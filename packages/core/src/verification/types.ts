export const VERIFICATION_EVIDENCE_VERSION = 'sutura-verification-evidence-v1' as const;
export const VERIFICATION_COST_VERSION = 'sutura-verification-cost-v1' as const;
export const VERIFICATION_GATES = ['policy', 'visible', 'audit', 'challenges', 'reproduction', 'repository-policy', 'mechanical', 'adjudication', 'resources', 'counterfactual'] as const;
export const VERIFICATION_STATUSES = ['passed', 'failed', 'insufficient', 'not-run', 'infra-stop'] as const;
export const VERIFICATION_REASONS = ['not-executed', 'missing-contract', 'unsupported-contract', 'invalid-probe', 'assertion-failed', 'command-failed', 'policy-denied', 'audit-refused', 'budget-exhausted', 'provider-error', 'protocol-error', 'identity-mismatch', 'flaky', 'no-candidate', 'resource-limit'] as const;

export type VerificationGateStatus = typeof VERIFICATION_STATUSES[number];
export type VerificationOutcome = 'repaired' | 'verified-supplied-patch' | 'refused' | 'flaky-no-patch' | 'insufficient' | 'infra-stop';
export type VerificationAssurance = 'contract-verified' | 'baseline-only';
export type VerificationMode = 'live' | 'replay' | 'recorded' | 'local';

/** Artifact references identify executed observations; they never carry hidden assertions. */
export interface VerificationGateObservation {
  gate: typeof VERIFICATION_GATES[number];
  status: VerificationGateStatus;
  reasons: Array<typeof VERIFICATION_REASONS[number]>;
  artifacts: Array<{ id: string; sha256: string }>;
}

export interface VerificationIdentity {
  sourceSha: string;
  /** Unavailable only for nonaccepted terminal results; never fabricate execution identity. */
  snapshotSha256: string | null;
  policyBaseSha: string;
  policySha256: string;
  diffSha256: string | null;
  corpusRevision: string | null;
  fixtureRevision: string | null;
  imageDigest: string | null;
  routingVersion: string;
  challengeVersion: string;
}

export interface VerificationModel {
  purpose: 'diagnosis' | 'repair' | 'challenge-generation' | 'adjudication' | 'terminal-evidence';
  tier: 'nano' | 'super' | 'ultra';
  requestedModel: string;
  returnedModel: string | null;
}

export interface VerificationCosts {
  schemaVersion: typeof VERIFICATION_COST_VERSION;
  /** Null means usage is unavailable; [] means no inference was used. */
  inference: Array<{
    modelIndex: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    estimateUsd: number | null;
    price: {
      inputPerMillionUsd: number;
      outputPerMillionUsd: number;
      asOf: string;
      source: string;
    } | null;
  }> | null;
  sandbox: Array<{
    operationId: string;
    rawAmount: number | null;
    rawUnit: string | null;
    unitSource: string | null;
    billed: { amount: number; currency: string; source: string; asOf: string } | null;
  }> | null;
  wallTimeMs: number | null;
}

/** Dataset truth and presentation are deliberately separate from executed evidence. */
export interface VerificationDatasetTruth {
  schemaVersion: 'sutura-repair-quality-truth-v1';
  status: 'correct' | 'incorrect' | 'unknown';
  evaluatorArtifactSha256: string | null;
  oracleRevision: string;
}

export interface VerificationPresentation {
  label: string;
  evidenceIntegritySha256: string;
}

export interface VerificationEvidence {
  schemaVersion: typeof VERIFICATION_EVIDENCE_VERSION;
  mode: VerificationMode;
  outcome: VerificationOutcome;
  assurance: VerificationAssurance;
  identity: VerificationIdentity;
  startedAt: string;
  finishedAt: string;
  commands: string[];
  models: VerificationModel[];
  challenges: { mode: 'required' | 'optional' | 'disabled'; qualifiedProbeCount: number };
  gates: VerificationGateObservation[];
  costs: VerificationCosts;
}

/** Store bytes unchanged and hashes alongside them; integrity is not a signature. */
export interface VerificationArtifact {
  bytes: string;
  integritySha256: string;
  normalizedComparisonSha256: string;
}
