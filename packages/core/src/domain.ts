import type { SemanticDecisions } from './decisions/evidence.js';
import type { RuntimeCandidateEvidence } from './verification/runtime-evidence.js';
import type { ChallengePreparationDiagnostics } from './challenges/runtime.js';
import type { CounterfactualEvidence } from './counterfactual/types.js';
import type { ProcessState, RunMetrics } from './executor/types.js';
import type { TraceEvent } from './trace/types.js';
import type { VerificationArtifact, VerificationEvidence } from './verification/types.js';
import type { DiagnosisRecoveryEvidence } from './diagnose/hypotheses.js';
import type { FailureIdentityEvidence } from './engine/failure-identity.js';

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
  status: 'real' | 'flaky' | 'intermittent' | 'not-run';
  reproduced: number;
  of: number;
  attemptsUsed: number;
  maximumAttempts: number;
  reproductionProbability: number;
  confidenceLower: number;
  confidenceUpper: number;
  /** `sandbox-budget`: triage stopped before its next batch would exceed the sandbox budget (status `not-run`). */
  stopReason: 'failure-boundary' | 'pass-boundary' | 'maximum-attempts' | 'not-run' | 'sandbox-budget' | 'failure-identity';
  methodVersion: 'sprt-p20-p80-a05-b05-v1';
  reproduction?: FailureIdentityEvidence;
}

export interface Candidate {
  id: string;
  rationale: string;
  diff: string;
}

export type RepairFailureKind =
  | 'provider'
  | 'completion-limit'
  | 'sandbox'
  | 'policy'
  | 'budget'
  | 'invalid';

export interface RaceResult {
  candidate: Candidate;
  imageId: string;
  nodeId: string;
  exitCode: number;
  processState?: ProcessState;
  held: boolean;
  note?: string;
}

export type GreenwashCheck =
  | 'deleted-test'
  | 'skipped-test'
  | 'weakened-assertion'
  | 'loosened-type'
  | 'relaxed-config'
  | 'pass-with-no-tests'
  | 'module-syntax'
  | 'llm-adjudication'
  | 'second-opinion'
  | 'typesafe-audit'
  | 'policy-required-command'
  | 'policy-resource-limit'
  | 'paired-evidence'
  | 'policy-patch';

/** Optional presentation evidence; authority remains in approved/passed. */
export interface AuditCheckMetadata {
  status: 'approved' | 'refused' | 'uncertain' | 'skipped';
  requestedModel: string;
  resolvedModel?: string;
  policyVersion: string;
  policyHash: string;
}

export interface AuditVerdict {
  approved: boolean;
  checks: Array<{
    name: GreenwashCheck;
    passed: boolean;
    evidence?: string;
    metadata?: AuditCheckMetadata;
  }>;
  reasoning: string;
}

export interface CostLedger {
  entries: Array<{
    role: 'nano' | 'super' | 'ultra';
    model: string;
    inTok: number;
    outTok: number;
    reasoningTok: number;
    usd: number;
  }>;
  totalUsd(): number;
}

export type StageName =
  | 'policy'
  | 'preparation'
  | 'reproduction'
  | 'triage'
  | 'candidate'
  | 'search'
  | 'audit';

export interface StageEvidence {
  stage: StageName;
  attempt: number;
  nodeId: string;
  parentNodeId?: string;
  exitCode?: number;
  processState?: ProcessState;
  metrics: RunMetrics;
  network: 'disabled' | 'enabled';
  note?: string;
  operationId?: string;
  operationTerminal?: 'succeeded' | 'failed' | 'cancelled';
  cancellationRequested?: boolean;
}

export interface SearchEvidence {
  nodeId: string;
  parentNodeId?: string;
  depth: number;
  errorFingerprint: string;
  transcriptReference: string;
  terminalReason?: string;
  testExitCode: number;
  policyValid: boolean;
  changedFiles: number;
  diffBytes: number;
}

export interface PolicyEvidence {
  baseRef: string;
  baseSha: string;
  policySha: string;
}

export interface CaseFile {
  semanticDecisions?: SemanticDecisions;
  /** Actual controller case clock, including preparation and drain; never summed operation durations. */
  controllerWallTimeSec?: number;
  runId: string;
  repo: string;
  runtime: 'node' | 'python';
  diagnosis: Diagnosis;
  triage: TriageVerdict;
  /** Absent historical records have no measured original-failure identity. */
  reproduction?: FailureIdentityEvidence;
  race: RaceResult[];
  audit?: AuditVerdict;
  selectedCandidate?: {
    id: string;
    diffHash: string;
  };
  outcome: 'fixed' | 'flaky-no-patch' | 'refused' | 'gave-up' | 'infra-stop';
  cost: CostLedger;
  policy: PolicyEvidence;
  stages: StageEvidence[];
  search?: SearchEvidence[];
  counterfactual?: CounterfactualEvidence;
  trace?: TraceEvent[];
  /** Absent on legacy records; absence never establishes challenge assurance. */
  verification?: VerificationEvidence;
  verificationArtifact?: VerificationArtifact;
  verificationRuns?: RuntimeCandidateEvidence[];
  /** Bounded controller reason codes and counts, without generated probe text or inputs. */
  challengePreparation?: ChallengePreparationDiagnostics;
  /** Public observations only; serialized recovery evidence cannot create edit grants. */
  recovery?: DiagnosisRecoveryEvidence;
}

export interface AuditFile {
  assurance: 'reduced';
  outcome: 'audit-approved' | 'audit-refused';
  diagnosis: {
    before: Diagnosis;
    after: Diagnosis;
  };
  policy: PolicyEvidence;
  audit: AuditVerdict;
  cost: CostLedger;
}
