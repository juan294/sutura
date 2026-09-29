import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { prepareRuntimeChallenges, runRuntimeChallenges, summarizeChallengePreparation } from './runtime.js';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import type { Executor } from '../executor/types.js';
import type { HealLlm } from '../heal.js';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const source = 'export function pages(n, d) { return Math.floor(n / d) + 1; }';
const proposal = { id: 'boundary', kind: 'bug-regression', contractRefs: [{ path: 'src/pages.js', sha256: hash(source), startLine: 1, endLine: 1 }], rationale: 'Exact boundary', probeId: 'pages', inputs: [20, 10], contractId: 'pages', relationId: 'equals' };
function setup() {
  const calls: string[] = [];
  const run = vi.fn(async (image: string) => { calls.push(image); return { imageId: 'discard', exitCode: 0, stdout: JSON.stringify({ version: 1, value: image === 'ceil' ? 2 : 3 }), stderr: '', metrics: {} }; });
  const executor = { run } as unknown as Executor;
  const chat = vi.fn(async () => { calls.push('generate'); return { text: JSON.stringify({ challenges: [proposal] }) }; });
  const llm = { chat } as unknown as HealLlm;
  const policy = { ...createDefaultRepositoryPolicy(), verification: { mode: 'required' as const, contracts: [{ id: 'pages', kind: 'ceiling-division' as const, target: { adapter: 'javascript' as const, path: 'src/pages.js', export: 'pages' }, maxItems: 100, maxDivisor: 100 }] } };
  return { calls, run, chat, executor, llm, policy, input: { executor, llm, policy, baselineImage: 'baseline', baselineSnapshotHash: hash('snapshot'), policyBaseSha: 'a'.repeat(40), policyHash: hash('policy'), failureExcerpt: 'expected two pages', baselineSources: [{ path: 'src/pages.js', startLine: 1, content: source }] } };
}
it('generates and qualifies once before any candidate and shares frozen probes across alternatives', async () => {
  const s = setup();
  const prepared = await prepareRuntimeChallenges(s.input);
  const messages = (s.chat.mock.calls[0] as unknown as [unknown, Array<{ role: string; content: string }>])[1];
  const generation = JSON.parse(messages[1]!.content) as {
    contractExcerpts: Array<{ citation: { path: string; sha256: string; startLine: number; endLine: number } }>;
  };
  expect(generation.contractExcerpts[0]?.citation).toEqual({
    path: 'src/pages.js', sha256: hash(source), startLine: 1, endLine: 1,
  });
  expect(s.calls).toEqual(['generate', 'baseline', 'baseline']);
  expect((await runRuntimeChallenges(prepared, s.executor, 'floor')).status).toBe('failed');
  expect((await runRuntimeChallenges(prepared, s.executor, 'ceil')).status).toBe('passed');
  expect(s.chat).toHaveBeenCalledTimes(1);
  expect(s.calls).toEqual(['generate', 'baseline', 'baseline', 'floor', 'floor', 'ceil', 'ceil']);
  expect(JSON.stringify(s.chat.mock.calls)).not.toContain('candidateDiff');
});
it('never discards an invalid frozen challenge to approve the remaining one', async () => {
  const s = setup();
  s.chat.mockResolvedValue({ text: JSON.stringify({ challenges: [proposal, { ...proposal, id: 'bad', inputs: [-1, 10] }] }) });
  const prepared = await prepareRuntimeChallenges(s.input);
  expect((await runRuntimeChallenges(prepared, s.executor, 'ceil')).status).toBe('insufficient');
  expect(summarizeChallengePreparation(prepared)).toEqual({
    reason: 'invalid-probe', retainedCount: 2, excludedCount: 0, qualifiedCount: 1,
    excludedReasons: [], disqualifiedReasons: [{ reasonCode: 'input-outside-domain', count: 1 }],
  });
});

it('reports excluded proposal codes without retaining generated text or inputs', async () => {
  const s = setup();
  s.chat.mockResolvedValue({ text: JSON.stringify({ challenges: [proposal, {
    ...proposal, id: 'bad', probeId: 'Invalid ID', rationale: 'sk_test_abcdefgh12345678', inputs: ['private-value'],
  }] }) });
  const prepared = await prepareRuntimeChallenges(s.input);
  const summary = summarizeChallengePreparation(prepared);
  expect(summary).toEqual({
    reason: 'invalid-probe', retainedCount: 1, excludedCount: 1, qualifiedCount: 1,
    excludedReasons: [{ reasonCode: 'invalid-probe', count: 1 }], disqualifiedReasons: [],
  });
  expect(JSON.stringify(summary)).not.toContain('private-value');
  expect(JSON.stringify(summary)).not.toContain('sk_test_abcdefgh12345678');
});
it('binds every repetition to the original subject image and stores observed byte digests', async () => {
  const s = setup();
  const prepared = await prepareRuntimeChallenges(s.input);
  const result = await runRuntimeChallenges(prepared, s.executor, 'ceil');
  expect(result.observations).toHaveLength(4);
  expect(result.observations.every(x => /^[a-f0-9]{64}$/.test(x.observationSha256 ?? ''))).toBe(true);
  expect(s.run.mock.calls.map(([image]) => image)).toEqual(['baseline', 'baseline', 'ceil', 'ceil']);
});

it('refuses a denied contract target before disclosing it to generation or running a probe', async () => {
  const s = setup();
  s.policy.deniedReadPaths = ['src/pages.js'];
  const prepared = await prepareRuntimeChallenges(s.input);
  expect(prepared.reason).toBe('invalid-probe');
  expect(s.chat).not.toHaveBeenCalled();
  expect(s.run).not.toHaveBeenCalled();
});

it('shows exact-contract arguments and a valid example in the challenge prompt', async () => {
  const s = setup();
  s.policy.verification.contracts = [{
    id: 'pages', kind: 'exact',
    target: { adapter: 'javascript', path: 'src/pages.js', export: 'pages' },
    examples: [{ args: [20, 10], expected: 3 }],
  }] as unknown as typeof s.policy.verification.contracts;
  const chat = vi.fn(async (_model: string, messages: Array<{ content: string }>) => {
    const example = messages[0]!.content.match(/A valid shape using the first cited contract is (.+)\. Change kind/u)?.[1];
    if (!example) throw Error('missing challenge example');
    return { text: example };
  });
  s.input.llm = { chat } as unknown as HealLlm;

  const prepared = await prepareRuntimeChallenges(s.input);

  const messages = chat.mock.calls[0]![1];
  const user = JSON.parse(messages[1]!.content) as { contractExcerpts: Array<{ allowedInputsJson: string[] }> };
  expect(user.contractExcerpts[0]?.allowedInputsJson).toEqual(['[20,10]']);
  expect(messages[0]!.content).toContain('"inputs":[20,10]');
  expect(messages[0]!.content).not.toContain('"inputs":[]');
  expect(prepared.reason).toBeNull();
  expect(prepared.qualified).toEqual([expect.objectContaining({ challengeId: 'probe-1', qualified: true })]);
  expect((await runRuntimeChallenges(prepared, s.executor, 'floor')).status).toBe('passed');
  expect((await runRuntimeChallenges(prepared, s.executor, 'ceil')).status).toBe('failed');
});

it('redacts exact-contract arguments in every generated message', async () => {
  const s = setup();
  const secret = 'sk_test_abcdefgh12345678';
  s.policy.verification.contracts = [{
    id: 'pages', kind: 'exact',
    target: { adapter: 'javascript', path: 'src/pages.js', export: 'pages' },
    examples: [{ args: [secret], expected: 2 }],
  }] as unknown as typeof s.policy.verification.contracts;

  await prepareRuntimeChallenges(s.input);

  const messages = (s.chat.mock.calls[0] as unknown as [unknown, Array<{ role: string; content: string }>])[1];
  expect(JSON.stringify(messages)).not.toContain(secret);
  expect(JSON.stringify(messages)).toContain('[redacted token]');
});
