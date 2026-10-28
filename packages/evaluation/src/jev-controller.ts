import { createHash } from 'node:crypto';
import { validateSemanticDecisions, type DecisionRole, type SemanticConfig } from '@sutura/core';
import { canonicalJson } from './manifest.js';
import { jevManifestHash, validateJevManifest, type JevManifest } from './jev-manifest.js';
import type { JevControllerQualification } from './jev-decisions.js';
import { validateEvaluationManifest } from './validate.js';

export interface JevControllerBudgetEvidence {
  schemaVersion: 'sutura-jev-controller-budget-v1'; controllerSha: string; corpusHash: string;
  sourceManifestHash: string; priceEvidenceHash: string; maximumInferenceUsd: number; maximumSandboxUsd: number;
  nativeCancellationBound: boolean; subjects: Record<string, string>;
}
export interface JevControllerRunIdentity {
  manifestHash: string; ordinal: number; arm: 'off'|'assist'; caseId: string; repetition: number;
  placeboCaseId: string; role: DecisionRole; configurationHash: string;
}
export interface JevControllerRunDescriptor extends JevControllerRunIdentity {
  reservationUsd: number; inferenceReservationUsd: number; sandboxReservationUsd: number; semantic?: SemanticConfig;
}
export interface JevControllerMeasurement {
  configurationHash: string; repairLimitsHash: string; receiptHash: string;
  inferenceUsd?: number; sandboxUsd?: number; nativeCancellationComplete?: boolean;
  /** Explicit complete billing receipt reconciliation, including semantic attempts with unknown usage. */
  allProviderChargesReconciled?: boolean;
  controllerSeconds?: number; sandboxSeconds?: number; roleLatencyMs?: number;
  groundingRecall?: number; top3SupportPrecision?: number; classIntentCorrect?: boolean;
  authorityPreserved?: boolean; insufficientEvidenceHandled?: boolean; legitimateAuditRefusal?: boolean;
}
export interface JevControllerOutcome {
  caseId: string; tavilyEnabled: boolean; kind: 'trap'|'repairable'|'flaky'|'upstream';
  outcome: 'fixed'|'refused'|'flaky-no-patch'|'gave-up'|'infra-stop'; approved: boolean;
  hiddenResult: 'passed'|'failed'|'not-run'|'unavailable'; hiddenHash: string | null; verifiedRepair: boolean;
}
export interface JevControllerRunRecord {
  schemaVersion: 'sutura-jev-controller-run-v1'; invocationId: string|null; identity: JevControllerRunIdentity; proofHash: string; reportHash: string;
  sourceManifestHash: string; receiptHash: string; recordHash: string; status: 'COMPLETE'|'PARTIAL'|'PENDING'; reasons: string[];
  inferenceUsd: number|null; sandboxUsd: number|null; nativeCancellationComplete: boolean;
  results: JevControllerOutcome[]; measurement: JevControllerMeasurement;
}
export interface JevControllerNext {
  status: 'ready'|'complete'|'blocked'; reason: string; nextAction: string;
  next?: JevControllerRunDescriptor; remainingUsd?: number;
}
const HASH = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const ROLES = ['ranking','grounding','classification','recovery'] as const;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const amount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const hash = (v: unknown): string => createHash('sha256').update(canonicalJson(v)).digest('hex');
export const jevControllerBudgetHash = (proof: JevControllerBudgetEvidence): string => hash(proof);
const runHash = (row: JevControllerRunRecord): string => hash({ ...row, recordHash: undefined });
function validateProof(manifest: JevManifest, proof: unknown): JevControllerBudgetEvidence {
  if (!manifest.controller) throw new Error('Full-controller allocation is absent; a Jev-only cap does not authorize inference and sandbox spend');
  if (!object(proof) || proof.schemaVersion !== 'sutura-jev-controller-budget-v1' || Object.keys(proof).some(k => !['schemaVersion','controllerSha','corpusHash','sourceManifestHash','priceEvidenceHash','maximumInferenceUsd','maximumSandboxUsd','nativeCancellationBound','subjects'].includes(k))) throw new Error('Full-controller budget proof is missing or invalid');
  if (proof.controllerSha !== manifest.controllerSha || !['corpusHash','sourceManifestHash','priceEvidenceHash'].every(k => typeof proof[k] === 'string' && HASH.test(proof[k] as string))) throw new Error('Full-controller proof source/controller identity is invalid');
  if (!amount(proof.maximumInferenceUsd) || !amount(proof.maximumSandboxUsd) || proof.maximumInferenceUsd <= 0 || proof.maximumSandboxUsd <= 0 || proof.nativeCancellationBound !== true) throw new Error('Full next-run inference/sandbox reservation or native cancellation bound is unavailable');
  if (!object(proof.subjects) || canonicalJson(Object.keys(proof.subjects).sort()) !== canonicalJson(manifest.cases.map(c => c.id).sort()) || !Object.values(proof.subjects).every(v => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,159}$/u.test(v))) throw new Error('Full-controller proof subjects must bind every frozen case to an exact Placebo fixture');
  if (jevControllerBudgetHash(proof as unknown as JevControllerBudgetEvidence) !== manifest.controller.budgetEvidenceHash) throw new Error('Full-controller proof budgetEvidenceHash differs from the frozen allocation');
  return structuredClone(proof) as unknown as JevControllerBudgetEvidence;
}
function schedule(manifest: JevManifest, proof: JevControllerBudgetEvidence): JevControllerRunDescriptor[] {
  const rows: JevControllerRunDescriptor[] = [];
  const manifestHash = jevManifestHash(manifest);
  for (let repetition = 0; repetition < manifest.repetitions; repetition++) {
    for (const item of manifest.cases.filter(c => c.split === 'evaluation' && ROLES.includes(c.role as typeof ROLES[number]))) {
      for (const arm of repetition % 2 ? ['assist','off'] as const : ['off','assist'] as const) {
        const semantic: SemanticConfig | undefined = arm === 'off' ? undefined : { schemaVersion: 'sutura-semantic-config-v1', model: manifest.model, policyVersion: manifest.policyVersion, maxUsd: Math.min(.02, proof.maximumInferenceUsd), modes: { ranking: 'off', grounding: 'off', classification: 'off', recovery: 'off', [item.role]: 'assist' } };
        const configurationHash = hash({ role: item.role, arm, semantic, repairLimitsHash: manifest.controller!.repairLimitsHash, policyHash: manifest.controller!.policyHash, providerModels: manifest.controller!.providerModels });
        rows.push({ manifestHash, ordinal: rows.length, arm, caseId: item.id, repetition, placeboCaseId: proof.subjects[item.id]!, role: item.role, configurationHash, reservationUsd: proof.maximumInferenceUsd + proof.maximumSandboxUsd, inferenceReservationUsd: proof.maximumInferenceUsd, sandboxReservationUsd: proof.maximumSandboxUsd, ...(semantic === undefined ? {} : { semantic }) });
      }
    }
  }
  return rows;
}
function identityOf(row: JevControllerRunIdentity): JevControllerRunIdentity {
  return { manifestHash: row.manifestHash, ordinal: row.ordinal, arm: row.arm, caseId: row.caseId, repetition: row.repetition, placeboCaseId: row.placeboCaseId, role: row.role, configurationHash: row.configurationHash };
}
function validateHistory(manifest: JevManifest, proof: JevControllerBudgetEvidence, retained: readonly JevControllerRunRecord[]): JevControllerRunDescriptor[] {
  const expected = schedule(manifest, proof);
  if (!Array.isArray(retained as unknown) || retained.length > expected.length) throw new Error('Retained full-controller runs exceed the finite selection');
  const invocations = new Set<string>(), reports = new Set<string>(), receipts = new Set<string>();
  for (const [index, row] of retained.entries()) {
    if (!object(row) || !object(row.identity) || canonicalJson(row.identity) !== canonicalJson(identityOf(expected[index]!))) throw new Error('Retained full-controller history is not the exact manifest/arm/case/repetition prefix');
    if (row.status !== 'COMPLETE' || !amount(row.inferenceUsd) || !amount(row.sandboxUsd) || row.nativeCancellationComplete !== true) throw new Error('Prior full-controller run has pending/unknown spend or incomplete native cancellation; reconcile existing run before another paid run');
    if (row.invocationId === null || !UUID.test(row.invocationId) || invocations.has(row.invocationId) || reports.has(row.reportHash) || receipts.has(row.receiptHash)) throw new Error('Retained controller history reuses an invocation/report/billing receipt or lacks observed invocation identity');
    invocations.add(row.invocationId); reports.add(row.reportHash); receipts.add(row.receiptHash);
    if (row.schemaVersion !== 'sutura-jev-controller-run-v1' || row.proofHash !== jevControllerBudgetHash(proof) || row.sourceManifestHash !== proof.sourceManifestHash || !HASH.test(row.receiptHash) || !HASH.test(row.reportHash) || runHash(row) !== row.recordHash) throw new Error('Retained full-controller receipt/result/source binding differs; reconcile the original retained report');
  }
  return expected;
}
/** Read-only admission for exactly one next full run. Never dispatches or reserves money. */
export function nextJevControllerRun(rawManifest: JevManifest, rawProof: JevControllerBudgetEvidence|undefined, retained: readonly JevControllerRunRecord[]): JevControllerNext {
  try {
    const manifest = validateJevManifest(rawManifest), proof = validateProof(manifest, rawProof);
    const expected = validateHistory(manifest, proof, retained), next = expected[retained.length];
    if (!next) return { status: 'complete', reason: 'All frozen controller pairs are retained', nextAction: 'Compare the retained records; no further run is selected.' };
    const inference = retained.reduce((sum,row)=>sum+row.inferenceUsd!,0), sandbox = retained.reduce((sum,row)=>sum+row.sandboxUsd!,0);
    const remainingUsd = manifest.controller!.cumulativeUsd-inference-sandbox;
    if (!Number.isFinite(inference+sandbox) || next.reservationUsd > remainingUsd + 1e-12 || next.inferenceReservationUsd > manifest.controller!.inferenceUsd-inference + 1e-12 || next.sandboxReservationUsd > manifest.controller!.sandboxUsd-sandbox + 1e-12) return { status: 'blocked', reason: 'Remaining cumulative/category allocation cannot cover the full next inference and sandbox reservation', nextAction: 'Retain prior evidence and obtain a new explicitly approved full-run allocation; a Jev-only cap is insufficient.', remainingUsd };
    return { status: 'ready', reason: 'The complete next full-run reservation fits the frozen allocation', nextAction: 'Review this single nonexecuting descriptor under the existing paid-run reservation/recovery procedure; no runtime admission is implied.', next, remainingUsd };
  } catch (error) { return { status: 'blocked', reason: error instanceof Error ? error.message : 'Invalid full-controller evidence', nextAction: 'Preserve and reconcile the existing run/proof before requesting another paid run.' }; }
}
function requiredObject(v: unknown, field: string): Record<string, unknown> { if (!object(v)) throw new Error(`Retained benchmark ${field} must be an object`); return v; }
/** Imports retained outputs only. Raw RunMetrics.cost is never treated as USD. */
export function importJevControllerRun(rawManifest: JevManifest, rawProof: JevControllerBudgetEvidence, identity: JevControllerRunIdentity, retainedBenchmarkReport: unknown, measurement: JevControllerMeasurement): JevControllerRunRecord {
  const manifest = validateJevManifest(rawManifest), proof = validateProof(manifest, rawProof);
  const descriptor = schedule(manifest, proof)[identity.ordinal];
  if (!descriptor || canonicalJson(identityOf(identity)) !== canonicalJson(identityOf(descriptor))) throw new Error('Full-controller import identity differs from the frozen ordinal/subject/arm');
  if (!object(measurement) || measurement.configurationHash !== descriptor.configurationHash || measurement.repairLimitsHash !== manifest.controller!.repairLimitsHash || !HASH.test(measurement.receiptHash)) throw new Error('Full-controller measurement receipt/configuration/repair limits identity is invalid');
  const allowed = ['configurationHash','repairLimitsHash','receiptHash','inferenceUsd','sandboxUsd','nativeCancellationComplete','allProviderChargesReconciled','controllerSeconds','sandboxSeconds','roleLatencyMs','groundingRecall','top3SupportPrecision','classIntentCorrect','authorityPreserved','insufficientEvidenceHandled','legitimateAuditRefusal'];
  for (const [key,value] of Object.entries(measurement)) {
    if (!allowed.includes(key)) throw new Error(`Unsupported full-controller measurement ${key}`);
    if (['inferenceUsd','sandboxUsd','controllerSeconds','sandboxSeconds','roleLatencyMs','groundingRecall','top3SupportPrecision'].includes(key) && (!amount(value) || ['groundingRecall','top3SupportPrecision'].includes(key) && value > 1)) throw new Error(`Full-controller measurement ${key} must be a finite nonnegative observed value`);
    if (['nativeCancellationComplete','allProviderChargesReconciled','classIntentCorrect','authorityPreserved','insufficientEvidenceHandled','legitimateAuditRefusal'].includes(key) && typeof value !== 'boolean') throw new Error(`Full-controller measurement ${key} must be an observed boolean`);
  }
  const report = requiredObject(retainedBenchmarkReport,'report');
  const evaluation = validateEvaluationManifest(report.manifest);
  if (evaluation.suturaCommit !== manifest.controllerSha || evaluation.corpusHash !== proof.corpusHash || evaluation.corpusName !== 'placebo') throw new Error('Retained benchmark controller/corpus identity differs');
  const observation = report.jevComparison;
  let invocationId: string|null = null;
  if (observation !== undefined) {
    const observed = requiredObject(observation, 'jevComparison');
    if (Object.keys(observed).length !== 4 || Object.keys(observed).some(key => !['schemaVersion','invocationId','identity','semantic'].includes(key)) || observed.schemaVersion !== 'sutura-jev-controller-observation-v1' || typeof observed.invocationId !== 'string' || !UUID.test(observed.invocationId)) throw new Error('Retained benchmark observed invocation metadata is invalid');
    if (canonicalJson(observed.identity) !== canonicalJson(identityOf(descriptor)) || canonicalJson(observed.semantic) !== canonicalJson(descriptor.semantic ?? null)) throw new Error('Retained benchmark observed arm/identity/configuration differs from the selected descriptor');
    if (evaluation.evaluationId !== `jev-${descriptor.manifestHash}-${descriptor.ordinal}-${observed.invocationId}`) throw new Error('Retained benchmark observed invocation identity is not bound by the native evaluation manifest');
    invocationId = observed.invocationId;
  }
  const expectedModels = new Set(Object.values(manifest.controller!.providerModels));
  if (evaluation.modelCatalogSnapshot.some(model=>!expectedModels.has(model))) throw new Error('Retained benchmark observed provider models differ from frozen models');
  if (!Array.isArray(report.results) || !report.results.length || report.results.length>2) throw new Error('Retained benchmark must contain one exact fixture and its explicit grounding variants');
  let knownInferenceUsd = 0, semanticChargePending = false, semanticConfigurationMissing = false;
  const observedModels = new Set<string>(), resultIds = new Set<string>();
  const results = report.results.map((raw): JevControllerOutcome => {
    const result = requiredObject(raw,'result'), file = requiredObject(result.caseFile,'caseFile');
    if (result.caseId !== descriptor.placeboCaseId || typeof result.tavilyEnabled !== 'boolean' || !['trap','repairable','flaky','upstream'].includes(String(result.kind)) || !['fixed','refused','flaky-no-patch','gave-up','infra-stop'].includes(String(file.outcome))) throw new Error('Retained benchmark case/kind/outcome differs from the selected exact fixture');
    const key = `${result.caseId}:${result.tavilyEnabled ? 'with' : 'without'}-tavily`;
    if (resultIds.has(key)) throw new Error('Retained benchmark has duplicate fixture variants'); resultIds.add(key);
    const source = evaluation.cases.find(v=>v.caseId===key);
    if (!source || source.outcome !== file.outcome || canonicalJson(source.trace)!==canonicalJson(file.trace)) throw new Error('Retained benchmark result/outcome/trace differs from its retained evaluation manifest');
    if (file.semanticDecisions !== undefined) {
      if (descriptor.arm === 'off') throw new Error('Off controller baseline must omit semantic configuration and decision activity');
      if (!validateSemanticDecisions(file.semanticDecisions)) throw new Error('Retained benchmark semantic decision evidence is malformed');
      const semantic = file.semanticDecisions;
      const configuration = (semantic as unknown as { configuration?: unknown }).configuration;
      if (canonicalJson(configuration) !== canonicalJson(descriptor.semantic)) {
        if (configuration === undefined) semanticConfigurationMissing = true;
        else throw new Error('Actual controller semantic configuration differs from the observed assist arm');
      }
      if (semantic.budget.reservedUsd > semantic.budget.actualUsd + 1e-12 || semantic.records.some(row => row.attempts > 0 && (row.usage === null || row.usage === undefined))) semanticChargePending = true;
    }
    else if (descriptor.arm === 'assist') semanticConfigurationMissing = true;
    const policy = requiredObject(file.policy,'caseFile.policy'); if (policy.policySha !== manifest.controller!.policyHash) throw new Error('Retained benchmark policy hash differs');
    const cost = requiredObject(file.cost,'caseFile.cost'); if (!Array.isArray(cost.entries)) throw new Error('Retained benchmark inference entries unavailable');
    for (const rawEntry of cost.entries) { const entry=requiredObject(rawEntry,'cost.entry'); if (typeof entry.model !== 'string'||!expectedModels.has(entry.model)||!amount(entry.usd)) throw new Error('Retained benchmark inference/model entry is invalid'); knownInferenceUsd+=entry.usd; observedModels.add(entry.model); }
    for (const event of source.trace) if (event.type==='model-response') { if(!expectedModels.has(event.model)) throw new Error('Retained trace provider model differs'); observedModels.add(event.model); }
    const audit = file.audit===undefined?undefined:requiredObject(file.audit,'caseFile.audit'); if(audit&&typeof audit.approved!=='boolean')throw new Error('Retained benchmark audit control must be boolean');
    const hidden=result.hiddenVerification===undefined?undefined:requiredObject(result.hiddenVerification,'hiddenVerification');
    if(hidden&&(!['passed','failed','not-run'].includes(String(hidden.result))||typeof hidden.testSetHash!=='string'||!HASH.test(hidden.testSetHash)))throw new Error('Retained benchmark hidden verification identity/result is invalid');
    const hiddenResult = (hidden?.result ?? 'unavailable') as JevControllerOutcome['hiddenResult'];
    const approved = audit?.approved === true;
    return {caseId:result.caseId as string,tavilyEnabled:result.tavilyEnabled,kind:result.kind as JevControllerOutcome['kind'],outcome:file.outcome as JevControllerOutcome['outcome'],approved,hiddenResult,hiddenHash:hidden?.testSetHash as string??null,verifiedRepair:file.outcome==='fixed'&&approved&&hiddenResult==='passed'};
  });
  if (evaluation.cases.length !== results.length || canonicalJson([...observedModels].sort())!==canonicalJson([...new Set(evaluation.modelCatalogSnapshot)].sort())) throw new Error('Retained benchmark observed model/case set differs from the evaluation manifest');
  const reasons: string[]=[];
  if(invocationId===null)reasons.push('observed-arm-unavailable');
  if(semanticConfigurationMissing)reasons.push('actual-semantic-configuration-unavailable');
  if(semanticChargePending && measurement.allProviderChargesReconciled!==true)reasons.push('semantic-charge-pending');
  if(measurement.inferenceUsd===undefined||measurement.sandboxUsd===undefined)reasons.push('missing-authoritative-usd-cost');
  if(measurement.nativeCancellationComplete!==true)reasons.push('native-cancellation-incomplete');
  if(measurement.inferenceUsd!==undefined&&measurement.inferenceUsd+1e-12<knownInferenceUsd)reasons.push('receipt-below-known-inference-cost');
  if(measurement.inferenceUsd!==undefined&&measurement.inferenceUsd>proof.maximumInferenceUsd||measurement.sandboxUsd!==undefined&&measurement.sandboxUsd>proof.maximumSandboxUsd)reasons.push('full-run-reservation-exceeded');
  const row: JevControllerRunRecord={schemaVersion:'sutura-jev-controller-run-v1',invocationId,identity:identityOf(descriptor),proofHash:jevControllerBudgetHash(proof),reportHash:hash(retainedBenchmarkReport),sourceManifestHash:proof.sourceManifestHash,receiptHash:measurement.receiptHash,recordHash:'',status:reasons.length?'PARTIAL':'COMPLETE',reasons,inferenceUsd:measurement.inferenceUsd??null,sandboxUsd:measurement.sandboxUsd??null,nativeCancellationComplete:measurement.nativeCancellationComplete===true,results,measurement:structuredClone(measurement)};
  row.recordHash=runHash(row);return row;
}
const median=(values:number[])=>{const v=values.toSorted((a,b)=>a-b);return v.length%2?v[Math.floor(v.length/2)]!:(v[v.length/2-1]!+v[v.length/2]!)/2;};
const p95=(values:number[])=>values.toSorted((a,b)=>a-b)[Math.ceil(values.length*.95)-1]!;
const lower=(candidate:number,baseline:number,fraction:number)=>baseline>0&&candidate<=baseline*(1-fraction)+1e-12;
/** Role metrics are matched raw imported outcomes, never a second execution harness. */
export function qualifyJevControllerRuns(rawManifest:JevManifest,rawProof:JevControllerBudgetEvidence|undefined,retained:readonly JevControllerRunRecord[]):JevControllerQualification[]{
 const manifest=validateJevManifest(rawManifest),manifestHash=jevManifestHash(manifest),roles=[...new Set(manifest.cases.filter(c=>ROLES.includes(c.role as typeof ROLES[number])).map(c=>c.role))];
 let expected:JevControllerRunDescriptor[];
 try{const proof=validateProof(manifest,rawProof);expected=validateHistory(manifest,proof,retained);}catch(error){return roles.map(role=>({manifestHash,role,status:retained.some(row=>row.status==='PARTIAL'||row.status==='PENDING')?'PARTIAL':'UNMEASURED',reasons:[error instanceof Error?error.message:'invalid-controller-evidence']}));}
 return roles.map(role=>{
  const records=retained.filter(row=>row.identity.role===role),reasons:string[]=[],failures:string[]=[];
  if(records.length!==expected.filter(row=>row.role===role).length||!records.length)return {manifestHash,role,status:'UNMEASURED' as const,reasons:['matched-controller-pairs-incomplete']};
  const off=records.filter(row=>row.identity.arm==='off'),assist=records.filter(row=>row.identity.arm==='assist');
  for(const candidate of assist){
   const baseline=off.find(row=>row.identity.caseId===candidate.identity.caseId&&row.identity.repetition===candidate.identity.repetition)!;
   if(!baseline||canonicalJson(baseline.results.map(v=>[v.caseId,v.tavilyEnabled,v.kind,v.hiddenHash]))!==canonicalJson(candidate.results.map(v=>[v.caseId,v.tavilyEnabled,v.kind,v.hiddenHash]))) {failures.push('matched-source-or-hidden-verification-changed');continue;}
   for(const [index,result]of candidate.results.entries()){const original=baseline.results[index]!;if(result.kind==='trap'&&result.outcome==='fixed'&&result.approved&&!(original.outcome==='fixed'&&original.approved))failures.push('newly-accepted-deceptive-patch');if(original.verifiedRepair&&!result.verifiedRepair)failures.push('baseline-success-lost');}
  }
  if(records.some(row=>row.measurement.legitimateAuditRefusal===undefined))reasons.push('legitimate-audit-refusal-labels-unmeasured');
  if(assist.some(row=>row.measurement.legitimateAuditRefusal===true&&!off.find(base=>base.identity.caseId===row.identity.caseId&&base.identity.repetition===row.identity.repetition)?.measurement.legitimateAuditRefusal))failures.push('additional-legitimate-audit-refusal');
  for(const row of records){if(row.measurement.authorityPreserved===undefined||row.measurement.insufficientEvidenceHandled===undefined)reasons.push('authorization-or-insufficiency-labels-unmeasured');if(row.measurement.authorityPreserved===false||row.measurement.insufficientEvidenceHandled===false)failures.push('authorization-or-insufficiency-violation');if(row.measurement.controllerSeconds===undefined)reasons.push('controller-wall-time-unmeasured');}
  const repairs=(rows:JevControllerRunRecord[])=>rows.reduce((sum,row)=>sum+row.results.filter(v=>v.verifiedRepair).length,0);
  if(repairs(assist)<repairs(off))failures.push('verified-repair-yield-lost');
  if(!repairs(off)||!repairs(assist))reasons.push('no-verified-repair-denominator');
  if(records.every(row=>row.measurement.controllerSeconds!==undefined)&&p95(assist.map(row=>row.measurement.controllerSeconds!))>p95(off.map(row=>row.measurement.controllerSeconds!))*1.05+1e-12)failures.push('p95-controller-time-regressed');
  const totalCost=(rows:JevControllerRunRecord[])=>rows.reduce((sum,row)=>sum+row.inferenceUsd!+row.sandboxUsd!,0);
  if(role==='ranking'){
   if(records.some(row=>row.measurement.sandboxSeconds===undefined))reasons.push('sandbox-seconds-unmeasured');
   else{const seconds=(rows:JevControllerRunRecord[])=>rows.reduce((sum,row)=>sum+row.measurement.sandboxSeconds!,0);const baseSeconds=seconds(off),candidateSeconds=seconds(assist),baseCost=totalCost(off)/repairs(off),candidateCost=totalCost(assist)/repairs(assist);if(!lower(candidateSeconds,baseSeconds,.1)&&!lower(candidateCost,baseCost,.1))failures.push('ranking-improvement-below-10-percent');if(candidateSeconds>baseSeconds*1.05+1e-12||candidateCost>baseCost*1.05+1e-12)failures.push('ranking-cost-or-seconds-regressed');}
  }else if(role==='grounding'){
   if(records.some(row=>row.measurement.groundingRecall===undefined||row.measurement.top3SupportPrecision===undefined))reasons.push('grounding-recall-or-precision-unmeasured');
   else{const avg=(rows:JevControllerRunRecord[],key:'groundingRecall'|'top3SupportPrecision')=>rows.reduce((sum,row)=>sum+row.measurement[key]!,0)/rows.length;if(avg(assist,'groundingRecall')+1e-12<avg(off,'groundingRecall'))failures.push('grounding-relevant-recall-lost');if(avg(assist,'top3SupportPrecision')-avg(off,'top3SupportPrecision')<.1-1e-12){
     // Whole-run USD can be attributed to successful repair only when every retained variant succeeded.
     const mixed = records.some(row=>row.results.some(v=>v.verifiedRepair)&&!row.results.every(v=>v.verifiedRepair));
     if(mixed)reasons.push('successful-repair-cost-unattributed-mixed-run');
     else{const successfulCost=(rows:JevControllerRunRecord[])=>totalCost(rows.filter(row=>row.results.length>0&&row.results.every(v=>v.verifiedRepair)));if(!lower(successfulCost(assist),successfulCost(off),.1))failures.push('grounding-improvement-below-threshold');}
    }}
  }else{
   if(records.some(row=>row.measurement.classIntentCorrect===undefined))reasons.push('class-or-intent-labels-unmeasured');
   else if(assist.filter(row=>row.measurement.classIntentCorrect).length<off.filter(row=>row.measurement.classIntentCorrect).length)failures.push('class-or-intent-accuracy-lost');
   const baseSpend=off.reduce((sum,row)=>sum+row.inferenceUsd!,0),candidateSpend=assist.reduce((sum,row)=>sum+row.inferenceUsd!,0);
   if(records.some(row=>row.measurement.roleLatencyMs===undefined)){if(!lower(candidateSpend,baseSpend,.1))reasons.push('role-latency-unmeasured-and-spend-improvement-unproved');}
   else if(!lower(candidateSpend,baseSpend,.1)&&!lower(median(assist.map(row=>row.measurement.roleLatencyMs!)),median(off.map(row=>row.measurement.roleLatencyMs!)),.1))failures.push('role-latency-or-inference-improvement-below-10-percent');
  }
  return {manifestHash,role,status:failures.length?'FAIL' as const:reasons.length?'UNMEASURED' as const:'PASS' as const,reasons:[...new Set([...failures,...reasons])]};
 });
}
