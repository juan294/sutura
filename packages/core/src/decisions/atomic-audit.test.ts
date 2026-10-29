import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Diagnosis } from '../domain.js';
import { Ledger } from '../llm/cost.js';
import { TypeSafeClient, type JsonValue, type TypeSafeQuestion } from '../llm/typesafe.js';
import type { NebiusFetch } from '../llm/nebius.js';
import { typesafeAudit, TYPESAFE_AUDIT_POLICY_HASH, TYPESAFE_AUDIT_POLICY_VERSION, TYPESAFE_REFUSE_GREEN_WASH_PROBABILITY, TYPESAFE_UNCERTAIN_CONFIDENCE } from '../audit/typesafe-audit.js';
import { DecisionSession } from './call.js';
import { semanticConfig } from './config.js';
import { ATOMIC_AUDIT_POLICY, ATOMIC_AUDIT_QUESTIONS } from './atomic-audit.js';

const diagnosis: Diagnosis = { class: 'test-assertion', confidence: .9, signals: ['assertion'], failingCmd: 'node --test case.test.js', errorExcerpt: 'case.test.js: pageCount(4,2) expected 2; received 3' };
const beforeSource = 'export const pageCount=(items,size)=>Math.floor(items/size)+1;\n';
const afterSource = 'export const pageCount=(items,size)=>Math.ceil(items/size);\n';
const testSource = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { pageCount } from './page-count.js';\ntest('pageCount rounds a nonempty page count',()=>assert.equal(pageCount(4,2),2));\n";
const diff = `--- a/page-count.js\n+++ b/page-count.js\n@@ -1 +1 @@\n-${beforeSource}+${afterSource}`;
const context = { diagnosis, diff, beforeLog: 'case.test.js: pageCount rounds a nonempty page count\nAssertionError: expected 3 to be 2', afterLog: 'Tests passed' };
const state: JsonValue = { diagnosis: { class: diagnosis.class, confidence: diagnosis.confidence, signals: diagnosis.signals, failingCmd: diagnosis.failingCmd, errorExcerpt: diagnosis.errorExcerpt }, candidateDiff: diff, beforeLog: context.beforeLog, afterLog: context.afterLog, sourceContext: {
  beforeFiles: [{ path: 'page-count.js', content: beforeSource }, { path: 'case.test.js', content: testSource }],
  afterFiles: [{ path: 'page-count.js', content: afterSource }, { path: 'case.test.js', content: testSource }],
} };
const traits = ['deleted_test', 'skipped_execution', 'weaker_assertion', 'suppressed_propagation', 'unrelated_change'];

function setup(extraAnswer = false) {
  const fetch = vi.fn<NebiusFetch>(async (_url, init) => {
    const body = JSON.parse(init!.body as string) as { model: string; questions: Record<string, TypeSafeQuestion> };
    // Invented transport answers exercise serialization and strict handling only;
    // no assertion below treats these values as model-quality measurements.
    const answers = Object.fromEntries(Object.keys(body.questions).map(id => [id, { type: 'noul', noul: 0 }]));
    if (extraAnswer) answers.verdict = { type: 'noul', noul: 0 };
    return new Response(JSON.stringify({ model: body.model, answers, usage: { input_tokens: 100, output_tokens: 0 } }));
  });
  const client = new TypeSafeClient({ apiKey: 'offline-test-only', ledger: new Ledger({}), model: 'jev-1.14.0' }, { fetch });
  const session = new DecisionSession({ config: semanticConfig({ maxUsd: .02 }, true), client, deadline: Date.now() + 5000 });
  return { fetch, session };
}

describe('experimental atomic audit request contract', () => {
  it('serializes five independent Nouls with explicit true/false situations under v3', async () => {
    const { fetch, session } = setup();
    const evidence = await session.judge('audit-v2', state, ATOMIC_AUDIT_QUESTIONS, 'legacy-audit-retained');
    expect(fetch).toHaveBeenCalledOnce();
    const request = JSON.parse(fetch.mock.calls[0]![1]!.body as string) as { model: string; state: JsonValue; questions: Record<string, TypeSafeQuestion> };
    expect(request.questions.suppressed_propagation?.instructions).toContain('application exception propagation');
    expect(request.questions.suppressed_propagation?.criteria).toMatchObject({ true: expect.stringContaining('bypassed') });
    expect(request.questions.suppressed_propagation?.criteria).toMatchObject({ false: expect.stringContaining('unchanged or absent') });
    expect(request.questions.weaker_assertion?.instructions).toContain('assertion predicate');
    expect(request.questions.weaker_assertion?.criteria).toMatchObject({ false: expect.stringContaining('registration or execution') });
    expect(ATOMIC_AUDIT_POLICY).toBe('atomic-audit-v4');
    expect(request.model).toBe('jev-1.14.0');
    expect(request.state).toEqual(state);
    expect(Object.keys(request.questions)).toEqual(traits);
    for (const question of Object.values(request.questions)) {
      expect(question.type).toBe('noul');
      expect(question.criteria).toEqual({ true: expect.any(String), false: expect.any(String) });
    }
    expect(evidence).toMatchObject({ role: 'audit-v2', outcome: 'answered', fallback: 'legacy-audit-retained' });
    // Pins the actual wording, criteria and unchanged shared probability policy.
    expect(evidence.policyHash).toBe('b687c46ef43ee1905ea38ae1a14f4ddde5cc32adcff050af13ecbbd29468e3f3');
    expect(evidence.policyHash).not.toBe('23001fbbc70dae797080c04273d8c89316e0c4189b63ecd890765108c549f713');
  });

  it('rejects an extra verdict answer instead of turning evidence-only judgments into a veto', async () => {
    const { fetch, session } = setup(true);
    const evidence = await session.judge('audit-v2', state, ATOMIC_AUDIT_QUESTIONS, 'legacy-audit-retained');
    expect(fetch).toHaveBeenCalledOnce();
    expect(evidence.outcome).toBe('unavailable');
    expect(evidence.answers).toBeUndefined();
  });

  it('keeps legacy audit request bytes, model, policy and veto thresholds unchanged', async () => {
    const fetch = vi.fn<NebiusFetch>(async (_url, init) => {
      const body = JSON.parse(init!.body as string) as { model: string };
      return new Response(JSON.stringify({ model: body.model, answers: {
        verdict: { type: 'choice', choice: 'legitimate_repair', probabilities: { legitimate_repair: 1, green_wash: 0 }, confidence: 1 },
        touches_only_tests: { type: 'noul', noul: 0 }, weakens_assertion: { type: 'noul', noul: 0 }, suppresses_error: { type: 'noul', noul: 0 }, unrelated_change: { type: 'noul', noul: 0 },
      }, usage: { input_tokens: 100, output_tokens: 0 } }));
    });
    const client = new TypeSafeClient({ apiKey: 'offline-test-only', ledger: new Ledger({}) }, { fetch });
    await typesafeAudit(client, context);
    expect(fetch).toHaveBeenCalledOnce();
    const bytes = fetch.mock.calls[0]![1]!.body as string;
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('bb1578a101b045b2a2f9234eda0a789770b4789141c301ae524acd078d6a3ffc');
    expect(JSON.parse(bytes).model).toBe('jev-latest');
    expect(TYPESAFE_AUDIT_POLICY_VERSION).toBe('legacy-v1');
    expect(TYPESAFE_AUDIT_POLICY_HASH).toBe('eceb9cecb5fdf10f2e9b42a1b5ecf9d5b784f5da03a50b76fa57e08df507e679');
    expect(TYPESAFE_REFUSE_GREEN_WASH_PROBABILITY).toBe(.5);
    expect(TYPESAFE_UNCERTAIN_CONFIDENCE).toBe(.7);
  });
});
