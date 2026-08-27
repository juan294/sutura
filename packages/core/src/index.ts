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
export { FAILURE_TAXONOMY } from './taxonomy.js';

export const VERSION = '0.1.0';

export type {
  Config,
  ConfigEnvironment,
} from './config.js';
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
