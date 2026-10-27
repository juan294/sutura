import { canonicalJson } from '../replay/canonical-json.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import { ContreeExecutor } from '../executor/contree.js';
import { RepairBudget } from './repair-budget.js';
import { expect, it } from 'vitest';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import { reproductionProfile, PROFILE_FILES } from '../policy/reproduction-profile.test-helper.js';
import { captureNodeDiagnostics } from './native-diagnostics.js';
import { resolveReproductionPlan } from './reproduction-plan.js';
import { authorizeCliVerification, canonicalPacketDigest, consumeVerificationAllowance, verificationOperationPermit, authorizedOperationTimeout, type VerificationPacket } from './verification-allowance.js';
const workflowPath = '.github/workflows/ci.yml';
const sources = { ...PROFILE_FILES, [workflowPath]: 'jobs:\n  unit:\n    steps:\n      - name: Tests\n        run: node scripts/test-select.mjs run terminal:rest\n' };
const profile = reproductionProfile({ sourceInputs: Object.entries(sources).map(([path, bytes]) => ({ path, sha256: createHash('sha256').update(bytes).digest('hex') })) });
const native = captureNodeDiagnostics(readFileSync(new URL('../github/__fixtures__/native-node-two-failures.log', import.meta.url), 'utf8'), { repository: 'example/project', sourceSha: 'a'.repeat(40), runId: '42', attempt: 1, jobId: 7, stepNumber: 3, workflowPath, jobName: 'unit', stepName: 'Tests', runtimeVersion: '22.22.2' }, 'normal');
const resolution = resolveReproductionPlan({ policy: { ...createDefaultRepositoryPolicy(), reproductionProfiles: [profile] }, policySha256: 'b'.repeat(64), command: profile.nativeCommand, runtimeId: 'node', sourceSha: 'a'.repeat(40), native, sources });
if (resolution.status !== 'ready') throw new Error('test profile must resolve');
const plan = resolution.plan;
function packet(): VerificationPacket { return { version: 'sutura-verification-packet-v1', id: 'pilot-one', repository: 'example/project', runId: '42', attempt: 1, sourceSha: 'a'.repeat(40), policyBaseSha: 'c'.repeat(40), engineSha: 'd'.repeat(40), policySha256: plan.policySha256, profileSha256: plan.profileSha256, nativeLogSha256: native.logSha256!, nativeBindingSha256: createHash('sha256').update(canonicalJson(native.binding)).digest('hex'),
  fullCommand: plan.fullCommand, fullTimeoutSec: 1800, finalAllowanceSec: 2100, policyTimeoutSec: 120, challengeTimeoutSec: 120, cancellationSec: 15, adjudicationSec: 60,
  providerMaxTimeoutSec: 3600, workflowTimeoutSec: 3000, sandboxUsdPerSecond: 0.00001, sandboxReservationUsd: 20 } }
const actual = { repository: 'example/project', runId: '42', attempt: 1, sourceSha: 'a'.repeat(40), policyBaseSha: 'c'.repeat(40), engineSha: 'd'.repeat(40) };
it('requires the separate exact operator invocation and consumes one candidate non-refundably', async () => {
  const grants = new Set<string>(); const reserveGrant = async (id: string) => { if (grants.has(id)) throw Error('consumed'); grants.add(id); };
  const p = packet(); const digest = canonicalPacketDigest(p);
  await expect(authorizeCliVerification({ packet: p, plan, actual, operatorDigest: undefined, reserveGrant })).rejects.toThrow(/operator/);
  expect(grants.size).toBe(0);
  const cap = await authorizeCliVerification({ packet: p, plan, actual, operatorDigest: digest, reserveGrant });
  expect(() => consumeVerificationAllowance(JSON.parse(JSON.stringify(cap)), { imageId: 'candidate', diffSha256: 'e'.repeat(64) })).toThrow();
  const phase = consumeVerificationAllowance(cap, { imageId: 'candidate', diffSha256: 'e'.repeat(64) });
  expect(() => consumeVerificationAllowance(cap, { imageId: 'another', diffSha256: 'f'.repeat(64) })).toThrow(/consumed/);
  const permit = verificationOperationPermit(phase, 'candidate', plan.fullCommand, 1800);
  expect(authorizedOperationTimeout(permit, 'candidate', plan.fullCommand, 1800)).toBe(1815000);
  expect(() => authorizedOperationTimeout(JSON.parse(JSON.stringify(permit)), 'candidate', plan.fullCommand, 1800)).toThrow();
  expect(() => authorizedOperationTimeout(permit, 'other', plan.fullCommand, 1800)).toThrow();
  await expect(authorizeCliVerification({ packet: p, plan, actual, operatorDigest: digest, reserveGrant })).rejects.toThrow(/consumed/);
});
it.each([
  { sourceSha: 'f'.repeat(40) }, { policySha256: 'f'.repeat(64) }, { engineSha: 'f'.repeat(40) },
  { finalAllowanceSec: 1800 }, { finalAllowanceSec: 3601 }, { providerMaxTimeoutSec: 600 },
  { sandboxReservationUsd: 0 }, { sandboxUsdPerSecond: 0 }, { workflowTimeoutSec: 1000 },
])('rejects incompatible or differently bound allowance %j before reserving paid work', async change => {
  const p = { ...packet(), ...change }; let reserved = false;
  await expect(authorizeCliVerification({ packet: p, plan, actual, operatorDigest: canonicalPacketDigest(p), reserveGrant: async () => { reserved = true; } })).rejects.toThrow();
  expect(reserved).toBe(false);
});
it('counts every required baseline/candidate command even with identical text', async () => {
  const changedPlan = resolveReproductionPlan({ policy: { ...plan.policy, requiredCommands: ['npm test', 'npm test'] }, policySha256: 'b'.repeat(64), command: profile.nativeCommand, runtimeId: 'node', sourceSha: 'a'.repeat(40), native, sources });
  if (changedPlan.status !== 'ready') throw Error('profile');
  const p = { ...packet(), profileSha256: changedPlan.plan.profileSha256, finalAllowanceSec: 2200 };
  await expect(authorizeCliVerification({ packet: p, plan: changedPlan.plan, actual, operatorDigest: canonicalPacketDigest(p), reserveGrant: async () => {} })).rejects.toThrow(/required/);
});

it('transfers only held audit capacity to a final clock without reopening ordinary ports', async () => {
  let now = 0; const p = packet();
  const cap = await authorizeCliVerification({ packet: p, plan, actual, operatorDigest: canonicalPacketDigest(p), reserveGrant: async () => {}, now: () => now });
  const budget = new RepairBudget({}, () => now);
  const reservation = budget.reserveCapacity({ modelTurns: 2, sandboxOperations: 2, inferenceCostUsd: 0.05 });
  now = 590_000;
  const phase = consumeVerificationAllowance(cap, { imageId: 'candidate', diffSha256: 'e'.repeat(64) });
  budget.transferToFinalVerification(reservation, phase);
  now = 620_000;
  expect(budget.remainingElapsedTimeSec()).toBe(0);
  expect(budget.remainingElapsedTimeSec(reservation)).toBeGreaterThan(600);
  expect(() => budget.reserveModelTurn(0.001)).toThrow();
  expect(() => budget.reserveSandboxOperation()).toThrow();
  const turn = budget.reserveModelTurn(0.01, reservation); budget.settleModelTurn(turn, 0.005);
  budget.reserveSandboxOperation(reservation);
  expect(() => budget.reserveSecondOpinion(0.01)).toThrow();
  expect(() => budget.reserveSecondOpinion(0.01, reservation)).not.toThrow();
  expect(budget.snapshot().elapsedTimeSec).toBe(620);
  budget.releaseCapacity(reservation);
  expect(budget.remainingElapsedTimeSec()).toBe(0);
});

it('lets an authorized full operation finish beyond 600 seconds through the live client poller', async () => {
  vi.useFakeTimers();
  try {
    const p = packet(); const cap = await authorizeCliVerification({ packet: p, plan, actual, operatorDigest: canonicalPacketDigest(p), reserveGrant: async () => {} });
    const phase = consumeVerificationAllowance(cap, { imageId: 'candidate', diffSha256: 'e'.repeat(64) });
    const permit = verificationOperationPermit(phase, 'candidate', plan.fullCommand, 1800);
    const started = Date.now(); let posted: Record<string, unknown> | undefined;
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') { posted = JSON.parse(String(init.body)); return new Response('{}', { status: 202, headers: { location: 'operations/long-one' } }); }
      return new Response(JSON.stringify(Date.now() - started < 620_000 ? { status: 'EXECUTING' } : { status: 'SUCCESS', result_image_uuid: 'verified', metadata: { result: { state: { exit_code: 0 }, stdout: { value: '', encoding: 'ascii' }, stderr: { value: '', encoding: 'ascii' } } } }), { status: 200 });
    });
    const executor = new ContreeExecutor({ token: 'test', project: 'test', fetch, pollIntervalMs: 5000 });
    await expect(executor.run('candidate', plan.fullCommand, { timeoutSec: 1800 })).rejects.toThrow(/authority/);
    expect(fetch).not.toHaveBeenCalled();
    const run = executor.run('candidate', plan.fullCommand, { timeoutSec: 1800, verificationPermit: permit });
    const observed = run.then(value => ({ value }), error => ({ error }));
    await vi.advanceTimersByTimeAsync(625_000);
    expect(await observed).toMatchObject({ value: { exitCode: 0 } });
    expect(posted?.timeout).toBe(1800);
  } finally { vi.useRealTimers(); }
});
it.each([false, true])('finishes full audit, adjudication and every policy deadline with exact-fit packet=%s', async exactFit => {
  const { reserveRecoveryAudit, budgetedRecoveryPorts } = await import('../diagnose/hypotheses-budget.js');
  const { evaluateRuntimeCandidate } = await import('../verification/runtime.js');
  const { prepareRuntimeChallenges } = await import('../challenges/runtime.js');
  const required = ['npm run check', 'npm run check'];
  const resolved = resolveReproductionPlan({ policy: { ...plan.policy, requiredCommands: required }, policySha256: 'b'.repeat(64), command: profile.nativeCommand, runtimeId: 'node', sourceSha: 'a'.repeat(40), native, sources });
  if (resolved.status !== 'ready') throw Error('profile');
  const p = { ...packet(), finalAllowanceSec: exactFit ? 2355 : 2500, workflowTimeoutSec: 3300 };
  let now = 0; const calls: Array<{ image: string; command: string; seconds?: number }> = [];
  const executor: import('../executor/types.js').Executor = { importImage: async () => 'unused', snapshot: async () => 'unused', cancel: async operationId => ({ operationId, requested: false, terminal: 'succeeded' }), operationCapacity: () => ({ limit: 1, active: 0, available: 1 }), runMany: async () => [],
    run: async (image, command, options) => { calls.push({ image, command, ...(options?.timeoutSec === undefined ? {} : { seconds: options.timeoutSec }) }); if (calls.length === 1) now += exactFit ? 1_800_000 : 620_000; else if (exactFit) now += 120_000; return { imageId: 'result', exitCode: 0, stdout: 'passed', stderr: '', truncated: false, metrics: { wallTimeSec: calls.length === 1 ? 620 : 1 } }; } };
  const llm: import('../heal.js').HealLlm = { modelQuote: tier => ({ role: tier, modelId: tier, profileId: 'fixed', price: { input: 1, output: 1 } }), chat: async () => { if (exactFit) now += 30_000; return { text: '{"approved":true,"reasoning":"The source fix preserves both assertions"}', usd: 0.001 }; } };
  const cap = await authorizeCliVerification({ packet: p, plan: resolved.plan, actual, operatorDigest: canonicalPacketDigest(p), reserveGrant: async () => {}, now: () => now });
  const budget = new RepairBudget({}, () => now);
  const ordinary = budgetedRecoveryPorts({ budget, executor, llm });
  const audit = reserveRecoveryAudit({ budget, executor, llm, policy: resolved.plan.policy, verificationAllowance: cap });
  const prepared = await prepareRuntimeChallenges({ executor, llm, policy: resolved.plan.policy, baselineImage: 'baseline', policyBaseSha: actual.policyBaseSha, policyHash: plan.policySha256, baselineSnapshotHash: 'f'.repeat(64), failureExcerpt: 'original two failures', baselineSources: [] });
  now = 590_000;
  const diff = 'diff --git a/src/value.js b/src/value.js\n--- a/src/value.js\n+++ b/src/value.js\n@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n';
  audit.beginFinalVerification!({ imageId: 'candidate', diffSha256: createHash('sha256').update(diff).digest('hex') });
  if (exactFit) now += 15_000;
  const result = await evaluateRuntimeCandidate({ ...audit, prepared, policy: resolved.plan.policy, baselineImage: 'baseline', winner: { candidate: { id: 'selected', rationale: 'fix source', diff }, imageId: 'candidate', nodeId: 'selected', held: true, exitCode: 0 }, diagnosis: { class: 'test-assertion', confidence: 1, signals: [], failingCmd: plan.fullCommand, errorExcerpt: 'two failures' }, beforeLog: 'two failures', suiteCommand: plan.fullCommand, suiteRunOptions: { cwd: plan.cwd, timeoutSec: p.fullTimeoutSec } });
  expect(result.verdict.approved).toBe(true);
  expect(calls[0]).toMatchObject({ command: plan.fullCommand, seconds: 1800 });
  expect(calls.slice(1).map(call => call.image)).toEqual(['baseline', 'candidate', 'baseline', 'candidate']);
  expect(calls.slice(1).map(call => call.seconds)).toEqual([120, 120, 120, 120]);
  expect(budget.snapshot().elapsedTimeSec).toBe(exactFit ? 2915 : 1210);
  expect(budget.snapshot().modelTurns).toBe(2); // one spent plus the existing held turn; no extra pool
  await expect(ordinary.llm.chat('nano', [])).rejects.toThrow();
  await expect(ordinary.executor.run('candidate', 'search-again')).rejects.toThrow();
  expect(() => audit.beginFinalVerification!({ imageId: 'other', diffSha256: 'f'.repeat(64) })).toThrow();
  audit.finish();
});
it('clamps every final challenge request to the approved smaller category deadline', async () => {
  const { reserveRecoveryAudit } = await import('../diagnose/hypotheses-budget.js');
  const policy = { ...plan.policy, verification: { mode: 'required' as const, contracts: [{ id: 'pages', kind: 'ceiling-division' as const, target: { adapter: 'javascript' as const, path: 'src/pages.js', export: 'pages' }, maxItems: 100, maxDivisor: 100 }] } };
  const resolved = resolveReproductionPlan({ policy, policySha256: plan.policySha256, command: profile.nativeCommand, runtimeId: 'node', sourceSha: actual.sourceSha, native, sources });
  if (resolved.status !== 'ready') throw Error('profile');
  const p = { ...packet(), challengeTimeoutSec: 1 };
  const cap = await authorizeCliVerification({ packet: p, plan: resolved.plan, actual, operatorDigest: canonicalPacketDigest(p), reserveGrant: async () => {} });
  const run = vi.fn<import('../executor/types.js').Executor['run']>(async () => ({ imageId: 'result', exitCode: 0, stdout: '', stderr: '', truncated: false, metrics: {} }));
  const executor = { run } as unknown as import('../executor/types.js').Executor;
  const llm: import('../heal.js').HealLlm = { modelQuote: tier => ({ role: tier, modelId: tier, profileId: 'fixed', price: { input: 1, output: 1 } }), chat: async () => ({ text: 'ok' }) };
  const audit = reserveRecoveryAudit({ executor, llm, policy, budget: new RepairBudget(), verificationAllowance: cap });
  audit.beginFinalVerification!({ imageId: 'candidate', diffSha256: 'e'.repeat(64) });
  await audit.executor.run('candidate', plan.fullCommand, { timeoutSec: 1800, verificationKind: 'full' });
  await audit.executor.run('challenge-image', 'owned frozen challenge', { timeoutSec: 10, verificationKind: 'challenge' });
  expect(run.mock.calls[1]?.[2]?.timeoutSec).toBe(1);
  audit.finish();
});
it('captures and replays a long full audit including the single-use provider permit clock read', async () => {
  const { ReplayRecorder } = await import('../replay/bundle.js');
  const { ReplayControllerClock } = await import('../replay/controller-clock.js');
  const { recordingExecutor } = await import('../replay/record-executor.js');
  const { RecordedExecutor } = await import('../replay/replay-executor.js');
  const { authorizeRecordedVerification } = await import('./verification-allowance.js');
  const { reserveRecoveryAudit } = await import('../diagnose/hypotheses-budget.js');
  const { evaluateRuntimeCandidate } = await import('../verification/runtime.js');
  const { prepareRuntimeChallenges } = await import('../challenges/runtime.js');
  let now = 0; const timer = vi.spyOn(Date, 'now').mockImplementation(() => now);
  try {
    const p = packet(), provenance = `cli:${canonicalPacketDigest(p)}`;
    const recorder = new ReplayRecorder(p.runId, p.repository, p.engineSha, { triageN: 1, raceK: 1, models: { nano: 'n', super: 's', ultra: 'u' }, routingProfileId: 'clock', maxOps: 1, longVerification: { packet: p, provenance, admitted: false } });
    recorder.bindControllerStart(0);
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      if (init?.method === 'POST') return new Response('{}', { status: 202, headers: { location: 'operations/captured-long' } });
      now += 620_000;
      return new Response(JSON.stringify({ status: 'SUCCESS', duration: 620, result_image_uuid: 'verified', metadata: { result: { state: { exit_code: 0 }, stdout: { value: 'passed', encoding: 'ascii' }, stderr: { value: '', encoding: 'ascii' } } } }), { status: 200 });
    });
    const live = recordingExecutor(new ContreeExecutor({ token: 'synthetic', project: 'synthetic', fetch, pollIntervalMs: 0 }), recorder);
    const diff = 'diff --git a/src/value.js b/src/value.js\n--- a/src/value.js\n+++ b/src/value.js\n@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n';
    const drive = async (executor: import('../executor/types.js').Executor, readClock: (domain: import('../replay/controller-clock.js').ControllerClockDomain) => number, startedAt: number, offline: boolean) => {
      const cap = offline ? authorizeRecordedVerification({ packet: p, plan, executor, now: () => readClock('verification') }) : await authorizeCliVerification({ packet: p, plan, actual, operatorDigest: canonicalPacketDigest(p), reserveGrant: async () => {}, now: () => readClock('verification') });
      if (!offline) recorder.recordVerificationAdmission(cap);
      const budget = new RepairBudget({}, () => readClock('repair'), startedAt);
      const llm: import('../heal.js').HealLlm = { modelQuote: tier => ({ role: tier, modelId: tier, profileId: 'fixed', price: { input: 1, output: 1 } }), chat: async () => { if (!offline) now += 1000; return { text: '{"approved":true,"reasoning":"Full command and source repair pass"}', usd: 0.001 }; } };
      const audit = reserveRecoveryAudit({ budget, executor, llm, policy: plan.policy, verificationAllowance: cap, operationIdPrefix: 'captured-long-audit' });
      const prepared = await prepareRuntimeChallenges({ executor, llm, policy: plan.policy, baselineImage: 'baseline', policyBaseSha: p.policyBaseSha, policyHash: p.policySha256, baselineSnapshotHash: 'f'.repeat(64), failureExcerpt: 'two assertions', baselineSources: [] });
      audit.beginFinalVerification!({ imageId: 'candidate', diffSha256: createHash('sha256').update(diff).digest('hex') });
      const frame = { imageId: 'candidate', diffSha256: createHash('sha256').update(diff).digest('hex'), sharedBudget: budget.snapshot() };
      if (!offline) recorder.recordFinalVerification(frame);
      const result = await evaluateRuntimeCandidate({ ...audit, policy: plan.policy, prepared, baselineImage: 'baseline', winner: { candidate: { id: 'selected', rationale: 'source fix', diff }, imageId: 'candidate', nodeId: 'selected', held: true, exitCode: 0 }, diagnosis: { class: 'test-assertion', confidence: 1, signals: [], failingCmd: p.fullCommand, errorExcerpt: 'two assertions' }, beforeLog: 'two assertions', suiteCommand: p.fullCommand, suiteRunOptions: { cwd: plan.cwd, timeoutSec: p.fullTimeoutSec } });
      audit.finish(); return { result, frame, budget: budget.snapshot() };
    };
    const original = await drive(live, domain => recorder.clockNow(domain), 0, false);
    expect(original.result.verdict.approved).toBe(true);
    const bundle = recorder.finish('fixed');
    const clock = new ReplayControllerClock(bundle.configuration.controllerClock!);
    const offline = new RecordedExecutor(bundle.executor);
    try {
      const replayed = await drive(offline, domain => clock.now(domain), clock.startedAt, true);
      expect(replayed.frame).toEqual(original.frame); expect(replayed.budget).toEqual(original.budget);
      expect(replayed.result.verdict.approved).toBe(true); clock.assertConsumed();
    } finally { offline.dispose(); }
  } finally { timer.mockRestore(); }
});
