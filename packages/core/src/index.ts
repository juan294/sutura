export {
  ConfigError,
  DEFAULT_MODELS,
  MAX_RACE_CANDIDATES,
  MAX_STAGE_EVIDENCE_ENTRIES,
  MAX_TRIAGE_RUNS,
  loadConfig,
} from './config.js';
export { ContreeError, ContreeExecutor } from './executor/contree.js';
export { InMemoryExecutor } from './executor/memory.js';
export {
  AllowlistedExecutor,
  HealCaseError,
  StageLedger,
  SUTURA_SANDBOX_ENV,
  healCase,
  repairFailure,
} from './heal.js';
export { MAX_POLICY_BYTES, loadRepositoryPolicy } from './policy/load.js';
export {
  DEFAULT_REPOSITORY_POLICY,
  PolicyValidationError,
  parseRepositoryPolicy,
  validatePolicyGlob,
} from './policy/schema.js';
export {
  evaluatePatchPolicy,
  evaluateResourceThresholds,
  filterPolicyDeniedText,
  isPolicyPathMatched,
  policyAllowsSourceRead,
} from './policy/evaluate.js';
export { DEFAULT_MODEL_PRICES, Ledger } from './llm/cost.js';
export { NebiusApiError, NebiusClient, NebiusResponseError } from './llm/nebius.js';
export {
  ClassificationError,
  classify,
  classifyMechanically,
} from './diagnose/classify.js';
export {
  TavilyClient,
  TavilyConfigError,
  TavilyRequestError,
  ground,
} from './diagnose/tavily.js';
export { audit } from './audit/audit.js';
export {
  ADVERSARIAL_AUDIT_PROMPT,
  adjudicate,
} from './audit/adjudicate.js';
export {
  checkAssertionDrop,
  checkDeletedTests,
  checkLoosenedTypes,
  checkPassWithNoTests,
  checkRelaxedConfig,
  checkSkips,
  runMechanicalChecks,
} from './audit/mechanical.js';
export { vetPatch } from './engine/patch-rules.js';
export {
  generateCandidates,
  prepareRepair,
  race,
  selectWinner,
} from './engine/repair.js';
export { triage } from './engine/triage.js';
export {
  AlreadyAttemptedError,
  OrchestrationError,
  REPAIR_SOURCE_LIMITS,
  attemptMarker,
  collectFailedLogs,
  extractSourceReferences,
  orchestrate,
  readRepairSourceContext,
} from './orchestrate.js';
export { FAILURE_TAXONOMY } from './taxonomy.js';
export { renderCaseFile } from './report/casefile.js';
export { renderComment } from './report/markdown.js';
export { aggregateStageEvidence } from './report/format.js';
export { isSensitiveRepositoryPath } from './security/repository-path.js';
export {
  ExternalTextError,
  assertExternalEditableText,
  redactExternalMessages,
  redactExternalText,
} from './security/external-text.js';

export const VERSION = '0.1.1';

export type {
  HealCaseContext,
  HealLlm,
  RepairFailureContext,
} from './heal.js';
export type {
  ModelPrice,
  ModelPrices,
  ModelTier,
  TokenUsage,
} from './llm/cost.js';
export type {
  NebiusClientConfig,
  NebiusClientDependencies,
} from './llm/nebius.js';
export type {
  AssistantMessage,
  CapacitySnapshot,
  ChatMessage,
  ChatOptions,
  FunctionToolCall,
  FunctionToolDefinition,
  JsonSchema,
  LlmReply,
  ResponseFormat,
  SystemMessage,
  ToolChoice,
  ToolMessage,
  UserMessage,
} from './llm/types.js';
export type {
  Config,
  ConfigEnvironment,
} from './config.js';
export type { AuditContext, AuditLlm } from './audit/audit.js';
export type {
  AdjudicationContext,
  AdjudicationLlm,
  AdjudicationResult,
} from './audit/adjudicate.js';
export type { MechanicalCheck } from './audit/mechanical.js';
export type { ContreeExecutorConfig } from './executor/contree.js';
export type {
  InMemoryCall,
  InMemoryRunResult,
  InMemoryScript,
} from './executor/memory.js';
export type {
  Executor,
  ImageId,
  RunMetrics,
  RunOptions,
  RunResult,
  SnapshotMode,
  SnapshotOptions,
  SnapshotProfile,
} from './executor/types.js';
export type { ExternalTextRedaction } from './security/external-text.js';
export type {
  DiagnosisLlm,
  MechanicalDiagnosis,
} from './diagnose/classify.js';
export type {
  GroundOptions,
  TavilyCitation,
  TavilyClientDependencies,
  TavilyHttpRequestInit,
  TavilyHttpResponse,
  TavilySearch,
  TavilySearchOptions,
} from './diagnose/tavily.js';
export type { PatchVerdict } from './engine/patch-rules.js';
export type {
  RepairLlm,
  RepairPreparation,
  RepairSourceContext,
  RepairSourceExcerpt,
} from './engine/repair.js';
export type {
  AttemptTarget,
  CreateFixPullRequestInput,
  FailedStepLog,
  FailingWorkflowRun,
  GitHubOrchestrationPort,
  OrchestrationContext,
  OrchestratorLlm,
  PublishFixInput,
  RepositorySourceExcerpt,
  RepositoryPort,
  SourceReadLimits,
  SourceReference,
} from './orchestrate.js';
export type { TaxonomyEntry } from './taxonomy.js';
export type {
  AuditVerdict,
  Candidate,
  CaseFile,
  CostLedger,
  Diagnosis,
  FailureClass,
  GreenwashCheck,
  Grounding,
  PolicyEvidence,
  RaceResult,
  StageEvidence,
  StageName,
  TriageVerdict,
} from './domain.js';
export type {
  RepositoryPolicy,
  ResourceLimits,
} from './policy/schema.js';
export type { LoadedRepositoryPolicy } from './policy/load.js';
export type { SensitiveRepositoryPathOptions } from './security/repository-path.js';
export type { StageTotals } from './report/format.js';
