export type FailureClass =
  | 'typecheck'
  | 'lint'
  | 'build'
  | 'test-assertion'
  | 'test-bug'
  | 'flaky-timing'
  | 'dep-upstream-breaking'
  | 'env-config'
  | 'infra';

export interface Grounding {
  query: string;
  citations: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
  skipped: boolean;
  reason?: 'disabled' | 'not-applicable';
}

export interface Diagnosis {
  class: FailureClass;
  confidence: number;
  signals: string[];
  failingCmd: string;
  errorExcerpt: string;
  grounding?: Grounding;
}

export interface TriageVerdict {
  status: 'real' | 'flaky' | 'intermittent';
  reproduced: number;
  of: number;
}

export interface Candidate {
  id: string;
  rationale: string;
  diff: string;
}

export interface RaceResult {
  candidate: Candidate;
  imageId: string;
  exitCode: number;
  held: boolean;
}

export type GreenwashCheck =
  | 'deleted-test'
  | 'skipped-test'
  | 'weakened-assertion'
  | 'loosened-type'
  | 'relaxed-config'
  | 'pass-with-no-tests'
  | 'llm-adjudication';

export interface AuditVerdict {
  approved: boolean;
  checks: Array<{
    name: GreenwashCheck;
    passed: boolean;
    evidence?: string;
  }>;
  reasoning: string;
}

export interface CostLedger {
  entries: Array<{
    model: string;
    inTok: number;
    outTok: number;
    reasoningTok: number;
    usd: number;
  }>;
  totalUsd(): number;
}

export interface CaseFile {
  runId: string;
  repo: string;
  diagnosis: Diagnosis;
  triage: TriageVerdict;
  race: RaceResult[];
  audit?: AuditVerdict;
  outcome: 'fixed' | 'flaky-no-patch' | 'refused' | 'gave-up';
  cost: CostLedger;
}
