import { describe, expect, it } from 'vitest';
import type { DecisionEvidence } from '@sutura/core';
import { createJevManifest, jevManifestHash, JEV_QUESTION_VERSIONS, type JevCase, type JevManifest } from './jev-manifest.js';
import { compareJevDecisions, type JevObservation } from './jev-decisions.js';

function manifest(count = 1, role: JevCase['role'] = 'classification'): JevManifest {
  return createJevManifest({ controllerSha: 'a'.repeat(40), cases: Array.from({ length: count }, (_, i) => ({
    id: `case-${i}`, family: `family-${i}`, role, split: 'evaluation', category: 'synthetic',
    variant: ['positive', 'negative', 'uncertain'][i % 3], questionVersion: JEV_QUESTION_VERSIONS[role],
    state: { message: `public example ${i}` }, questions: { applies: { type: 'noul', instructions: 'Does this apply?' } }, candidateIds: [], baselineIds: [], labels: { applies: i % 3 === 0 ? true : i % 3 === 1 ? false : 'uncertain' },
    baselineLabels: { applies: i % 3 === 0 ? true : i % 3 === 1 ? false : 'uncertain' },
  })) });
}
function evidence(m: JevManifest, index: number, probability?: number): DecisionEvidence {
  const c = m.cases[index]!;
  const expected = c.labels.applies;
  return { role: c.role, mode: 'assist', outcome: expected === 'uncertain' ? 'uncertain' : 'answered', policyVersion: m.policyVersion, policyHash: c.policyHash, inputHash: c.inputHash, requestedModel: m.model, resolvedModel: m.model,
    usage: { inTok: 100, outTok: 0, reasoningTok: 0 }, attempts: 1, reservedUsd: .00001, actualUsd: .0000042, latencyMs: 10, reason: expected === 'uncertain' ? 'uncertain-answer' : 'usable', fallback: 'baseline', candidateIds: c.candidateIds, baseline: c.baselineIds, answers: { applies: { type: 'noul', noul: probability ?? (expected === true ? .9 : expected === false ? .1 : .5) } } };
}
function observations(m: JevManifest, live = false): JevObservation[] {
  return m.cases.flatMap((c, index) => Array.from({ length: 3 }, (_, repetition) => ([
    { manifestHash: jevManifestHash(m), arm: 'off' as const, caseId: c.id, repetition, baselineLabels: c.baselineLabels!, live, contractProbe: false },
    { manifestHash: jevManifestHash(m), arm: 'assist' as const, caseId: c.id, repetition, evidence: evidence(m, index), live, contractProbe: live },
  ])).flat());
}

describe('compareJevDecisions (invented measurements test calculation only)', () => {
  it('keeps missing/errors in the all-case denominator and reports resources and descriptive intervals', () => {
    const m = manifest(); const rows = observations(m);
    rows[1]!.evidence!.latencyMs = 10; rows[3]!.evidence!.latencyMs = 20;
    rows[5] = { ...rows[5]!, error: 'provider timeout' };
    delete rows[5]!.evidence;
    rows.splice(2, 1);
    const report = compareJevDecisions(m, rows);
    const role = report.roles[0]!;
    expect(role.arms.assist).toMatchObject({ expected: 3, observed: 3, missing: 0, errors: 1, correct: 2, accuracy: 2 / 3, unknownCost: 1, totalCostUsd: null, p50LatencyMs: 15, p95LatencyMs: 20 });
    expect(role.arms.off).toMatchObject({ expected: 3, observed: 2, missing: 1, accuracy: 2 / 3 });
    expect(role.arms.assist.accuracyInterval!.lower).toBeLessThan(2 / 3);
    expect(role.arms.assist.accuracyInterval!.upper).toBeGreaterThan(2 / 3);
    expect(report.status).toBe('UNMEASURED');
    expect(report.autoEnabled).toBe(false);
  });

  it('scores confident false and explicit uncertainty without converting an outage to a label', () => {
    const m = manifest(3); const report = compareJevDecisions(m, observations(m));
    expect(report.roles[0]!.arms.assist).toMatchObject({ correct: 9, incorrect: 0, uncertain: 3, accuracy: 1, abstentionRate: 1 / 3 });
    expect(report.perCase.find(row => row.caseId === 'case-1' && row.arm === 'assist')!.predictedLabels).toEqual({ applies: false });
    expect(report.perCase.find(row => row.caseId === 'case-2' && row.arm === 'assist')!.predictedLabels).toEqual({ applies: 'uncertain' });
  });

  it('rejects duplicate, foreign, changed-input and wrong-manifest observations', () => {
    const m = manifest(); const rows = observations(m);
    expect(() => compareJevDecisions(m, [...rows, rows[0]!])).toThrow(/duplicate/u);
    expect(() => compareJevDecisions(m, [{ ...rows[0]!, caseId: 'foreign' }])).toThrow(/caseId/u);
    expect(() => compareJevDecisions(m, [{ ...rows[1]!, manifestHash: 'b'.repeat(64) }])).toThrow(/manifestHash/u);
    const changed = structuredClone(rows[1]!); changed.evidence!.inputHash = 'b'.repeat(64);
    expect(() => compareJevDecisions(m, [changed])).toThrow(/inputHash/u);
  });

  it('never qualifies offline fixtures even with thirty families and a passing controller comparison', () => {
    const m = manifest(30);
    const report = compareJevDecisions(m, observations(m), [{ manifestHash: jevManifestHash(m), role: 'classification', status: 'PASS', reasons: [] }]);
    expect(report.status).toBe('UNMEASURED');
    expect(report.roles[0]!.reasons).toContain('offline-only');
  });

  it('requires bound full-controller evidence and fails any previously correct baseline case lost in a repetition', () => {
    const m = manifest(30); const rows = observations(m, true);
    expect(compareJevDecisions(m, rows).roles[0]!.reasons).toContain('controller-comparison-unmeasured');
    const controller = [{ manifestHash: jevManifestHash(m), role: 'classification' as const, status: 'PASS' as const, reasons: [] }];
    expect(compareJevDecisions(m, rows, controller).status).toBe('PASS');
    rows[1]!.evidence!.answers!.applies = { type: 'noul', noul: .1 };
    const failed = compareJevDecisions(m, rows, controller);
    expect(failed.status).toBe('FAIL');
    expect(failed.roles[0]!.failedCriteria).toContain('baseline-success-lost');
    const retry = compareJevDecisions(m, observations(m, true), controller);
    expect(retry.status).toBe('PASS');
  });

  it('does not invent a zero-error criterion when an unchanged baseline label was already wrong', () => {
    const m = manifest(30); const rows = observations(m, true);
    rows[0]!.baselineLabels = { applies: false };
    rows[1]!.evidence!.answers!.applies = { type: 'noul', noul: .1 };
    const controller = [{ manifestHash: jevManifestHash(m), role: 'classification' as const, status: 'PASS' as const, reasons: [] }];
    const report = compareJevDecisions(m, rows, controller);
    expect(report.roles[0]!.arms.assist.correct).toBe(report.roles[0]!.arms.off.correct);
    expect(report.roles[0]!.failedCriteria).not.toContain('label-accuracy');
    expect(report.roles[0]!.failedCriteria).not.toContain('baseline-success-lost');
    expect(report.status).toBe('PASS');
  });

  it('invalidates observations after option-order permutations or corpus changes', () => {
    const source = manifest();
    const c = source.cases[0]!;
    const base = { ...c, questions: { applies: { type: 'choice' as const, instructions: 'Which public option?', criteria: { right: 'right', left: 'left' } } }, labels: { applies: 'right' }, baselineLabels: { applies: 'right' } };
    const original = createJevManifest({ controllerSha: source.controllerSha, cases: [base] });
    const reordered = createJevManifest({ controllerSha: source.controllerSha, cases: [{ ...base, questions: { applies: { ...base.questions.applies, criteria: { left: 'left', right: 'right' } } } }] });
    expect(original.cases[0]!.inputHash).not.toBe(reordered.cases[0]!.inputHash);
    expect(() => compareJevDecisions(reordered, [{ manifestHash: jevManifestHash(original), arm: 'off', caseId: c.id, repetition: 0, live: false, contractProbe: false }])).toThrow(/manifestHash/u);
    const mutated = structuredClone(original); mutated.cases[0]!.state = 'changed corpus';
    expect(() => compareJevDecisions(mutated, [])).toThrow(/inputHash/u);
  });

  it('reports malformed answers and outcome conflicts without poisoning cost metrics', () => {
    const m = manifest(); const rows = observations(m);
    rows[1]!.evidence!.answers!.applies = { type: 'noul', noul: Number.NaN };
    rows[3]!.evidence!.outcome = 'uncertain';
    const report = compareJevDecisions(m, rows);
    expect(report.roles[0]!.arms.assist.errors).toBe(2);
    expect(report.roles[0]!.arms.assist.knownCostUsd).toBeCloseTo(.0000084,9);
    expect(report.perCase.filter(row => row.arm === 'assist').flatMap(row => row.diagnostics)).toContain('outcome-answer-conflict');
  });

  it('qualifies navigator top-three and negative/no-result behavior while rejecting unsupported IDs', () => {
    const source = manifest(30, 'navigator');
    const m = createJevManifest({ controllerSha: source.controllerSha, cases: source.cases.map(c => ({ ...c,
      questions: { applies: c.questions.applies, selection: { type: 'choice', instructions: 'Which supplied excerpt applies?', criteria: { relevant: 'Relevant excerpt', alternate: 'Other excerpt', unrelated: 'Unrelated excerpt' } } },
      candidateIds: ['relevant', 'alternate', 'unrelated'], baselineIds: ['relevant', 'alternate', 'unrelated'],
      labels: c.variant === 'positive' ? { applies: true, selection: 'relevant' } : c.labels,
      baselineLabels: c.variant === 'positive' ? { applies: true, selection: 'relevant' } : c.labels,
    })) });
    const rows = observations(m, true);
    for (const row of rows) if (row.evidence) {
      row.evidence.answers!.selection = { type: 'choice', choice: 'relevant', confidence: .9, probabilities: { relevant: .9, alternate: .05, unrelated: .05 } };
      row.evidence.suggested = m.cases.find(c => c.id === row.caseId)!.variant === 'positive' ? ['relevant'] : [];
    }
    expect(compareJevDecisions(m, rows).status).toBe('PASS');
    const negative = rows.find(row => row.arm === 'assist' && row.caseId === 'case-1')!;
    negative.evidence!.suggested = ['relevant'];
    expect(compareJevDecisions(m, rows).roles[0]!.failedCriteria).toContain('navigator-negative-returned-result');
    negative.evidence!.suggested = ['foreign-action'];
    expect(compareJevDecisions(m, rows).roles[0]!.failedCriteria).toContain('unsupported-evidence');
  });

  it('never uses development families as qualification cases and keeps audit v2 evidence-only', () => {
    const base = manifest(30, 'audit-v2');
    const m = createJevManifest({ controllerSha: base.controllerSha, cases: base.cases.map(c => ({ ...c, legacyDecision: { status: 'approved', model: 'jev-legacy', sourceHash: 'f'.repeat(64) } })) });
    const result = compareJevDecisions(m, observations(m, true));
    expect(result.roles[0]!.recommendation).toContain('retain the legacy audit veto');
    expect(result.perCase[0]!.legacyDecision).toEqual(m.cases[0]!.legacyDecision);
    const development = createJevManifest({ controllerSha: base.controllerSha, cases: base.cases.map(c => ({ ...c, split: 'development' })) });
    expect(compareJevDecisions(development, observations(development, true)).roles[0]!.independentFamilies).toBe(0);
  });

  it('keeps PARTIAL controller evidence unmeasured and rejects an unrelated qualification identity', () => {
    const m = manifest(30);
    const result = compareJevDecisions(m, observations(m, true), [{ manifestHash: jevManifestHash(m), role: 'classification', status: 'PARTIAL', reasons: ['missing-native-cancellation'] }]);
    expect(result.status).toBe('UNMEASURED');
    expect(result.roles[0]!.reasons).toContain('missing-native-cancellation');
    expect(() => compareJevDecisions(m, observations(m, true), [{ manifestHash: 'b'.repeat(64), role: 'classification', status: 'PASS', reasons: [] }])).toThrow(/manifestHash/u);
  });
});

it('never qualifies positive navigation with false applicability despite a correct selected ID',()=>{
 const seed=manifest(30,'navigator');
 const m=createJevManifest({controllerSha:seed.controllerSha,cases:seed.cases.map(c=>({...c,questions:{applies:c.questions.applies,selection:{type:'choice',instructions:'Which excerpt?',criteria:{relevant:'Relevant',other:'Other'}}},candidateIds:['relevant','other'],baselineIds:['relevant','other'],labels:c.variant==='positive'?{applies:true,selection:'relevant'}:c.labels,baselineLabels:c.variant==='positive'?{applies:true,selection:'relevant'}:c.baselineLabels}))});
 const rows=observations(m,true);
 for(const row of rows)if(row.evidence){row.evidence.answers!.selection={type:'choice',choice:'relevant',confidence:.9,probabilities:{relevant:.9,other:.1}};row.evidence.suggested=m.cases.find(c=>c.id===row.caseId)!.variant==='positive'?['relevant']:[];if(m.cases.find(c=>c.id===row.caseId)!.variant==='positive')row.evidence.answers!.applies={type:'noul',noul:.1};}
 expect(compareJevDecisions(m,rows).status).toBe('FAIL');
});
it('keeps atomic audit comparison unmeasured without an original legacy observation',()=>{
 const m=manifest(30,'audit-v2');expect(compareJevDecisions(m,observations(m,true)).roles[0]!.reasons).toContain('legacy-audit-observation-unmeasured');
});

it('scores a gold navigator excerpt in second place as top-three without inventing top-one correctness',()=>{
 const seed=manifest(1,'navigator'),c=seed.cases[0]!;
 const m=createJevManifest({controllerSha:seed.controllerSha,cases:[{...c,questions:{...c.questions,selection:{type:'choice',instructions:'Which excerpt?',criteria:{gold:'Gold excerpt',other:'Other excerpt'}}},candidateIds:['gold','other'],baselineIds:['gold','other'],labels:{applies:true,selection:'gold'},baselineLabels:{applies:true,selection:'gold'}}]});
 const rows=observations(m,true);for(const row of rows)if(row.evidence){row.evidence.answers!.selection={type:'choice',choice:'other',confidence:.9,probabilities:{other:.9,gold:.1}};row.evidence.suggested=['other','gold'];}
 const answer=compareJevDecisions(m,rows).perCase.find(row=>row.arm==='assist')!;expect(answer.correct).toBe(false);expect(answer.navigatorTop3).toBe(true);
});

it('does not present a successful retry as a fully known cost when its failed attempt retained unknown spend',()=>{
 const m=manifest(),rows=observations(m);rows[1]!.evidence!.unknownSpendUsd=.000005;
 const arm=compareJevDecisions(m,rows).roles[0]!.arms.assist;expect(arm.errors).toBe(0);expect(arm.totalCostUsd).toBeNull();expect(arm.unknownCost).toBe(1);expect(arm.knownCostUsd).toBeCloseTo(.0000126,9);
});
