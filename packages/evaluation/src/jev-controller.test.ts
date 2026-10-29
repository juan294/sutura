import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { TraceRecorder, type CaseFile, type CostLedger } from '@sutura/core';
import { createEvaluationManifest, evaluationResultHash } from './manifest.js';
import { createJevManifest, type JevManifest } from './jev-manifest.js';
import { importJevControllerRun, jevControllerBudgetHash, nextJevControllerRun, qualifyJevControllerRuns, type JevControllerBudgetEvidence, type JevControllerMeasurement, type JevControllerRunDescriptor, type JevControllerRunRecord } from './jev-controller.js';

async function setup(role: 'ranking'|'grounding'|'classification'|'recovery' = 'ranking') {
  const fixture = JSON.parse(await readFile(new URL('../../core/src/report/fixtures/fixed.json', import.meta.url), 'utf8')) as Omit<CaseFile, 'cost'> & { cost: Pick<CostLedger, 'entries'> };
  const proof: JevControllerBudgetEvidence = { schemaVersion: 'sutura-jev-controller-budget-v1', controllerSha: 'a'.repeat(40), corpusHash: 'b'.repeat(64), sourceManifestHash: 'c'.repeat(64), priceEvidenceHash: 'd'.repeat(64), maximumInferenceUsd: 1, maximumSandboxUsd: 2, nativeCancellationBound: true, subjects: { 'case-0': 'repair-off-by-one' } };
  const manifest = createJevManifest({ controllerSha: proof.controllerSha, cases: [{ id: 'case-0', family: 'family-0', role, split: 'evaluation', category: 'public', variant: 'positive', questionVersion: `${role}-v1`, state: 'public', questions: { sufficient: { type: 'noul', instructions: 'Is evidence sufficient?' } }, labels: { sufficient: true }, candidateIds: [], baselineIds: [] }], controller: { cumulativeUsd: 20, inferenceUsd: 8, sandboxUsd: 15, repairLimitsHash: 'e'.repeat(64), policyHash: fixture.policy.policySha, providerModels: Object.fromEntries(fixture.cost.entries.map((v, index) => [`model${index}`, v.model])), budgetEvidenceHash: jevControllerBudgetHash(proof) } });
  const trace = new TraceRecorder('fixture-import'); trace.record({ type: 'run-start', stage: 'run', summary: 'Public fixture parser example' });
  for (const entry of fixture.cost.entries) trace.record({ type: 'model-response', stage: 'audit', role: 'assistant', model: entry.model, summary: 'Retained provider example', inputTokens: entry.inTok, outputTokens: entry.outTok, reasoningTokens: entry.reasoningTok, latencyMs: 10, costUsd: entry.usd, requestId: null });
  trace.record({ type: 'run-finish', stage: 'run', outcome: 'fixed' }); fixture.trace = trace.events();
  const report = { adapter: 'sutura', results: [{ caseId: 'repair-off-by-one', kind: 'repairable', language: 'typescript', caseFile: fixture, tavilyEnabled: true, elapsedTimeMs: 1000, hiddenVerification: { result: 'passed', testSetHash: 'f'.repeat(64) } }], score: {}, manifest: createEvaluationManifest({ repositoryClean: true, evaluationId: 'fixture-import', suturaCommit: proof.controllerSha, corpusName: 'placebo', corpusVersion: '0.2', corpusHash: proof.corpusHash, adapterVersion: 'test', modelCatalogSnapshot: Object.values(manifest.controller!.providerModels), routingProfile: 'production-baseline-v1', budgetProfile: 'default', cases: [{ caseId: 'repair-off-by-one:with-tavily', outcome: 'fixed', trace: trace.events() }], startedAt: '2026-10-28T00:00:00.000Z', completedAt: '2026-10-28T00:01:00.000Z' }) };
  return { manifest, proof, report };
}
function boundReport(report: Awaited<ReturnType<typeof setup>>['report'], next: JevControllerRunDescriptor, invocationId: string = randomUUID()) {
  const copy = structuredClone(report);
  const identity = { manifestHash: next.manifestHash, ordinal: next.ordinal, arm: next.arm, caseId: next.caseId, repetition: next.repetition, placeboCaseId: next.placeboCaseId, role: next.role, configurationHash: next.configurationHash };
  if (next.semantic) for (const result of copy.results) Object.assign(result.caseFile, { semanticDecisions: { schemaVersion: 'sutura-semantic-decisions-v1', records: [], budget: { maxUsd: next.semantic.maxUsd, attempts: 0, reservedUsd: 0, actualUsd: 0 }, ...(result.caseFile.semanticDecisions ?? {}), configuration: structuredClone(next.semantic) } });
  Object.assign(copy, { jevComparison: { schemaVersion: 'sutura-jev-controller-observation-v1', invocationId, identity, semantic: structuredClone(next.semantic ?? null) } });
  copy.manifest.evaluationId = `jev-${next.manifestHash}-${next.ordinal}-${invocationId}`;
  copy.manifest.resultHash = evaluationResultHash(copy.manifest);
  return copy;
}
function measurement(manifest: JevManifest, next: NonNullable<ReturnType<typeof nextJevControllerRun>['next']>, arm: 'off'|'assist'): JevControllerMeasurement {
  return { configurationHash: next.configurationHash, repairLimitsHash: manifest.controller!.repairLimitsHash, receiptHash: next.ordinal.toString(16).padStart(64, '0'), inferenceUsd: arm === 'off' ? .1 : .08, sandboxUsd: .1, nativeCancellationComplete: true, controllerSeconds: 10, sandboxSeconds: arm === 'off' ? 100 : 85, authorityPreserved: true, insufficientEvidenceHandled: true, legitimateAuditRefusal: false, classIntentCorrect: true, groundingRecall: 1, top3SupportPrecision: arm === 'off' ? .7 : .85, roleLatencyMs: arm === 'off' ? 100 : 80 };
}

async function qualificationWithRoleMeasurements(
  role: 'classification' | 'recovery',
  assistMeasurement: (next: JevControllerRunDescriptor) => Partial<JevControllerMeasurement>,
) {
  const { manifest, proof, report } = await setup(role);
  const records: JevControllerRunRecord[] = [];
  while (nextJevControllerRun(manifest, proof, records).status === 'ready') {
    const next = nextJevControllerRun(manifest, proof, records).next!;
    const observed = {
      ...measurement(manifest, next, next.arm),
      // Hold inference spend constant so every oracle isolates its named criterion.
      inferenceUsd: .1,
      ...(next.arm === 'assist' ? assistMeasurement(next) : {}),
    };
    records.push(importJevControllerRun(manifest, proof, next, boundReport(report, next), observed));
  }
  expect(nextJevControllerRun(manifest, proof, records).status).toBe('complete');
  expect(records).toHaveLength(6);
  expect(records.every(record => record.status === 'COMPLETE')).toBe(true);
  const result = qualifyJevControllerRuns(manifest, proof, records);
  expect(result).toHaveLength(1);
  expect(result[0]!.role).toBe(role);
  return result[0]!;
}

describe('bounded Jev controller support; invented measurements do not qualify production', () => {
  it('refuses missing full-run proof and never treats a Jev-only cap as full-controller allocation', async () => {
    const { manifest, proof } = await setup();
    expect(nextJevControllerRun(manifest, undefined, []).status).toBe('blocked');
    expect(nextJevControllerRun({ ...manifest, controller: undefined } as unknown as JevManifest, proof, []).status).toBe('blocked');
    expect(nextJevControllerRun(manifest, { ...proof, nativeCancellationBound: false }, []).status).toBe('blocked');
    const next = nextJevControllerRun(manifest, proof, []);
    expect(next.next).toMatchObject({ ordinal: 0, arm: 'off', reservationUsd: 3, placeboCaseId: 'repair-off-by-one' });
    expect(next.next).not.toHaveProperty('semantic');
  });

  it('imports the existing public case fixture while retaining missing USD/cancellation as PARTIAL', async () => {
    const { manifest, proof, report } = await setup(); const next = nextJevControllerRun(manifest, proof, []).next!;
    const partial = importJevControllerRun(manifest, proof, next, report, { configurationHash: next.configurationHash, repairLimitsHash: manifest.controller!.repairLimitsHash, receiptHash: '1'.repeat(64) });
    expect(partial.status).toBe('PARTIAL');
    expect(partial.sandboxUsd).toBeNull();
    expect(partial.results[0]!.outcome).toBe('fixed');
    expect(nextJevControllerRun(manifest, proof, [partial]).status).toBe('blocked');
    expect(nextJevControllerRun(manifest, proof, [partial]).nextAction).toContain('reconcile');
    expect(() => importJevControllerRun(manifest, proof, next, { ...report, manifest: { ...report.manifest, corpusHash: '0'.repeat(64) } }, measurement(manifest, next, 'off'))).toThrow(/resultHash|corpus/u);
  });

  it.each(['ranking', 'grounding', 'classification', 'recovery'] as const)('uses all paired outcomes and the literal %s performance gate', async role => {
    const { manifest, proof, report } = await setup(role); const retained: JevControllerRunRecord[] = [];
    while (nextJevControllerRun(manifest, proof, retained).status === 'ready') {
      const next = nextJevControllerRun(manifest, proof, retained).next!;
      retained.push(importJevControllerRun(manifest, proof, next, boundReport(report, next), measurement(manifest, next, next.arm)));
    }
    expect(retained.map(v => v.identity.arm)).toEqual(['off', 'assist', 'assist', 'off', 'off', 'assist']);
    expect(qualifyJevControllerRuns(manifest, proof, retained)[0]!.status).toBe('PASS');
    expect(qualifyJevControllerRuns(manifest, proof, retained.slice(0, 2))[0]!.status).toBe('UNMEASURED');
  });

  describe.each(['classification', 'recovery'] as const)('%s qualification rejection oracles', role => {
    it('rejects a 6% p95 controller slowdown despite a 20% role-latency improvement', async () => {
      const result = await qualificationWithRoleMeasurements(role, () => ({ controllerSeconds: 10.6, roleLatencyMs: 80 }));
      expect(result.status).toBe('FAIL');
      expect(result.reasons).toEqual(['p95-controller-time-regressed']);
    });

    it('rejects only 5% role-latency improvement despite a 20% controller speedup', async () => {
      const result = await qualificationWithRoleMeasurements(role, () => ({ controllerSeconds: 8, roleLatencyMs: 95 }));
      expect(result.status).toBe('FAIL');
      expect(result.reasons).toEqual(['role-latency-or-inference-improvement-below-10-percent']);
    });

    it.each(['authorityPreserved', 'insufficientEvidenceHandled'] as const)('rejects a false %s label even when the performance criterion passes', async field => {
      const result = await qualificationWithRoleMeasurements(role, () => ({ [field]: false }));
      expect(result.status).toBe('FAIL');
      expect(result.reasons).toEqual(['authorization-or-insufficiency-violation']);
    });

    it('rejects losing one previously correct class/intent judgment across matched repetitions', async () => {
      const result = await qualificationWithRoleMeasurements(role, next => ({ classIntentCorrect: next.repetition !== 1 }));
      expect(result.status).toBe('FAIL');
      expect(result.reasons).toEqual(['class-or-intent-accuracy-lost']);
    });
  });

  it('retains gave-up and infra-stop outcomes and fails newly lost verified repairs', async () => {
    const { manifest, proof, report } = await setup(); const rows: JevControllerRunRecord[] = [];
    while (nextJevControllerRun(manifest, proof, rows).status === 'ready') {
      const next = nextJevControllerRun(manifest, proof, rows).next!;
      const copy = structuredClone(report);
      if (next.arm === 'assist') {
        copy.results[0]!.caseFile.outcome = next.repetition === 1 ? 'infra-stop' : 'gave-up';
        copy.manifest.cases[0]!.outcome = copy.results[0]!.caseFile.outcome;
        for (const trace of [copy.results[0]!.caseFile.trace!, copy.manifest.cases[0]!.trace]) { const finish = trace.at(-1)!; if (finish.type === 'run-finish') finish.outcome = copy.results[0]!.caseFile.outcome; }
        copy.manifest.resultHash = evaluationResultHash(copy.manifest);
      }
      rows.push(importJevControllerRun(manifest, proof, next, boundReport(copy, next), measurement(manifest, next, next.arm)));
    }
    expect(rows.filter(row => row.identity.arm === 'assist').flatMap(row => row.results.map(result => result.outcome))).toEqual(['gave-up', 'infra-stop', 'gave-up']);
    expect(qualifyJevControllerRuns(manifest, proof, rows)[0]!.reasons).toContain('baseline-success-lost');
  });

  it('requires explicit all-provider charge reconciliation for unknown semantic consumption', async () => {
    const { manifest, proof, report } = await setup(); const first = nextJevControllerRun(manifest, proof, []).next!;
    const base = importJevControllerRun(manifest, proof, first, boundReport(report, first), measurement(manifest, first, 'off'));
    const next = nextJevControllerRun(manifest, proof, [base]).next!;
    Object.assign(report.results[0]!.caseFile, { semanticDecisions: { schemaVersion: 'sutura-semantic-decisions-v1', records: [], budget: { maxUsd: .02, attempts: 1, reservedUsd: .001, actualUsd: 0 } } });
    const partial = importJevControllerRun(manifest, proof, next, boundReport(report, next), measurement(manifest, next, 'assist'));
    expect(partial.status).toBe('PARTIAL');
    expect(partial.reasons).toContain('semantic-charge-pending');
    const reconciled = importJevControllerRun(manifest, proof, next, boundReport(report, next), { ...measurement(manifest, next, 'assist'), allProviderChargesReconciled: true });
    expect(reconciled.status).toBe('COMPLETE');
  });

  it('requires independently observed metrics and does not promote a cost-complete run with missing assurance labels', async () => {
    const { manifest, proof, report } = await setup(); const rows: JevControllerRunRecord[] = [];
    while (nextJevControllerRun(manifest, proof, rows).status === 'ready') {
      const next = nextJevControllerRun(manifest, proof, rows).next!;
      rows.push(importJevControllerRun(manifest, proof, next, boundReport(report, next), { configurationHash: next.configurationHash, repairLimitsHash: manifest.controller!.repairLimitsHash, receiptHash: next.ordinal.toString(16).padStart(64, '0'), inferenceUsd: .1, sandboxUsd: .1, nativeCancellationComplete: true }));
    }
    const result = qualifyJevControllerRuns(manifest, proof, rows)[0]!;
    expect(result.status).toBe('UNMEASURED');
    expect(result.reasons).toContain('controller-wall-time-unmeasured');
    expect(result.reasons).toContain('authorization-or-insufficiency-labels-unmeasured');
  });

  it('rejects relabeling an observed off report as assist and reused invocation/report/billing evidence', async () => {
    const { manifest, proof, report } = await setup(); const first = nextJevControllerRun(manifest, proof, []).next!;
    const observedOff = boundReport(report, first);
    const base = importJevControllerRun(manifest, proof, first, observedOff, measurement(manifest, first, 'off'));
    const next = nextJevControllerRun(manifest, proof, [base]).next!;
    expect(() => importJevControllerRun(manifest, proof, next, observedOff, measurement(manifest, next, 'assist'))).toThrow(/observed.*identity|arm/u);
    const invocationId = (observedOff as typeof observedOff & { jevComparison: { invocationId: string } }).jevComparison.invocationId;
    const repeated = importJevControllerRun(manifest, proof, next, boundReport(report, next, invocationId), measurement(manifest, next, 'assist'));
    expect(nextJevControllerRun(manifest, proof, [base, repeated]).status).toBe('blocked');
    const fresh = importJevControllerRun(manifest, proof, next, boundReport(report, next), { ...measurement(manifest, next, 'assist'), receiptHash: base.receiptHash });
    expect(nextJevControllerRun(manifest, proof, [base, fresh]).status).toBe('blocked');
  });

  it('keeps legacy imports partial and requires native observed identity plus actual assist configuration', async () => {
    const { manifest, proof, report } = await setup(); const first = nextJevControllerRun(manifest, proof, []).next!;
    const legacy = importJevControllerRun(manifest, proof, first, report, measurement(manifest, first, 'off'));
    expect(legacy.status).toBe('PARTIAL');
    expect(legacy.reasons).toContain('observed-arm-unavailable');
    expect(legacy.invocationId).toBeNull();
    const base = importJevControllerRun(manifest, proof, first, boundReport(report, first), measurement(manifest, first, 'off'));
    const next = nextJevControllerRun(manifest, proof, [base]).next!;
    const unbound = boundReport(report, next);
    Object.assign(unbound, { jevComparison: { ...(unbound as typeof unbound & { jevComparison: Record<string, unknown> }).jevComparison, invocationId: randomUUID() } });
    expect(() => importJevControllerRun(manifest, proof, next, unbound, measurement(manifest, next, 'assist'))).toThrow(/native evaluation manifest/u);
    const wrongConfig = boundReport(report, next);
    wrongConfig.results[0]!.caseFile.semanticDecisions!.configuration!.modes.ranking = 'off';
    expect(() => importJevControllerRun(manifest, proof, next, wrongConfig, measurement(manifest, next, 'assist'))).toThrow(/Actual controller semantic configuration/u);
  });

  it('does not count cheaper failed runs as lower successful-repair grounding cost', async () => {
    const { manifest, proof, report } = await setup('grounding'); const rows: JevControllerRunRecord[] = [];
    while (nextJevControllerRun(manifest, proof, rows).status === 'ready') {
      const next = nextJevControllerRun(manifest, proof, rows).next!;
      const copy = structuredClone(report);
      if (next.repetition === 1) {
        copy.results[0]!.caseFile.outcome = 'gave-up'; copy.manifest.cases[0]!.outcome = 'gave-up';
        for (const trace of [copy.results[0]!.caseFile.trace!, copy.manifest.cases[0]!.trace]) { const finish = trace.at(-1)!; if (finish.type === 'run-finish') finish.outcome = 'gave-up'; }
      }
      const observed = measurement(manifest, next, next.arm);
      observed.inferenceUsd = .1; observed.sandboxUsd = next.repetition === 1 ? (next.arm === 'off' ? 1.8 : .01) : .1;
      observed.top3SupportPrecision = next.arm === 'off' ? .7 : .75;
      rows.push(importJevControllerRun(manifest, proof, next, boundReport(copy, next), observed));
    }
    const result = qualifyJevControllerRuns(manifest, proof, rows)[0]!;
    expect(result.status).toBe('FAIL');
    expect(result.reasons).toContain('grounding-improvement-below-threshold');
  });

  it('refuses a non-prefix history, modified receipt and cumulative allocation shortfall', async () => {
    const { manifest, proof, report } = await setup(); const next = nextJevControllerRun(manifest, proof, []).next!;
    const row = importJevControllerRun(manifest, proof, next, boundReport(report, next), measurement(manifest, next, 'off'));
    expect(nextJevControllerRun(manifest, proof, [{ ...row, identity: { ...row.identity, ordinal: 1 } }]).status).toBe('blocked');
    expect(nextJevControllerRun(manifest, proof, [{ ...row, sandboxUsd: 0 }]).status).toBe('blocked');
    const bounded = structuredClone(manifest); bounded.controller!.cumulativeUsd = 2;
    expect(nextJevControllerRun(bounded, proof, []).status).toBe('blocked');
  });
});
