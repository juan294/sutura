import { choice, noul, validateAnswers, validateSemanticDecisions, type DecisionEvidence, type DecisionRole } from '@sutura/core';
import { canonicalJson } from './manifest.js';
import { jevManifestHash, validateJevManifest, type JevCase, type JevLabel, type JevManifest } from './jev-manifest.js';

export interface JevObservation {
  manifestHash: string;
  arm: 'off' | 'assist';
  caseId: string;
  /** Zero-based repetition, 0..2. */
  repetition: number;
  evidence?: DecisionEvidence;
  error?: string;
  baselineLabels?: Record<string, string | boolean>;
  live: boolean;
  contractProbe: boolean;
}
export type JevQualificationStatus = 'PASS' | 'FAIL' | 'UNMEASURED';
export interface JevControllerQualification {
  manifestHash: string;
  role: DecisionRole;
  status: JevQualificationStatus | 'PARTIAL';
  reasons: string[];
}
export interface JevCaseComparison {
  caseId: string; family: string; role: DecisionRole; split: JevCase['split']; variant: JevCase['variant'];
  arm: JevObservation['arm']; repetition: number; observed: boolean; correct: boolean;
  predictedLabels?: Record<string, JevLabel>;
  diagnostics: string[];
  uncertain: boolean; error: boolean; live: boolean; contractProbe: boolean;
  costUsd: number | null; knownCostUsd:number; reservedUsd: number; inputTokens: number; outputTokens: number; unknownUsage: boolean;
  legacyDecision?: JevCase['legacyDecision'];
  latencyMs: number | null; navigatorTop3: boolean | null; unsupportedEvidence: boolean;
}
export interface JevArmMetrics {
  expected: number; observed: number; missing: number; errors: number; correct: number; incorrect: number;
  answered: number; uncertain: number; accuracy: number | null; abstentionRate: number | null;
  accuracyInterval: { lower: number; upper: number; unit: 'case-repetition'; independence: 'not-established' } | null;
  knownCostUsd: number; totalCostUsd: number | null; unknownCost: number; reservedUsd: number;
  inputTokens: number; outputTokens: number; unknownUsage: number;
  p50LatencyMs: number | null; p95LatencyMs: number | null;
}
export interface JevRoleComparison {
  role: DecisionRole; status: JevQualificationStatus; reasons: string[]; failedCriteria: string[];
  independentFamilies: number; cases: number; arms: Record<JevObservation['arm'], JevArmMetrics>;
  navigatorTop3Accuracy: number | null; recommendation: string;
}
export interface JevComparison {
  schemaVersion: 'sutura-jev-comparison-v1'; manifestHash: string; controllerSha: string; corpusHash: string;
  scope: 'offline' | 'live'; status: JevQualificationStatus; autoEnabled: false;
  roles: JevRoleComparison[]; perCase: JevCaseComparison[]; recommendation: string; limitations: string[];
}

const ratio = (count: number, total: number): number | null => total ? count / total : null;
function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = values.toSorted((a, b) => a - b);
  if (fraction === .5 && sorted.length % 2 === 0) return (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  return sorted[Math.ceil(sorted.length * fraction) - 1]!;
}
function interval(correct: number, total: number): JevArmMetrics['accuracyInterval'] {
  if (!total) return null;
  const z = 1.959963984540054, p = correct / total, denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator;
  const half = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator;
  return { lower: Math.max(0, center - half), upper: Math.min(1, center + half), unit: 'case-repetition', independence: 'not-established' };
}
function metrics(rows: JevCaseComparison[]): JevArmMetrics {
  const correct = rows.filter(row => row.correct).length;
  const unknownCost = rows.filter(row => row.costUsd === null).length;
  const knownCostUsd = rows.reduce((sum, row) => sum + row.knownCostUsd, 0);
  if (!Number.isFinite(knownCostUsd) || !rows.every(row => Number.isFinite(row.reservedUsd)) || !Number.isFinite(rows.reduce((sum, row) => sum + row.reservedUsd, 0))) throw new Error('Jev comparison resource totals overflow finite numeric limits');
  const latencies = rows.flatMap(row => row.latencyMs === null ? [] : [row.latencyMs]);
  return {
    expected: rows.length, observed: rows.filter(row => row.observed).length, missing: rows.filter(row => !row.observed).length,
    errors: rows.filter(row => row.error).length, correct, incorrect: rows.filter(row => row.observed && !row.error && !row.correct).length,
    answered: rows.filter(row => row.observed && !row.error && !row.uncertain).length, uncertain: rows.filter(row => row.uncertain).length,
    accuracy: ratio(correct, rows.length), abstentionRate: ratio(rows.filter(row => row.uncertain).length, rows.length), accuracyInterval: interval(correct, rows.length),
    knownCostUsd, totalCostUsd: unknownCost ? null : knownCostUsd, unknownCost, reservedUsd: rows.reduce((sum, row) => sum + row.reservedUsd, 0),
    inputTokens: rows.reduce((sum, row) => sum + row.inputTokens, 0), outputTokens: rows.reduce((sum, row) => sum + row.outputTokens, 0), unknownUsage: rows.filter(row => row.unknownUsage).length,
    p50LatencyMs: percentile(latencies, .5), p95LatencyMs: percentile(latencies, .95),
  };
}
function validateObservation(observation: JevObservation, manifest: JevManifest, hash: string, cases: Map<string, JevCase>): JevCase {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation) || Object.keys(observation).some(key => !['manifestHash', 'arm', 'caseId', 'repetition', 'evidence', 'error', 'baselineLabels', 'live', 'contractProbe'].includes(key))) throw new Error('Jev observation must contain recognized bounded fields');
  if (observation.manifestHash !== hash) throw new Error('Jev observation manifestHash differs; use the frozen manifest and original observations');
  const item = cases.get(observation.caseId);
  if (!item) throw new Error('Jev observation caseId is foreign to the frozen manifest');
  if (!['off', 'assist'].includes(observation.arm) || !Number.isInteger(observation.repetition) || observation.repetition < 0 || observation.repetition >= manifest.repetitions || typeof observation.live !== 'boolean' || typeof observation.contractProbe !== 'boolean') throw new Error('Jev observation arm/repetition/live/contractProbe is invalid');
  if (observation.error !== undefined && (typeof observation.error !== 'string' || observation.error.length > 2000)) throw new Error('Jev observation error must be bounded text');
  if (observation.baselineLabels !== undefined) {
    if (observation.arm !== 'off' || !observation.baselineLabels || typeof observation.baselineLabels !== 'object' || Array.isArray(observation.baselineLabels)) throw new Error('Jev observation baselineLabels requires the off arm');
    for (const [id, value] of Object.entries(observation.baselineLabels)) {
      const q = item.questions[id];
      if (!q || !(value === 'uncertain' || (q.type === 'noul' ? typeof value === 'boolean' : typeof value === 'string' && Object.hasOwn(q.criteria, value)))) throw new Error('Jev observation baselineLabels is outside the supplied question taxonomy');
    }
  }
  const e = observation.evidence;
  if (e) {
    if (typeof e !== 'object' || Array.isArray(e)) throw new Error('Jev observation evidence must be a typed record');
    if (e.role !== item.role || e.mode !== observation.arm || e.policyVersion !== manifest.policyVersion || e.policyHash !== item.policyHash || e.requestedModel !== manifest.model) throw new Error('Jev observation evidence policy/model/role/mode identity differs');
    if (e.inputHash !== item.inputHash || canonicalJson(e.candidateIds) !== canonicalJson(item.candidateIds) || canonicalJson(e.baseline) !== canonicalJson(item.baselineIds)) throw new Error('Jev observation inputHash/candidate order differs; regenerate observations for the frozen input');
  }
  return item;
}
function score(item: JevCase, arm: JevObservation['arm'], repetition: number, observation?: JevObservation): JevCaseComparison {
  const supplied = observation?.evidence;
  const validEvidence = supplied !== undefined && validateSemanticDecisions({ schemaVersion: 'sutura-semantic-decisions-v1', records: [supplied], budget: { maxUsd: .02, attempts: supplied?.attempts ?? 0, reservedUsd: supplied?.reservedUsd ?? 0, actualUsd: supplied?.actualUsd ?? 0 } });
  const e = validEvidence ? supplied : undefined;
  const row: JevCaseComparison = { caseId: item.id, family: item.family, role: item.role, split: item.split, variant: item.variant, arm, repetition, observed: observation !== undefined, correct: false, diagnostics: [], uncertain: false, error: false, live: observation?.live ?? false, contractProbe: observation?.contractProbe ?? false,
    costUsd: observation && arm === 'off' && !observation.error ? 0 : e && (e.usage || e.attempts === 0) && (e.unknownSpendUsd ?? (e.attempts>1 ? 1 : 0))===0 ? e.actualUsd : null, knownCostUsd:e?.actualUsd??0, reservedUsd: e?.reservedUsd ?? 0, inputTokens: e?.usage?.inTok ?? 0, outputTokens: e?.usage?.outTok ?? 0, unknownUsage: arm !== 'off' && !e?.usage, latencyMs: e?.latencyMs ?? null, navigatorTop3: null, unsupportedEvidence: false, ...(item.legacyDecision === undefined ? {} : { legacyDecision: { ...item.legacyDecision } }) };
  if (!observation) { row.diagnostics.push('missing-observation'); return row; }
  if (observation.error !== undefined) { row.error = true; row.diagnostics.push('provider-error'); return row; }
  let labels: Record<string, JevLabel> | undefined;
  if (arm === 'off') {
    labels = observation.baselineLabels ?? item.baselineLabels;
    if (!labels || Object.keys(item.labels).some(id => !Object.hasOwn(labels!, id))) { row.diagnostics.push('baseline-labels-unavailable'); row.error = true; return row; }
    if (supplied && !e) { row.error = true; row.diagnostics.push('invalid-decision-evidence'); return row; }
    if (e && (e.attempts !== 0 || e.actualUsd !== 0 || e.reservedUsd !== 0 || e.outcome !== 'disabled' || e.usage && Object.values(e.usage).some(value => value !== 0))) { row.error = true; row.diagnostics.push('off-arm-provider-work'); return row; }
  } else {
    if (!e) { row.unsupportedEvidence = Array.isArray(supplied?.suggested) && supplied.suggested.some(id => !item.candidateIds.includes(id)); row.error = true; row.diagnostics.push('invalid-decision-evidence'); return row; }
    if (e.suggested?.some(id => !item.candidateIds.includes(id))) { row.unsupportedEvidence = true; row.error = true; row.diagnostics.push('unsupported-evidence'); return row; }
    if (!['answered', 'uncertain'].includes(e.outcome) || e.resolvedModel !== 'jev-1.14.0' || !e.answers) { row.error = true; row.diagnostics.push(e.outcome === 'unavailable' ? 'decision-unavailable' : 'decision-not-answered'); return row; }
    if (!validateAnswers({ model: e.resolvedModel, answers: e.answers, usage: e.usage ?? { inTok: 0, outTok: 0, reasoningTok: 0 }, usd: e.actualUsd, latencyMs: e.latencyMs, requestId: null }, item.questions)) { row.error = true; row.diagnostics.push('invalid-answer-distribution'); return row; }
    labels = Object.fromEntries(Object.entries(e.answers).map(([id, answer]) => [id, (answer.type === 'noul' ? noul(answer) : choice(answer)) ?? 'uncertain']));
    const uncertain = Object.values(labels).includes('uncertain');
    if ((e.outcome === 'answered' && uncertain) || (e.outcome === 'uncertain' && !uncertain)) { row.error = true; row.diagnostics.push('outcome-answer-conflict'); return row; }
  }
  row.predictedLabels = { ...labels };
  row.uncertain = Object.values(labels).includes('uncertain');
  row.correct = Object.entries(item.labels).every(([id, expected]) => labels![id] === expected);
  if (!row.correct) row.diagnostics.push('label-mismatch');
  if (item.role === 'navigator' && arm === 'assist' && e?.answers) {
    const candidateLabels = Object.values(item.labels).filter((value): value is string => typeof value === 'string' && value !== 'uncertain' && item.candidateIds.includes(value));
    const proposed = e.suggested ?? Object.entries(e.answers).flatMap(([id, answer]) => {
      if (answer.type !== 'choice') return [];
      const question = item.questions[id];
      // Only the actual selection is a result. Probability alternatives are not
      // returned evidence, and a declared none sentinel is an explicit abstention.
      return answer.choice === 'none' && question?.type === 'choice' && Object.hasOwn(question.criteria, 'none') ? [] : [answer.choice];
    });
    row.unsupportedEvidence = proposed.some(id => !item.candidateIds.includes(id));
    if (item.variant === 'negative') row.navigatorTop3 = row.correct && Object.values(item.labels).includes(false) && proposed.length === 0;
    else {
      const requiredNonselection=Object.entries(item.labels).filter(([id,expected])=>item.questions[id]?.type!=='choice'||typeof expected!=='string'||!item.candidateIds.includes(expected));
      const applicable=requiredNonselection.some(([id,expected])=>item.questions[id]?.type==='noul'&&expected===true&&labels![id]===true);
      row.navigatorTop3 = !row.uncertain && applicable && requiredNonselection.every(([id,expected])=>labels![id]===expected) && candidateLabels.length>0 && candidateLabels.every(id=>proposed.slice(0,3).includes(id));
    }
    if(item.variant==='uncertain') row.navigatorTop3 = row.correct && row.uncertain && proposed.length===0;
    if (row.unsupportedEvidence) row.diagnostics.push('unsupported-evidence');
  }
  return row;
}

/** Descriptive, finite comparison only. It never activates a role or authorizes an experiment. */
export function compareJevDecisions(rawManifest: JevManifest, observations: readonly JevObservation[], controllerRuns: readonly JevControllerQualification[] = []): JevComparison {
  const manifest = validateJevManifest(rawManifest), hash = jevManifestHash(manifest);
  const cases = new Map(manifest.cases.map(item => [item.id, item]));
  const keyed = new Map<string, JevObservation>();
  for (const observation of observations) {
    validateObservation(observation, manifest, hash, cases);
    const key = `${observation.arm}/${observation.caseId}/${observation.repetition}`;
    if (keyed.has(key)) throw new Error(`Jev observation duplicate ${key}`);
    keyed.set(key, observation);
  }
  const qualified = new Map<DecisionRole, JevControllerQualification>();
  for (const result of controllerRuns) {
    if (result.manifestHash !== hash) throw new Error('Controller qualification manifestHash differs from the frozen decision manifest');
    if (!manifest.cases.some(item => item.role === result.role) || qualified.has(result.role) || !['PASS', 'FAIL', 'UNMEASURED', 'PARTIAL'].includes(result.status) || !Array.isArray(result.reasons) || !result.reasons.every(reason => typeof reason === 'string' && reason.length <= 256)) throw new Error('Controller qualification role/status/reasons is invalid or duplicate');
    qualified.set(result.role, result);
  }
  const perCase = manifest.cases.flatMap(item => manifest.arms.flatMap(({ id: arm }) => Array.from({ length: manifest.repetitions }, (_, repetition) => score(item, arm, repetition, keyed.get(`${arm}/${item.id}/${repetition}`)))));
  const roles = [...new Set(manifest.cases.map(item => item.role))].map((role): JevRoleComparison => {
    const selected = manifest.cases.filter(item => item.role === role && item.split === 'evaluation');
    const rows = perCase.filter(row => row.role === role && row.split === 'evaluation');
    const off = rows.filter(row => row.arm === 'off'), assist = rows.filter(row => row.arm === 'assist');
    const arms = { off: metrics(off), assist: metrics(assist) };
    const independentFamilies = new Set(selected.map(item => item.family)).size;
    const variants = new Set(selected.map(item => item.variant));
    const reasons: string[] = [], failedCriteria: string[] = [];
    if(role==='audit-v2'&&selected.some(item=>!item.legacyDecision||item.legacyDecision.status==='skipped'))reasons.push('legacy-audit-observation-unmeasured');
    if (independentFamilies < 30) reasons.push('fewer-than-30-independent-evaluation-families');
    if (!variants.has('positive') || !variants.has('negative') || !(variants.has('uncertain') || variants.has('adversarial'))) reasons.push('variant-coverage-incomplete');
    if (!rows.length || rows.some(row => !row.live)) reasons.push('offline-only');
    if (!assist.length || assist.some(row => !row.observed || !row.contractProbe)) reasons.push('live-contract-probe-unmeasured');
    if (rows.some(row => !row.observed)) reasons.push('paired-repetitions-incomplete');
    if (off.some(row => row.error)) reasons.push('baseline-labels-unavailable');
    if (assist.some(row => row.error)) failedCriteria.push('decision-errors');
    if (assist.some(row => row.unsupportedEvidence)) failedCriteria.push('unsupported-evidence');
    if (role !== 'navigator' && arms.assist.correct < arms.off.correct) failedCriteria.push('label-accuracy');
    if (role !== 'navigator' && assist.some(row => off.find(base => base.caseId === row.caseId && base.repetition === row.repetition)?.correct && !row.correct)) failedCriteria.push('baseline-success-lost');
    if (selected.some(item => item.variant === 'uncertain') && assist.some(row => row.variant === 'uncertain' && !row.correct)) failedCriteria.push('insufficient-evidence-ignored');
    const navRows = assist.filter(row => row.variant === 'positive' || row.variant === 'adversarial');
    const navigatorTop3Accuracy = role === 'navigator' ? ratio(navRows.filter(row => row.navigatorTop3 === true).length, navRows.length) : null;
    if (role === 'navigator') {
      if (navigatorTop3Accuracy === null || navigatorTop3Accuracy < .9) failedCriteria.push('navigator-top3-below-90-percent');
      if (assist.some(row => row.variant === 'negative' && row.navigatorTop3 !== true)) failedCriteria.push('navigator-negative-returned-result');
    }
    const controller = qualified.get(role);
    const needsController = ['ranking', 'grounding', 'classification', 'recovery'].includes(role);
    if (needsController && (!controller || controller.status === 'UNMEASURED' || controller.status === 'PARTIAL')) reasons.push('controller-comparison-unmeasured', ...(controller?.reasons ?? []));
    if (needsController && controller?.status === 'FAIL') failedCriteria.push('controller-comparison-failed', ...controller.reasons);
    const status: JevQualificationStatus = reasons.length ? 'UNMEASURED' : failedCriteria.length ? 'FAIL' : 'PASS';
    return { role, status, reasons: [...new Set(reasons)], failedCriteria: [...new Set(failedCriteria)], independentFamilies, cases: selected.length, arms, navigatorTop3Accuracy,
      recommendation: role === 'audit-v2' ? 'Evidence-only comparison; retain the legacy audit veto model and thresholds.' : status === 'PASS' ? 'Criteria met for owner review; keep current role configuration until separately authorized.' : 'Keep the role off or shadow; resolve the listed evidence gaps or failed criteria before a new frozen measurement.' };
  });
  const status = roles.some(role => role.status === 'FAIL') ? 'FAIL' : roles.every(role => role.status === 'PASS') ? 'PASS' : 'UNMEASURED';
  return { schemaVersion: 'sutura-jev-comparison-v1', manifestHash: hash, controllerSha: manifest.controllerSha, corpusHash: manifest.corpusHash, scope: observations.length && observations.every(row => row.live) ? 'live' : 'offline', status, autoEnabled: false, roles, perCase,
    recommendation: 'No role was enabled. Review per-role criteria and retain the separately controlled publication and experiment boundaries.',
    limitations: ['Decision accuracy, cost and latency do not establish repair yield or avoided sandbox work.', 'Wilson intervals describe case repetitions; repeated observations are correlated and do not establish population safety.', 'Offline fixtures and invented metric tests are not provider compatibility or live qualification evidence.'] };
}
