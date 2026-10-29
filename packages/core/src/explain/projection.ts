import { validateSemanticDecisions, type SemanticDecisions } from '../decisions/evidence.js';
import { decisionHash } from '../decisions/call.js';
import { canonicalJson } from '../replay/canonical-json.js';
import { redactExternalText } from '../security/external-text.js';
import { FAILURE_TAXONOMY } from '../taxonomy.js';
import { parseVerificationEvidence } from '../verification/codec.js';
import { summarizeVerificationCosts } from '../verification/cost-summary.js';
import { parseDiagnosisRecoveryEvidence } from '../verification/recovery.js';
import { parseRuntimeCandidateEvidence } from '../verification/runtime-evidence.js';
import { parseAuditCheckMetadata, auditCheckLabel } from '../report/audit-status.js';
import type { AuditVerdict } from '../domain.js';
import { MAX_EXPLAIN_QUERY_BYTES, type EvidenceBlock, type EvidenceKind, type EvidenceProjection } from './types.js';

const SHA = /^[a-f0-9]{40}$/u, HASH = /^[a-f0-9]{64}$/u;
const KINDS = ['diagnosis','verification','search','policy','cost','recovery','assurance'];
const ACTIONS: Readonly<Record<string,string>> = Object.freeze({
  'review-verification': 'Review the recorded blocking gate and missing evidence before a new authorized verification attempt.',
  'review-recovery': 'Review the recorded recovery probes, source identity and grants before a new authorized attempt.',
  'review-repair-budget': 'Review the recorded budget limit and known or unknown charges before a new authorized attempt.',
  'review-exact-source': 'Review scoped access and the recorded exact failing source identity before a new authorized attempt.',
  'review-provider-capacity': 'Review the retained provider operation evidence and known or unknown charges with the account owner before another authorized attempt.',
});
function fail(field: string): never { throw new Error(`Invalid case evidence ${field}; select an actual stable serialized case JSON file with supported evidence fields`); }
function record(value: unknown, field: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field); return value as Record<string,unknown>; }
function text(value: unknown, field: string, max=65_536, empty=false): string { if (typeof value !== 'string' || (!empty&&!value.length) || value.length>max) fail(field); return value; }
function number(value: unknown, field: string, integer=false): number { if(typeof value!=='number'||!Number.isFinite(value)||value<0||integer&&!Number.isSafeInteger(value))fail(field);return value; }
function bool(value: unknown, field: string): boolean { if(typeof value!=='boolean')fail(field);return value; }
function list(value: unknown, field: string, max=512): unknown[] { if(!Array.isArray(value)||value.length>max)fail(field);return value; }
function id(value: unknown, field: string): string { const result=text(value,field,200);if(!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(result)||safeEvidenceText(result)!==result)fail(field);return result; }
function sha(value: unknown, field: string, size:40|64):string { const result=text(value,field,size);if(!(size===40?SHA:HASH).test(result))fail(field);return result; }
/** Redaction happens before hashing, display and outbound semantic requests. */
export function safeEvidenceText(value: string): string {
  // The shared redactor handles headers/standalone values; log prose can also carry inline assignments.
  const inline=redactExternalText(value).text.replace(
    /\b((?:[A-Z][A-Z0-9_]{0,64}(?:API_KEY|ACCESS_KEY|TOKEN|SECRET|PASSWORD)|API[_-]?KEY|ACCESS[_-]?TOKEN|CLIENT[_-]?SECRET|TOKEN|SECRET|PASSWORD)\s*[:=]\s*)(?!\[redacted(?: credential)?\]|%5Bredacted%5D)(?:"(?:[^"\\\r\n]|\\.)*"|'(?:[^'\\\r\n]|\\.)*'|[^\s,;)&"'\\\[\]{}<>]+)/giu,
    '$1[redacted]',
  );
  const redacted=inline.replace(/https?:\/\/[^\s"'<>\\\u0000-\u001f\u007f]+/giu, raw=>{
    try{const url=new URL(raw);url.username='';url.password='';for(const key of [...url.searchParams.keys()])url.searchParams.set(key,'[redacted]');url.hash='';return url.toString();}catch{return '[redacted URL]';}
  });
  return redacted.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>]/gu, char=>`\\u${char.charCodeAt(0).toString(16).padStart(4,'0')}`);
}
function blockId(identity: EvidenceProjection['identity'], locator:string, excerpt:string, kind:EvidenceKind, action?:EvidenceBlock['action']):string {
  return `evidence-${decisionHash({identity,locator,excerpt,kind,...(action===undefined?{}:{action})})}`;
}
export function validateEvidenceQuery(query: string): string {
  if(typeof query!=='string'||!query.trim()||Buffer.byteLength(query,'utf8')>MAX_EXPLAIN_QUERY_BYTES)throw new Error('Evidence query must be nonempty and at most 2048 bytes (2 KiB); choose a shorter evidence question');
  return safeEvidenceText(query.trim());
}
/** Guards exported selection APIs against forged actions or malformed projected identities. */
export function assertEvidenceProjection(value: unknown): asserts value is EvidenceProjection {
  const raw=record(value,'projection');if(Object.keys(raw).some(key=>!['schemaVersion','format','identity','blocks'].includes(key))||raw.schemaVersion!=='sutura-evidence-projection-v1'||!['case','case-lab'].includes(String(raw.format)))fail('projection.schemaVersion');
  const identity=record(raw.identity,'projection.identity');if(Object.keys(identity).some(key=>!['runId','repo','controllerSha'].includes(key)))fail('projection.identity');id(identity.runId,'runId');if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(text(identity.repo,'repo',200))||String(identity.repo).split('/').some(part=>part==='.'||part==='..')||safeEvidenceText(String(identity.repo))!==identity.repo)fail('repo');
  if(identity.controllerSha!==undefined)sha(identity.controllerSha,'controllerSha',40);
  const blocks=list(raw.blocks,'projection.blocks');const seen=new Set<string>();
  for(const item of blocks){const b=record(item,'projection.block');if(Object.keys(b).some(k=>!['id','locator','excerpt','kind','action'].includes(k))||!KINDS.includes(String(b.kind)))fail('projection.block');
    const locator=text(b.locator,'locator',300);if(!/^\$(?:\.[A-Za-z][A-Za-z0-9]*|\[(?:0|[1-9]\d*)\])*$/u.test(locator))fail('locator');
    const excerpt=text(b.excerpt,'excerpt',131_072);if(safeEvidenceText(excerpt)!==excerpt)fail('projection.excerpt');
    let action:EvidenceBlock['action'];if(b.action!==undefined){const a=record(b.action,'action');if(Object.keys(a).length!==2||typeof a.code!=='string'||!Object.hasOwn(ACTIONS,a.code)||a.text!==ACTIONS[a.code])fail('action');action={code:a.code,text:a.text as string};}
    const expected=blockId(identity as unknown as EvidenceProjection['identity'],locator,excerpt,b.kind as EvidenceKind,action);
    if(b.id!==expected||seen.has(expected))fail('projection.block.id');seen.add(expected);
  }
}

/** Reads recognized serializable observations only; arbitrary trace, commands and nextAction data are ignored. */
export function parseEvidenceCase(value: unknown): EvidenceProjection {
  const root=record(value,'root');let source=root,prefix='$',format:EvidenceProjection['format']='case';let controllerSha:string|undefined;
  if(root.schemaVersion!==undefined){if(root.schemaVersion!=='sutura-case-lab-result-v1')fail('schemaVersion');format='case-lab';prefix='$.caseFile';source=record(root.caseFile,'caseFile');const identity=record(root.identity,'identity');controllerSha=sha(identity.controllerSha,'identity.controllerSha',40);if(identity.demoSha!==undefined)sha(identity.demoSha,'identity.demoSha',40);if(root.resultHash!==undefined)sha(root.resultHash,'resultHash',64);if(root.elapsedMs!==undefined)number(root.elapsedMs,'elapsedMs');if(root.release!==undefined){const release=record(root.release,'release');if(release.actionSha!==undefined)sha(release.actionSha,'release.actionSha',40);}}
  else if(root.controllerSha!==undefined)controllerSha=sha(root.controllerSha,'controllerSha',40);
  const runId=id(source.runId,'runId'),repo=text(source.repo,'repo',200);if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo)||repo.split('/').some(part=>part==='.'||part==='..')||safeEvidenceText(repo)!==repo)fail('repo');
  if(!['fixed','refused','gave-up','infra-stop','flaky-no-patch'].includes(String(source.outcome)))fail('outcome');if(source.runtime!==undefined&&!['node','python'].includes(String(source.runtime)))fail('runtime');
  const identity:EvidenceProjection['identity']={runId,repo,...(controllerSha===undefined?{}:{controllerSha})};const blocks:EvidenceBlock[]=[];
  const add=(locator:string,kind:EvidenceKind,content:unknown,actionCode?:string)=>{const excerpt=safeEvidenceText(typeof content==='string'?content:canonicalJson(content));if(!excerpt.length)return;const action=actionCode?{code:actionCode,text:ACTIONS[actionCode]!}:undefined;const block:EvidenceBlock={id:blockId(identity,locator,excerpt,kind,action),locator,excerpt,kind,...(action===undefined?{}:{action})};if(blocks.length>=512)fail('too many evidence blocks');blocks.push(block);};
  let diagnosis:Record<string,unknown>|undefined;
  if(source.diagnosis!==undefined){diagnosis=record(source.diagnosis,'diagnosis');if(typeof diagnosis.class!=='string'||!Object.hasOwn(FAILURE_TAXONOMY,diagnosis.class))fail('diagnosis.class');if(diagnosis.confidence!==undefined&&number(diagnosis.confidence,'diagnosis.confidence')>1)fail('diagnosis.confidence');
    const excerpt=text(diagnosis.errorExcerpt,'diagnosis.errorExcerpt');text(diagnosis.failingCmd,'diagnosis.failingCmd',4096);const signals=diagnosis.signals===undefined?[]:list(diagnosis.signals,'diagnosis.signals',64).map((v,i)=>text(v,`diagnosis.signals[${i}]`,4096));
    add(`${prefix}.diagnosis.errorExcerpt`,'diagnosis',excerpt);add(`${prefix}.diagnosis`,'diagnosis',{class:diagnosis.class,...(diagnosis.confidence===undefined?{}:{confidence:diagnosis.confidence}),failingCmd:diagnosis.failingCmd,signals});
    for(const code of signals){if(code==='provider-disk-exhausted')add(`${prefix}.diagnosis.signals`,'recovery',code,'review-provider-capacity');if(code==='exact-source-unavailable')add(`${prefix}.diagnosis.signals`,'recovery',code,'review-exact-source');}
  }
  let policy:Record<string,unknown>|undefined;
  if(source.policy!==undefined){policy=record(source.policy,'policy');text(policy.baseRef,'policy.baseRef',256);const base=text(policy.baseSha,'policy.baseSha',64),policyId=text(policy.policySha,'policy.policySha',64);if(!SHA.test(base)&&!['local','unavailable'].includes(base))fail('policy.baseSha');if(!HASH.test(policyId)&&!['default','local','unavailable'].includes(policyId))fail('policy.policySha');add(`${prefix}.policy`,'policy',{baseRef:policy.baseRef,baseSha:base,policySha:policyId});}
  const rawSandboxAmounts:number[]=[];
  if(source.stages!==undefined)for(const [index,raw]of list(source.stages,'stages',128).entries()){const stage=record(raw,`stages[${index}]`);if(!['policy','preparation','reproduction','triage','candidate','search','audit'].includes(String(stage.stage)))fail('stages.stage');number(stage.attempt,'stages.attempt',true);id(stage.nodeId,'stages.nodeId');if(stage.parentNodeId!==undefined)id(stage.parentNodeId,'stages.parentNodeId');if(stage.exitCode!==undefined&&(!Number.isSafeInteger(stage.exitCode)||Math.abs(stage.exitCode as number)>2**31))fail('stages.exitCode');
    const metrics=record(stage.metrics,'stages.metrics');const selected:Record<string,number>={};for(const key of ['wallTimeSec','cost','elapsedTimeSec','maxRssKb','systemCpuTimeSec','userCpuTimeSec'])if(metrics[key]!==undefined)selected[key]=number(metrics[key],`stages.metrics.${key}`);if(selected.cost!==undefined)rawSandboxAmounts.push(selected.cost);
    if(stage.network!==undefined&&!['enabled','disabled'].includes(String(stage.network)))fail('stages.network');let processState:Record<string,unknown>|undefined;if(stage.processState!==undefined){const p=record(stage.processState,'stages.processState');if(Object.keys(p).some(k=>!['timedOut','signal'].includes(k)))fail('stages.processState');if(p.timedOut!==undefined)bool(p.timedOut,'stages.processState.timedOut');if(p.signal!==undefined)number(p.signal,'stages.processState.signal',true);processState=p;}
    if(stage.note!==undefined)text(stage.note,'stages.note',16_384);add(`${prefix}.stages[${index}]`,'verification',{stage:stage.stage,attempt:stage.attempt,nodeId:stage.nodeId,...(stage.exitCode===undefined?{}:{exitCode:stage.exitCode}),metrics:selected,...(processState===undefined?{}:{processState}),...(stage.note===undefined?{}:{note:stage.note})});
  }
  if(source.controllerWallTimeSec!==undefined)number(source.controllerWallTimeSec,'controllerWallTimeSec');
  let semantic:SemanticDecisions|undefined;
  let semanticUnknownReservationUsd:number|null=null;
  let semanticPending=false;
  if(source.semanticDecisions!==undefined){
    const knownCandidates=source.search===undefined?[]:list(source.search,'search',128).map(raw=>id(record(raw,'search.node').nodeId,'search.nodeId'));
    if(!validateSemanticDecisions(source.semanticDecisions,knownCandidates))fail('semanticDecisions');
    semantic=source.semanticDecisions;
    const knownUnknown=semantic.records.reduce((sum,row)=>sum+(row.unknownSpendUsd??0),0);
    const lowerBound=Math.max(knownUnknown,semantic.budget.reservedUsd-semantic.budget.actualUsd,0);
    const legacyUnknown=semantic.records.some(row=>row.attempts>0&&row.unknownSpendUsd===undefined);
    semanticPending=lowerBound>1e-12||legacyUnknown||semantic.records.some(row=>row.attempts>0&&(row.usage===null||row.usage===undefined));
    semanticUnknownReservationUsd=lowerBound>1e-12?lowerBound:semanticPending?null:0;
    if(semantic.configuration!==undefined)add(`${prefix}.semanticDecisions.configuration`,'assurance',semantic.configuration);
    else add(`${prefix}.semanticDecisions`,'assurance','Semantic role configuration: NOT RECORDED. Recorded calls do not establish default role modes.');
    add(`${prefix}.semanticDecisions.budget`,'cost',{...semantic.budget,unknownReservationUsd:semanticUnknownReservationUsd,pendingOrUnrecordedSpend:semanticPending},semanticPending?'review-repair-budget':undefined);
    for(const[index,row]of semantic.records.entries())add(`${prefix}.semanticDecisions.records[${index}]`,'assurance',{
      role:row.role,mode:row.mode,outcome:row.outcome,reason:row.reason,fallback:row.fallback,requestedModel:row.requestedModel,resolvedModel:row.resolvedModel??'NOT RECORDED',policyVersion:row.policyVersion,policyHash:row.policyHash,inputHash:row.inputHash,
      attempts:row.attempts,reservedUsd:row.reservedUsd,knownUsd:row.actualUsd,unknownSpendUsd:row.unknownSpendUsd??(row.attempts>0?'NOT RECORDED':0),usage:row.usage??null,latencyMs:row.latencyMs,
    },row.outcome==='uncertain'||row.outcome==='unavailable'?'review-verification':undefined);
  }else add(prefix,'assurance','Semantic decisions and role modes: NOT RECORDED. Missing metadata is unavailable, not an off-mode or zero-spend claim.');

  if(source.cost!==undefined){const cost=record(source.cost,'cost');const entries=list(cost.entries,'cost.entries',1024);let total=0;for(const [index,raw]of entries.entries()){const entry=record(raw,`cost.entries[${index}]`);if(!['nano','super','ultra'].includes(String(entry.role)))fail('cost.entries.role');text(entry.model,'cost.entries.model',256);for(const key of ['inTok','outTok','reasoningTok'])number(entry[key],`cost.entries.${key}`,true);total+=number(entry.usd,'cost.entries.usd');}if(!Number.isFinite(total))fail('cost.entries total');add(`${prefix}.cost.entries`,'cost',{coverage:'recorded ledger entries only; unknown/unrecorded charges unavailable',inferenceEstimateUsd:Number(total.toFixed(12)),inferenceTotalUsd:null,semanticMetadata:semantic?'recorded':'NOT RECORDED',semanticUnknownReservationUsd,semanticPendingOrUnrecordedSpend:semantic===undefined?true:semanticPending,sandboxUsd:'UNAVAILABLE',sandboxRawUnit:'UNAVAILABLE',sandboxRawAmounts:rawSandboxAmounts});}
  else add(prefix,'cost','Inference and sandbox cost: NOT RECORDED. Missing cost is unavailable, not zero.');
  if(source.audit!==undefined){const audit=record(source.audit,'audit');bool(audit.approved,'audit.approved');const known=new Set(['deleted-test','skipped-test','weakened-assertion','loosened-type','relaxed-config','pass-with-no-tests','module-syntax','llm-adjudication','second-opinion','typesafe-audit','policy-required-command','policy-resource-limit','paired-evidence','policy-patch']);
    for(const [index,raw]of list(audit.checks,'audit.checks',64).entries()){const check=record(raw,'audit.check');if(!known.has(String(check.name)))fail('audit.check.name');bool(check.passed,'audit.check.passed');if(check.evidence!==undefined)text(check.evidence,'audit.check.evidence',16_384);const metadata=check.metadata===undefined?undefined:parseAuditCheckMetadata(check.metadata);const row={name:check.name,passed:check.passed,...(check.evidence===undefined?{}:{evidence:check.evidence}),...(metadata===undefined?{}:{metadata})};add(`${prefix}.audit.checks[${index}]`,'verification',{...row,displayStatus:auditCheckLabel(row as AuditVerdict['checks'][number])});}}
  if(source.search!==undefined){const seen=new Set<string>();for(const [index,raw]of list(source.search,'search',128).entries()){const node=record(raw,'search.node');const nodeId=id(node.nodeId,'search.nodeId');if(seen.has(nodeId))fail('search duplicate nodeId');seen.add(nodeId);if(node.parentNodeId!==undefined)id(node.parentNodeId,'search.parentNodeId');for(const key of ['depth','changedFiles','diffBytes'])if(node[key]!==undefined)number(node[key],`search.${key}`,true);if(node.testExitCode!==undefined&&!Number.isSafeInteger(node.testExitCode))fail('search.testExitCode');if(node.policyValid!==undefined)bool(node.policyValid,'search.policyValid');if(node.terminalReason!==undefined){text(node.terminalReason,'search.terminalReason',1000);add(`${prefix}.search[${index}].terminalReason`,'search',{nodeId,terminalReason:node.terminalReason,...(node.testExitCode===undefined?{}:{testExitCode:node.testExitCode}),...(node.policyValid===undefined?{}:{policyValid:node.policyValid})});}}}
  if(source.triage!==undefined){const triage=record(source.triage,'triage');for(const key of ['reproduced','of','attemptsUsed','maximumAttempts'])if(triage[key]!==undefined)number(triage[key],`triage.${key}`,true);for(const key of ['reproductionProbability','confidenceLower','confidenceUpper'])if(triage[key]!==undefined&&number(triage[key],`triage.${key}`)>1)fail(`triage.${key}`);if(triage.stopReason!==undefined){const reason=text(triage.stopReason,'triage.stopReason',100);add(`${prefix}.triage.stopReason`,'verification',reason,reason==='sandbox-budget'?'review-repair-budget':undefined);}}
  let verification:ReturnType<typeof parseVerificationEvidence>|undefined;
  if(source.verification!==undefined){verification=parseVerificationEvidence(source.verification);if(policy&&(HASH.test(String(policy.policySha))&&policy.policySha!==verification.identity.policySha256||SHA.test(String(policy.baseSha))&&policy.baseSha!==verification.identity.policyBaseSha))fail('verification policy identity mismatch');const outcomeMap:Record<string,string>={fixed:'repaired',refused:'refused','gave-up':'insufficient','flaky-no-patch':'flaky-no-patch','infra-stop':'infra-stop'};if(verification.outcome!==outcomeMap[String(source.outcome)])fail('verification outcome mismatch');add(`${prefix}.verification.assurance`,'assurance',{assurance:verification.assurance,mode:verification.mode,challenges:verification.challenges});for(const [index,gate]of verification.gates.entries())add(`${prefix}.verification.gates[${index}]`,'verification',gate,gate.status==='passed'?undefined:'review-verification');add(`${prefix}.verification.costs`,'cost',summarizeVerificationCosts(verification.costs));}
  else add(prefix,'assurance','Versioned verification assurance: NOT RECORDED. Absent legacy evidence does not establish challenge execution.');
  if(source.verificationRuns!==undefined)for(const [index,raw]of list(source.verificationRuns,'verificationRuns',12).entries()){const run=parseRuntimeCandidateEvidence(raw);add(`${prefix}.verificationRuns[${index}]`,'assurance',{candidateId:run.candidateId,diffHash:run.diffHash,setHash:run.setHash,status:run.verification.status,blockingGate:run.verification.blockingGate,challengeMode:run.verification.challengeMode,challengeAssurance:run.verification.challengeAssurance});for(const [gateIndex,gate]of run.verification.observations.entries())add(`${prefix}.verificationRuns[${index}].verification.observations[${gateIndex}]`,'verification',gate,gate.status==='passed'?undefined:'review-verification');}
  const recoveryBinding={...(diagnosis===undefined?{}:{initialClass:diagnosis.class as string,observedCommand:diagnosis.failingCmd as string}),...(policy&&SHA.test(String(policy.baseSha))?{policyBaseSha:policy.baseSha as string}:{}),...(policy&&HASH.test(String(policy.policySha))?{policySha256:policy.policySha as string}:{}),...(verification===undefined?{}:verification.identity)};
  const rootRecovery=source.recovery===undefined?undefined:parseDiagnosisRecoveryEvidence(source.recovery,recoveryBinding);
  const nestedRecovery=verification?.recovery===undefined?undefined:parseDiagnosisRecoveryEvidence(verification.recovery,recoveryBinding);
  if(rootRecovery!==undefined&&nestedRecovery!==undefined&&canonicalJson(rootRecovery)!==canonicalJson(nestedRecovery))fail('recovery attribution disagreement');
  const recovery=rootRecovery??nestedRecovery;const recoveryLocator=rootRecovery===undefined?`${prefix}.verification.recovery`:`${prefix}.recovery`;
  if(recovery!==undefined){add(recoveryLocator,'recovery',{status:recovery.status,reason:recovery.reason,initialClass:recovery.initialClass,observedCommand:recovery.observedCommand,executedCommand:recovery.executedCommand},'review-recovery');for(const [index,hypothesis]of recovery.hypotheses.entries())add(`${recoveryLocator}.hypotheses[${index}]`,'recovery',hypothesis,'review-recovery');}
  const projection:EvidenceProjection={schemaVersion:'sutura-evidence-projection-v1',format,identity,blocks};assertEvidenceProjection(projection);return projection;
}
