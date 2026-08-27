export {
  ConfigError,
  DEFAULT_MODELS,
  loadConfig,
} from './config.js';
export { ContreeError, ContreeExecutor } from './executor/contree.js';
export { InMemoryExecutor } from './executor/memory.js';
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
  SUTURA_SANDBOX_ENV,
  attemptMarker,
  collectFailedLogs,
  extractSourceReferences,
  orchestrate,
  readRepairSourceContext,
} from './orchestrate.js';
export { FAILURE_TAXONOMY } from './taxonomy.js';
export { renderCaseFile } from './report/casefile.js';
export { renderComment } from './report/markdown.js';

export const VERSION = '0.1.0';

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
} from './executor/types.js';
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
  RaceResult,
  TriageVerdict,
} from './domain.js';
