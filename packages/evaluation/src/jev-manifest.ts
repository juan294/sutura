import {createHash} from 'node:crypto';
import {TYPESAFE_PRICE,decisionHash,redactDecisionValue,type JsonValue,type TypeSafeQuestion,type DecisionRole} from '@sutura/core';
import {canonicalJson} from './manifest.js';
export const JEV_THRESHOLDS={noulTrue:.8,noulFalse:.2,choiceProbability:.8,choiceMargin:.2} as const;
export const JEV_QUESTION_VERSIONS:Record<DecisionRole,string>={ranking:'ranking-v2',grounding:'grounding-v2',classification:'classification-v1',recovery:'recovery-v2',navigator:'navigator-v2','audit-v2':'atomic-audit-v3'};
const HISTORICAL_QUESTION_VERSIONS:Partial<Record<DecisionRole,readonly string[]>>={ranking:['ranking-v1'],grounding:['grounding-v1'],recovery:['recovery-v1'],navigator:['navigator-v1'],'audit-v2':['atomic-audit-v2']};
export type JevLabel=string|boolean;
export interface JevCase {
 id:string;family:string;role:DecisionRole;split:'development'|'evaluation';category:'public'|'synthetic'|'redacted';variant:'positive'|'negative'|'uncertain'|'adversarial';
 questionVersion:string;policyHash:string;inputHash:string;state:JsonValue;questions:Record<string,TypeSafeQuestion>;candidateIds:string[];baselineIds:string[];
 labels:Record<string,JevLabel>;baselineLabels?:Record<string,JevLabel>;
 /** An existing legacy audit observation, never inferred from the v2 answers. */
 legacyDecision?:{status:'approved'|'refused'|'uncertain'|'skipped';model:string;sourceHash:string};
}
export interface JevControllerAllocation {
 cumulativeUsd:number;inferenceUsd:number;sandboxUsd:number;repairLimitsHash:string;policyHash:string;providerModels:Record<string,string>;budgetEvidenceHash:string;
}
export interface JevManifest {
 schemaVersion:'sutura-jev-evaluation-v1';controllerSha:string;corpusHash:string;model:'jev-1.14.0';policyVersion:'semantic-v1';thresholds:typeof JEV_THRESHOLDS;
 repetitions:3;maxAttempts:2;arms:Array<{id:'off'|'assist';mode:'off'|'assist'}>;cases:JevCase[];controller?:JevControllerAllocation;
}
const SHA=/^[a-f0-9]{40}$/u,HASH=/^[a-f0-9]{64}$/u;
const obj=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
function fail(field:string):never{throw new Error(`Jev manifest ${field} is invalid; regenerate the frozen manifest with exact controller, corpus, policy and redacted inputs`);}
function keys(v:Record<string,unknown>,allowed:readonly string[],field:string){if(Object.keys(v).some(k=>!allowed.includes(k)))fail(field);}
function text(v:unknown,field:string,max=128):asserts v is string{if(typeof v!=='string'||!v.length||v.length>max||/[\x00-\x1f]/u.test(v))fail(field);}
const hash=(v:unknown)=>createHash('sha256').update(canonicalJson(v)).digest('hex');
export const jevManifestHash=(v:JevManifest):string=>hash(v);
export const jevCaseInputHash=(v:Pick<JevCase,'state'|'questions'|'candidateIds'>):string=>decisionHash({state:v.state,questions:v.questions,candidateIds:v.candidateIds});
export const jevCasePolicyHash=(v:Pick<JevCase,'role'|'questions'>):string=>decisionHash({role:v.role,version:'semantic-v1',questions:v.questions,thresholds:{noul:[.2,.8],choice:[.8,.2]}});
export function jevAttemptReservation(v:JevCase):number{return Math.ceil(Buffer.byteLength(JSON.stringify({state:v.state,model:'jev-1.14.0',questions:v.questions}),'utf8')*TYPESAFE_PRICE.input)/1e6;}
function validateCase(raw:unknown):asserts raw is JevCase {
 if(!obj(raw))fail('cases');keys(raw,['id','family','role','split','category','variant','questionVersion','policyHash','inputHash','state','questions','candidateIds','baselineIds','labels','baselineLabels','legacyDecision'],'case.fields');
 for(const k of ['id','family']){text(raw[k],`case.${k}`);if(!/^[a-z0-9][a-z0-9._-]*$/u.test(raw[k] as string))fail(`case.${k}`);}
 if(!Object.hasOwn(JEV_QUESTION_VERSIONS,String(raw.role))||raw.questionVersion!==JEV_QUESTION_VERSIONS[raw.role as DecisionRole]&&!(HISTORICAL_QUESTION_VERSIONS[raw.role as DecisionRole]??[]).includes(raw.questionVersion as string))fail('case.questionVersion');
 if(!['development','evaluation'].includes(raw.split as string)||!['public','synthetic','redacted'].includes(raw.category as string)||!['positive','negative','uncertain','adversarial'].includes(raw.variant as string))fail('case.split/category/variant');
 for(const field of ['candidateIds','baselineIds'])if(!Array.isArray(raw[field])||(raw[field] as unknown[]).length>32||!(raw[field] as unknown[]).every(v=>typeof v==='string'&&v.length>0&&v.length<=200)||new Set(raw[field] as unknown[]).size!==(raw[field] as unknown[]).length)fail(`case.${field}`);
 if(!(raw.baselineIds as string[]).every(id=>(raw.candidateIds as string[]).includes(id)))fail('case.baselineIds');
 if(!obj(raw.questions)||!Object.keys(raw.questions).length||Object.keys(raw.questions).length>256)fail('case.questions');
 for(const [id,q] of Object.entries(raw.questions)){
  text(id,'question.id');if(!obj(q)||!['choice','noul'].includes(q.type as string))fail(`questions.${id}`);
  keys(q,['type','instructions','criteria'],`questions.${id}`);
  const wording=(value:unknown)=>value===null||typeof value==='string'||Array.isArray(value)||obj(value);
  if(!Object.hasOwn(q,'instructions')||!wording(q.instructions))fail(`questions.${id}.instructions`);
  if(q.type==='noul'&&q.criteria!==undefined&&( !obj(q.criteria)||Object.keys(q.criteria).some(k=>!['true','false'].includes(k))||!Object.values(q.criteria).every(wording)))fail(`questions.${id}.criteria`);
  if(q.type==='choice'&&obj(q.criteria)&&!Object.values(q.criteria).every(wording))fail(`questions.${id}.criteria`);
  if(q.type==='choice'&&(!obj(q.criteria)||!Object.keys(q.criteria).length||Object.keys(q.criteria).length>255))fail(`questions.${id}.criteria`);
 }
 const encoded=JSON.stringify({state:raw.state,questions:raw.questions});if(!encoded||Buffer.byteLength(encoded,'utf8')>24*1024)fail('case state/questions exceeds 24 KiB');
 const redacted=redactDecisionValue({state:raw.state,questions:raw.questions} as JsonValue);
 if(JSON.stringify(redacted)!==encoded)fail('case must redact credentials before authorization');
 const finite=(v:unknown):boolean=>typeof v==='number'?Number.isFinite(v):Array.isArray(v)?v.every(finite):obj(v)?Object.values(v).every(finite):v===null||typeof v==='string'||typeof v==='boolean';
 if(!finite(raw.state)||!finite(raw.questions))fail('case JSON values');
 for(const field of ['labels','baselineLabels']){
  if(field==='baselineLabels'&&raw[field]===undefined)continue;
  if(!obj(raw[field])||!Object.keys(raw[field]).length)fail(`case.${field}`);
  for(const [id,label] of Object.entries(raw[field] as object)){
   const question=raw.questions[id];if(!obj(question))fail(`case.${field}.${id}`);
   if(label==='uncertain')continue;
   if(question.type==='noul'?typeof label!=='boolean':typeof label!=='string'||!obj(question.criteria)||!Object.hasOwn(question.criteria,label))fail(`case.${field}.${id}`);
  }
 }
 const expected=raw.labels as Record<string,JevLabel>;
 const conditional = raw.role==='navigator' && Object.entries(raw.questions).some(([id,q])=>obj(q)&&q.type==='noul'&&['applies','applicable'].includes(id)&&(expected[id]===false||expected[id]==='uncertain'));
 for(const [id,q] of Object.entries(raw.questions)){
  if(!Object.hasOwn(expected,id)&&!(conditional&&obj(q)&&q.type==='choice'))fail(`case.labels.${id}`);
  if(raw.baselineLabels!==undefined&&Object.hasOwn(expected,id)&&!Object.hasOwn(raw.baselineLabels as object,id))fail(`case.baselineLabels.${id}`);
 }
 if(raw.legacyDecision!==undefined){const d=raw.legacyDecision;if(!obj(d)||!['approved','refused','uncertain','skipped'].includes(d.status as string)||typeof d.model!=='string'||typeof d.sourceHash!=='string'||!HASH.test(d.sourceHash))fail('case.legacyDecision');keys(d,['status','model','sourceHash'],'case.legacyDecision');}
 if(raw.inputHash!==jevCaseInputHash(raw as unknown as JevCase))fail('case.inputHash');
 if(raw.policyHash!==jevCasePolicyHash(raw as unknown as JevCase))fail('case.policyHash');
}
export function validateJevManifest(raw:unknown,controllerSha?:string):JevManifest {
 if(!obj(raw))fail('object');keys(raw,['schemaVersion','controllerSha','corpusHash','model','policyVersion','thresholds','repetitions','maxAttempts','arms','cases','controller'],'fields');
 if(raw.schemaVersion!=='sutura-jev-evaluation-v1'||typeof raw.controllerSha!=='string'||!SHA.test(raw.controllerSha)||controllerSha!==undefined&&raw.controllerSha!==controllerSha)fail('controllerSha/schemaVersion');
 if(raw.model!=='jev-1.14.0'||raw.policyVersion!=='semantic-v1'||canonicalJson(raw.thresholds)!==canonicalJson(JEV_THRESHOLDS)||raw.repetitions!==3||raw.maxAttempts!==2||canonicalJson(raw.arms)!==canonicalJson([{id:'off',mode:'off'},{id:'assist',mode:'assist'}]))fail('model/policy/thresholds/repetitions/arms');
 if(!Array.isArray(raw.cases)||!raw.cases.length||raw.cases.length>512)fail('cases');
 const ids=new Set<string>(),families=new Map<string,string>();
 for(const entry of raw.cases){validateCase(entry);if(ids.has(entry.id))fail('duplicate case id');ids.add(entry.id);if(families.has(entry.family)&&families.get(entry.family)!==entry.split)fail('family split leakage');families.set(entry.family,entry.split);}
 if(raw.corpusHash!==hash(raw.cases))fail('corpusHash');
 if(raw.controller!==undefined){const c=raw.controller;if(!obj(c))fail('controller');keys(c,['cumulativeUsd','inferenceUsd','sandboxUsd','repairLimitsHash','policyHash','providerModels','budgetEvidenceHash'],'controller');for(const k of ['cumulativeUsd','inferenceUsd','sandboxUsd'])if(typeof c[k]!=='number'||!Number.isFinite(c[k])||(c[k] as number)<=0)fail(`controller.${k}`);for(const k of ['repairLimitsHash','policyHash','budgetEvidenceHash'])if(typeof c[k]!=='string'||!HASH.test(c[k] as string))fail(`controller.${k}`);if(!obj(c.providerModels)||!Object.keys(c.providerModels).length||!Object.values(c.providerModels).every(v=>typeof v==='string'&&v.length>0&&v.length<=200))fail('controller.providerModels');}
 return structuredClone(raw) as unknown as JevManifest;
}
/** Creation freezes supplied public/redacted cases; it never fills labels or budget authority. */
export function createJevManifest(input:unknown):JevManifest {
 if(!obj(input)||!Array.isArray(input.cases))fail('input');
 const cases=input.cases.map(v=>{if(!obj(v))fail('case');return {...v,inputHash:jevCaseInputHash(v as unknown as JevCase),policyHash:jevCasePolicyHash(v as unknown as JevCase)};});
 return validateJevManifest({schemaVersion:'sutura-jev-evaluation-v1',controllerSha:input.controllerSha,model:'jev-1.14.0',policyVersion:'semantic-v1',thresholds:JEV_THRESHOLDS,repetitions:3,maxAttempts:2,arms:[{id:'off',mode:'off'},{id:'assist',mode:'assist'}],cases,corpusHash:hash(cases),...(input.controller===undefined?{}:{controller:input.controller})});
}
