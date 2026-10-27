import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { canonicalPacketDigest, canonicalJson, captureNodeDiagnostics, resolveReproductionAtSource, type VerificationPacket } from '@sutura/core';
const exec = promisify(execFile), engineSha = 'd'.repeat(40);
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
let prepare: typeof import('./verification-authorization.js').prepareCliVerificationAuthorization;
let resolveFromBuilt: typeof resolveReproductionAtSource;
let bundleDir: string;
let authenticatedGh: import('./command.js').CommandRunner;
beforeAll(async () => {
  bundleDir = resolve('node_modules/.cache', `sutura-cli-authority-${randomUUID()}`);
  await mkdir(bundleDir, { recursive: true });
  const outfile = join(bundleDir, 'authority.mjs');
  await build({ stdin: { contents: `export { prepareCliVerificationAuthorization } from ${JSON.stringify(resolve('src/verification-authorization.ts'))}; export { resolveReproductionAtSource } from '@sutura/core';`, resolveDir: resolve('.') }, outfile, platform: 'node', format: 'esm', bundle: true, alias: { '@sutura/core': resolve('../core/src/index.ts') }, banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' }, define: { __SUTURA_ENGINE_SHA__: JSON.stringify(engineSha) } });
  const loaded = await import(pathToFileURL(outfile).href);
  prepare = input => loaded.prepareCliVerificationAuthorization(input, { run: authenticatedGh });
  resolveFromBuilt = loaded.resolveReproductionAtSource;
});
afterAll(async () => { if (bundleDir) await rm(bundleDir, { recursive: true, force: true }); });

async function fixture(withProtectedRef = false) {
  const root = await mkdtemp(join(tmpdir(), 'sutura-cli-authority-')), caseDir = join(root, 'repo');
  await exec('git', ['init', '-q', caseDir]);
  await exec('git', ['-C', caseDir, 'remote', 'add', 'origin', 'git@github.com:example/project.git']);
  const command = 'node scripts/test-select.mjs run terminal:rest';
  const files: Record<string, string> = { 'package.json': '{}', 'scripts/test-select.mjs': 'console.log("reviewed wrapper");\n', '.github/workflows/ci.yml': `jobs:\n  unit:\n    steps:\n      - name: Tests\n        run: ${command}\n` };
  const profile = { id: 'terminal', nativeCommand: command, cwd: '.', argv: ['node', '--test', '--test-reporter=spec'], sourceInputs: Object.entries(files).map(([path, bytes]) => ({ path, sha256: hash(bytes) })), nativeNodeVersion: '22.22.2', sandboxNodeVersion: '22.22.2', imageRef: `node:22.22.2@sha256:${'b'.repeat(64)}`, probeTimeoutSec: 240, fullCommand: command, fullTimeoutSec: 1800, callers: withProtectedRef ? [{ workflowId: 7, path: '.github/workflows/ci.yml', blobSha: 'b'.repeat(40), protectedRef: 'refs/heads/trusted', engineSha }] : [], approverIds: [] };
  const policyText = JSON.stringify({ version: 1, reproductionProfiles: [profile] });
  for (const [path, content] of Object.entries({ ...files, '.sutura.json': policyText })) { await mkdir(dirname(join(caseDir, path)), { recursive: true }); await writeFile(join(caseDir, path), content); }
  await exec('git', ['-C', caseDir, 'add', '.']);
  await exec('git', ['-C', caseDir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'source']);
  const sourceSha = (await exec('git', ['-C', caseDir, 'rev-parse', 'HEAD'])).stdout.trim();
  if (withProtectedRef) await exec('git', ['-C', caseDir, 'update-ref', 'refs/heads/trusted', sourceSha]);
  const fixtureLog = await readFile(new URL('../../core/src/github/__fixtures__/native-node-two-failures.log', import.meta.url), 'utf8');
  const nativeLog = [`##[group]Run ${command}`, command, 'shell: /usr/bin/bash -e {0}', '##[endgroup]', ...fixtureLog.trimEnd().split('\n'), '##[error]Process completed with exit code 1.'].map(line => `2026-10-27T00:00:01.100Z ${line}`).join('\n');
  const nativeBinding = { repository: 'example/project', sourceSha, runId: '42', attempt: 1, jobId: 7, stepNumber: 3, workflowPath: '.github/workflows/ci.yml', jobName: 'unit', stepName: 'Tests', runtimeVersion: '22.22.2' };
  const packet: VerificationPacket = { version: 'sutura-verification-packet-v1', id: 'approved-one', repository: nativeBinding.repository, sourceSha, runId: '42', attempt: 1, policyBaseSha: sourceSha, engineSha, policySha256: hash(policyText), profileSha256: '', nativeLogSha256: hash(nativeLog), nativeBindingSha256: hash(canonicalJson(nativeBinding)), fullCommand: command, fullTimeoutSec: 1800, finalAllowanceSec: 2100, policyTimeoutSec: 120, challengeTimeoutSec: 120, cancellationSec: 15, adjudicationSec: 60, providerMaxTimeoutSec: 3600, workflowTimeoutSec: 3000, sandboxUsdPerSecond: 0.00001, sandboxReservationUsd: 20 };
  const { readTrustedPolicyAtCommit } = await import('@sutura/core');
  const loaded = await readTrustedPolicyAtCommit(caseDir, sourceSha);
  const resolution = await resolveReproductionAtSource(caseDir, { policy: loaded.policy, policySha256: loaded.sha, command, runtimeId: 'node', sourceSha, native: captureNodeDiagnostics(nativeLog, nativeBinding, 'normal') });
  if (resolution.status !== 'ready') throw new Error('fixture profile must resolve');
  packet.profileSha256 = resolution.plan.profileSha256;
  authenticatedGh = async (binary, args) => {
    expect(binary).toBe('gh');
    expect(args.slice(0, 3)).toEqual(['api', '--hostname', 'github.com']);
    const endpoint = args.at(-1);
    if (endpoint === 'repos/example/project/actions/runs/42/attempts/1') return JSON.stringify({ id: 42, run_attempt: 1, head_sha: sourceSha, repository: { full_name: 'example/project' }, head_repository: { full_name: 'example/project' }, path: nativeBinding.workflowPath, conclusion: 'failure' });
    if (endpoint === 'repos/example/project/actions/runs/42/attempts/1/jobs?per_page=100') return JSON.stringify({ total_count: 1, jobs: [{ id: 7, run_id: 42, run_attempt: 1, head_sha: sourceSha, name: 'unit', conclusion: 'failure', steps: [{ number: 3, name: 'Tests', conclusion: 'failure', started_at: '2026-10-27T00:00:01Z', completed_at: '2026-10-27T00:00:02Z' }] }] });
    if (endpoint === 'repos/example/project/actions/jobs/7/logs') return `2026-10-27T00:00:00.100Z node: v22.22.2\n${nativeLog}`;
    throw new Error('Unexpected authenticated metadata request');
  };
  const envelopePath = join(root, 'private-envelope.json');
  const save = async () => writeFile(envelopePath, JSON.stringify({ packet, nativeLog, nativeBinding }), { mode: 0o600 });
  await save();
  return { root, caseDir, packet, nativeLog, nativeBinding, envelopePath, save };
}
it('uses the embedded engine, exact Git origin/source and protected policy, then reserves once', async () => {
  const f = await fixture();
  try {
    const input = { caseDir: f.caseDir, envelopePath: f.envelopePath, operatorDigest: canonicalPacketDigest(f.packet) };
    const prepared = await prepare(input);
    expect(prepared.sourceIdentity).toMatchObject({ kind: 'git', sourceSha: f.packet.sourceSha, policyBaseSha: f.packet.policyBaseSha });
    expect(prepared.nativeFailure.diagnostics?.complete).toBe(true);
    const resolution = await resolveFromBuilt(f.caseDir, { policy: prepared.policy, policySha256: prepared.policyEvidence.policySha, command: prepared.failureCommand, runtimeId: 'node', sourceSha: f.packet.sourceSha, native: prepared.nativeFailure.diagnostics });
    if (resolution.status !== 'ready') throw new Error('prepared profile must resolve');
    await prepared.authorizeVerification(resolution.plan);
    await expect(prepared.authorizeVerification(resolution.plan)).rejects.toThrow(/pending|issued|consumed|reconciliation/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
it('rejects omitted/wrong operator approval, engine/source/log mismatch and dirty source before reservation', async () => {
  const f = await fixture();
  try {
    const input = { caseDir: f.caseDir, envelopePath: f.envelopePath };
    await expect(prepare(input)).rejects.toThrow(/operator|authorize/u);
    await expect(prepare({ ...input, operatorDigest: 'a'.repeat(64) })).rejects.toThrow(/digest/u);
    f.packet.engineSha = f.packet.sourceSha; await f.save();
    await expect(prepare({ ...input, operatorDigest: canonicalPacketDigest(f.packet) })).rejects.toThrow(/engine/u);
    f.packet.engineSha = engineSha; f.packet.nativeLogSha256 = 'a'.repeat(64); await f.save();
    await expect(prepare({ ...input, operatorDigest: canonicalPacketDigest(f.packet) })).rejects.toThrow(/log/u);
    f.packet.nativeLogSha256 = hash(f.nativeLog); await f.save();
    await writeFile(join(f.caseDir, 'untracked'), 'dirty');
    await expect(prepare({ ...input, operatorDigest: canonicalPacketDigest(f.packet) })).rejects.toThrow(/tracked|clean/u);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
it('refuses public or symlinked envelope files', async () => {
  const f = await fixture();
  try {
    const input = { caseDir: f.caseDir, envelopePath: f.envelopePath, operatorDigest: canonicalPacketDigest(f.packet) };
    await chmod(f.envelopePath, 0o644);
    await expect(prepare(input)).rejects.toThrow(/private/u);
    await chmod(f.envelopePath, 0o600);
    const link = join(f.root, 'linked-envelope.json'); await symlink(f.envelopePath, link);
    await expect(prepare({ ...input, envelopePath: link })).rejects.toThrow();
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
it('normalizes HTTPS origins and rechecks known protected refs before issuing authority', async () => {
  const f = await fixture(true);
  try {
    await exec('git', ['-C', f.caseDir, 'remote', 'set-url', 'origin', 'https://github.com/example/project.git']);
    const input = { caseDir: f.caseDir, envelopePath: f.envelopePath, operatorDigest: canonicalPacketDigest(f.packet) };
    const prepared = await prepare(input);
    const resolved = await resolveFromBuilt(f.caseDir, { policy: prepared.policy, policySha256: prepared.policyEvidence.policySha, command: prepared.failureCommand, runtimeId: 'node', sourceSha: f.packet.sourceSha, native: prepared.nativeFailure.diagnostics });
    if (resolved.status !== 'ready') throw new Error('profile must resolve');
    await exec('git', ['-C', f.caseDir, 'update-ref', '-d', 'refs/heads/trusted']);
    await expect(prepared.authorizeVerification(resolved.plan)).rejects.toThrow(/ref.*unavailable/u);
    await exec('git', ['-C', f.caseDir, 'remote', 'set-url', 'origin', 'https://github.com/example/other.git']);
    await expect(prepare(input)).rejects.toThrow(/repository/u);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
