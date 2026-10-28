import { createHash } from 'node:crypto';
import { redactExternalText } from '../security/external-text.js';
import { TYPESAFE_PRICE, TypeSafeApiError, type TypeSafeAnswer, type TypeSafeAuditClient, type TypeSafeQuestion, type JsonValue, type TypeSafeDecision } from '../llm/typesafe.js';
import { SEMANTIC_MODEL, SEMANTIC_POLICY, type SemanticConfig, type DecisionRole, type DecisionMode, type SemanticRole } from './config.js';
export const decisionHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface DecisionEvidence {
  role: DecisionRole; mode: DecisionMode; outcome: 'answered'|'uncertain'|'unavailable'|'disabled';
  policyVersion: string; policyHash: string; inputHash: string; requestedModel: string; resolvedModel?: string;
  usage: TypeSafeDecision['usage'] | null;
  /** Retained reservation for attempts whose actual charge remains unknown. */
  unknownSpendUsd?: number;
  attempts: number; reservedUsd: number; actualUsd: number; latencyMs: number; reason: string; fallback: string;
  candidateIds: string[]; baseline: string[]; suggested?: string[];
  answers?: Record<string, TypeSafeAnswer>;
}
export interface ShadowInput {
 schemaVersion:'sutura-semantic-shadow-v1'; role:DecisionRole; policyVersion:string; policyHash:string; inputHash:string;
 requestedModel:string; state:JsonValue; questions:Record<string,TypeSafeQuestion>; candidateIds:string[]; baseline:string[];
}
export interface SemanticPort { config:SemanticConfig; client?:TypeSafeAuditClient; capture?(input:ShadowInput):Promise<void>|void }
export interface DecisionSessionOptions extends SemanticPort { deadline:number; now?:()=>number; remainingMs?:()=>number }
export type DecisionInputIssue = 'missing-evidence' | 'invalid-candidates';
export function noul(answer: TypeSafeAnswer | undefined): boolean | undefined {
 if(answer?.type!=='noul'||!Number.isFinite(answer.noul)||answer.noul<0||answer.noul>1)return undefined;
 return answer.noul>=.8?true:answer.noul<=.2?false:undefined;
}
export function choice(answer: TypeSafeAnswer | undefined): string | undefined {
 if(answer?.type!=='choice')return undefined;
 const sorted=Object.entries(answer.probabilities).sort((a,b)=>b[1]-a[1]);
 return sorted[0]?.[0]===answer.choice && sorted[0][1]>=.8 && sorted[0][1]-(sorted[1]?.[1]??0)>=.2-1e-12 ? answer.choice:undefined;
}
export function validateAnswers(decision:TypeSafeDecision, questions:Record<string,TypeSafeQuestion>):boolean {
 const same=(a:string[],b:string[])=>a.length===b.length&&a.every(k=>b.includes(k));
 if(!same(Object.keys(decision.answers),Object.keys(questions)))return false;
 const probability=(v:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1;
 return Object.entries(questions).every(([id,q])=>{
  const a=decision.answers[id];if(a?.type!==q.type)return false;
  if(a.type==='noul')return probability(a.noul);
  if(q.type!=='choice'||!same(Object.keys(a.probabilities),Object.keys(q.criteria))||!Object.hasOwn(q.criteria,a.choice)||!probability(a.confidence))return false;
  const values=Object.values(a.probabilities);
  return values.every(probability)&&Math.abs(values.reduce((x,y)=>x+y,0)-1)<=1e-6&&a.probabilities[a.choice]===Math.max(...values);
 });
}
/** Redact values before serialization so a credential replacement cannot corrupt JSON. */
export function redactDecisionValue(value:JsonValue):JsonValue {
 if(typeof value==='string')return redactExternalText(value).text;
 if(Array.isArray(value))return value.map(redactDecisionValue);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/^(?:api[_-]?key|access[_-]?token|client[_-]?secret|token|secret|password)$/iu.test(key)?'[redacted credential]':redactDecisionValue(item)]));
 return value;
}
export class DecisionSession {
 readonly records:DecisionEvidence[]=[];
 private attempts=0;private reservedUsd=0;private actualUsd=0;
 private readonly now:()=>number;
 constructor(readonly options:DecisionSessionOptions){this.now=options.now??Date.now;}
 snapshot(){return {maxUsd:this.options.config.maxUsd,attempts:this.attempts,reservedUsd:this.reservedUsd,actualUsd:this.actualUsd};}
 async judge(role:DecisionRole,state:JsonValue,questions:Record<string,TypeSafeQuestion>,fallback:string,candidateIds:string[]=[],baseline:string[]=candidateIds,inputIssue?:DecisionInputIssue):Promise<DecisionEvidence>{
  const started=this.now();const mode=role==='navigator'||role==='audit-v2'?'assist':this.options.config.modes[role as SemanticRole];
  // Redact before hashing/capture/transmission; no raw state enters public evidence.
  let safeState:JsonValue = null;
  let invalidInput:string|undefined;
  try {
    const raw=JSON.stringify({state,questions});
    if(Buffer.byteLength(raw,'utf8')>24*1024) invalidInput='input-too-large';
    else {
      safeState=redactDecisionValue(state);
      questions=redactDecisionValue(questions as unknown as JsonValue) as unknown as Record<string,TypeSafeQuestion>;
    }
  } catch { invalidInput='invalid-input'; }
  const policyHash=decisionHash({role,version:SEMANTIC_POLICY,questions,thresholds:{noul:[.2,.8],choice:[.8,.2]}});
  const inputHash=decisionHash({state:safeState,questions,candidateIds});
  const evidence:DecisionEvidence={role,mode,outcome:'unavailable',policyVersion:SEMANTIC_POLICY,policyHash,inputHash,requestedModel:SEMANTIC_MODEL,usage:null,unknownSpendUsd:0,attempts:0,reservedUsd:0,actualUsd:0,latencyMs:0,reason:'provider-unavailable',fallback,candidateIds:[...candidateIds],baseline:[...baseline]};
  const finish=(outcome:DecisionEvidence['outcome'],reason:string)=>{evidence.outcome=outcome;evidence.reason=reason;evidence.latencyMs=Math.max(0,this.now()-started);if(this.records.length<100)this.records.push(evidence);return evidence;};
  if(mode==='off')return finish('disabled','role-off');
  if(invalidInput)return finish('unavailable',invalidInput);
  if(inputIssue!==undefined)return finish('unavailable',inputIssue);
  const serialized=JSON.stringify({state:safeState,questions});const bytes=Buffer.byteLength(serialized,'utf8');
  if(bytes>24*1024)return finish('unavailable','input-too-large');
  if(candidateIds.length>32||new Set(candidateIds).size!==candidateIds.length||Object.values(questions).some(q=>q.type==='choice'&&(Object.keys(q.criteria).length<1||Object.keys(q.criteria).length>255)))return finish('unavailable','invalid-candidates');
  const availableDeadline=()=>{
   if(!this.options.remainingMs)return this.options.deadline;
   const checkedAt=this.now();const remaining=this.options.remainingMs();
   return Number.isFinite(remaining)&&remaining>=0?Math.min(this.options.deadline,checkedAt+remaining):checkedAt;
  };
  if(mode==='shadow'){
   if(!this.options.capture)return finish('unavailable','shadow-capture-unavailable');
   let timer:ReturnType<typeof setTimeout>|undefined;
   const remaining=Math.min(100,availableDeadline()-this.now());
   if(remaining<=0)return finish('unavailable','deadline');
   try {
    await Promise.race([this.options.capture({schemaVersion:'sutura-semantic-shadow-v1',role,policyVersion:SEMANTIC_POLICY,policyHash,inputHash,requestedModel:SEMANTIC_MODEL,state:safeState,questions,candidateIds,baseline}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('capture-timeout')),remaining);})]);
    return finish('disabled','shadow-captured');
   }catch{return finish('unavailable','shadow-capture-failed');}
   finally{if(timer!==undefined)clearTimeout(timer);}
  }
  if(!this.options.client)return finish('unavailable','key-unavailable');
  let deadline=Math.min(this.options.deadline,started+5000);
  const reservation=Math.ceil(Buffer.byteLength(JSON.stringify({state:safeState,model:SEMANTIC_MODEL,questions}),'utf8')*TYPESAFE_PRICE.input)/1e6;
  for(let attempt=0;attempt<2;attempt++){
   deadline=Math.min(deadline,availableDeadline());
   if(this.now()>=deadline)return finish('unavailable','deadline');
   if(this.attempts>=8||this.reservedUsd+reservation>this.options.config.maxUsd)return finish('unavailable','semantic-cap');
   this.attempts++;this.reservedUsd+=reservation;evidence.attempts++;evidence.reservedUsd+=reservation;evidence.unknownSpendUsd=(evidence.unknownSpendUsd??0)+reservation;
   const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
   try{
    const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new Error('semantic-timeout'));},Math.max(0,deadline-this.now()));});
    const decision=await Promise.race([this.options.client.decide(safeState,questions,{signal:abort.signal,singleAttempt:true}),timeout]);
    if(this.now()>=deadline)return finish('unavailable','timeout');
    if(!Number.isFinite(decision.usd)||decision.usd<0||!Number.isFinite(decision.usage.inTok)||decision.usage.inTok<0)return finish('unavailable','invalid-provider-result');
    this.reservedUsd+=Math.max(0,decision.usd)-reservation;this.actualUsd+=decision.usd;evidence.actualUsd+=decision.usd;evidence.unknownSpendUsd=Math.max(0,(evidence.unknownSpendUsd??0)-reservation);
    evidence.resolvedModel=decision.model; evidence.usage=decision.usage;
    if(decision.model!==SEMANTIC_MODEL)return finish('unavailable','model-mismatch');
    if(!validateAnswers(decision,questions))return finish('unavailable','invalid-provider-result');
    evidence.answers=decision.answers;
    if(Object.values(decision.answers).some(a=>a.type==='noul'?noul(a)===undefined:choice(a)===undefined))return finish('uncertain','uncertain-answer');
    return finish('answered','usable');
   }catch(error){
    if(abort.signal.aborted)return finish('unavailable','timeout');
    if(role!=='navigator'&&attempt===0&&error instanceof TypeSafeApiError&&error.status!==undefined&&(error.status===429||error.status>=500))continue;
    return finish('unavailable','provider-unavailable');
   }finally{if(timer!==undefined)clearTimeout(timer);}
  }
  return finish('unavailable','provider-unavailable');
 }
}
