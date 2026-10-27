export type ImageId = string;
export const SNAPSHOT_CWD = '/workspace';

export type SnapshotProfile = 'dependency-inputs' | 'repository';
export type SnapshotMode = 'replace' | 'overlay';

export interface SnapshotOptions {
  profile: SnapshotProfile;
  mode: SnapshotMode;
  includePaths?: readonly string[];
}

export interface RunOptions {
  env?: Readonly<Record<string, string>>;
  timeoutSec?: number;
  cwd?: string;
  network?: 'disabled' | 'enabled';
  operationId?: string;
}

export type OperationTerminal = 'succeeded' | 'failed' | 'cancelled';

export interface OperationCapacity {
  limit: number;
  active: number;
  available: number;
}

export interface CancellationResult {
  operationId: string;
  requested: boolean;
  terminal?: OperationTerminal;
}

export interface OperationCompletion {
  operationId: string;
  terminal: OperationTerminal;
  cancellationRequested: boolean;
}

export interface ProcessState {
  timedOut?: boolean;
  signal?: number;
}

export interface RunMetrics {
  /** Provider operation duration in seconds; absent historical duration is unknown. */
  wallTimeSec?: number;
  cost?: number;
  elapsedTimeSec?: number;
  maxRssKb?: number;
  systemCpuTimeSec?: number;
  userCpuTimeSec?: number;
}

export interface RunResult {
  imageId: ImageId;
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  metrics: RunMetrics;
  operation?: OperationCompletion;
  processState?: ProcessState;
}

export interface Executor {
  importImage(ref: string): Promise<ImageId>;
  snapshot(
    dir: string,
    base: ImageId,
    options: SnapshotOptions,
  ): Promise<ImageId>;
  run(parent: ImageId, cmd: string, opts?: RunOptions): Promise<RunResult>;
  runMany(
    parent: ImageId,
    cmds: string[],
    opts?: RunOptions,
  ): Promise<RunResult[]>;
  operationCapacity(): OperationCapacity;
  cancel(operationId: string): Promise<CancellationResult>;
}

/** Process termination and provider-operation completion are separate facts. */
export function processCompletedNormally(result: { exitCode: number; processState?: ProcessState }): boolean {
  return result.exitCode >= 0 && result.processState?.timedOut !== true &&
    (result.processState?.signal === undefined || result.processState.signal === 0);
}

export function processSucceeded(result: { exitCode: number; processState?: ProcessState }): boolean {
  return result.exitCode === 0 && processCompletedNormally(result);
}
