import { admitNativeCommand } from '../engine/native-command-admission.js';
import { parseDocument } from 'yaml';
import { assessPythonDeclarations } from './python-declarations.js';
import { detectRuntime, RuntimeDetectionError } from '../runtime/detect.js';
import { nodeImageRefForDeclarations } from '../runtime/node.js';
import { PYTHON_IMAGE_REF, validatePythonDependencyContents } from '../runtime/python.js';
import { assertSafeNpmrcContent, isPublicSnapshotPath } from '../security/snapshot-inputs.js';
import { INCIDENT_ASSESSMENT_VERSION, RUNTIME_SUPPORT_CONTRACT, type JobAssessmentInput, type JobAssessmentRecord, type SupportVerdict, type TargetRuntimeContract } from './types.js';

export const ASSESSMENT_BOUNDS = Object.freeze({ metadataFiles: 256, metadataFileBytes: 1_048_576,
  metadataTotalBytes: 4_194_304, snapshotFiles: 10_000, snapshotBytes: 268_435_456 });
const SHA = /^[a-f0-9]{40}$/u, DIGEST = /^[a-f0-9]{64}$/u;
const METADATA = /^(?:(?:[^/]+\/)*package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|\.nvmrc|\.npmrc|pyproject\.toml|uv\.lock|requirements\.txt|poetry\.lock)$/u;
const NODE_LOCKS = ['pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock'];
const CAPABILITIES = ['services', 'applicationSecrets', 'nativePreparation', 'privateDependencies'] as const;
function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function yaml(content: string): unknown {
  const parsed = parseDocument(content, { uniqueKeys: true });
  if (parsed.errors.length || parsed.warnings.length) throw new Error('unsupported-yaml');
  return parsed.toJS({ maxAliasCount: 0 }) as unknown;
}
function assertSupportedWorkspacePatterns(manifest: Record<string, unknown>, files: Readonly<Record<string, string>>): void {
  const workspace = manifest.workspaces;
  const patterns: unknown[] = [];
  if (workspace !== undefined) {
    const declared = Array.isArray(workspace) ? workspace : object(workspace)?.packages;
    if (!Array.isArray(declared)) throw new Error('workspace-format-unsupported');
    patterns.push(...declared);
  }
  if (files['pnpm-workspace.yaml'] !== undefined) {
    const packages = object(yaml(files['pnpm-workspace.yaml']))?.packages;
    if (!Array.isArray(packages)) throw new Error('workspace-format-unsupported');
    patterns.push(...packages);
  }
  if (!patterns.every(pattern => typeof pattern === 'string' && pattern !== '' && !pattern.startsWith('/') &&
      !pattern.startsWith('!') && !pattern.includes('\\') && !/[{}[\]]/u.test(pattern) &&
      !pattern.split('/').some(segment => segment === '..' || (segment.includes('*') && segment !== '*' && segment !== '**')))) {
    throw new Error('workspace-pattern-unsupported');
  }
}
function nonPublicDependencyOrigin(value: unknown): boolean {
  const pending: unknown[] = [value];
  let visited = 0;
  while (pending.length) {
    if (++visited > 50_000) throw new Error('dependency-evidence-limit');
    const item = pending.pop();
    if (typeof item === 'string') {
      if (/^(?:git\+|git:|ssh:|file:|link:|github:|gitlab:|bitbucket:)/u.test(item)) return true;
      if (/^https?:\/\//u.test(item)) {
        const url = new URL(item);
        if (url.username || url.password || !['registry.npmjs.org', 'registry.yarnpkg.com', 'pypi.org', 'files.pythonhosted.org'].includes(url.hostname)) return true;
      }
    } else if (Array.isArray(item)) pending.push(...item);
    else if (object(item)) pending.push(...Object.values(item as Record<string, unknown>));
  }
  return false;
}
function supportedTarget(target: TargetRuntimeContract): boolean {
  if (target.runtimeContractVersion !== RUNTIME_SUPPORT_CONTRACT) return false;
  if (target.kind === 'installed-action') {
    return Object.keys(target).every(key => ['kind', 'runtimeContractVersion', 'actionSha', 'resolvedFromActionSha'].includes(key)) &&
      typeof target.actionSha === 'string' && SHA.test(target.actionSha) && target.resolvedFromActionSha === target.actionSha;
  }
  if (target.kind === 'packaged-runtime') {
    return Object.keys(target).every(key => ['kind', 'runtimeContractVersion', 'packageVersion', 'packageTreeDigest', 'resolvedFromPackageTreeDigest'].includes(key)) &&
      typeof target.packageVersion === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/u.test(target.packageVersion) &&
      typeof target.packageTreeDigest === 'string' && DIGEST.test(target.packageTreeDigest) &&
      target.resolvedFromPackageTreeDigest === target.packageTreeDigest;
  }
  return false;
}
function observationTime(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) return undefined;
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return undefined;
  const canonical = new Date(millis).toISOString();
  return canonical === (value.includes('.') ? value : value.replace('Z', '.000Z')) ? value : undefined;
}
function base(input: JobAssessmentInput): JobAssessmentRecord {
  const observedAt = observationTime(input.observation.observedAt);
  return { schemaVersion: INCIDENT_ASSESSMENT_VERSION, scope: { ...input.scope }, target: { ...input.target },
    observation: { complete: input.observation.complete, truncated: input.observation.truncated,
      ...(observedAt === undefined ? {} : { observedAt }) }, support: 'unknown', reason: 'assessment-evidence-unavailable', confidence: 'unknown',
    coveredFailureClasses: [], requiredInput: [], nextAction: 'Collect complete metadata for the selected job.', evidenceStage: 'assessed',
    readiness: { assessed: 'observed', configured: 'unmeasured', activated: 'unmeasured', prepared: 'unmeasured', reproduced: 'unmeasured', 'native-verified': 'unmeasured', integrated: 'unmeasured' },
    executionAuthorized: false };
}
function stop(record: JobAssessmentRecord, support: SupportVerdict, reason: string, requiredInput: string, nextAction: string): JobAssessmentRecord {
  return { ...record, support, reason, confidence: support === 'unsupported' ? 'confirmed' : 'unknown', requiredInput: [requiredInput], nextAction };
}

/** Pure, bounded evaluation of adapter-supplied metadata. It performs no reads, execution or network access. */
export function assessJobSupport(input: JobAssessmentInput): JobAssessmentRecord {
  let record = base(input);
  if (!record.observation.observedAt) {
    return stop(record, 'unknown', 'observation-time-unavailable', 'valid-observation-time', 'Capture a valid UTC observation timestamp without changing the source evidence.');
  }
  if ((!input.scope.localTreeDigest && !input.scope.localMetadataDigest && !input.scope.remoteSourceSha) ||
      (input.scope.localTreeDigest !== undefined && !DIGEST.test(input.scope.localTreeDigest)) ||
      (input.scope.localMetadataDigest !== undefined && !DIGEST.test(input.scope.localMetadataDigest)) ||
      (input.scope.remoteSourceSha !== undefined && !SHA.test(input.scope.remoteSourceSha))) {
    return stop(record, 'unknown', 'source-identity-unavailable', 'source-identity', 'Capture the bounded metadata digest, selected local tree digest or authenticated remote source SHA.');
  }
  if (!supportedTarget(input.target)) {
    return stop(record, 'unknown', 'target-contract-unavailable', 'target-runtime-contract',
      'Bind the runtime capability contract to either the exact installed Action SHA or the identified local package tree; keep their identities separate.');
  }
  if (!input.observation.complete || input.observation.truncated || !input.snapshot.complete) {
    return stop(record, 'unknown', 'incomplete-evidence', 'complete-selected-job-evidence', 'Repeat the bounded metadata capture and disclose any remaining truncation.');
  }
  const admission = admitNativeCommand(input.job.command);
  if (admission) return stop(record, 'unsupported', admission.reason, 'coordinator-source-evidence', admission.nextAction);
  if (CAPABILITIES.some(key => input.job[key] === 'present')) {
    return stop(record, 'unsupported', 'selected-job-capability-unsupported', 'self-contained-selected-job', 'Select a job without application secrets, services, private dependencies or native preparation, or supply a reviewed adapter.');
  }
  if (CAPABILITIES.some(key => input.job[key] !== 'absent') || input.job.dynamicConfiguration !== 'absent') {
    return stop(record, 'unknown', 'selected-job-capability-unknown', 'resolved-selected-job-capabilities', 'Resolve dynamic configuration and unknown capabilities for this selected job.');
  }
  if (![input.snapshot.fileCount, input.snapshot.totalBytes, input.snapshot.largestFileBytes].every(value => Number.isSafeInteger(value) && value >= 0)) {
    return stop(record, 'unknown', 'snapshot-evidence-invalid', 'bounded-snapshot-metadata', 'Capture file counts and byte sizes without following escaping links.');
  }
  if (input.snapshot.fileCount > ASSESSMENT_BOUNDS.snapshotFiles || input.snapshot.totalBytes > ASSESSMENT_BOUNDS.snapshotBytes) {
    return stop(record, 'unsupported', 'snapshot-unsupported', 'bounded-snapshot', 'Reduce the selected source scope or obtain a reviewed snapshot capability; retain diagnosis only.');
  }
  const entries = Object.entries(input.files);
  if (entries.length > ASSESSMENT_BOUNDS.metadataFiles || input.paths.length > ASSESSMENT_BOUNDS.snapshotFiles ||
      entries.some(([path, content]) => !METADATA.test(path) || typeof content !== 'string' || Buffer.byteLength(content) > ASSESSMENT_BOUNDS.metadataFileBytes) ||
      entries.reduce((bytes, [, content]) => bytes + Buffer.byteLength(content), 0) > ASSESSMENT_BOUNDS.metadataTotalBytes) {
    return stop(record, 'unknown', 'metadata-scope-or-bound-exceeded', 'bounded-allowlisted-metadata', 'Supply only bounded manifests, lockfiles and runtime configuration for the selected root.');
  }
  if (input.paths.some(path => !isPublicSnapshotPath(path)) || entries.some(([path]) => !isPublicSnapshotPath(path))) {
    return stop(record, 'unsupported', 'snapshot-path-unsupported', 'safe-snapshot-paths', 'Remove private, installed-dependency or escaping paths from the selected snapshot.');
  }
  if (input.files['.npmrc'] !== undefined) {
    try { assertSafeNpmrcContent(input.files['.npmrc'], '.npmrc'); }
    catch { return stop(record, 'unsupported', 'npm-configuration-unsupported', 'safe-npm-configuration', 'Retain only supported boolean npm settings; do not supply registry credentials.'); }
  }
  let runtime;
  try {
    runtime = detectRuntime({ paths: [...new Set([...input.paths, ...Object.keys(input.files)])], failingCommand: input.job.command,
      ...(input.job.configuredRuntime === undefined ? {} : { configuredRuntime: input.job.configuredRuntime }) });
  } catch (error) {
    return stop(record, 'unknown', error instanceof RuntimeDetectionError ? error.code : 'runtime-evidence-invalid',
      'selected-runtime', 'Choose the intended runtime for the selected root and job.');
  }
  record = { ...record, runtime: runtime.id };
  if (runtime.id === 'python') {
    const declarationFit = assessPythonDeclarations(input.files['pyproject.toml'], input.files['uv.lock']);
    if (declarationFit === 'unknown') {
      return stop(record, 'unknown', 'python-runtime-declaration-unknown', 'unambiguous-python-declarations', 'Capture supported static project and lock requires-python declarations for the advertised interpreter.');
    }
    if (declarationFit === 'incompatible') {
      return stop(record, 'unsupported', 'runtime-version-unsupported', 'supported-python-declarations', 'Select a job whose project and lock declarations admit the advertised Python interpreter; no runtime is changed automatically.');
    }
    try {
      validatePythonDependencyContents({ pyproject: input.files['pyproject.toml'] ?? null, uvLock: input.files['uv.lock'] ?? null,
        requirements: input.files['requirements.txt'] ?? null, poetryLock: input.files['poetry.lock'] ?? null });
      record.runtimeImage = PYTHON_IMAGE_REF;
    } catch {
      return stop(record, 'unsupported', 'python-dependencies-unsupported', 'supported-python-lock', 'Use frozen public uv dependencies or exact hashed binary requirements without external editable, VCS or source-build dependencies.');
    }
  } else {
    try {
      record.runtimeImage = nodeImageRefForDeclarations({ ...(input.files['.nvmrc'] === undefined ? {} : { nvmrc: input.files['.nvmrc'] }),
        ...(input.files['package.json'] === undefined ? {} : { packageJson: input.files['package.json'] }) });
    } catch {
      return stop(record, 'unsupported', 'runtime-version-unsupported', 'supported-node-declarations', 'Use mutually compatible Node 22 or 24 declarations; no runtime is changed automatically.');
    }
    const locks = NODE_LOCKS.filter(path => input.files[path] !== undefined);
    if (locks.length !== 1) return stop(record, 'unknown', 'dependency-lock-unavailable', 'one-selected-node-lock', 'Capture the selected package manager lockfile and resolve ambiguous lock roots.');
    try {
      const manifest = object(JSON.parse(input.files['package.json'] ?? 'null'));
      if (!manifest) throw new Error('manifest-object-required');
      const manifests = [manifest, ...entries.filter(([path]) => path.endsWith('/package.json')).map(([, content]) => {
        const parsed = object(JSON.parse(content));
        if (!parsed) throw new Error('manifest-object-required');
        return parsed;
      })];
      assertSupportedWorkspacePatterns(manifest, input.files);
      if (!input.job.workspaceEvidenceComplete) return stop(record, 'unknown', 'workspace-evidence-incomplete', 'workspace-manifests', 'Capture all manifests used by the selected workspace without widening repository scope.');
      const lockPath = locks[0]!;
      // Yarn Classic's non-YAML format remains unknown until a bounded adapter supplies it.
      if (lockPath === 'yarn.lock' && input.files[lockPath]!.includes('# yarn lockfile v1')) {
        return stop(record, 'unknown', 'lock-adapter-unavailable', 'yarn-classic-lock-adapter', 'Supply a bounded Yarn Classic lock adapter; retain diagnosis without certifying preparation.');
      }
      const lock = lockPath.endsWith('.json') ? JSON.parse(input.files[lockPath]!) as unknown : yaml(input.files[lockPath]!);
      const lockObject = object(lock);
      if (!lockObject) throw new Error('lock-object-required');
      if (lockPath === 'pnpm-lock.yaml' ?
        !['string', 'number'].includes(typeof lockObject.lockfileVersion) || !object(lockObject.importers) :
        lockPath === 'yarn.lock' ? !object(lockObject.__metadata) :
        ![1, 2, 3].includes(lockObject.lockfileVersion as number)) throw new Error('lock-format-unsupported');
      if (nonPublicDependencyOrigin(lock) || manifests.some(value => nonPublicDependencyOrigin([value.dependencies, value.devDependencies, value.optionalDependencies, value.peerDependencies]))) {
        return stop(record, 'unsupported', 'dependency-origin-unsupported', 'public-locked-dependencies', 'Use public locked dependencies or supply a reviewed dependency preparation adapter.');
      }
    } catch {
      return stop(record, 'unknown', 'dependency-metadata-unsupported', 'parseable-bounded-dependency-metadata', 'Resolve malformed or unsupported workspace/lock metadata without running repository scripts.');
    }
  }
  return { ...record, support: 'candidate-supported', reason: 'static-job-fit', confidence: 'suspected',
    coveredFailureClasses: ['test-assertion', 'test-bug', 'typecheck', 'lint', 'build', 'dep-upstream-breaking'],
    requiredInput: ['authorized-preparation-and-reproduction'],
    nextAction: 'Review provider access and the selected execution scope; static fit does not prove preparation or reproduction.' };
}
