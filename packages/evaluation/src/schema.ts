import type { CaseFile, TraceEvent } from '@sutura/core';

export const EVALUATION_SCHEMA_VERSION = 'sutura-evaluation-v1' as const;
export const ATIF_SCHEMA_VERSION = 'ATIF-v1.7' as const;

export interface EvaluationCase {
  caseId: string;
  outcome: CaseFile['outcome'];
  trace: TraceEvent[];
}

export interface EvaluationManifest {
  schemaVersion: typeof EVALUATION_SCHEMA_VERSION;
  evaluationId: string;
  suturaCommit: string;
  corpusName: string;
  corpusVersion: string;
  corpusHash: string;
  adapterVersion: string;
  modelCatalogSnapshot: string[];
  routingProfile: string;
  budgetProfile: string;
  cases: EvaluationCase[];
  startedAt: string;
  completedAt: string;
  resultHash: string;
}

export interface AtifToolCall {
  tool_call_id: string;
  function_name: string;
  arguments: Record<string, unknown>;
  extra?: { sutura: { child_node_id: string } };
}

export interface AtifObservationResult {
  source_call_id?: string;
  content: string;
  extra?: { sutura: { child_node_id: string } };
}

export interface AtifStep {
  step_id: number;
  timestamp: string;
  source: 'system' | 'user' | 'agent';
  message: string;
  model_name?: string;
  tool_calls?: AtifToolCall[];
  observation?: { results: AtifObservationResult[] };
  metrics?: {
    prompt_tokens: number;
    completion_tokens: number;
    cost_usd: number;
    extra: { reasoning_tokens: number; latency_ms: number; request_id: string | null };
  };
  llm_call_count?: number;
  extra?: Record<string, unknown>;
}

export interface AtifTrajectory {
  schema_version: typeof ATIF_SCHEMA_VERSION;
  session_id: string;
  trajectory_id: string;
  agent: {
    name: 'Sutura';
    version: string;
    model_name?: string;
  };
  steps: AtifStep[];
  notes: string;
  extra: {
    evaluation_id: string;
    case_id: string;
    outcome: CaseFile['outcome'];
  };
}

export interface AtifCaseExport {
  caseId: string;
  trajectory: AtifTrajectory;
}
