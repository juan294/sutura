import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import { reproductionProfile, PROFILE_FILES } from '../policy/reproduction-profile.test-helper.js';
import { captureNodeDiagnostics } from './native-diagnostics.js';
import { resolveReproductionPlan, isResolvedReproductionPlan } from './reproduction-plan.js';
const workflowPath = '.github/workflows/ci.yml';
const sources = { ...PROFILE_FILES, [workflowPath]: 'jobs:\n  unit:\n    steps:\n      - name: Tests\n        run: node scripts/test-select.mjs run terminal:rest\n' };
const profile = reproductionProfile({ sourceInputs: Object.entries(sources).map(([path, bytes]) => ({ path, sha256: createHash('sha256').update(bytes).digest('hex') })) });
const binding = { repository: 'example/project', sourceSha: 'a'.repeat(40), runId: '42', attempt: 1, jobId: 7, stepNumber: 3, workflowPath, jobName: 'unit', stepName: 'Tests', runtimeVersion: '22.22.2' };
const log = readFileSync(new URL('../github/__fixtures__/native-node-two-failures.log', import.meta.url), 'utf8');
const native = captureNodeDiagnostics(log, binding, 'normal');
function input() { return { policy: { ...createDefaultRepositoryPolicy(), reproductionProfiles: [profile] }, policySha256: 'b'.repeat(64), command: profile.nativeCommand, runtimeId: 'node' as const, sourceSha: binding.sourceSha, native, sources }; }
it('maps a protected exact wrapper to all native failing files while keeping full verification unchanged', () => {
  const result = resolveReproductionPlan(input());
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw Error(JSON.stringify(result));
  expect(result.plan.probeCommand).toContain('test/terminal/storage.test.mjs');
  expect(result.plan.probeCommand).toContain('test/terminal/clock.test.mjs');
  expect(result.plan.fullCommand).toBe(profile.nativeCommand);
  expect(result.plan.policy.protectedPaths).toEqual(expect.arrayContaining(profile.sourceInputs.map(item => item.path)));
  expect(isResolvedReproductionPlan(result.plan)).toBe(true);
  expect(isResolvedReproductionPlan(JSON.parse(JSON.stringify(result.plan)))).toBe(false);
});
it('names stale, missing and policy-denied inputs with a review action', () => {
  for (const change of [
    { sources: { ...sources, 'scripts/test-select.mjs': 'changed' } },
    { sources: { 'package.json': sources['package.json'] } },
    { policy: { ...input().policy, deniedReadPaths: ['scripts/**'] } },
  ]) {
    expect(resolveReproductionPlan({ ...input(), ...change })).toMatchObject({ status: 'stopped', nextAction: expect.stringContaining('.sutura.json') });
  }
});
it('rejects wrong source, runtime, cwd, incomplete and serialized native evidence', () => {
  for (const change of [
    { sourceSha: 'c'.repeat(40) }, { runtimeId: 'python' as const },
    { policy: { ...input().policy, reproductionProfiles: [{ ...profile, cwd: 'packages/elsewhere' }] } },
    { native: captureNodeDiagnostics(log, { ...binding, runtimeVersion: '22.23.4' }, 'normal') },
    { native: captureNodeDiagnostics(log, binding, 'unknown') },
    { native: JSON.parse(JSON.stringify(native)) },
  ]) expect(resolveReproductionPlan({ ...input(), ...change }).status).toBe('stopped');
});
it('defers unrelated direct commands rather than declaring arbitrary wrappers supported', () => {
  expect(resolveReproductionPlan({ ...input(), command: 'node --test test/unit.mjs' }).status).toBe('not-profiled');
});
it('accepts a literal YAML command and resolves repository-relative files under a non-root cwd', () => {
  const nested = { ...sources, 'packages/app/scripts/test-select.mjs': PROFILE_FILES['scripts/test-select.mjs'], [workflowPath]: 'jobs:\n  unit:\n    defaults:\n      run:\n        working-directory: packages/app\n    steps:\n      - name: Tests\n        run: |\n          node scripts/test-select.mjs run terminal:rest\n' };
  const selected = reproductionProfile({ cwd: 'packages/app', sourceInputs: Object.entries(nested).map(([path, content]) => ({ path, sha256: createHash('sha256').update(content).digest('hex') })) });
  const evidence = captureNodeDiagnostics(log.replaceAll('test/terminal/', 'packages/app/test/terminal/'), binding, 'normal');
  const result = resolveReproductionPlan({ ...input(), sources: nested, native: evidence, sourcePaths: [...Object.keys(nested), 'packages/app/test/terminal/storage.test.mjs', 'packages/app/test/terminal/clock.test.mjs'], policy: { ...input().policy, reproductionProfiles: [selected] } });
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw Error(JSON.stringify(result));
  expect(result.plan.cwd).toBe('/workspace/packages/app');
  expect(result.plan.probeCommand).not.toContain('packages/app/test');
});
