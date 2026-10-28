import { semanticConfig, type SemanticConfig } from './config.js';
import type { DecisionEvidence } from './call.js';
export interface SemanticDecisions { configuration?:SemanticConfig; schemaVersion:'sutura-semantic-decisions-v1'; records:DecisionEvidence[]; budget:{maxUsd:number;attempts:number;reservedUsd:number;actualUsd:number} }
const HASH=/^[a-f0-9]{64}$/u;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const bounded=(v:unknown,max=160):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f]/u.test(v);
const ids=(v:unknown):v is string[]=>Array.isArray(v)&&v.length<=32&&v.every(x=>bounded(x,200))&&new Set(v).size===v.length;
const amount=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
/** Validation at serialization boundaries; metadata cannot confer controller authority. */
export function validateSemanticDecisions(value:unknown,candidateIds?:readonly string[]):value is SemanticDecisions {
 if(!record(value)||Object.keys(value).some(k=>!['schemaVersion','configuration','records','budget'].includes(k))||value.schemaVersion!=='sutura-semantic-decisions-v1'||!Array.isArray(value.records)||value.records.length>100||!record(value.budget))return false;
 const b=value.budget;if(Object.keys(b).some(k=>!['maxUsd','attempts','reservedUsd','actualUsd'].includes(k))||!amount(b.maxUsd)||b.maxUsd>.02||!Number.isInteger(b.attempts)||!amount(b.attempts)||b.attempts>8||!amount(b.reservedUsd)||!amount(b.actualUsd))return false;
 let config:SemanticConfig|undefined;
 if(value.configuration!==undefined){
  const raw=value.configuration;
  if(!record(raw)||Object.keys(raw).length!==5||!['schemaVersion','model','policyVersion','modes','maxUsd'].every(k=>Object.hasOwn(raw,k))||raw.schemaVersion!=='sutura-semantic-config-v1'||raw.model!=='jev-1.14.0'||raw.policyVersion!=='semantic-v1'||!record(raw.modes)||Object.keys(raw.modes).length!==4||!['ranking','grounding','classification','recovery'].every(k=>Object.hasOwn(raw.modes as object,k)))return false;
  try{config=semanticConfig(raw,true);if(config.maxUsd!==b.maxUsd)return false;}catch{return false;}
 }
 return value.records.every(v=>{
  if(!record(v)||Object.keys(v).some(k=>!['role','mode','outcome','policyVersion','policyHash','inputHash','requestedModel','resolvedModel','usage','unknownSpendUsd','attempts','reservedUsd','actualUsd','latencyMs','reason','fallback','candidateIds','baseline','suggested','answers'].includes(k))||!['ranking','grounding','classification','recovery','navigator','audit-v2'].includes(v.role as string)||!['off','shadow','assist'].includes(v.mode as string)||!['answered','uncertain','unavailable','disabled'].includes(v.outcome as string))return false;
  if(!bounded(v.policyVersion)||!bounded(v.requestedModel)||v.resolvedModel!==undefined&&!bounded(v.resolvedModel)||typeof v.policyHash!=='string'||!HASH.test(v.policyHash)||typeof v.inputHash!=='string'||!HASH.test(v.inputHash)||!bounded(v.reason)||!bounded(v.fallback))return false;
  if(config!==undefined&&['ranking','grounding','classification','recovery'].includes(v.role as string)){if(v.mode!==config.modes[v.role as keyof SemanticConfig['modes']]||v.requestedModel!==config.model||v.policyVersion!==config.policyVersion)return false;}
  if(!Number.isInteger(v.attempts)||!amount(v.attempts)||v.attempts>2||![v.actualUsd,v.reservedUsd,v.latencyMs].every(amount)||!ids(v.candidateIds)||!ids(v.baseline)||!v.baseline.every(x=>(v.candidateIds as string[]).includes(x)))return false;
  if(v.suggested!==undefined&&(!ids(v.suggested)||!v.suggested.every(x=>(v.candidateIds as string[]).includes(x))))return false;
  if(v.role==='ranking'&&candidateIds!==undefined&&!v.candidateIds.every(x=>candidateIds.includes(x)))return false;
  if(v.unknownSpendUsd!==undefined&&(!amount(v.unknownSpendUsd)||v.unknownSpendUsd>(v.reservedUsd as number)+1e-12))return false;
  if(v.usage!==null && v.usage!==undefined){if(!record(v.usage)||Object.keys(v.usage).some(k=>!['inTok','outTok','reasoningTok'].includes(k))||!['inTok','outTok','reasoningTok'].every(k=>Number.isSafeInteger(v.usage && (v.usage as Record<string,unknown>)[k])&&amount((v.usage as Record<string,unknown>)[k])))return false;}
  if(v.answers!==undefined){
   if(!record(v.answers)||Object.keys(v.answers).length>256)return false;
   for(const a of Object.values(v.answers)){
    if(!record(a)||Object.keys(a).some(k=>!(a.type==='noul'?['type','noul']:['type','choice','confidence','probabilities']).includes(k)))return false;
    if(a.type==='noul'){if(!amount(a.noul)||a.noul>1)return false;}
    else if(a.type==='choice'){
     if(!bounded(a.choice,200)||!amount(a.confidence)||a.confidence>1||!record(a.probabilities))return false;
     const probabilities=Object.values(a.probabilities);if(probabilities.length>255||!probabilities.every(p=>amount(p)&&p<=1)||Math.abs((probabilities as number[]).reduce((x,y)=>x+y,0)-1)>1e-6||!Object.hasOwn(a.probabilities,a.choice))return false;
    }else return false;
   }
  }
  return true;
 });
}
