import { describe, expect, it, vi } from 'vitest';
import { decisionHash } from '../decisions/call.js';
import { Ledger } from '../llm/cost.js';
import { TypeSafeClient, type TypeSafeAnswer, type TypeSafeQuestion } from '../llm/typesafe.js';
import type { NebiusFetch } from '../llm/nebius.js';
import { parseEvidenceCase } from './projection.js';
import { explainEvidence, lexicalEvidence, navigatorRequest } from './select.js';

function projection() { return parseEvidenceCase({ runId: 'case-1', repo: 'acme/widget', outcome: 'gave-up', diagnosis: { class: 'test-assertion', confidence: .75, signals: ['mechanical:test-assertion'], failingCmd: 'pnpm test', errorExcerpt: 'AssertionError: expected 1 to be 2 in calculateTotal' }, policy: { baseRef: 'local', baseSha: 'local', policySha: 'default' }, stages: [], cost: { entries: [] } }); }
function provider(change?: (answers: Record<string, TypeSafeAnswer>, ids: string[]) => void, status = 200) {
  const fetch = vi.fn(async (_url: string, init: Parameters<NebiusFetch>[1]) => {
    const body = JSON.parse(init!.body as string) as { state: { candidates: Array<{ id: string }> }; questions: Record<string, TypeSafeQuestion> };
    const ids = body.state.candidates.map(c => c.id); const selected = [ids[0], 'none', 'none'];
    const answers: Record<string, TypeSafeAnswer> = { applicable: { type: 'noul', noul: .95 } };
    for (const [index,key] of ['first','second','third'].entries()) { const q = body.questions[key]!; if (q.type !== 'choice') throw new Error('Expected choice'); answers[key] = { type: 'choice', choice: selected[index]!, confidence: .95, probabilities: Object.fromEntries(Object.keys(q.criteria).map(id => [id, id === selected[index] ? .9 : .1 / (Object.keys(q.criteria).length - 1)])) }; }
    change?.(answers, ids);
    return new Response(JSON.stringify({ model: 'jev-1.14.0', answers, usage: { input_tokens: 100, output_tokens: 0 } }), { status });
  });
  return { fetch, client: new TypeSafeClient({ apiKey: 'test', model: 'jev-1.14.0', ledger: new Ledger({}) }, { fetch: fetch as NebiusFetch }) };
}
function choose(answers: Record<string, TypeSafeAnswer>, key: string, id: string) { const answer = answers[key]; if (answer?.type !== 'choice') throw new Error('Expected choice'); answer.choice = id; answer.probabilities = Object.fromEntries(Object.keys(answer.probabilities).map(k => [k, k === id ? .9 : .1 / (Object.keys(answer.probabilities).length - 1)])); }

describe('local evidence selection', () => {
  it('answers evidence queries lexically, returns at most three existing blocks, and no result for unrelated text', async () => {
    const value = projection(), ambient = vi.fn(async () => { throw new Error('Unexpected network'); }); vi.stubGlobal('fetch', ambient);
    try {
      const results = lexicalEvidence(value, 'What caused the calculateTotal AssertionError?');
      expect(results.length).toBeLessThanOrEqual(3); expect(results.some(b => b.locator === '$.diagnosis.errorExcerpt')).toBe(true);
      expect(lexicalEvidence(value, 'unicorn astronomy volcano')).toEqual([]);
      expect((await explainEvidence(value, 'What cost USD was recorded?')).results.some(b => b.kind === 'cost')).toBe(true);
      expect((await explainEvidence(value, 'unicorn astronomy volcano')).status).toBe('no-match'); expect(ambient).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('builds the exact bounded evaluator request without duplicating excerpts in criteria', () => {
    const value = projection(); const request = navigatorRequest(value, 'What caused calculateTotal?');
    expect(Object.keys(request.questions)).toEqual(['applicable','first','second','third']);
    expect(request.baselineIds).toEqual(lexicalEvidence(value, 'What caused calculateTotal?').map(b => b.id));
    expect(request.candidateIds.length).toBeLessThanOrEqual(32);
    expect(JSON.stringify(request.questions)).not.toContain('AssertionError: expected');
  });

  it('selects only actual supplied evidence IDs through one real TypeSafe call', async () => {
    const value = projection(), { client, fetch } = provider();
    const result = await explainEvidence(value, 'What caused calculateTotal?', { semantic: true, maxUsd: .002, client });
    expect(result.status).toBe('matched'); expect(result.mode).toBe('semantic'); expect(result.results).toHaveLength(1); expect(value.blocks.some(b => b.id === result.results[0]!.id)).toBe(true);
    expect(result.decision).toMatchObject({ role: 'navigator', requestedModel: 'jev-1.14.0', attempts: 1 }); expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    (a: Record<string, TypeSafeAnswer>, ids: string[]) => { choose(a,'second',ids[0]!); },
    (a: Record<string, TypeSafeAnswer>, ids: string[]) => { choose(a,'first','none'); choose(a,'second',ids[0]!); },
    (a: Record<string, TypeSafeAnswer>) => { a.first = { type: 'choice', choice: 'foreign-action', confidence: 1, probabilities: { 'foreign-action': 1 } }; },
    (a: Record<string, TypeSafeAnswer>) => { a.applicable = { type: 'noul', noul: .5 }; },
    (a: Record<string, TypeSafeAnswer>) => { delete a.third; },
  ])('returns labeled lexical fallback on duplicates, holes, foreign IDs, uncertainty or malformed answers', async change => {
    const value = projection(), { client } = provider(change);
    const result = await explainEvidence(value, 'What caused calculateTotal?', { semantic: true, maxUsd: .002, client });
    expect(result.status).toBe('unavailable'); expect(result.fallback).toBe('lexical'); expect(result.results).toEqual(lexicalEvidence(value, 'What caused calculateTotal?'));
  });

  it('returns no-match on confident nonapplicability without inventing an action', async () => {
    const { client } = provider(answers => { answers.applicable = { type: 'noul', noul: .1 }; for (const key of ['first','second','third']) choose(answers,key,'none'); });
    const result = await explainEvidence(projection(), 'unicorn astronomy volcano', { semantic: true, maxUsd: .002, client });
    expect(result.status).toBe('no-match'); expect(result.results).toEqual([]);
  });

  it('falls back for contradictory false applicability with a positive supplied evidence selection', async () => {
    const { client, fetch } = provider(answers => { answers.applicable = { type: 'noul', noul: .1 }; });
    const result = await explainEvidence(projection(), 'error', { semantic: true, maxUsd: .002, client });
    expect(result.status).toBe('unavailable'); expect(result.fallback).toBe('lexical'); expect(result.reason).toBe('navigator-applicability-selection-conflict'); expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects invalid query/cap without calls and exposes missing client/oversized state with recovery text', async () => {
    const value = projection(), { client, fetch } = provider();
    expect((await explainEvidence(value, ' ', { semantic: true, maxUsd: .002, client })).status).toBe('invalid-input');
    expect((await explainEvidence(value, 'error', { semantic: true, maxUsd: .003, client })).status).toBe('invalid-input');
    expect(fetch).not.toHaveBeenCalled();
    const missing = await explainEvidence(value, 'error', { semantic: true, maxUsd: .002 }); expect(missing.status).toBe('unavailable'); expect(missing.nextAction).toContain('key');
    const large = parseEvidenceCase({ runId: 'large', repo: 'acme/widget', outcome: 'gave-up', diagnosis: { class: 'infra', confidence: 0, signals: [], failingCmd: 'test', errorExcerpt: 'error '+ 'x'.repeat(25 * 1024) } });
    const oversized = await explainEvidence(large, 'error', { semantic: true, maxUsd: .002, client }); expect(oversized.status).toBe('unavailable'); expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects forged projected actions or extra identity data without sending anything', async () => {
    const value = projection(), { client, fetch } = provider();
    Object.assign(value.identity, { privateToken: 'sk-live-private' });
    for (const block of value.blocks) block.id = `evidence-${decisionHash({ identity:value.identity, locator:block.locator, excerpt:block.excerpt, kind:block.kind, ...(block.action === undefined ? {} : { action:block.action }) })}`;
    expect((await explainEvidence(value, 'error', { semantic: true, maxUsd: .002, client })).status).toBe('invalid-input');
    const forged = projection(); forged.blocks[0]!.action = { code: 'review-recovery', text: 'rm -rf /' };
    expect((await explainEvidence(forged, 'error', { semantic: true, maxUsd: .002, client })).status).toBe('invalid-input');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cancels the navigator at five seconds, keeps unknown spend, and never resends', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => new Promise<Response>(() => {}));
    const client = new TypeSafeClient({ apiKey: 'test', model: 'jev-1.14.0', ledger: new Ledger({}) }, { fetch: fetch as NebiusFetch });
    try {
      const pending = explainEvidence(projection(), 'error', { semantic: true, maxUsd: .002, client });
      await vi.advanceTimersByTimeAsync(5001);
      const result = await pending;
      expect(result.status).toBe('unavailable'); expect(result.reason).toBe('timeout');
      expect(result.decision?.unknownSpendUsd).toBeGreaterThan(0); expect(fetch).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it('removes inline credential assignments from actual HTTP query/state and preserves stable redacted IDs', async () => {
    const secrets = ['inline-env-example', 'quoted-env-example', 'single-token-example', 'inline-token-example'];
    const original = { runId: 'inline', repo: 'acme/widget', outcome: 'gave-up', diagnosis: { class: 'infra', confidence: .75, signals: ['failure'], failingCmd: 'test', errorExcerpt: `prefix API_KEY=${secrets[0]} failed; TOKEN="${secrets[1]}" denied; token='${secrets[2]}' missing; request token=${secrets[3]} refused suffix` } };
    const value = parseEvidenceCase(original), again = parseEvidenceCase(JSON.parse(JSON.stringify(original, null, 2)));
    expect(value).toEqual(again);
    const { client, fetch } = provider();
    const result = await explainEvidence(value, `why API_KEY=${secrets[0]} failed and token="${secrets[1]}" was refused?`, { semantic: true, maxUsd: .002, client });
    expect(result.status).toBe('matched'); expect(fetch).toHaveBeenCalledOnce();
    const outgoing = fetch.mock.calls[0]![1]!.body as string;
    for (const secret of secrets) { expect(outgoing).not.toContain(secret); expect(JSON.stringify(value)).not.toContain(secret); expect(JSON.stringify(result)).not.toContain(secret); }
    const request = navigatorRequest(value, 'Error token=inline-token-example was refused');
    expect(JSON.stringify(request)).not.toContain('inline-token-example');
  });

  it('rejects credential identities even with recomputed hashes, before optional provider use', async () => {
    const value = projection(), { client, fetch } = provider(); value.identity.runId = 'ghp_abcdefgh12345678'; value.blocks = [];
    for (const semantic of [false, true]) { const result = await explainEvidence(value, 'error', { semantic, maxUsd: .002, client }); expect(result.status).toBe('invalid-input'); expect(JSON.stringify(result)).not.toContain('ghp_abcdefgh12345678'); }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not retry a 503, preserves outage/cap fallback, and recovers in a fresh authorized invocation', async () => {
    const value = projection(), failed = provider(undefined, 503);
    const unavailable = await explainEvidence(value, 'error', { semantic: true, maxUsd: .002, client: failed.client });
    expect(unavailable.status).toBe('unavailable'); expect(failed.fetch).toHaveBeenCalledOnce();
    const capped = provider(); expect((await explainEvidence(value, 'error', { semantic: true, maxUsd: 1e-10, client: capped.client })).status).toBe('unavailable'); expect(capped.fetch).not.toHaveBeenCalled();
    expect((await explainEvidence(value, 'error', { semantic: true, maxUsd: .002, client: provider().client })).status).toBe('matched');
  });
});
