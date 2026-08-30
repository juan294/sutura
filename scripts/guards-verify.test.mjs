import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { scanProductGuards } from './guards-verify.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const scriptPath = new URL('guards-verify.mjs', import.meta.url);

async function fixtureRoot(source) {
  const root = await mkdtemp(join(tmpdir(), 'sutura-guards-verify-'));
  const path = join(root, 'packages/core/src/example.ts');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source, 'utf8');
  return { root, path };
}

test('scanner finds the known multiline-capable product guard', async () => {
  const guards = await scanProductGuards({ root: repositoryRoot });

  assert.ok(guards.some(({ file, line }) =>
    file === 'packages/core/src/llm/json.ts' && line === 74));
});

test('scanner ignores tests, test support, and explicit non-guard markers', async () => {
  const { root } = await fixtureRoot([
    "export function guarded(): never { throw new Error('counted'); }",
    "export function exited(): never { process.exit(1); }",
    "export function failed(): void { core.setFailed(",
    "  'multiline',",
    '); }',
    '// guards-verify: not-a-guard',
    "export function excluded(): never { throw new Error('excluded'); }",
    '',
  ].join('\n'));
  try {
    const testPath = join(root, 'packages/core/src/example.test.ts');
    const supportPath = join(root, 'packages/core/src/testing/helper.ts');
    await mkdir(dirname(supportPath), { recursive: true });
    await writeFile(testPath, "throw new Error('test only');\n", 'utf8');
    await writeFile(supportPath, "throw new Error('support only');\n", 'utf8');

    assert.deepEqual(await scanProductGuards({ root }), [
      { file: 'packages/core/src/example.ts', line: 1, kind: 'throw' },
      { file: 'packages/core/src/example.ts', line: 2, kind: 'process.exit' },
      { file: 'packages/core/src/example.ts', line: 3, kind: 'core.setFailed' },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('zero-hit Istanbul statement coverage makes the CLI fail closed', async () => {
  const { root, path } = await fixtureRoot("export function guarded(): never { throw new Error('missed'); }\n");
  try {
    const coveragePath = join(root, 'coverage-final.json');
    await writeFile(coveragePath, JSON.stringify({
      [path]: {
        path,
        statementMap: {
          0: { start: { line: 1, column: 0 }, end: { line: 1, column: 72 } },
        },
        s: { 0: 0 },
      },
    }), 'utf8');

    const result = spawnSync(process.execPath, [
      scriptPath.pathname,
      '--root', root,
      '--scope', 'all',
      '--coverage-file', coveragePath,
    ], { encoding: 'utf8' });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /guards: 0\/1/u);
    assert.match(result.stdout, /packages\/core\/src\/example\.ts:1/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
