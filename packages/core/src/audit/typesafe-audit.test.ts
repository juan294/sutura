import { describe, expect, it, vi } from 'vitest';

import { BudgetExceededError } from '../engine/repair-budget.js';
import type { Diagnosis } from '../domain.js';
import { TYPESAFE_AUDIT_MODEL, TypeSafeClient, TypeSafeResponseError, type TypeSafeDecision } from '../llm/typesafe.js';
import { Ledger } from '../llm/cost.js';
import type { HttpResponse } from '../llm/nebius.js';
import { decideTypeSafeAudit, typesafeAudit, type TypeSafeAuditBudget } from './typesafe-audit.js';

const DIAGNOSIS: Diagnosis = {
  class: 'test-assertion',
  confidence: 0.9,
  signals: ['assertion'],
  failingCmd: 'pnpm test',
  errorExcerpt: 'expected 1 to be 2',
};

const CONTEXT = {
  diagnosis: DIAGNOSIS,
  diff: 'diff --git a/add.ts b/add.ts\n',
  beforeLog: 'AssertionError',
  afterLog: 'Tests passed',
};

function decision(pGreen: number, confidence: number, overrides: Partial<TypeSafeDecision> = {}): TypeSafeDecision {
  return {
    model: TYPESAFE_AUDIT_MODEL,
    answers: {
      verdict: {
        type: 'choice',
        choice: pGreen >= 0.5 ? 'green_wash' : 'legitimate_repair',
        probabilities: { legitimate_repair: 1 - pGreen, green_wash: pGreen },
        confidence,
      },
      touches_only_tests: { type: 'noul', noul: 0.1 },
      weakens_assertion: { type: 'noul', noul: 0.2 },
      suppresses_error: { type: 'noul', noul: 0.3 },
      unrelated_change: { type: 'noul', noul: 0.4 },
    },
    usage: { inTok: 1_000, outTok: 0, reasoningTok: 0 },
    usd: 0.000042,
    latencyMs: 350,
    requestId: null,
    ...overrides,
  };
}

describe('decideTypeSafeAudit', () => {
  it.each([
    [0.97, 0.94, 'refused'],
    [0.03, 0.96, 'approved'],
    [0.81, 0.63, 'uncertain'],
    [0.37, 0.26, 'uncertain'],
    // Boundary: confidence < 0.70 is uncertain (exclusive); exactly 0.70 proceeds.
    [0.03, 0.7, 'approved'],
    [0.03, 0.6999, 'uncertain'],
    // Boundary: P(green_wash) >= 0.50 is refused (inclusive); just under is approved.
    [0.5, 0.9, 'refused'],
    [0.4999, 0.9, 'approved'],
  ] as const)('P(green_wash)=%s confidence=%s -> %s', (pGreen, confidence, status) => {
    const result = decideTypeSafeAudit(decision(pGreen, confidence));
    expect(result.status).toBe(status);
    expect(result.greenWashProbability).toBe(pGreen);
    expect(result.confidence).toBe(confidence);
    expect(result.model).toBe(TYPESAFE_AUDIT_MODEL);
    expect(result.reasoning).toBe(`P(green-wash)=${pGreen.toFixed(2)} confidence=${confidence.toFixed(2)}`);
    expect(result.signals).toEqual({
      touchesOnlyTests: 0.1,
      weakensAssertion: 0.2,
      suppressesError: 0.3,
      unrelatedChange: 0.4,
    });
  });

  it('throws TypeSafeResponseError when an expected answer is missing', () => {
    const full = decision(0.5, 0.9);
    const malformed: TypeSafeDecision = {
      ...full,
      answers: {
        verdict: full.answers.verdict!,
        touches_only_tests: full.answers.touches_only_tests!,
        weakens_assertion: full.answers.weakens_assertion!,
        suppresses_error: full.answers.suppresses_error!,
      },
    };
    expect(() => decideTypeSafeAudit(malformed)).toThrow(TypeSafeResponseError);
  });
});

describe('typesafeAudit', () => {
  it('reports skipped when unconfigured, without calling any client', async () => {
    const result = await typesafeAudit(undefined, CONTEXT);
    expect(result).toEqual({
      metadata: expect.objectContaining({ status: 'skipped', requestedModel: TYPESAFE_AUDIT_MODEL, policyVersion: 'legacy-v1', policyHash: expect.stringMatching(/^[a-f0-9]{64}$/u) }),
      status: 'skipped',
      model: TYPESAFE_AUDIT_MODEL,
      greenWashProbability: null,
      confidence: null,
      signals: null,
      reasoning: expect.stringContaining('TYPESAFE_API_KEY'),
    });
  });

  it('reports approved when Jev approves', async () => {
    const result = await typesafeAudit({
      modelId: () => TYPESAFE_AUDIT_MODEL,
      decide: async () => decision(0.03, 0.96),
    }, CONTEXT);
    expect(result.status).toBe('approved');
  });

  it('reports refused when Jev refuses', async () => {
    const result = await typesafeAudit({
      modelId: () => TYPESAFE_AUDIT_MODEL,
      decide: async () => decision(0.97, 0.94),
    }, CONTEXT);
    expect(result.status).toBe('refused');
  });

  it('reports uncertain when confidence is below the threshold', async () => {
    const result = await typesafeAudit({
      modelId: () => TYPESAFE_AUDIT_MODEL,
      decide: async () => decision(0.81, 0.63),
    }, CONTEXT);
    expect(result.status).toBe('uncertain');
  });

  it('fails open to skipped on a transport error, never throwing', async () => {
    const result = await typesafeAudit({
      modelId: () => TYPESAFE_AUDIT_MODEL,
      decide: async () => {
        throw new Error('ECONNRESET');
      },
    }, CONTEXT);
    expect(result.status).toBe('skipped');
    expect(result.model).toBe(TYPESAFE_AUDIT_MODEL);
  });

  it('fails open to skipped on a TypeSafeResponseError, never throwing', async () => {
    const result = await typesafeAudit({
      modelId: () => TYPESAFE_AUDIT_MODEL,
      decide: async () => {
        throw new TypeSafeResponseError('malformed answer');
      },
    }, CONTEXT);
    expect(result.status).toBe('skipped');
  });

  it('fails open to skipped when the typesafe-audit budget is exhausted, without calling the client', async () => {
    let called = false;
    const budget: TypeSafeAuditBudget = {
      reserveTypeSafeAudit() {
        throw new BudgetExceededError('typesafeAuditUsd' as never);
      },
      settleTypeSafeAudit() {},
    };
    const result = await typesafeAudit({
      modelId: () => TYPESAFE_AUDIT_MODEL,
      decide: async () => {
        called = true;
        return decision(0.03, 0.96);
      },
    }, CONTEXT, budget);
    expect(result).toEqual({
      metadata: expect.objectContaining({ status: 'skipped', requestedModel: TYPESAFE_AUDIT_MODEL, policyVersion: 'legacy-v1', policyHash: expect.stringMatching(/^[a-f0-9]{64}$/u) }),
      status: 'skipped',
      model: TYPESAFE_AUDIT_MODEL,
      greenWashProbability: null,
      confidence: null,
      signals: null,
      reasoning: expect.stringContaining('typesafe-audit budget exhausted'),
    });
    expect(called).toBe(false);
  });

  it('reports skipped when the adjudication context exceeds the safe request limit', async () => {
    const oversized = {
      diagnosis: DIAGNOSIS,
      diff: 'x'.repeat(70_000),
      beforeLog: '',
      afterLog: '',
    };
    let called = false;
    const result = await typesafeAudit({
      modelId: () => TYPESAFE_AUDIT_MODEL,
      decide: async () => {
        called = true;
        return decision(0.03, 0.96);
      },
    }, oversized);
    expect(result.status).toBe('skipped');
    expect(result.reasoning).toContain('exceeds the safe request limit');
    expect(called).toBe(false);
  });

  it('reserves the worst-case cost and settles with the actual usd', async () => {
    const reserved: number[] = [];
    const settled: Array<{ id: number; actualUsd: number }> = [];
    const budget: TypeSafeAuditBudget = {
      reserveTypeSafeAudit(worstCaseUsd: number) {
        reserved.push(worstCaseUsd);
        return { id: 1, reservedUsd: worstCaseUsd };
      },
      settleTypeSafeAudit(reservation, actualUsd: number) {
        settled.push({ id: reservation.id, actualUsd });
      },
    };
    const result = await typesafeAudit({
      modelId: () => TYPESAFE_AUDIT_MODEL,
      decide: async () => decision(0.03, 0.96, { usd: 0.0007 }),
    }, CONTEXT, budget);
    expect(result.status).toBe('approved');
    expect(reserved).toHaveLength(1);
    expect(settled).toEqual([{ id: 1, actualUsd: 0.0007 }]);
  });

  it('never throws regardless of what the client does', async () => {
    await expect(typesafeAudit({
      modelId: () => TYPESAFE_AUDIT_MODEL,
      decide: async () => {
        throw new Error('boom');
      },
    }, CONTEXT)).resolves.toMatchObject({ status: 'skipped' });
  });
});


it('records requested and resolved models and frozen legacy policy without changing the request', async () => {
  const sent: unknown[] = [];
  const result = await typesafeAudit({
    modelId: () => 'jev-latest',
    decide: async (state, questions) => { sent.push({ state, questions }); return decision(0.03, 0.96, { model: 'jev-1.14.0' }); },
  }, CONTEXT);
  expect(result.metadata).toEqual({ status: 'approved', requestedModel: 'jev-latest', resolvedModel: 'jev-1.14.0', policyVersion: 'legacy-v1', policyHash: expect.stringMatching(/^[a-f0-9]{64}$/u) });
  expect(sent).toHaveLength(1);
  const skipped = await typesafeAudit(undefined, CONTEXT);
  expect(skipped.metadata?.resolvedModel).toBeUndefined();
});


it('bounds a standalone legacy audit, retains unknown spend, and recovers only in a fresh invocation', async () => {
  vi.useFakeTimers();
  try {
    let finish: ((response: HttpResponse) => void) | undefined;
    let sentSignal: AbortSignal | undefined;
    let calls = 0;
    const ledger = new Ledger({});
    const client = new TypeSafeClient({ apiKey: 'test', ledger }, { fetch: async (_url, request) => {
      calls++; sentSignal = request.signal;
      return new Promise<HttpResponse>((resolve) => { finish = resolve; });
    } });
    let reserved = 0, settled = 0;
    const budget: TypeSafeAuditBudget = {
      reserveTypeSafeAudit: (reservedUsd) => ({ id: ++reserved, reservedUsd }),
      settleTypeSafeAudit: () => { settled++; },
    };
    const pending = typesafeAudit(client, CONTEXT, budget);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sentSignal?.aborted).toBe(true);
    let completed = false;
    void pending.then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(true);
    const result = await pending;
    expect(result.status).toBe('skipped');
    expect(result.reasoning).toMatch(/deadline.*new authorized invocation/u);
    expect(reserved).toBe(1); expect(settled).toBe(0); expect(calls).toBe(1);
    const approved = decision(0.03, 0.96);
    const response: HttpResponse = { ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ model: approved.model, answers: approved.answers, usage: { input_tokens: 1_000, output_tokens: 0 } }), text: async () => '' };
    finish!(response);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(0);
    expect(ledger.entries).toHaveLength(0);
    const nextClient = new TypeSafeClient({ apiKey: 'test', ledger }, { fetch: async () => response });
    const next = await typesafeAudit(nextClient, CONTEXT, budget);
    expect(next.status).toBe('approved'); expect(reserved).toBe(2); expect(settled).toBe(1);
  } finally { vi.useRealTimers(); }
});
