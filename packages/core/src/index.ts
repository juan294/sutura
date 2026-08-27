export {
  ConfigError,
  DEFAULT_MODELS,
  loadConfig,
} from './config.js';
export { ContreeError, ContreeExecutor } from './executor/contree.js';
export { InMemoryExecutor } from './executor/memory.js';

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
