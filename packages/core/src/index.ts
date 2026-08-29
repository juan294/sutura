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
export { DEFAULT_MODEL_PRICES, Ledger, calculateModelCostUsd } from './llm/cost.js';
export { completedTriageVerdict, notRunTriageVerdict } from './engine/triage.js';
export {
  DEFAULT_ROUTING_PROFILE_ID,
  MODEL_SELECTION_SCHEMA_VERSION,
  ModelRouter,
} from './llm/router.js';
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
export { validateCandidateDiff } from './engine/candidate-validation.js';
export {
  BudgetExceededError,
  DEFAULT_REPAIR_BUDGET_LIMITS,
  RepairBudget,
  repairBudgetLimits,
} from './engine/repair-budget.js';
export { runRepairAgent } from './engine/repair-agent.js';
export { diffFingerprint, errorFingerprint, failureSignatureCount } from './engine/fingerprint.js';
export { compareSearchNodes, searchScore } from './engine/search-score.js';
export { adaptiveSearch, DEFAULT_SEARCH_LIMITS } from './engine/search.js';
export { REPAIR_TOOL_DEFINITIONS, RepairToolRuntime } from './engine/repair-tools.js';
export {
  generateCandidates,
  prepareRepair,
  selectWinner,
} from './engine/repair.js';
export type {
  RepairBudgetLimits,
  RepairBudgetOverrides,
  RepairBudgetSnapshot,
} from './engine/repair-budget.js';
export type { RepairAgentContext, RepairAgentOutcome } from './engine/repair-agent.js';
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
export { TraceRecorder } from './trace/recorder.js';
export { sanitizeTraceEvent } from './trace/sanitize.js';
export { TRACE_SCHEMA_VERSION } from './trace/types.js';
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
export type { RepairFailureKind } from './domain.js';
export type {
  ModelPrice,
  ModelPrices,
  ModelTier,
  TokenUsage,
} from './llm/cost.js';
export type {
  ModelRouteDecision,
  ModelRoutingInput,
  ModelSelectionProfile,
} from './llm/router.js';
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
  SearchLimits,
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
  CancellationResult,
  OperationCapacity,
  OperationCompletion,
  OperationTerminal,
} from './executor/types.js';
export type { ExternalTextRedaction } from './security/external-text.js';
export type {
  TraceEvent,
  TraceEventInput,
  TraceStage,
} from './trace/types.js';
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
  SearchEvidence,
} from './domain.js';
export type {
  AdaptiveSearchOptions,
  AdaptiveSearchResult,
  SearchExpansion,
  SearchExpansionContext,
  SearchNode,
  SearchPolicyEvidence,
} from './engine/search.js';
export type { SearchScore } from './engine/search-score.js';
export type {
  RepositoryPolicy,
  ResourceLimits,
} from './policy/schema.js';
export type { LoadedRepositoryPolicy } from './policy/load.js';
export type { SensitiveRepositoryPathOptions } from './security/repository-path.js';
export type { StageTotals } from './report/format.js';
