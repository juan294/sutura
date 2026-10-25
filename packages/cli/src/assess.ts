import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSESSMENT_BOUNDS, RUNTIME_SUPPORT_CONTRACT, assessJobSupport, extractAssessmentJobs, isPublicSnapshotPath,
  parseAssessmentWorkflow, selectAssessmentMetadata, type JobAssessmentRecord, type TargetRuntimeContract } from '@sutura/core';
import { VERSION } from './args.js';

const LIMITS = Object.freeze({ ...ASSESSMENT_BOUNDS, entries: 12_000, depth: 16, elapsedMs: 5_000, jobs: 512 });
const METADATA = /^(?:(?:[^/]+\/)*package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|\.nvmrc|pyproject\.toml|uv\.lock|requirements\.txt|poetry\.lock)$/u;
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/u;
const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
export interface RepositoryAssessment {
  schemaVersion: 'sutura-repository-assessment-v1';
  root: string;
  scopeKind: 'metadata-only';
  scopeDigest: string;
  inputs: readonly { path: string; sha256: string }[];
  complete: boolean;
  bounds: { limits: typeof LIMITS; observed: { entries: number; metadataFiles: number; metadataBytes: number; snapshotFiles: number; snapshotBytes: number; elapsedMs: number } };
  jobs: JobAssessmentRecord[];
  warnings: string[];
  nextAction: string;
}
export interface AssessRepositoryOptions { target?: TargetRuntimeContract; now?: () => Date }

/** Identify the executing bundled runtime only. Source/development execution has no invented package identity. */
async function packagedTarget(): Promise<TargetRuntimeContract> {
  const path = fileURLToPath(import.meta.url);
  if (basename(path) !== 'bin.js') return { kind: 'packaged-runtime' };
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await handle.stat();
    if (!info.isFile() || info.size > 32 * 1_048_576) return { kind: 'packaged-runtime' };
    const bytes = Buffer.alloc(info.size + 1), read = await handle.read(bytes, 0, bytes.length, 0);
    if (read.bytesRead !== info.size) return { kind: 'packaged-runtime' };
    const digest = hash(bytes.subarray(0, info.size));
    return { kind: 'packaged-runtime', packageVersion: VERSION, runtimeContractVersion: RUNTIME_SUPPORT_CONTRACT,
      packageTreeDigest: digest, resolvedFromPackageTreeDigest: digest };
  } catch { return { kind: 'packaged-runtime' }; }
  finally { await handle?.close(); }
}

/** Read bounded public metadata from one root. Never execute repository code, read credential files, or contact a provider. */
export async function assessRepository(requestedRoot: string, options: AssessRepositoryOptions = {}): Promise<RepositoryAssessment> {
  const monotonicStart = performance.now();
  const now = options.now ?? (() => new Date()), start = now(), target = options.target ?? await packagedTarget();
  const root = await realpath(resolve(requestedRoot));
  if (root === parse(root).root || root === await realpath(homedir())) throw new Error('assessment-requires-selected-repository-root');
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory()) throw new Error('assessment-root-not-directory');
  const warnings = new Set<string>(), files: Record<string, string> = Object.create(null) as Record<string, string>;
  const workflows: Record<string, string> = Object.create(null) as Record<string, string>;
  const inputs: { path: string; sha256: string }[] = [], paths: string[] = [], metadata: { path: string; bytes: number }[] = [];
  const observed = { entries: 0, metadataFiles: 0, metadataBytes: 0, snapshotFiles: 0, snapshotBytes: 0, elapsedMs: 0 };
  let complete = true, largest = 0, npmrc = false;
  const incomplete = (warning: string): void => { complete = false; warnings.add(warning); };
  const elapsed = (): number => Math.max(0, performance.now() - monotonicStart, now().getTime() - start.getTime());
  async function walk(relative: string, depth: number): Promise<void> {
    if (elapsed() > LIMITS.elapsedMs) { incomplete('elapsed-limit'); return; }
    const absolute = join(root, relative);
    const before = await lstat(absolute), canonical = await realpath(absolute);
    if (!before.isDirectory() || before.isSymbolicLink() || (canonical !== root && !canonical.startsWith(root + sep))) { incomplete('directory-link-or-change'); return; }
    const directory = await opendir(absolute);
    for await (const entry of directory) {
      if (++observed.entries > LIMITS.entries || elapsed() > LIMITS.elapsedMs) { incomplete('entry-or-elapsed-limit'); break; }
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (!isPublicSnapshotPath(path)) continue;
      const full = join(root, path), info = await lstat(full);
      if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) { incomplete('link-or-nonregular-input'); continue; }
      if (info.isDirectory()) {
        if (depth >= LIMITS.depth) incomplete('directory-depth-limit');
        else await walk(path, depth + 1);
        if (observed.entries > LIMITS.entries || elapsed() > LIMITS.elapsedMs) break;
        continue;
      }
      observed.snapshotFiles += 1; observed.snapshotBytes += info.size; largest = Math.max(largest, info.size);
      if (observed.snapshotFiles > LIMITS.snapshotFiles || observed.snapshotBytes > LIMITS.snapshotBytes) { incomplete('snapshot-limit'); break; }
      paths.push(path); metadata.push({ path, bytes: info.size });
      if (entry.name.toLowerCase() === '.npmrc') { npmrc = true; warnings.add('npm-configuration-not-read'); continue; }
      if (!METADATA.test(path) && !WORKFLOW.test(path)) continue;
      if (observed.metadataFiles >= LIMITS.metadataFiles || info.size > LIMITS.metadataFileBytes || observed.metadataBytes + info.size > LIMITS.metadataTotalBytes) {
        incomplete('metadata-limit'); continue;
      }
      const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const actual = await handle.stat(), physical = await realpath(full);
        if (!actual.isFile() || actual.dev !== info.dev || actual.ino !== info.ino || actual.size !== info.size || !physical.startsWith(root + sep)) { incomplete('metadata-changed'); continue; }
        const bytes = Buffer.alloc(info.size + 1), read = await handle.read(bytes, 0, bytes.length, 0), after = await handle.stat();
        if (read.bytesRead !== info.size || after.size !== info.size || after.mtimeMs !== actual.mtimeMs) { incomplete('metadata-changed'); continue; }
        const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, info.size));
        observed.metadataFiles += 1; observed.metadataBytes += info.size;
        inputs.push({ path, sha256: hash(bytes.subarray(0, info.size)) });
        if (WORKFLOW.test(path)) workflows[path] = content; else files[path] = content;
      } finally { await handle.close(); }
    }
  }
  try { await walk('', 0); } catch { incomplete('metadata-unreadable-or-changed'); }
  inputs.sort((a, b) => a.path.localeCompare(b.path)); metadata.sort((a, b) => a.path.localeCompare(b.path)); paths.sort();
  const scopeDigest = hash(JSON.stringify({ kind: 'metadata-only', inputs, metadata }));
  let selectedFiles: Readonly<Record<string, string>> = files;
  try { selectedFiles = selectAssessmentMetadata(files); } catch { incomplete('workspace-metadata-unavailable'); }
  const parsed: { workflowPath: string; jobKey: string; job: ReturnType<typeof extractAssessmentJobs>[number]['job'] }[] = [];
  for (const [workflowPath, content] of Object.entries(workflows).sort(([a], [b]) => a.localeCompare(b))) {
    try {
      for (const selected of extractAssessmentJobs(parseAssessmentWorkflow(content), selectedFiles)) {
        if (parsed.length >= LIMITS.jobs) { incomplete('job-limit'); break; }
        if (npmrc) selected.job.privateDependencies = 'unknown';
        parsed.push({ workflowPath, ...selected });
      }
    } catch { incomplete('workflow-data-unavailable'); }
  }
  observed.elapsedMs = elapsed();
  if (observed.elapsedMs > LIMITS.elapsedMs) incomplete('elapsed-limit');
  if (!target.runtimeContractVersion) warnings.add('packaged-runtime-identity-unavailable');
  const jobs = parsed.map(({ workflowPath, jobKey, job }) => assessJobSupport({
    scope: { workflowPath, jobKey, localMetadataDigest: scopeDigest }, target,
    observation: { complete, truncated: !complete, observedAt: start.toISOString() }, job: { ...job, workspaceEvidenceComplete: complete }, files: selectedFiles, paths,
    snapshot: { complete, fileCount: observed.snapshotFiles, totalBytes: observed.snapshotBytes, largestFileBytes: largest },
  }));
  return { schemaVersion: 'sutura-repository-assessment-v1', root, scopeKind: 'metadata-only', scopeDigest, inputs, complete,
    bounds: { limits: LIMITS, observed }, jobs, warnings: [...warnings].sort(),
    nextAction: !complete ? 'Resolve the reported scan limits or missing metadata and run sutura assess again.' : !jobs.length ?
      'Add or select a GitHub Actions verification workflow, then run sutura assess again.' : jobs.every(job => job.support === 'candidate-supported') ?
        'Review sutura setup plan; preparation and reproduction still require explicit execution authority.' :
        'Review each job nextAction and resolve unsupported or unknown prerequisites before setup.' };
}
