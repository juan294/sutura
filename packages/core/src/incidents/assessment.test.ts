import { describe, expect, it } from 'vitest';
import { assessJobSupport } from './assess.js';
import { classifyIncident } from './classify.js';
import { RUNTIME_SUPPORT_CONTRACT, type JobAssessmentInput } from './types.js';

function nodeInput(): JobAssessmentInput {
  return {
    scope: { workflowPath: '.github/workflows/ci.yml', jobKey: 'unit', localTreeDigest: 'a'.repeat(64), remoteSourceSha: 'b'.repeat(40), repositoryId: 42, workflowId: 7 },
    target: { kind: 'installed-action', actionSha: 'c'.repeat(40), resolvedFromActionSha: 'c'.repeat(40), runtimeContractVersion: RUNTIME_SUPPORT_CONTRACT },
    observation: { complete: true, truncated: false, observedAt: '2026-10-25T10:00:00Z' },
    job: { command: 'pnpm test', services: 'absent', applicationSecrets: 'absent', nativePreparation: 'absent', privateDependencies: 'absent', dynamicConfiguration: 'absent', workspaceEvidenceComplete: true },
    files: { 'package.json': '{"name":"fixture","engines":{"node":">=22"},"scripts":{"test":"vitest run"}}', 'pnpm-lock.yaml': 'lockfileVersion: "9.0"\nimporters:\n  .: {}\n', '.nvmrc': '24' },
    paths: ['package.json', 'pnpm-lock.yaml', '.nvmrc', 'src/unit.test.ts'],
    snapshot: { complete: true, fileCount: 4, totalBytes: 1200, largestFileBytes: 800 },
  };
}
function pythonInput(): JobAssessmentInput {
  const input = nodeInput(); input.job.command = 'pytest';
  input.files = { 'pyproject.toml': '[project]\nname="fixture"\n', 'uv.lock': 'version=1\n[[package]]\nname="fixture"\nsource={editable="."}\n' };
  input.paths = ['pyproject.toml', 'uv.lock', 'tests/test_unit.py']; return input;
}

describe('shared static job assessment', () => {
  it('assesses a package-script Node job without claiming preparation, reproduction or execution authority', () => {
    const input = nodeInput(), before = structuredClone(input);
    const result = assessJobSupport(input);
    expect(result).toMatchObject({ support: 'candidate-supported', runtime: 'node', runtimeImage: 'node:24', evidenceStage: 'assessed',
      executionAuthorized: false, readiness: { assessed: 'observed', configured: 'unmeasured', prepared: 'unmeasured', reproduced: 'unmeasured', integrated: 'unmeasured' } });
    expect(result.coveredFailureClasses).toContain('typecheck');
    expect(input).toEqual(before);
  });
  it('assesses the supported Python root exception with frozen public dependencies', () => {
    expect(assessJobSupport(pythonInput())).toMatchObject({ support: 'candidate-supported', runtime: 'python' });
  });
  it('preserves static conclusions across source captures but discloses missing evidence', () => {
    // Actual CLI/Action adapter parity remains a phase 5/6 integration requirement.
    const local = nodeInput(); delete local.scope.remoteSourceSha;
    const remote = nodeInput(); delete remote.scope.localTreeDigest;
    const localResult = assessJobSupport(local), remoteResult = assessJobSupport(remote);
    expect(localResult.support).toBe('candidate-supported');
    expect(remoteResult.support).toBe(localResult.support);
    expect(remoteResult.runtimeImage).toBe(localResult.runtimeImage);
    expect(localResult.scope.remoteSourceSha).toBeUndefined();
    expect(remoteResult.scope.localTreeDigest).toBeUndefined();
    remote.observation.complete = false;
    expect(assessJobSupport(remote)).toMatchObject({ support: 'unknown', reason: 'incomplete-evidence' });
  });
  it('does not turn static fit into successful preparation when execution evidence reports a missing tool', () => {
    const assessment = assessJobSupport(nodeInput());
    const knownPreparationFailure = { tool: 'git', outcome: 'infra-stop' as const };
    const classification = classifyIncident({ assessment, trigger: { event: 'push', authenticated: true }, outcome: knownPreparationFailure.outcome,
      causeEvidence: { cause: 'installation', confidence: 'confirmed', digest: 'd'.repeat(64), scope: assessment.scope, complete: true } });
    expect(assessment.readiness.prepared).toBe('unmeasured');
    expect(assessment.readiness.reproduced).toBe('unmeasured');
    expect(classification).toMatchObject({ disposition: 'observe-only', outcome: 'infra-stop', executionAuthorized: false });
  });
  it.each(['services', 'applicationSecrets', 'nativePreparation', 'privateDependencies'] as const)('refuses selected job %s while other job capabilities do not change its result', capability => {
    const input = nodeInput(); input.job[capability] = 'present';
    expect(assessJobSupport(input).support).toBe('unsupported');
    expect(assessJobSupport(nodeInput()).support).toBe('candidate-supported');
  });
  it.each(['services', 'applicationSecrets', 'nativePreparation', 'privateDependencies', 'dynamicConfiguration'] as const)('leaves unknown %s unresolved', capability => {
    const input = nodeInput(); input.job[capability] = 'unknown';
    expect(assessJobSupport(input).support).toBe('unknown');
  });
  it('does not apply current runtime rules to old, unknown or wrongly bound Actions', () => {
    for (const target of [{ runtimeContractVersion: 'sutura-runtime-v0.3.9' }, { resolvedFromActionSha: 'd'.repeat(40) }]) {
      const input = nodeInput();
      if (input.target.kind === 'installed-action') input.target = { ...input.target, ...target };
      expect(assessJobSupport(input).reason).toBe('target-contract-unavailable');
    }
    const missing = nodeInput(); delete missing.target.actionSha;
    expect(assessJobSupport(missing).reason).toBe('target-contract-unavailable');
  });
  it('discloses missing scope, truncation, incomplete snapshot and ambiguous runtime', () => {
    const missing = nodeInput(); delete missing.scope.localTreeDigest; delete missing.scope.remoteSourceSha;
    expect(assessJobSupport(missing).reason).toBe('source-identity-unavailable');
    const truncated = nodeInput(); truncated.observation.truncated = true;
    expect(assessJobSupport(truncated).support).toBe('unknown');
    const snapshot = nodeInput(); snapshot.snapshot.complete = false;
    expect(assessJobSupport(snapshot).support).toBe('unknown');
    const polyglot = nodeInput(); polyglot.files = { ...polyglot.files, ...pythonInput().files }; polyglot.paths = [...polyglot.paths, ...pythonInput().paths]; polyglot.job.command = '';
    expect(assessJobSupport(polyglot).reason).toBe('runtime-ambiguous');
  });
  it('rejects snapshot overflow, escaping paths, unapproved metadata and unsafe npmrc without echoing content', () => {
    const large = nodeInput(); large.snapshot.totalBytes = 300 * 1024 * 1024;
    expect(assessJobSupport(large).reason).toBe('snapshot-unsupported');
    const escaping = nodeInput(); escaping.paths = ['../package.json'];
    expect(assessJobSupport(escaping).support).toBe('unsupported');
    const source = nodeInput(); source.files = { ...source.files, 'src/evil.ts': 'throw new Error("never execute");' };
    expect(assessJobSupport(source).support).toBe('unknown');
    const unsafe = nodeInput(); unsafe.files = { ...unsafe.files, '.npmrc': '//registry.npmjs.org/:_authToken=private-value' };
    const result = assessJobSupport(unsafe);
    expect(result.support).toBe('unsupported'); expect(JSON.stringify(result)).not.toContain('private-value');
  });
  it('preserves unsupported Node, Python local dependency and missing lock dispositions', () => {
    const old = nodeInput(); old.files = { ...old.files, '.nvmrc': '20' };
    expect(assessJobSupport(old).reason).toBe('runtime-version-unsupported');
    const python = pythonInput(); python.files = { ...python.files, 'uv.lock': 'version=1\n[[package]]\nname="external"\nsource={editable="../other"}\n' };
    expect(assessJobSupport(python).support).toBe('unsupported');
    const unlocked = nodeInput(); unlocked.files = { 'package.json': '{}' }; unlocked.paths = ['package.json'];
    expect(assessJobSupport(unlocked).reason).toBe('dependency-lock-unavailable');
  });
  it('supports bounded workspace syntax but requires complete selected workspace evidence', () => {
    const input = nodeInput(); input.files = { ...input.files, 'pnpm-workspace.yaml': 'packages:\n  - packages/*\n', 'packages/app/package.json': '{"name":"app"}' };
    input.paths = [...input.paths, 'pnpm-workspace.yaml', 'packages/app/package.json'];
    expect(assessJobSupport(input).support).toBe('candidate-supported');
    input.job.workspaceEvidenceComplete = false;
    expect(assessJobSupport(input).support).toBe('unknown');
  });
  it('does not execute hostile manifest scripts or resolve template expressions', () => {
    const input = nodeInput(); input.files = { ...input.files, 'package.json': '{"scripts":{"test":"touch /tmp/never-execute"}}' };
    const result = assessJobSupport(input);
    expect(result.executionAuthorized).toBe(false);
    input.job.dynamicConfiguration = 'present'; expect(assessJobSupport(input).support).toBe('unknown');
  });
});

describe('cause, trigger, disposition and outcome contracts', () => {
  it.each(['push', 'pull_request', 'schedule'])('does not exclude supported source evidence on %s', event => {
    const assessment = assessJobSupport(nodeInput());
    const result = classifyIncident({ assessment, trigger: { event, authenticated: true, actorId: 7 },
      causeEvidence: { cause: 'source-defect', confidence: 'confirmed', digest: 'd'.repeat(64), scope: assessment.scope, complete: true } });
    expect(result).toMatchObject({ cause: 'source-defect', confidence: 'confirmed', disposition: 'repair-supported', outcome: 'unmeasured', executionAuthorized: false });
  });
  it('keeps actor-only, incomplete or wrong-source evidence unknown and escalates', () => {
    const assessment = assessJobSupport(nodeInput());
    expect(classifyIncident({ assessment, trigger: { event: 'schedule', authenticated: true } }).cause).toBe('unknown');
    const result = classifyIncident({ assessment, trigger: { event: 'push', authenticated: true },
      causeEvidence: { cause: 'source-defect', confidence: 'confirmed', digest: 'd'.repeat(64), scope: { ...assessment.scope, remoteSourceSha: 'e'.repeat(40) }, complete: true } });
    expect(result).toMatchObject({ cause: 'unknown', disposition: 'escalation' });
  });
  it('preserves explicit protected exclusion and non-repair outcomes separately', () => {
    const result = classifyIncident({ assessment: assessJobSupport(nodeInput()), trigger: { event: 'push', authenticated: true },
      protectedPolicy: { schemaVersion: 'sutura-protected-repair-policy-v1', repair: 'excluded', sourceSha: 'f'.repeat(40), digest: 'd'.repeat(64), scope: nodeInput().scope }, outcome: 'infra-stop' });
    expect(result).toMatchObject({ disposition: 'intentionally-excluded', outcome: 'infra-stop', cause: 'unknown' });
  });
  it('never treats unsupported setup/resource cases as fixed', () => {
    const input = nodeInput(); input.job.nativePreparation = 'present';
    const assessment = assessJobSupport(input);
    const result = classifyIncident({ assessment, trigger: { event: 'push', authenticated: true },
      causeEvidence: { cause: 'provider-resource', confidence: 'confirmed', digest: 'd'.repeat(64), scope: assessment.scope, complete: true } });
    expect(result).toMatchObject({ disposition: 'observe-only', cause: 'provider-resource', ownerDomain: 'provider', outcome: 'unmeasured' });
  });
});

describe('assessment integrity and cause boundaries', () => {
  it('rejects invalid observations and inconsistent metadata identities without echoing extra payload', () => {
    const input = nodeInput(); input.observation.observedAt = '2026-10-25 (private-value)';
    const result = assessJobSupport(input);
    expect(result.support).toBe('unknown'); expect(JSON.stringify(result)).not.toContain('private-value');
    const wrong = nodeInput(); wrong.scope.remoteSourceSha = 'wrong';
    expect(assessJobSupport(wrong).support).toBe('unknown');
  });
  it('does not claim candidate support from an empty lock or absent manifest', () => {
    const empty = nodeInput(); empty.files = { ...empty.files, 'pnpm-lock.yaml': '{}' };
    expect(assessJobSupport(empty).support).toBe('unknown');
    const missing = nodeInput(); missing.files = { 'pnpm-lock.yaml': 'lockfileVersion: 9\nimporters: {}' };
    expect(assessJobSupport(missing).support).toBe('unknown');
  });
  it('escalates internal faults even when the selected environment is unsupported', () => {
    const input = nodeInput(); input.job.services = 'present'; const assessment = assessJobSupport(input);
    const result = classifyIncident({ assessment, trigger: { event: 'push', authenticated: true },
      causeEvidence: { cause: 'sutura-internal', confidence: 'confirmed', digest: 'd'.repeat(64), scope: assessment.scope, complete: true } });
    expect(result.disposition).toBe('escalation');
  });
});


describe('reviewed support boundaries', () => {
  it('does not invent a per-source-file snapshot limit', () => {
    const input = nodeInput(); input.snapshot.totalBytes = 20_000_000; input.snapshot.largestFileBytes = 12_000_000;
    expect(assessJobSupport(input).support).toBe('candidate-supported');
  });
  it.each(['git+https://github.com/example/package.git', 'file:../external', 'https://private.example/package.tgz'])('checks nested workspace manifest origin %s', origin => {
    const input = nodeInput(); input.files = { ...input.files, 'pnpm-workspace.yaml': 'packages: [packages/*]',
      'packages/app/package.json': JSON.stringify({ name: 'app', dependencies: { external: origin } }) };
    input.paths = [...input.paths, 'pnpm-workspace.yaml', 'packages/app/package.json'];
    expect(assessJobSupport(input)).toMatchObject({ support: 'unsupported', reason: 'dependency-origin-unsupported' });
  });
  it('rejects malformed nested manifests', () => {
    const input = nodeInput(); input.files = { ...input.files, 'packages/app/package.json': '{invalid' };
    expect(assessJobSupport(input).support).toBe('unknown');
  });
  it('does not apply a protected exclusion to another repository or workflow', () => {
    const assessment = assessJobSupport(nodeInput());
    for (const scope of [{ ...assessment.scope, repositoryId: 999 }, { ...assessment.scope, workflowPath: '.github/workflows/other.yml' }]) {
      const protectedPolicy = { schemaVersion: 'sutura-protected-repair-policy-v1' as const, repair: 'excluded' as const, sourceSha: 'f'.repeat(40), digest: 'd'.repeat(64), scope };
      expect(classifyIncident({ assessment, trigger: { event: 'push', authenticated: true }, protectedPolicy })).toMatchObject({ disposition: 'escalation', reason: 'protected-policy-scope-unavailable' });
    }
  });
});


describe('packaged-runtime and installed-action target boundaries', () => {
  function packagedInput(): JobAssessmentInput {
    const input = nodeInput(); delete input.scope.remoteSourceSha; delete input.scope.repositoryId; delete input.scope.workflowId;
    input.target = { kind: 'packaged-runtime', runtimeContractVersion: RUNTIME_SUPPORT_CONTRACT,
      packageVersion: '0.3.9-dev.1', packageTreeDigest: 'e'.repeat(64), resolvedFromPackageTreeDigest: 'e'.repeat(64) };
    return input;
  }
  it('assesses a new repository against a known packaged runtime without an installed Action', () => {
    const result = assessJobSupport(packagedInput());
    expect(result).toMatchObject({ support: 'candidate-supported', confidence: 'suspected', target: { kind: 'packaged-runtime' },
      readiness: { configured: 'unmeasured', activated: 'unmeasured', prepared: 'unmeasured', reproduced: 'unmeasured' }, executionAuthorized: false });
    expect(result.target).not.toHaveProperty('actionSha');
    expect(result.scope.remoteSourceSha).toBeUndefined();
  });
  it.each(['packageTreeDigest', 'resolvedFromPackageTreeDigest', 'packageVersion'] as const)('keeps missing packaged %s unknown', field => {
    const input = packagedInput(); delete input.target[field];
    expect(assessJobSupport(input).support).toBe('unknown');
  });
  it('rejects mismatched packaged tree evidence and unknown packaged capability version', () => {
    const input = packagedInput(); Object.assign(input.target, { resolvedFromPackageTreeDigest: 'f'.repeat(64) });
    expect(assessJobSupport(input).support).toBe('unknown');
    input.target = { ...packagedInput().target, runtimeContractVersion: 'future-runtime-unknown' };
    expect(assessJobSupport(input).support).toBe('unknown');
  });
  it.each(['', 'v 1', '1\nsecret', '../runtime', 'a'.repeat(81)])('rejects unsafe or unbounded package version %j', packageVersion => {
    const input = packagedInput(); Object.assign(input.target, { packageVersion });
    expect(assessJobSupport(input).support).toBe('unknown');
  });
  it('rejects mixed identities in both target directions, even an explicitly undefined foreign field', () => {
    const packaged = packagedInput(); Object.assign(packaged.target, { actionSha: 'c'.repeat(40), resolvedFromActionSha: 'c'.repeat(40) });
    expect(assessJobSupport(packaged).support).toBe('unknown');
    const installed = nodeInput(); Object.assign(installed.target, { packageTreeDigest: 'e'.repeat(64) });
    expect(assessJobSupport(installed).support).toBe('unknown');
    const undefinedField = packagedInput(); Object.assign(undefinedField.target, { actionSha: undefined });
    expect(assessJobSupport(undefinedField).support).toBe('unknown');
  });
  it('does not certify an old installed Action using the packaged runtime or an untagged target', () => {
    const installed = nodeInput(); installed.target.runtimeContractVersion = 'old-runtime';
    expect(assessJobSupport(packagedInput()).support).toBe('candidate-supported');
    expect(assessJobSupport(installed).support).toBe('unknown');
    const untagged = nodeInput(); Reflect.deleteProperty(untagged.target, 'kind');
    expect(assessJobSupport(untagged).support).toBe('unknown');
  });
});


describe('explicit workspace metadata shapes', () => {
  it.each([42, null, 'packages/*', { packages: 'packages/*' }, { unknown: [] }, [42], { packages: [false] }].map(workspaces => ({ workspaces })))('leaves malformed workspace shape $workspaces unknown', ({ workspaces }) => {
    const input = nodeInput(); input.files = { ...input.files, 'package.json': JSON.stringify({ name: 'fixture', workspaces }) };
    expect(assessJobSupport(input)).toMatchObject({ support: 'unknown', reason: 'dependency-metadata-unsupported' });
  });
  it.each([['packages/*'], { packages: ['packages/*'] }].map(workspaces => ({ workspaces })))('keeps supported workspace shape $workspaces eligible', ({ workspaces }) => {
    const input = nodeInput(); input.files = { ...input.files, 'package.json': JSON.stringify({ name: 'fixture', workspaces }),
      'packages/app/package.json': '{"name":"app","dependencies":{"public-package":"1.0.0"}}' };
    input.paths = [...input.paths, 'packages/app/package.json'];
    expect(assessJobSupport(input).support).toBe('candidate-supported');
  });
});
