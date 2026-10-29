import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareFailureIdentity, nativeExecutionCommand, nativeFailureForCommand, type NativeFailureEvidence } from './failure-identity.js';

const testLog = ' FAIL src/add.test.ts > adds\nAssertionError: expected 2 to be 3\n';
const native: NativeFailureEvidence = { command: 'pnpm exec vitest run', log: testLog };

describe('original failure identity', () => {
  it('handles long internal whitespace without quadratic command parsing', () => {
    const command = `vitest${' '.repeat(100_000)}run`;
    const started = performance.now();
    expect(nativeExecutionCommand({ command, log: testLog })).toBe(command);
    // A linear scan has ample headroom; the former overlapping whitespace scan takes seconds.
    expect(performance.now() - started).toBeLessThan(1000);
  }, 30_000);
  it('preserves whitespace-delimited AND-chain admission', () => {
    for (const command of ['tsc --noEmit\t&&  vitest run', 'tsc --noEmit &&\n vitest run', 'tsc --noEmit\n && vitest run']) {
      expect(nativeExecutionCommand({ command, log: testLog })).toBe(command);
    }
    for (const command of ['tsc&& vitest run', 'tsc &&vitest run']) {
      expect(nativeExecutionCommand({ command, log: testLog })).toBeUndefined();
    }
  });
  it('matches actual assertions with harmless runner timestamps and workspace paths', () => {
    expect(compareFailureIdentity(native, { log: testLog.replace('src/', '/workspace/src/'), exitCode: 1 }).status).toBe('matched');
  });
  it('rejects a different assertion for the same test', () => {
    expect(compareFailureIdentity(native, { log: testLog.replace('to be 3', 'to be 4'), exitCode: 1 }).status).toBe('mismatch');
  });
  it('compares complete multi-failure sets, not any matching member', () => {
    const two = testLog + ' FAIL src/other.test.ts > subtracts\nAssertionError: expected 0 to be 1\n';
    expect(compareFailureIdentity({ ...native, log: two }, { log: two, exitCode: 1 }).status).toBe('matched');
    expect(compareFailureIdentity({ ...native, log: two }, { log: testLog, exitCode: 1 }).status).toBe('mismatch');
  });
  it.each([undefined, true])('cannot certify missing or truncated native evidence (%s)', truncated => {
    expect(compareFailureIdentity({ ...native, log: truncated ? testLog : '', ...(truncated === undefined ? {} : { truncated }) }, { log: testLog, exitCode: 1 }).status).toBe('unavailable');
  });
  it('does not treat scanner failure as native vulnerability findings', () => {
    expect(compareFailureIdentity({ command: 'npm audit', log: 'high severity GHSA-aaaa-bbbb-cccc' }, { log: 'npm: command not found', exitCode: 127 }).status).toBe('mismatch');
  });
  it('does not match a new missing prerequisite against the original assertion', () => {
    expect(compareFailureIdentity(native, { log: 'vitest: command not found', exitCode: 127 }).status).toBe('mismatch');
  });
  it.each([
    ['tsc --noEmit', 'src/a.ts(2,3): error TS2322: Type string is not assignable to number.'],
    ['eslint src', '/workspace/src/a.ts\n  2:3  error  Unexpected any  @typescript-eslint/no-explicit-any'],
    ['ruff check .', 'src/a.py:2:3: F401 unused import'],
    ['vite build', 'error during build:\nCould not resolve "./missing" from "src/a.ts"'],
    ['node build.mjs', "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/workspace/src/missing.js' imported from /workspace/src/a.js"],
  ])('retains structured %s diagnostics', (command, log) => {
    expect(compareFailureIdentity({ command, log }, { log, exitCode: 1 }).status).toBe('matched');
    expect(compareFailureIdentity({ command, log }, { log: log.replaceAll('src/a', 'src/b'), exitCode: 1 }).status).toBe('mismatch');
  });
  it('accepts a package script only with exact script provenance', () => {
    const wrapped = { command: 'pnpm test', log: testLog };
    expect(compareFailureIdentity(wrapped, { log: testLog, exitCode: 1 }).status).toBe('unavailable');
    expect(compareFailureIdentity({ ...wrapped, script: { manifestPath: 'package.json', manifestSha256: 'a'.repeat(64), name: 'test', command: 'vitest run' } }, { log: testLog, exitCode: 1 }).status).toBe('matched');
  });
  it('does not certify arbitrary identical error text', () => {
    expect(compareFailureIdentity({ command: 'custom', log: 'something failed' }, { log: 'something failed', exitCode: 1 }).status).toBe('unavailable');
  });
});


describe('preserved diagnostic support', () => {
  const unittest = `FAIL: test_name (test_app.AppTest.test_name)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/workspace/tests/test_app.py", line 7, in test_name
    self.assertEqual(fetch_name(), "Ada")
AssertionError: <coroutine object fetch_name at 0xabc123> != 'Ada'
----------------------------------------------------------------------
Ran 1 test in 0.01s
FAILED (failures=1)
`;
  it('preserves unittest identity and normalizes only the object address', () => {
    const evidence = { command: "python3 -B -m unittest discover -s tests -p 'test_*.py'", log: unittest };
    expect(compareFailureIdentity(evidence, { log: unittest.replace('0xabc123', '0xdef456'), exitCode: 1 }).status).toBe('matched');
    expect(compareFailureIdentity(evidence, { log: unittest.replace("!= 'Ada'", "!= 'Grace'"), exitCode: 1 }).status).toBe('mismatch');
  });
  it('does not certify incomplete reported failure counts', () => {
    expect(compareFailureIdentity(native, { log: testLog + 'Tests 2 failed (2)', exitCode: 1 }).status).toBe('unavailable');
    expect(compareFailureIdentity(native, { log: ' FAIL src/add.test.ts > adds\n', exitCode: 1 }).status).toBe('unavailable');
  });
  it('retains compiler and linter failures from manifest-bound compound scripts', () => {
    for (const [command, log] of [
      ['tsc --noEmit && vitest run', 'src/a.ts(2,3): error TS2322: Type string is not assignable to number.'],
      ['eslint . && vitest run', '/workspace/src/a.ts\n  2:3  error  Unexpected any  @typescript-eslint/no-explicit-any'],
    ]) {
      const sources = [{ path: 'package.json', content: JSON.stringify({ scripts: { test: command } }) }];
      const evidence = nativeFailureForCommand('pnpm test', log!, sources);
      expect(evidence.script?.manifestSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(compareFailureIdentity(evidence, { log: log!, exitCode: 1 }).status).toBe('matched');
    }
  });
  it('binds filtered workspace script to the exact supplied package', () => {
    const sources = [{ path: 'packages/core/package.json', content: JSON.stringify({ name: '@acme/core', scripts: { test: 'vitest run' } }) }];
    expect(nativeFailureForCommand('pnpm --filter @acme/core test', testLog, sources).script?.manifestPath).toBe('packages/core/package.json');
    expect(nativeFailureForCommand('pnpm --filter @acme/other test', testLog, sources).script).toBeUndefined();
    expect(nativeFailureForCommand('pnpm test', testLog, [{ ...sources[0]!, path: 'package.json', truncated: true }]).script).toBeUndefined();
  });
  it('refuses forged script names and arbitrary shell compounds', () => {
    const script = { manifestPath: 'package.json', manifestSha256: 'a'.repeat(64), name: 'other', command: 'vitest run' };
    expect(compareFailureIdentity({ command: 'pnpm test', log: testLog, script }, { log: testLog, exitCode: 1 }).status).toBe('unavailable');
    expect(compareFailureIdentity({ command: 'curl example.com && vitest run', log: testLog }, { log: testLog, exitCode: 1 }).status).toBe('unavailable');
  });
  it('keeps module-load failures distinct from assertions and missing prerequisites', () => {
    const log = ` FAIL src/a.test.ts [ src/a.test.ts ]\nError: Cannot find module './missing.js' imported from /workspace/src/a.test.ts\nSerialized Error: { code: 'ERR_MODULE_NOT_FOUND' }`;
    expect(compareFailureIdentity({ command: 'vitest run', log }, { log, exitCode: 1 }).status).toBe('matched');
    expect(compareFailureIdentity({ command: 'vitest run', log }, { log: 'vitest: command not found', exitCode: 127 }).status).toBe('mismatch');
  });
  it('keeps pass and truncated sandbox results outside reproduction claims', () => {
    expect(compareFailureIdentity(native, { log: testLog, exitCode: 0 }).status).toBe('unavailable');
    expect(compareFailureIdentity(native, { log: testLog, exitCode: 1, truncated: true }).status).toBe('unavailable');
  });
});


describe('full assertion and scanner evidence', () => {
  it('distinguishes detailed Vitest differences under the same generic assertion heading', () => {
    const log = ' FAIL src/a.test.ts > object equality\nAssertionError: expected objects to deeply equal\nExpected: { count: 1 }\nReceived: { count: 2 }\n ❯ src/a.test.ts:3:2\nTests 1 failed (1)';
    expect(compareFailureIdentity({ command: 'vitest run', log }, { log: log.replace('count: 2', 'count: 7'), exitCode: 1 }).status).toBe('mismatch');
    expect(compareFailureIdentity({ command: 'vitest run', log }, { log: log.replace(':3:2', ':9:2'), exitCode: 1 }).status).toBe('matched');
  });
  it('distinguishes multiline unittest assertion values', () => {
    const log = 'FAIL: test_name (test_app.AppTest.test_name)\nTraceback (most recent call last):\n  File "/workspace/test_app.py", line 3, in test_name\nAssertionError: Dictionaries differ\n- {"count": 2}\n+ {"count": 1}\n----------------------------------------------------------------------\nRan 1 test in 0.01s\nFAILED (failures=1)';
    expect(compareFailureIdentity({ command: 'python3 -m unittest', log }, { log: log.replace('count": 2', 'count": 7'), exitCode: 1 }).status).toBe('mismatch');
  });
  it('reports unavailable scan evidence as mismatch without inventing a missing prerequisite', () => {
    const proof = compareFailureIdentity({ command: 'npm audit', log: 'high severity GHSA-aaaa-bbbb-cccc' }, { log: 'scanner terminated before producing a report', exitCode: 1 });
    expect(proof.status).toBe('mismatch');
    expect(proof.reason).toContain('scanner evidence unavailable');
    expect(proof.reason).not.toContain('prerequisite');
  });
});


describe('bounded exact workspace script chains', () => {
  it('retains the real dogfood arithmetic root-to-workspace command', () => {
    const base = new URL('../../../placebo/corpus/repair-dogfood-arithmetic/fixture/', import.meta.url);
    const sources = ['package.json', 'packages/core/package.json'].map(path => ({ path, content: readFileSync(new URL(path, base), 'utf8') }));
    const evidence = nativeFailureForCommand('pnpm test', testLog, sources);
    expect(evidence.scriptChain?.map(script => script.manifestPath)).toEqual(['package.json', 'packages/core/package.json']);
    expect(compareFailureIdentity(evidence, { log: testLog, exitCode: 1 }).status).toBe('matched');
  });
  it('refuses cycles and duplicate package-name matches without partial provenance', () => {
    const root = { path: 'package.json', content: JSON.stringify({ scripts: { test: 'pnpm --filter @acme/core test' } }) };
    const child = { path: 'packages/core/package.json', content: JSON.stringify({ name: '@acme/core', scripts: { test: 'pnpm test' } }) };
    expect(nativeFailureForCommand('pnpm test', testLog, [root, child]).script).toBeUndefined();
    const valid = { ...child, content: JSON.stringify({ name: '@acme/core', scripts: { test: 'vitest run' } }) };
    expect(nativeFailureForCommand('pnpm test', testLog, [root, valid, { ...valid, path: 'packages/duplicate/package.json' }]).script).toBeUndefined();
  });
  it('rejects supplied chains with a wrong filter identity, cycle or more than four links', () => {
    const root = { manifestPath: 'package.json', manifestSha256: 'a'.repeat(64), name: 'test', command: 'pnpm --filter @acme/core test' };
    const child = { manifestPath: 'packages/core/package.json', manifestSha256: 'b'.repeat(64), packageName: '@acme/other', name: 'test', command: 'vitest run' };
    expect(compareFailureIdentity({ command: 'pnpm test', log: testLog, script: root, scriptChain: [root, child] }, { log: testLog, exitCode: 1 }).status).toBe('unavailable');
    expect(compareFailureIdentity({ command: 'pnpm test', log: testLog, script: root, scriptChain: [root, root] }, { log: testLog, exitCode: 1 }).status).toBe('unavailable');
    expect(compareFailureIdentity({ command: 'pnpm test', log: testLog, script: root, scriptChain: Array.from({ length: 5 }, () => root) }, { log: testLog, exitCode: 1 }).status).toBe('unavailable');
  });
});


describe('existing terminal and recursive commands', () => {
  it('admits one terminal semicolon but never an additional command or separator', () => {
    expect(compareFailureIdentity({ command: 'vitest run;', log: testLog }, { log: testLog, exitCode: 1 }).status).toBe('matched');
    for (const command of ['vitest run;;', 'vitest run; echo unsafe']) expect(compareFailureIdentity({ command, log: testLog }, { log: testLog, exitCode: 1 }).status).toBe('unavailable');
  });
  const manifests = ['core', 'action'].map(name => ({ path: `packages/${name}/package.json`, content: JSON.stringify({ name: `@fixture/${name}`, scripts: { test: 'vitest run' } }) }));
  const qualified = (name: string, log = testLog) => log.split('\n').filter(Boolean).map(line => `packages/${name} test: ${line}`).join('\n');
  it('compares every failing workspace with exact manifest provenance', () => {
    const log = qualified('core') + '\n' + qualified('action');
    const evidence = nativeFailureForCommand('pnpm -r test', log, manifests);
    expect(evidence.workspaceScripts).toHaveLength(2);
    expect(compareFailureIdentity(evidence, { log, exitCode: 1 }).status).toBe('matched');
    expect(compareFailureIdentity(evidence, { log: qualified('core'), exitCode: 1 }).status).toBe('mismatch');
    expect(compareFailureIdentity(evidence, { log: testLog, exitCode: 1 }).status).toBe('unavailable');
    expect(compareFailureIdentity(evidence, { log: log.replaceAll('packages/action test:', 'packages/foreign test:'), exitCode: 1 }).status).toBe('unavailable');
  });
  it('does not confuse identical diagnostics in different packages or admit ambiguous inventory', () => {
    const evidence = nativeFailureForCommand('pnpm --recursive test', qualified('core'), manifests);
    expect(compareFailureIdentity(evidence, { log: qualified('action'), exitCode: 1 }).status).toBe('mismatch');
    expect(nativeFailureForCommand('pnpm -r test', qualified('core'), [...manifests, manifests[0]!]).workspaceScripts).toBeUndefined();
    const unsupported = { path: 'packages/unknown/package.json', content: JSON.stringify({ name: '@fixture/unknown', scripts: { test: 'custom test' } }) };
    expect(nativeFailureForCommand('pnpm -r test', qualified('core'), [...manifests, unsupported]).workspaceScripts).toBeUndefined();
  });
});
