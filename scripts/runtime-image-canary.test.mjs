import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const SHA = 'a'.repeat(40);
const IMAGE = 'ghcr.io/astral-sh/uv@sha256:35b0aa516fbcf6f18624919cfc38fa02ab3458e0ffcd3c03e932051b37f315db';

test('runtime image canary writes exact-SHA proof and refuses dirty input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-runtime-canary-'));
  const { runRuntimeImageCanary } = await import('./runtime-image-canary.mjs');
  const proof = {
    schemaVersion: 'sutura-python-image-proof-v1',
    imageRef: IMAGE,
    importedImageId: 'image-1',
    operationId: 'sutura-python-runtime-image-proof',
    requiredTools: ['Python 3.13.11', 'uv 0.9.30', 'git version 2.39.5', 'tar (GNU tar) 1.34'],
  };
  try {
    const output = await runRuntimeImageCanary({
      token: 'test-token',
      project: 'test-project',
      outputDirectory: directory,
      now: () => Date.parse('2026-09-01T06:00:00.000Z'),
      git: (args) => args[0] === 'status' ? '' : SHA,
      executor: {},
      prove: async (_executor, reference) => {
        assert.equal(reference, IMAGE);
        return proof;
      },
    });
    assert.deepEqual(JSON.parse(await readFile(output.outputPath, 'utf8')), {
      schemaVersion: 'sutura-runtime-image-canary-v1',
      headSha: SHA,
      capturedAt: '2026-09-01T06:00:00.000Z',
      proof,
    });
    await assert.rejects(() => runRuntimeImageCanary({
      token: 'test-token', project: 'test-project', outputDirectory: directory,
      git: (args) => args[0] === 'status' ? ' M dirty.ts' : SHA,
      executor: {}, prove: async () => proof,
    }), /clean tree/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('runtime image canary command and workflows are read-only and fail closed', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const source = await readFile(resolve(root, 'scripts/runtime-image-canary.mjs'), 'utf8');
  const canaryWorkflow = await readFile(resolve(root, '.github/workflows/provider-contract-canary.yml'), 'utf8');
  const releaseWorkflow = await readFile(resolve(root, '.github/workflows/release-candidate.yml'), 'utf8');

  assert.equal(manifest.scripts['canary:runtime-image'], 'pnpm --filter @sutura/core build && node scripts/runtime-image-canary.mjs');
  assert.match(source, /process\.env\.CONTREE_TOKEN/u);
  assert.match(source, /process\.env\.CONTREE_PROJECT/u);
  assert.match(source, /process\.env\.SUTURA_CANARY_OUTPUT_DIRECTORY/u);
  assert.match(source, /provePythonRuntimeImage/u);
  assert.match(source, /requires a clean tree/u);
  assert.doesNotMatch(source, /(?:git|gh)\s+(?:push|branch|pr)|createFixPullRequest|publishFix/u);
  for (const workflow of [canaryWorkflow, releaseWorkflow]) {
    assert.match(workflow, /pnpm run canary:runtime-image/u);
    assert.match(workflow, /CONTREE_TOKEN: \$\{\{ secrets\.CONTREE_TOKEN \}\}/u);
    assert.match(workflow, /CONTREE_PROJECT: \$\{\{ vars\.CONTREE_PROJECT \}\}/u);
    assert.match(workflow, /SUTURA_CANARY_OUTPUT_DIRECTORY: \$\{\{ runner\.temp \}\}/u);
    assert.match(workflow, /path: \$\{\{ runner\.temp \}\}\/runtime-image-canary-\*\.json/u);
  }
});
