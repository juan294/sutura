import { validateSemanticDecisions, type SemanticDecisions } from '../decisions/evidence.js';
/** Bounded public text, rendered with the destination's normal escaping. */
export function semanticSummary(value:SemanticDecisions|undefined):string[] {
 if(!value)return [];
 if(!validateSemanticDecisions(value))return ['Semantic judgment evidence unavailable: invalid metadata; use a valid case report.'];
 return value.records.map(r=>`${r.role}: ${r.outcome.toUpperCase()} (${r.mode}); judgment only; ${r.reason}; fallback=${r.fallback}; requested=${r.requestedModel}; resolved=${r.resolvedModel??'NOT RECORDED'}; policy=${r.policyVersion}/${r.policyHash}; input=${r.inputHash}; attempts=${r.attempts}; reserved USD ${r.reservedUsd.toFixed(6)}; known USD ${r.actualUsd.toFixed(6)}; unknown spend USD ${r.unknownSpendUsd===undefined?(r.attempts>0?'NOT RECORDED':'0'):r.unknownSpendUsd.toFixed(6)}; ${r.latencyMs}ms`);
}
