import { canonicalJson } from '../replay/canonical-json.js';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it, vi } from 'vitest';
import { repairFailure, type HealLlm } from '../heal.js';
import type { Executor, RunOptions, RunResult } from '../executor/types.js';
import { readTrustedPolicyAtCommit } from '../verification/source.js';
import { captureNodeDiagnostics } from './native-diagnostics.js';
import { resolveReproductionAtSource } from './reproduction-source.js';
import { authorizeCliVerification, canonicalPacketDigest, type VerificationPacket } from './verification-allowance.js';

// Synthetic production-path oracle. Local child processes replace provider images;
// this fixture supplies no organic-recovery, paid-provider or hosted-CI evidence.
const exec = promisify(execFile);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fullCommand = 'node scripts/native-suite.mjs';
const originalSources = {
  'src/add.mjs': "export const add = (a, b) => a - b;\nexport const control = () => 'preserved';\n",
  'src/double.mjs': 'export const double = n => n;\n',
};
async function runLocal(root: string, command: string, seconds = 10) {
  const started = performance.now();
  try {
    const result = await exec('/bin/sh', ['-c', command], { cwd: root, encoding: 'utf8', timeout: seconds * 1000, maxBuffer: 1_048_576,
      env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}`, NODE_ENV: 'test', CI: 'true', FORCE_COLOR: '0' } });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr, seconds: (performance.now() - started) / 1000 };
  } catch (error) {
    const result = error as Error & { code?: number; signal?: string; stdout?: string; stderr?: string };
    if (typeof result.code !== 'number' || result.signal) throw error;
    return { exitCode: result.code, stdout: result.stdout ?? '', stderr: result.stderr ?? '', seconds: (performance.now() - started) / 1000 };
  }
}
async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'sutura-repair-oracle-'))), source = join(directory, 'source');
  const files = {
    'package.json': '{"type":"module"}\n',
    'scripts/native-suite.mjs': "import { spawnSync } from 'node:child_process';\nconst run = spawnSync(process.execPath, ['--test', '--test-reporter=spec', 'test/a.test.mjs', 'test/b.test.mjs', 'test/control.test.mjs'], { encoding: 'utf8' });\nprocess.stdout.write(run.stdout); process.stderr.write(run.stderr); process.exit(run.status ?? 1);\n",
    '.github/workflows/ci.yml': `jobs:\n  unit:\n    steps:\n      - name: Tests\n        run: ${fullCommand}\n`,
  };
  const tests = {
    'test/a.test.mjs': "import { test } from 'node:test'; import assert from 'node:assert/strict'; import { add } from '../src/add.mjs';\ntest('adds both values', () => assert.equal(add(1, 1), 2));\n",
    'test/b.test.mjs': "import { test } from 'node:test'; import assert from 'node:assert/strict'; import { double } from '../src/double.mjs';\ntest('doubles the value', () => assert.equal(double(2), 4));\n",
    'test/control.test.mjs': "import { test } from 'node:test'; import assert from 'node:assert/strict'; import { control } from '../src/add.mjs';\ntest('preserves the full-suite control', () => assert.equal(control(), 'preserved'));\n",
  };
  const profile = {
    id: 'synthetic-two-failures', nativeCommand: fullCommand, fullCommand, cwd: '.', argv: ['node', '--test', '--test-reporter=spec'],
    sourceInputs: Object.entries(files).map(([path, content]) => ({ path, sha256: hash(content) })),
    nativeNodeVersion: process.versions.node, sandboxNodeVersion: process.versions.node,
    imageRef: `node:${process.versions.node}@sha256:${'b'.repeat(64)}`, probeTimeoutSec: 10, fullTimeoutSec: 20, callers: [], approverIds: [],
  };
  const policyText = JSON.stringify({ version: 1, allowedPaths: ['src/**'], reproductionProfiles: [profile] });
  for (const [path, content] of Object.entries({ ...files, ...tests, ...originalSources, '.sutura.json': policyText })) {
    await mkdir(dirname(join(source, path)), { recursive: true }); await writeFile(join(source, path), content);
  }
  await exec('git', ['init', '-q', source]);
  await exec('git', ['-C', source, 'config', 'core.fsmonitor', 'false']);
  await exec('git', ['-C', source, 'config', 'core.hooksPath', '/dev/null']);
  await exec('git', ['-C', source, 'add', '.']);
  await exec('git', ['-C', source, '-c', 'user.name=Synthetic test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'synthetic failing source']);
  const sourceSha = (await exec('git', ['-C', source, 'rev-parse', 'HEAD'])).stdout.trim();
  const original = await runLocal(source, fullCommand);
  expect(original.exitCode).toBe(1);
  const log = `${original.stdout}\n${original.stderr}`.replaceAll(source, '/workspace');
  const binding = { repository: 'example/synthetic-repair', sourceSha, runId: '42', attempt: 1, jobId: 7, stepNumber: 3,
    workflowPath: '.github/workflows/ci.yml', jobName: 'unit', stepName: 'Tests', runtimeVersion: process.versions.node };
  const native = captureNodeDiagnostics(log, binding, 'normal');
  expect(native).toMatchObject({ complete: true, summary: { tests: 3, failed: 2, passed: 1 } });
  const loaded = await readTrustedPolicyAtCommit(source, sourceSha);
  const resolved = await resolveReproductionAtSource(source, { policy: loaded.policy, policySha256: loaded.sha, command: fullCommand, runtimeId: 'node', sourceSha, native });
  if (resolved.status !== 'ready') throw new Error(JSON.stringify(resolved));
  expect(resolved.plan.probeCommand).not.toContain('control.test.mjs');
  return { directory, source, sourceSha, log, native, loaded, plan: resolved.plan, binding };
}

it.each([false, true])('synthetic production repair preserves full audit when a focused-green patch breaks control=%s', async breaksControl => {
  const f = await fixture();
  try {
    await writeFile(join(f.source, 'src/add.mjs'), `export const add = (a, b) => a + b;\nexport const control = () => '${breaksControl ? 'broken' : 'preserved'}';\n`);
    await writeFile(join(f.source, 'src/double.mjs'), 'export const double = n => n * 2;\n');
    const diff = (await exec('git', ['-C', f.source, 'diff', '--binary', '--', 'src'])).stdout;
    for (const [path, content] of Object.entries(originalSources)) await writeFile(join(f.source, path), content);
    const images = new Map([['baseline', f.source]]), calls: Array<{ command: string; options: RunOptions; result: RunResult }> = [];
    const executor: Executor = {
      importImage: async () => { throw new Error('already-prepared synthetic image; imports must not occur'); },
      snapshot: async () => { throw new Error('already-prepared synthetic image; snapshots must not occur'); },
      operationCapacity: () => ({ limit: 1, active: 0, available: 1 }),
      cancel: async operationId => ({ operationId, requested: false, terminal: 'succeeded' }),
      async run(parent, command, options = {}) {
        const parentRoot = images.get(parent); if (!parentRoot) throw new Error('unknown synthetic provider image');
        const id = `image-${images.size}`, imageRoot = join(f.directory, id);
        await cp(parentRoot, imageRoot, { recursive: true }); images.set(id, imageRoot);
        const cwd = join(imageRoot, (options.cwd ?? '/workspace').replace(/^\/workspace\/?/u, ''));
        const result = await runLocal(cwd, command, Math.min(options.timeoutSec ?? 10, 10));
        const normalized: RunResult = { imageId: id, exitCode: result.exitCode, stdout: result.stdout.replaceAll(imageRoot, '/workspace'), stderr: result.stderr.replaceAll(imageRoot, '/workspace'), truncated: false,
          processState: { timedOut: false }, metrics: { wallTimeSec: result.seconds },
          ...(options.operationId ? { operation: { operationId: options.operationId, terminal: 'succeeded' as const, cancellationRequested: false } } : {}) };
        calls.push({ command, options, result: normalized }); return normalized;
      },
      async runMany(parent, commands, options) { const results = []; for (const command of commands) results.push(await this.run(parent, command, options)); return results; },
    };
    const baselineResult = await executor.run('baseline', f.plan.probeCommand, { cwd: f.plan.cwd, timeoutSec: f.plan.profile.probeTimeoutSec });
    const packet: VerificationPacket = { version: 'sutura-verification-packet-v1', id: `synthetic-${breaksControl ? 'bad' : 'good'}`, repository: f.binding.repository, sourceSha: f.sourceSha, runId: f.binding.runId, attempt: 1,
      policyBaseSha: f.sourceSha, engineSha: 'e'.repeat(40), policySha256: f.loaded.sha, profileSha256: f.plan.profileSha256, nativeLogSha256: f.native.logSha256!, nativeBindingSha256: createHash('sha256').update(canonicalJson(f.native.binding)).digest('hex'), fullCommand, fullTimeoutSec: 20,
      finalAllowanceSec: 120, policyTimeoutSec: 10, challengeTimeoutSec: 10, cancellationSec: 15, adjudicationSec: 60, providerMaxTimeoutSec: 20, workflowTimeoutSec: 720, sandboxUsdPerSecond: 0.00001, sandboxReservationUsd: 1 };
    const reserveGrant = vi.fn(async () => {}); // external durable-store API, no real spend or publication
    const cap = await authorizeCliVerification({ packet, plan: f.plan, actual: packet, operatorDigest: canonicalPacketDigest(packet), reserveGrant });
    const chat = vi.fn(async (tier: 'nano' | 'super' | 'ultra') => {
      if (tier === 'super') throw new Error('Supplied candidate must not request a generated repair');
      return { text: JSON.stringify(tier === 'nano'
        ? { class: 'test-assertion', confidence: 0.99, signals: ['synthetic-native-two-failures'], failingCmd: fullCommand, errorExcerpt: 'Both unchanged source assertions fail' }
        : { approved: true, reasoning: 'Both repaired assertions and the unchanged full control test pass' }), usd: 0.001 };
    });
    const llm: HealLlm = { chat, modelQuote: tier => ({ role: tier, modelId: `synthetic-${tier}`, profileId: 'synthetic-local-oracle', price: { input: 1, output: 1 } }) };
    const file = await repairFailure({ runId: f.binding.runId, repo: f.binding.repository, failedLog: `Run ${fullCommand}\n${f.log}`, nativeFailure: { command: fullCommand, log: f.log, truncated: false, diagnostics: f.native },
      reproductionPlan: f.plan, verificationAllowance: cap, baselineResult, failingImage: 'baseline', executor, llm, candidateDiff: diff, triageN: 5, raceK: 1,
      policy: f.plan.policy, policyEvidence: { baseRef: f.sourceSha, baseSha: f.sourceSha, policySha: f.loaded.sha },
      sourceIdentity: { kind: 'git', sourceSha: f.sourceSha, policyBaseSha: f.sourceSha, snapshotSha256: null }, cost: { entries: [], totalUsd: () => 0 },
      readSourceContext: async () => ({ sources: await Promise.all(Object.keys(originalSources).map(async path => ({ path, startLine: 1, truncated: false, content: await readFile(join(f.source, path), 'utf8') }))) }) });
    expect(file.reproduction?.status).toBe('matched');
    expect(reserveGrant).toHaveBeenCalledTimes(1);
    const fullRuns = calls.filter(call => call.command === fullCommand);
    expect(fullRuns).toHaveLength(1);
    expect(fullRuns[0]?.options).toMatchObject({ cwd: '/workspace', timeoutSec: 20, verificationKind: 'full' });
    expect(calls.filter(call => call.command.includes('--test')).every(call => call.options.timeoutSec !== undefined)).toBe(true);
    expect(file.race).toHaveLength(1);
    expect(file.race[0]?.held).toBe(true); // both patches pass the real two-file focused suite
    if (breaksControl) {
      expect(fullRuns[0]?.result.exitCode).toBe(1);
      expect(file.outcome).toBe('refused');
      expect(file.audit?.approved).toBe(false);
      expect(chat.mock.calls.filter(([tier]) => tier === 'ultra')).toHaveLength(0);
    } else {
      expect(fullRuns[0]?.result.exitCode).toBe(0);
      expect(file.outcome).toBe('fixed');
      expect(file.audit?.approved).toBe(true);
      expect(chat.mock.calls.filter(([tier]) => tier === 'ultra')).toHaveLength(1);
    }
    expect(await readFile(join(f.source, 'src/add.mjs'), 'utf8')).toBe(originalSources['src/add.mjs']);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
}, 20_000);
