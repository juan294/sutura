import { describe, expect, it, vi } from 'vitest';
import { TypeSafeClient, type TypeSafeAnswer, type TypeSafeQuestion } from '../llm/typesafe.js';
import type { NebiusFetch } from '../llm/nebius.js';
import { Ledger } from '../llm/cost.js';
import type { SearchNode } from '../engine/search.js';
import { adaptiveSearch } from '../engine/search.js';
import { compareSearchNodes } from '../engine/search-score.js';
import { ReplayRecorder } from '../replay/bundle.js';
import { recordingTypeSafeFetch } from '../replay/record-fetch.js';
import { replayFetch } from '../replay/replay-fetch.js';
import { RecordedCallCursor } from '../replay/recorded-call-cursor.js';
import { DecisionSession } from './call.js';
import { semanticConfig, type DecisionMode } from './config.js';
import { rankRepairFrontier } from './rank-frontier.js';

function node(id: string, output: string): SearchNode {
  return { id, depth: 1, imageId: id, cumulativeDiff: `complete diff ${id}`, errorFingerprint: id,
    testEvidence: { commandId: 'test', imageId: id, exitCode: 1, output },
    policyEvidence: { valid: true, violations: [], changedFiles: ['source.ts'], diffBytes: 20 },
    stageEvidence: [], transcriptReference: id };
}
const nodes = () => [node('short', 'original failure'), node('progress', Array.from({ length: 20 }, (_, index) => `new failure ${String.fromCharCode(65 + index)}`).join('\n'))];
function setup(mode: DecisionMode = 'assist', change?: (answers: Record<string, TypeSafeAnswer>) => void, deadline = Date.now() + 5000, maxUsd = .02) {
  const fetch = vi.fn(async (_url: string, request: Parameters<NebiusFetch>[1]) => {
    const body = JSON.parse(request!.body as string) as { questions: Record<string, TypeSafeQuestion> };
    const answers: Record<string, TypeSafeAnswer> = {};
    for (const [id, question] of Object.entries(body.questions)) {
      if (question.type === 'noul') answers[id] = { type: 'noul', noul: id.endsWith('sufficient') ? .95 : id.endsWith('original') && id.startsWith('node_0_') ? .95 : .05 };
      else {
        const selected = id.startsWith('node_0_') ? 'same_failure' : 'original_resolved_new_failure';
        answers[id] = { type: 'choice', choice: selected, confidence: .95,
          probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === selected ? .9 : .05])) };
      }
    }
    change?.(answers);
    return new Response(JSON.stringify({ model: 'jev-1.14.0', answers, usage: { input_tokens: 100, output_tokens: 0 } }), { headers: { 'content-type': 'application/json' } });
  });
  const capture = vi.fn();
  const session = new DecisionSession({ config: semanticConfig({ modes: { ranking: mode }, maxUsd }, true),
    deadline, capture, client: new TypeSafeClient({ apiKey: 'test', model: 'jev-1.14.0', ledger: new Ledger({}) }, { fetch: fetch as NebiusFetch }) });
  return { session, fetch, capture };
}

describe('semantic frontier judgments', () => {
  it('binds every judgment to its exact array entry and retains known versus absent observation metadata', async () => {
    const input = nodes();
    input[1]!.testEvidence = { ...input[1]!.testEvidence, commandId: 'diagnosed', outputTruncated: false, processState: { timedOut: false, signal: 0 } };
    const { session, fetch } = setup();
    expect(await rankRepairFrontier(session, 'original failure', input)).toEqual(['progress', 'short']);
    const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string) as { state: { nodes: unknown[] }; questions: Record<string, TypeSafeQuestion> };
    expect(body.state.nodes[0]).toMatchObject({ commandId: 'test', outputTruncated: null, processState: null });
    expect(body.state.nodes[1]).toMatchObject({ commandId: 'diagnosed', outputTruncated: false, processState: { timedOut: false, signal: 0 } });
    for (const index of [0, 1]) {
      for (const suffix of ['sufficient', 'original', 'unrelated', 'progress']) expect(body.questions[`node_${index}_${suffix}`]!.instructions).toContain(`nodes[${index}]`);
      expect(body.questions[`node_${index}_sufficient`]!.instructions).toContain(`nodes[${index}].output`);
      expect(body.questions[`node_${index}_sufficient`]!.instructions).toContain(`nodes[${index}].completeDiff`);
      expect(body.questions[`node_${index}_original`]!.instructions).toContain(`nodes[${index}].output`);
      expect(body.questions[`node_${index}_unrelated`]!.instructions).toContain(`nodes[${index}].completeDiff`);
      expect(body.questions[`node_${index}_progress`]!.instructions).toContain(`nodes[${index}].output`);
    }
    const unrelated = body.questions.node_0_unrelated;
    expect(unrelated).toMatchObject({ type: 'noul', criteria: { true: expect.any(String), false: expect.stringContaining('ineffective') } });
  });
  it.each(['assist', 'shadow'] as const)('%s retains the entire native order before provider or capture for incomplete observations', async mode => {
    const invalid: Array<{ original?: string; change(input: SearchNode[]): void }> = [
      { change: input => { input[1]!.testEvidence = { ...input[1]!.testEvidence, outputTruncated: true }; } },
      { change: input => { input[1]!.testEvidence.processState = { timedOut: true }; } },
      { change: input => { input[1]!.testEvidence.processState = { signal: 9 }; } },
      { change: input => { input[1]!.testEvidence.exitCode = -1; } },
      { change: input => { input[1]!.testEvidence.output = ' '; } },
      { change: input => { input[1]!.cumulativeDiff = ' '; } },
      { change: input => { input[1]!.testEvidence.commandId = ' '; } },
      { original: ' ', change: () => {} },
    ];
    for (const value of invalid) {
      const input = nodes(); value.change(input);
      const baseline = input.toSorted(compareSearchNodes).map(node => node.id);
      const { session, fetch, capture } = setup(mode);
      expect(await rankRepairFrontier(session, value.original ?? 'original failure', input)).toEqual(baseline);
      expect(fetch).not.toHaveBeenCalled(); expect(capture).not.toHaveBeenCalled();
      expect(session.records[0]).toMatchObject({ outcome: 'unavailable', reason: 'missing-evidence', suggested: baseline, attempts: 0, actualUsd: 0, unknownSpendUsd: 0 });
    }
  });
  it('promotes real progress despite verbose output, preserves the exact set and records both orders', async () => {
    const { session, fetch } = setup();
    expect(await rankRepairFrontier(session, 'original failure', nodes())).toEqual(['progress', 'short']);
    expect(fetch).toHaveBeenCalledOnce();
    expect(session.records[0]).toMatchObject({ candidateIds: ['short', 'progress'], baseline: ['short', 'progress'], suggested: ['progress', 'short'], reason: 'ranking-applied' });
  });
  it.each(['off', 'shadow'] as const)('%s preserves the baseline without provider calls', async mode => {
    const { session, fetch, capture } = setup(mode);
    expect(await rankRepairFrontier(session, 'original failure Authorization: Bearer private-token', nodes())).toEqual(['short', 'progress']);
    expect(fetch).not.toHaveBeenCalled();
    if (mode === 'shadow') { expect(capture).toHaveBeenCalledOnce(); expect(JSON.stringify(capture.mock.calls)).not.toContain('private-token'); }
  });
  it.each([
    (a: Record<string, TypeSafeAnswer>) => { a.node_1_sufficient = { type: 'noul', noul: .1 }; },
    (a: Record<string, TypeSafeAnswer>) => { a.node_1_original = { type: 'noul', noul: .95 }; },
    (a: Record<string, TypeSafeAnswer>) => { a.node_1_unrelated = { type: 'noul', noul: .95 }; },
    (a: Record<string, TypeSafeAnswer>) => { a.node_1_original = { type: 'noul', noul: .5 }; },
    (a: Record<string, TypeSafeAnswer>) => { delete a.node_1_sufficient; },
  ])('falls back for the whole set when any required judgment is unusable', async change => {
    const { session } = setup('assist', change);
    expect(await rankRepairFrontier(session, 'original failure', nodes())).toEqual(['short', 'progress']);
  });
  it('does not favor missing output, truncate an oversized diff, or reorder tied judgments', async () => {
    const missing = setup(); const incomplete = nodes(); incomplete[0]!.testEvidence.output = '';
    expect(await rankRepairFrontier(missing.session, 'original failure', incomplete)).toEqual(['short', 'progress']);
    const large = setup(); const oversized = nodes(); oversized[1]!.cumulativeDiff = 'x'.repeat(24 * 1024);
    expect(await rankRepairFrontier(large.session, 'original failure', oversized)).toEqual(['short', 'progress']);
    expect(large.fetch).not.toHaveBeenCalled(); expect(large.session.records[0]?.reason).toBe('input-too-large');
    const tied = setup('assist', answers => { answers.node_1_original = { type: 'noul', noul: .95 }; answers.node_1_progress = { type: 'choice', choice: 'same_failure', confidence: .95, probabilities: { same_failure: .9, original_resolved_new_failure: .05, unclear: .05 } }; });
    expect(await rankRepairFrontier(tied.session, 'original failure', nodes())).toEqual(['short', 'progress']);
  });
  it('keeps native passing, policy and unpatched priorities', async () => {
    const { session } = setup(); const input = nodes(); input[1]!.policyEvidence.changedFiles = [];
    expect(await rankRepairFrontier(session, 'original failure', input)).toEqual(['short', 'progress']);
  });
  it('falls back on exhausted cap/deadline and recovers with a fresh authorized invocation', async () => {
    for (const value of [setup('assist', undefined, 0), setup('assist', undefined, Date.now() + 5000, 1e-10)]) {
      expect(await rankRepairFrontier(value.session, 'original failure', nodes())).toEqual(['short', 'progress']); expect(value.fetch).not.toHaveBeenCalled();
    }
    expect(await rankRepairFrontier(setup().session, 'original failure', nodes())).toEqual(['progress', 'short']);
  });
  it.each(['assist', 'shadow'] as const)('executes real search with %s and preserves final verification authority', async mode => {
    const { session, fetch } = setup(mode); const admit = vi.fn(async () => ({ accepted: false, reason: 'executable verification refused' }));
    const result = await adaptiveSearch({ baselineImageId: 'base', initialBranches: 2, beamWidth: 1,
      maximumDepth: 2, maximumTotalBranches: 3, availableBranches: () => 3, admit,
      rankFrontier: nodes => rankRepairFrontier(session, 'original failure', nodes),
      expand: async ({ depth, branch }) => depth === 1 ? nodes()[branch - 1]! : {
        ...node('green', 'Tests passed'), testEvidence: { commandId: 'test', imageId: 'green', exitCode: 0, output: 'Tests passed' }, candidate: { id: 'green', diff: 'complete diff green', rationale: 'observed green' },
      } });
    expect(result.nodes[2]?.parentId).toBe(mode === 'assist' ? 'search-002' : 'search-001');
    expect(result.nodes.slice(0, 2).map(n => n.id)).toEqual(['search-001', 'search-002']);
    expect(result.candidates).toEqual([]); expect(admit).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(mode === 'assist' ? 1 : 0);
  });
  it('replays the exact recorded ranking exchange without a live fallback', async () => {
    const original = setup();
    const recorder = new ReplayRecorder('ranking', 'fixture/ranking', 'a'.repeat(40), { triageN: 1, raceK: 1, models: { nano: 'nano', super: 'super', ultra: 'ultra' }, routingProfileId: 'test', maxOps: 1 });
    const withFetch = (fetch: NebiusFetch) => new DecisionSession({ ...original.session.options, client: new TypeSafeClient({ apiKey: 'test', model: 'jev-1.14.0', ledger: new Ledger({}) }, { fetch }) });
    const recorded = withFetch(recordingTypeSafeFetch(recorder, original.fetch));
    expect(await rankRepairFrontier(recorded, 'original failure', nodes())).toEqual(['progress', 'short']);
    const bundle = recorder.finish('gave-up'); const cursor = new RecordedCallCursor(bundle.http, exchange => ({ method: exchange.boundary, args: [] }), 'HTTP');
    const replayed = withFetch(replayFetch(bundle, 'typesafe', cursor));
    expect(await rankRepairFrontier(replayed, 'original failure', nodes())).toEqual(['progress', 'short']);
    cursor.assertConsumed(); expect(original.fetch).toHaveBeenCalledOnce();
    expect(replayed.records[0]?.inputHash).toBe(recorded.records[0]?.inputHash);
    expect(replayed.snapshot()).toEqual(recorded.snapshot());
  });
});
