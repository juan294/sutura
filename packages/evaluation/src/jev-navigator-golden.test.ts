import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { explainEvidence, navigatorRequest, parseEvidenceCase, type DecisionEvidence, type FailureClass, type TypeSafeQuestion } from '@sutura/core';
import { createJevManifest, jevManifestHash, JEV_QUESTION_VERSIONS, type JevCase } from './jev-manifest.js';
import { compareJevDecisions, type JevObservation } from './jev-decisions.js';

interface Golden { id: string; class: FailureClass; diagnostic: string; query: string }
const goldens = JSON.parse(await readFile(new URL('./__fixtures__/navigator-golden.json', import.meta.url), 'utf8')) as Golden[];
function report(golden: Golden) {
  return {
    runId: `golden-${golden.id}`, repo: `offline/${golden.id}`, runtime: 'node', outcome: 'gave-up',
    diagnosis: { class: golden.class, confidence: .75, signals: [], failingCmd: 'pnpm test', errorExcerpt: golden.diagnostic },
    triage: { status: 'real', reproduced: 3, of: 3, attemptsUsed: 3, maximumAttempts: 3, reproductionProbability: 1, confidenceLower: .4, confidenceUpper: 1, stopReason: 'failure-boundary', methodVersion: 'sprt-p20-p80-a05-b05-v1' },
    race: [], cost: { entries: [] }, policy: { baseRef: 'main', baseSha: 'a'.repeat(40), policySha: 'b'.repeat(64) }, stages: [],
  };
}
it('measures the actual provider-free lexical navigator on 30 independently labeled offline cases through Phase 2', async () => {
  if (process.env.SUTURA_NAVIGATOR_GOLDEN_OUTPUT && (!/^[a-f0-9]{40}$/u.test(process.env.SUTURA_NAVIGATOR_CONTROLLER_SHA ?? '') || process.env.SUTURA_NAVIGATOR_CONTROLLER_SHA === 'a'.repeat(40))) throw new Error('Saved measurements require the actual exact controller commit identity');
  expect(goldens).toHaveLength(30); expect(new Set(goldens.map(g => g.id)).size).toBe(30);
  const cases: Array<Omit<JevCase, 'policyHash' | 'inputHash'>> = [], measurements: Array<{ id: string; repetition: number; target: string | null; ids: string[]; latencyMs: number; matched: boolean }> = [];
  const observedLabels = new Map<string, Record<string, string | boolean>>();
  for (const golden of goldens) {
    const projection = parseEvidenceCase(JSON.parse(JSON.stringify(report(golden))));
    const target = projection.blocks.find(block => block.locator === '$.diagnosis.errorExcerpt');
    expect(target?.excerpt).toContain(golden.diagnostic); expect(target).toBeDefined();
    // The label names the source field independently of the ranker's result.
    for (const negative of [false, true]) {
      const id = `${golden.id}${negative ? '-unrelated' : ''}`, query = negative ? 'quasar telescope nebula' : golden.query;
      const request = navigatorRequest(projection, query);
      for (let repetition = 0; repetition < 3; repetition++) {
        const start = performance.now();
        const answer = await explainEvidence(projection, query);
        const latencyMs = performance.now() - start, ids = answer.results.map(result => result.id);
        expect(answer.mode).toBe('lexical'); expect(answer.decision).toBeUndefined(); expect(answer.results.length).toBeLessThanOrEqual(3);
        expect(ids.every(value => projection.blocks.some(block => block.id === value))).toBe(true);
        if (negative) { expect(answer.status).toBe('no-match'); expect(ids).toEqual([]); }
        else { expect(answer.status).toBe('matched'); expect(ids).toContain(target!.id); }
        const choices = Object.entries(request.questions).filter(([, question]) => question.type === 'choice').map(([questionId]) => questionId);
        expect(choices).toEqual(['first']); expect(request.questions.applicable).toMatchObject({ type: 'noul' });
        const baselineLabels: Record<string, string | boolean> = { applicable: ids.length > 0, first: ids[0] ?? 'none' };
        const labels: Record<string, string | boolean> = negative ? { applicable: false } : { applicable: true, first: target!.id };
        expect((request.questions.first as Extract<TypeSafeQuestion, { type: 'choice' }>).criteria).toHaveProperty('none');
        if (repetition === 0) cases.push({ id, family: golden.id, role: 'navigator', split: 'evaluation', category: 'synthetic', variant: negative ? 'negative' : 'positive', questionVersion: JEV_QUESTION_VERSIONS.navigator, state: request.state, questions: request.questions, candidateIds: request.candidateIds, baselineIds: request.baselineIds, labels });
        observedLabels.set(`${id}/${repetition}`, baselineLabels);
        measurements.push({ id, repetition, target: negative ? null : target!.id, ids, latencyMs, matched: negative ? !ids.length : ids.includes(target!.id) });
      }
    }
  }
  const manifest = createJevManifest({ controllerSha: process.env.SUTURA_NAVIGATOR_CONTROLLER_SHA ?? 'a'.repeat(40), cases });
  const hash = jevManifestHash(manifest);
  const observations: JevObservation[] = manifest.cases.flatMap(item => Array.from({ length: 3 }, (_, repetition) => {
    const measured = measurements.find(row => row.id === item.id && row.repetition === repetition)!;
    const evidence: DecisionEvidence = { role: 'navigator', mode: 'off', outcome: 'disabled', reason: 'lexical-measured-offline', fallback: 'lexical', policyVersion: 'semantic-v1', policyHash: item.policyHash, inputHash: item.inputHash, requestedModel: 'jev-1.14.0', usage: null, unknownSpendUsd: 0, attempts: 0, reservedUsd: 0, actualUsd: 0, latencyMs: measured.latencyMs, candidateIds: item.candidateIds, baseline: item.baselineIds };
    return { manifestHash: hash, arm: 'off' as const, caseId: item.id, repetition, evidence, baselineLabels: observedLabels.get(`${item.id}/${repetition}`)!, live: false, contractProbe: false };
  }));
  const comparison = compareJevDecisions(manifest, observations);
  expect(comparison.status).toBe('UNMEASURED'); expect(comparison.roles[0]?.arms.off.observed).toBe(180); expect(comparison.roles[0]?.arms.assist.observed).toBe(0);
  expect(comparison.roles[0]?.arms.off.totalCostUsd).toBe(0); expect(comparison.roles[0]?.arms.assist.totalCostUsd).toBeNull();
  const positives = measurements.filter(row => row.target !== null), negatives = measurements.filter(row => row.target === null);
  const result = { schemaVersion: 'sutura-navigator-offline-golden-v1', datasetSha256: createHash('sha256').update(JSON.stringify(goldens)).digest('hex'), cases: 30, queries: 60, repetitionsAreRepeatedMeasurements: true, lexical: { positiveTop3: positives.filter(row => row.matched).length / positives.length, negativeNoMatch: negatives.filter(row => row.matched).length / negatives.length, measurements }, semantic: 'UNMEASURED', ownerUsability: 'UNMEASURED', comparison, limitations: ['Constructed offline labels; not independent population evidence or a comprehension study.', 'Three actual local selector calls per query; repeated cases are correlated, and file read/parsing time is excluded.', 'No semantic response or paid call was observed.'] };
  if (process.env.SUTURA_NAVIGATOR_GOLDEN_OUTPUT) await writeFile(process.env.SUTURA_NAVIGATOR_GOLDEN_OUTPUT, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
});
