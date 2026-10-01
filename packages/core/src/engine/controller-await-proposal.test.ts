import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import {
  createRepairAuthorizationSession, deriveRepairAuthorization,
  type ControllerBaselineBinding,
} from './repair-authorization.js';
import { controllerAwaitReplacement, controllerJsSetupAwaitReplacement, controllerPythonAwaitReplacement } from './controller-await-proposal.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const path = 'case.test.js';
const prefix = "import { expect, test } from 'vitest';\ntest('renders', async () => {\n";
const suffix = '\n});\n';
const assertion = "  expect(renderName()).toBe('ADA');";
const pythonPath = 'tests/test_profile.py';
const pythonSource = 'import unittest\nfrom profile import fetch_profile\n\nclass ProfileTest(unittest.IsolatedAsyncioTestCase):\n    async def test_profile(self):\n        result = fetch_profile(" Ada ")\n        self.assertEqual(result["name"], "ADA")\n';
const setupSource = "import { expect, test } from 'vitest';\nimport { loadProfile } from './profile.js';\n\nconst load = (name) => loadProfile(name);\ntest('name', async () => {\n  const profile = load(' Ada ');\n  expect(profile.name).toBe('ADA');\n});\n";
const profileSource = 'export async function loadProfile(name) { return { name }; }\n';
const setupSources = [{ path: 'case.test.js', startLine: 1, content: setupSource, truncated: false },
  { path: 'profile.js', startLine: 1, content: profileSource, truncated: false }];

it('proposes one setup await only when a complete imported async helper closes the call', async () => {
  expect(await controllerJsSetupAwaitReplacement(setupSource, path, 7, setupSources))
    .toBe(setupSource.replace("const profile = load(' Ada ');", "const profile = await load(' Ada ');"));
});

it('refuses setup edits without the exact assertion, stack line, or async source closure', async () => {
  expect(await controllerJsSetupAwaitReplacement(setupSource, path, 6, setupSources)).toBeUndefined();
  for (const content of [
    setupSource.replace('expect(profile.name)', 'expect(other.name)'),
    setupSource.replace("const profile = load(' Ada ');", "const profile = await load(' Ada ');"),
    setupSource.replace('  expect(profile.name)', '\n  expect(profile.name)'),
    setupSource.replace('async () =>', '() =>'),
    setupSource.replace("test('name', async () => {", "test('name', async () => { const load = () => ({ name: 'ADA' });"),
    setupSource.replace("test('name', async () => {", "test('name', async () => { const { load } = { load: () => ({ name: 'ADA' }) };"),
    setupSource.replace("test('name'", "load = () => ({ name: 'ADA' });\ntest('name'"),
    setupSource.replace('const load = (name) => loadProfile(name);', 'const load = (loadProfile) => loadProfile(loadProfile);'),
  ]) {
    expect(await controllerJsSetupAwaitReplacement(content, path, 7, [
      { ...setupSources[0]!, content }, setupSources[1]!,
    ])).toBeUndefined();
  }
  for (const sources of [
    [setupSources[0]!],
    [setupSources[0]!, { ...setupSources[1]!, truncated: true }],
    [setupSources[0]!, { ...setupSources[1]!, content: profileSource.replace('async ', '') }],
    [setupSources[0]!, { ...setupSources[1]!, content: `${profileSource}loadProfile = () => ({ name: 'ADA' });\n` }],
    [setupSources[0]!, { ...setupSources[1]!, content: `${profileSource}({ loadProfile } = { loadProfile: () => ({ name: 'ADA' }) });\n` }],
    [setupSources[0]!, { ...setupSources[1]!, content: `${profileSource}for (loadProfile of [() => ({ name: 'ADA' })]) {}\n` }],
  ]) expect(await controllerJsSetupAwaitReplacement(setupSource, path, 7, sources)).toBeUndefined();
});

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

it('inserts only the missing Python await next to a confirmed unittest assertion', async () => {
  const source = pythonSource;
  const baseline: ControllerBaselineBinding = {
    kind: 'local-snapshot', sourceSha: null, policyBaseSha: null,
    snapshotSha256: null, baselineImageId: 'baseline', policySha256: 'a'.repeat(64),
  };
  const policy = createDefaultRepositoryPolicy();
  const excerpt = { path: pythonPath, startLine: 1, content: source, truncated: false };
  const session = createRepairAuthorizationSession({
    baseline, failingCommand: 'python3 -B -m unittest discover -s tests', policy, sources: [excerpt],
  });
  expect(await deriveRepairAuthorization(session, {
    kind: 'await-operation', path: pythonPath,
    evidenceReferences: ['coroutine-mismatch', 'controller-stack-line:7'],
    controllerProbe: {
      id: 'async-completion', imageId: 'baseline', exitCode: 1,
      output: "TypeError: 'coroutine' object is not subscriptable",
      sourceSha256: hash(source), failingCommand: 'python3 -B -m unittest discover -s tests',
    },
  })).toEqual({ ok: true });
  const input = {
    authorization: { session, baseline }, sourceContext: { sources: [excerpt] },
    slots: [{ slotId: 'slot-1', path: pythonPath, startLine: 1,
      endLine: source.split('\n').length, contentSha256: hash(source), generated: false }],
  };
  expect(await controllerAwaitReplacement(input))
    .toBe(source.replace('result = fetch_profile', 'result = await fetch_profile'));
  expect(await controllerAwaitReplacement({ ...input, slots: [{ ...input.slots[0]!, contentSha256: hash('stale') }] }))
    .toBeUndefined();
});

const inlinePath = 'tests/test_app.py';
const inlineSource = 'import unittest\n\nfrom app import fetch_name\n\n\nclass AppTest(unittest.IsolatedAsyncioTestCase):\n    async def test_fetches_name(self) -> None:\n        self.assertEqual(fetch_name(), "Ada")\n';

it('inserts only the missing Python await in a confirmed inline coroutine assertion', async () => {
  expect(await controllerPythonAwaitReplacement(inlineSource, inlinePath, 8))
    .toBe(inlineSource.replace('self.assertEqual(fetch_name(), "Ada")', 'self.assertEqual(await fetch_name(), "Ada")'));
  expect(await controllerPythonAwaitReplacement(inlineSource.replace('fetch_name()', 'fetch_name(" Ada ")'), inlinePath, 8))
    .toBe(inlineSource.replace('self.assertEqual(fetch_name(), "Ada")', 'self.assertEqual(await fetch_name(" Ada "), "Ada")'));
});

it('refuses inline Python edits that are not one plain first-argument call', async () => {
  for (const source of [
    inlineSource.replace('fetch_name()', 'await fetch_name()'),
    inlineSource.replace('fetch_name(), "Ada")', '"Ada", fetch_name())'),
    inlineSource.replace('fetch_name()', 'fetch_name(other())'),
    inlineSource.replace('"Ada")', '"Ada")  # note'),
    inlineSource.replace('"Ada")', '"Ada"); self.assertTrue(True)'),
  ]) {
    expect(await controllerPythonAwaitReplacement(source, inlinePath, 8)).toBeUndefined();
  }
  expect(await controllerPythonAwaitReplacement(inlineSource, inlinePath, 7)).toBeUndefined();
});

it('refuses Python edits outside the one adjacent, observed coroutine assignment', async () => {
  for (const source of [
    pythonSource.replace('self.assertEqual(result[', 'self.assertEqual(other['),
    pythonSource.replace('        self.assertEqual', '\n        self.assertEqual'),
    pythonSource.replace('unittest.IsolatedAsyncioTestCase', 'unittest.TestCase'),
    pythonSource.replace('result = fetch_profile', 'result = await fetch_profile'),
  ]) {
    expect(await controllerPythonAwaitReplacement(source, pythonPath, 7)).toBeUndefined();
  }
  expect(await controllerPythonAwaitReplacement(pythonSource, pythonPath, 6)).toBeUndefined();
});
