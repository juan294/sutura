import type { FailureClass, CaseFile } from '../domain.js';
import type { RuntimeId } from '../runtime/types.js';

export const INCIDENT_ASSESSMENT_VERSION = 'sutura-job-assessment-v1' as const;
export const RUNTIME_SUPPORT_CONTRACT = 'sutura-runtime-support-v1' as const;
type Outcome = CaseFile['outcome'];
export type Confidence = 'confirmed' | 'suspected' | 'unknown';
export type SupportVerdict = 'candidate-supported' | 'unsupported' | 'unknown';
export type IncidentCause = 'source-defect' | 'generated-bundle-stale' | 'action-version-mismatch' |
  'installation' | 'credential-boundary' | 'live-probe' | 'provider-resource' | 'network' | 'sutura-internal' | 'unknown';
export type IncidentDisposition = 'repair-supported' | 'escalation' | 'observe-only' | 'intentionally-excluded';
export type ReadinessStage = 'assessed' | 'configured' | 'activated' | 'prepared' | 'reproduced' | 'native-verified' | 'integrated';
export type CapabilityPresence = 'present' | 'absent' | 'unknown';

export interface AssessmentScope {
  repositoryId?: number;
  workflowId?: number;
  workflowPath: string;
  jobKey: string;
  localTreeDigest?: string;
  /** Allowlisted content and public metadata identity; never a complete source-tree identity. */
  localMetadataDigest?: string;
  remoteSourceSha?: string;
}
export interface InstalledActionTarget {
  kind: 'installed-action';
  actionSha?: string;
  runtimeContractVersion?: string;
  /** Adapter-observed binding; never infer a target Action's capabilities from CLI version. */
  resolvedFromActionSha?: string;
  packageVersion?: never;
  packageTreeDigest?: never;
  resolvedFromPackageTreeDigest?: never;
}
export interface PackagedRuntimeTarget {
  kind: 'packaged-runtime';
  runtimeContractVersion?: string;
  /** Version label plus exact packaged code identity, distinct from the assessed repository tree. */
  packageVersion?: string;
  packageTreeDigest?: string;
  resolvedFromPackageTreeDigest?: string;
  actionSha?: never;
  resolvedFromActionSha?: never;
}
export type TargetRuntimeContract = InstalledActionTarget | PackagedRuntimeTarget;
export interface ObservationCompleteness {
  complete: boolean;
  truncated: boolean;
  /** Omitted when a capture did not provide a valid UTC observation timestamp. */
  observedAt?: string;
}
export interface JobAssessmentInput {
  scope: AssessmentScope;
  target: TargetRuntimeContract;
  observation: ObservationCompleteness;
  /** Already selected job; adapters must mark unresolved workflow expressions unknown. */
  job: {
    command: string;
    configuredRuntime?: RuntimeId;
    services: CapabilityPresence;
    applicationSecrets: CapabilityPresence;
    nativePreparation: CapabilityPresence;
    privateDependencies: CapabilityPresence;
    dynamicConfiguration: CapabilityPresence;
    workspaceEvidenceComplete: boolean;
  };
  /** Bounded allowlisted metadata only. No source script is evaluated. */
  files: Readonly<Record<string, string>>;
  paths: readonly string[];
  snapshot: { complete: boolean; fileCount: number; totalBytes: number; largestFileBytes: number };
}
export interface JobAssessmentRecord {
  schemaVersion: typeof INCIDENT_ASSESSMENT_VERSION;
  scope: AssessmentScope;
  target: TargetRuntimeContract;
  observation: ObservationCompleteness;
  support: SupportVerdict;
  reason: string;
  confidence: Confidence;
  runtime?: RuntimeId;
  runtimeImage?: string;
  coveredFailureClasses: readonly FailureClass[];
  requiredInput: readonly string[];
  nextAction: string;
  evidenceStage: 'assessed';
  readiness: Readonly<Record<ReadinessStage, 'observed' | 'unmeasured'>>;
  /** Support classification never grants authority to execute or publish. */
  executionAuthorized: false;
}
export interface IncidentTrigger {
  event: string;
  actorId?: number;
  triggeringActorId?: number;
  authenticated: boolean;
}
export interface IncidentClassificationInput {
  assessment: JobAssessmentRecord;
  trigger: IncidentTrigger;
  /** Deterministic adapter findings; preserve evidence scope instead of guessing from actor. */
  causeEvidence?: { cause: IncidentCause; confidence: Confidence; digest: string; scope: AssessmentScope; complete: boolean };
  /** Authenticated protected policy capture. Integrity fields do not authenticate its source. */
  protectedPolicy?: { schemaVersion: 'sutura-protected-repair-policy-v1'; repair: 'allowed' | 'excluded';
    sourceSha: string; digest: string; scope: AssessmentScope };
  outcome?: Outcome;
}
export interface IncidentClassificationRecord {
  schemaVersion: 'sutura-incident-classification-v1';
  trigger: IncidentTrigger;
  cause: IncidentCause;
  confidence: Confidence;
  disposition: IncidentDisposition;
  outcome: Outcome | 'unmeasured';
  support: SupportVerdict;
  reason: string;
  ownerDomain: 'repository' | 'installation' | 'provider' | 'sutura' | 'unknown';
  requiredInput: readonly string[];
  nextAction: string;
  executionAuthorized: false;
}
