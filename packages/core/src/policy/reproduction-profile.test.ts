import { expect, it } from 'vitest';
import { parseRepositoryPolicy } from './schema.js';
import { parseReproductionProfiles } from './reproduction-profile.js';
import { reproductionProfile } from './reproduction-profile.test-helper.js';
it('adds an optional bounded protected Node profile without changing old policies', () => {
  expect(parseRepositoryPolicy('{"version":1}').reproductionProfiles).toBeUndefined();
  const profile = reproductionProfile();
  expect(parseRepositoryPolicy(JSON.stringify({ version: 1, reproductionProfiles: [profile] })).reproductionProfiles).toEqual([profile]);
  expect(Object.isFrozen(parseReproductionProfiles([profile])[0]?.sourceInputs)).toBe(true);
});
it.each([
  { id: '' }, { id: '../outside' }, { cwd: '../outside' }, { argv: ['bash', '-c', 'node --test'] },
  { argv: ['node', '--eval', 'process.exit(0)', '--test'] }, { argv: ['node', '--test', '--unknown'] },
  { sourceInputs: [{ path: '.env', sha256: 'a'.repeat(64) }] }, { sourceInputs: [{ path: 'scripts/test-select.mjs', sha256: 'bad' }] },
  { probeTimeoutSec: 601 }, { fullTimeoutSec: 3601 }, { fullCommand: 'echo green' },
  { sandboxNodeVersion: '22.23.4' }, { imageRef: 'node:22' }, { env: { NODE_OPTIONS: '--require secret' } },
  { approverIds: [0] }, { callers: [{ workflowId: 7, path: 'outside.yml' }] },
])('rejects unsafe or incomplete profile data %j', overrides => {
  expect(() => parseReproductionProfiles([{ ...reproductionProfile(), ...overrides }])).toThrow();
});
it('rejects duplicate profiles, unknown fields and unsafe caller bindings', () => {
  const profile = reproductionProfile();
  expect(() => parseReproductionProfiles([profile, profile])).toThrow();
  expect(() => parseReproductionProfiles([{ ...profile, approved: true }])).toThrow();
  expect(() => parseReproductionProfiles([{ ...profile, callers: [{ workflowId: 7, path: '.github/workflows/long.yml', blobSha: 'b'.repeat(40), protectedRef: 'refs/heads/develop', engineSha: 'c'.repeat(40) }], approverIds: [1, 1] }])).toThrow();
});
it('requires explicit protected equivalence for different exact runtime versions', () => {
  expect(parseReproductionProfiles([reproductionProfile({ sandboxNodeVersion: '22.23.4', runtimeEquivalenceReason: 'Reviewed by the protected policy owner for this source wrapper.' })])[0]?.sandboxNodeVersion).toBe('22.23.4');
});
it.each(['--env-file=.env', '--test-reporter-destination=/tmp/report', '--require=./unreviewed.cjs', '--import=file:///private/loader.mjs', '--loader=https://example.com/loader'])('refuses unreviewed or environment-changing Node option %s', option => {
  expect(() => parseReproductionProfiles([reproductionProfile({ argv: ['node', '--test', option] })])).toThrow();
});
