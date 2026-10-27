import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import { reproductionProfile } from '../policy/reproduction-profile.test-helper.js';
import { captureNodeDiagnostics } from './native-diagnostics.js';
import { InMemoryExecutor } from '../executor/memory.js';
import { verifyReproductionRuntime } from './reproduction-runtime.js';
import type { ResolvedReproductionPlan } from './reproduction-plan.js';
import { compareFailureIdentity } from './failure-identity.js';
import { resolveReproductionAtSource } from './reproduction-source.js';

it('runs a real reviewed wrapper and its complete direct probe through the production source resolver', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sutura-profile-')));
  try {
    await mkdir(join(root, 'scripts')); await mkdir(join(root, 'test')); await mkdir(join(root, '.github/workflows'), { recursive: true });
    const command = 'node scripts/test-select.mjs run terminal:rest';
    const sources = {
      'package.json': '{"type":"module"}',
      'scripts/test-select.mjs': "import {spawnSync} from 'node:child_process';const r=spawnSync(process.execPath,['--test','--test-reporter=spec','test/a.test.mjs','test/b.test.mjs'],{encoding:'utf8'});process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exit(r.status);\n",
      '.github/workflows/ci.yml': `jobs:\n  unit:\n    steps:\n      - name: Tests\n        run: ${command}\n`,
    };
    for (const [path, bytes] of Object.entries(sources)) await writeFile(join(root, path), bytes);
    for (const file of ['a', 'b']) await writeFile(join(root, `test/${file}.test.mjs`), `import {test} from 'node:test';import assert from 'node:assert/strict';test('${file} assertion',()=>assert.equal(1,2));\n`);
    const run = (argv: string[]) => {
      const result = spawnSync(process.execPath, argv, { cwd: root, encoding: 'utf8', timeout: 10_000 });
      expect(result.error).toBeUndefined();
      return { exitCode: result.status!, log: `${result.stdout}\n${result.stderr}`.replaceAll(root, '/workspace') };
    };
    const original = run(['scripts/test-select.mjs', 'run', 'terminal:rest']);
    const native = captureNodeDiagnostics(original.log, { repository: 'example/project', sourceSha: 'a'.repeat(40), runId: '42', attempt: 1, jobId: 7, stepNumber: 3,
      workflowPath: '.github/workflows/ci.yml', jobName: 'unit', stepName: 'Tests', runtimeVersion: process.versions.node }, 'normal');
    expect(native.complete).toBe(true); expect(native.identities).toHaveLength(2);
    const profile = reproductionProfile({ nativeCommand: command, fullCommand: command, nativeNodeVersion: process.versions.node, sandboxNodeVersion: process.versions.node,
      sourceInputs: Object.entries(sources).map(([path, content]) => ({ path, sha256: createHash('sha256').update(content).digest('hex') })) });
    const result = await resolveReproductionAtSource(root, { policy: { ...createDefaultRepositoryPolicy(), reproductionProfiles: [profile] }, policySha256: 'b'.repeat(64), command, runtimeId: 'node', sourceSha: 'a'.repeat(40), native });
    expect(result.status).toBe('ready'); if (result.status !== 'ready') throw new Error(JSON.stringify(result));
    const probe = run(['--test', '--test-reporter=spec', ...native.identities.map(item => item.file)]);
    expect(compareFailureIdentity({ command, log: 'short display', truncated: true, diagnostics: native, reproductionPlan: result.plan }, probe).status).toBe('matched');
    expect(result.plan.fullCommand).toBe(command);
    await writeFile(join(root, 'scripts/test-select.mjs'), 'changed');
    expect((await resolveReproductionAtSource(root, { policy: result.plan.policy, policySha256: 'b'.repeat(64), command, runtimeId: 'node', sourceSha: 'a'.repeat(40), native })).status).toBe('stopped');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('rejects serialized runtime-plan authority before an executor call', async () => {
  const executor = new InMemoryExecutor(() => ({ exitCode: 0, stdout: process.versions.node, stderr: '', truncated: false, metrics: {} }));
  await expect(verifyReproductionRuntime(executor, 'base', { profile: reproductionProfile() } as ResolvedReproductionPlan)).rejects.toThrow('Captured protected reproduction plan required');
  expect(executor.calls).toEqual([]);
});
