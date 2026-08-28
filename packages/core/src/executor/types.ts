export type ImageId = string;
export const SNAPSHOT_CWD = '/workspace';

export type SnapshotProfile = 'dependency-inputs' | 'repository';
export type SnapshotMode = 'replace' | 'overlay';

export interface SnapshotOptions {
  profile: SnapshotProfile;
  mode: SnapshotMode;
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

export interface RunMetrics {
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
