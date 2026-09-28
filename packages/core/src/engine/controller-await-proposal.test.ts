import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import {
  createRepairAuthorizationSession, deriveRepairAuthorization,
  type ControllerBaselineBinding,
} from './repair-authorization.js';
import { controllerAwaitReplacement } from './controller-await-proposal.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const path = 'case.test.js';
const prefix = "import { expect, test } from 'vitest';\ntest('renders', async () => {\n";
const suffix = '\n});\n';
const assertion = "  expect(renderName()).toBe('ADA');";

async function granted(source: string, line?: number) {
  const baseline: ControllerBaselineBinding = {
    kind: 'local-snapshot', sourceSha: null, policyBaseSha: null,
    snapshotSha256: null, baselineImageId: 'baseline', policySha256: 'a'.repeat(64),
  };
  const policy = createDefaultRepositoryPolicy();
  const excerpt = { path, startLine: 1, content: source, truncated: false };
  const session = createRepairAuthorizationSession({
    baseline, failingCommand: 'vitest run', policy, sources: [excerpt],
  });
  const result = await deriveRepairAuthorization(session, {
    kind: 'await-operation', path, evidenceReferences: ['promise-mismatch', ...(line === undefined ? [] : [`controller-stack-line:${line}`])],
    controllerProbe: {
      id: 'async-completion', imageId: 'baseline', exitCode: 1,
      output: 'AssertionError: expected Promise to be ADA',
      sourceSha256: hash(source), failingCommand: 'vitest run',
    },
  });
  expect(result).toEqual({ ok: true });
  return {
    authorization: { session, baseline }, sourceContext: { sources: [excerpt] },
    slots: [{ slotId: 'slot-1', path, startLine: 1, endLine: source.split('\n').length,
      contentSha256: hash(source), generated: false }],
  };
}

it('proposes only the await token for one granted complete assertion', async () => {
  const source = prefix + assertion + suffix;
  expect(await controllerAwaitReplacement(await granted(source, 3)))
    .toBe(prefix + "  expect(await renderName()).toBe('ADA');" + suffix);
});

it('refuses ambiguous, commented, and unrelated source lines', async () => {
  for (const source of [
    prefix + "  expect(renderName()).toBe('ADA'); expect(other()).toBe('BEE');" + suffix,
    prefix + '// ' + assertion + suffix,
    prefix + "  const value = renderName();\n  expect(value).toBe('ADA');" + suffix,
  ]) {
    expect(await controllerAwaitReplacement(await granted(source, 3))).toBeUndefined();
  }
});

it('refuses stale source identity and an absent grant', async () => {
  const source = prefix + assertion + suffix;
  const input = await granted(source, 3);
  expect(await controllerAwaitReplacement({ ...input, slots: [{ ...input.slots[0]!, contentSha256: 'b'.repeat(64) }] })).toBeUndefined();
  expect(await controllerAwaitReplacement({ sourceContext: input.sourceContext, slots: input.slots })).toBeUndefined();
});

it('requires the controller stack marker for the exact assertion line', async () => {
  const source = prefix + assertion + suffix;
  expect(await controllerAwaitReplacement(await granted(source))).toBeUndefined();
  expect(await controllerAwaitReplacement(await granted(source, 2))).toBeUndefined();
});
