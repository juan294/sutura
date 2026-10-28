import type { DecisionEvidence } from '../decisions/call.js';
import type { JsonValue, TypeSafeAuditClient, TypeSafeQuestion } from '../llm/typesafe.js';

export const MAX_EXPLAIN_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_EXPLAIN_QUERY_BYTES = 2 * 1024;
export type EvidenceKind = 'diagnosis' | 'verification' | 'search' | 'policy' | 'cost' | 'recovery' | 'assurance';
export interface EvidenceBlock {
  id: string;
  locator: string;
  /** Original recorded text/fields, with credentials redacted and controls made visible. */
  excerpt: string;
  kind: EvidenceKind;
  action?: { code: string; text: string };
}
export interface EvidenceProjection {
  schemaVersion: 'sutura-evidence-projection-v1';
  format: 'case' | 'case-lab';
  identity: { runId: string; repo: string; controllerSha?: string };
  blocks: EvidenceBlock[];
}
export interface EvidenceAnswer {
  schemaVersion: 'sutura-evidence-answer-v1';
  status: 'matched' | 'no-match' | 'unavailable' | 'invalid-input';
  mode: 'lexical' | 'semantic';
  reason: string;
  caseIdentity?: EvidenceProjection['identity'];
  results: EvidenceBlock[];
  nextAction: string;
  fallback?: 'lexical';
  decision?: DecisionEvidence;
}
export interface ExplainEvidenceOptions {
  semantic?: boolean;
  maxUsd?: number;
  client?: TypeSafeAuditClient;
}
export interface NavigatorRequest {
  state: JsonValue;
  questions: Record<string, TypeSafeQuestion>;
  candidateIds: string[];
  baselineIds: string[];
}
