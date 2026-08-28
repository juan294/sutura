import type {
  Executor,
  ImageId,
  RunOptions,
  RunResult,
  CancellationResult,
  OperationCapacity,
  OperationCompletion,
  SnapshotOptions,
} from './types.js';

export type InMemoryRunResult = Omit<RunResult, 'imageId'>;

export type InMemoryScript = (
  cmd: string,
  parent: ImageId,
  callIndex: number,
  opts?: RunOptions,
) => InMemoryRunResult | Promise<InMemoryRunResult>;

export type InMemoryCall =
  | {
      kind: 'importImage';
      ref: string;
      imageId: ImageId;
    }
  | {
      kind: 'snapshot';
      dir: string;
      base: ImageId;
      options: SnapshotOptions;
      imageId: ImageId;
    }
  | {
      kind: 'run';
      parent: ImageId;
      cmd: string;
      opts?: RunOptions;
      imageId: ImageId;
    };

export class InMemoryExecutor implements Executor {
  readonly calls: InMemoryCall[] = [];
  readonly completions: OperationCompletion[] = [];

  private nextImageNumber = 1;
  private nextRunNumber = 0;

  private readonly operationLimit: number;
  private readonly operations = new Map<string, { cancelled: boolean; terminal?: OperationCompletion['terminal'] }>();
  private active = 0;

  constructor(private readonly script: InMemoryScript, options: { operationLimit?: number } = {}) {
    this.operationLimit = options.operationLimit ?? Number.MAX_SAFE_INTEGER;
  }

  operationCapacity(): OperationCapacity {
    return { limit: this.operationLimit, active: this.active, available: Math.max(0, this.operationLimit - this.active) };
  }

  async cancel(operationId: string): Promise<CancellationResult> {
    const operation = this.operations.get(operationId);
    if (!operation || operation.terminal) {
      return {
        operationId,
        requested: false,
        ...(operation?.terminal === undefined ? {} : { terminal: operation.terminal }),
      };
    }
    operation.cancelled = true;
    operation.terminal = 'cancelled';
    this.completions.push({ operationId, cancellationRequested: true, terminal: 'cancelled' });
    return { operationId, requested: true, terminal: 'cancelled' };
  }

  async importImage(ref: string): Promise<ImageId> {
    const imageId = this.nextImageId();
    this.calls.push({ kind: 'importImage', ref, imageId });
    return imageId;
  }

  async snapshot(
    dir: string,
    base: ImageId,
    options: SnapshotOptions,
  ): Promise<ImageId> {
    const imageId = this.nextImageId();
    this.calls.push({ kind: 'snapshot', dir, base, options, imageId });
    return imageId;
  }

  async run(
    parent: ImageId,
    cmd: string,
    opts?: RunOptions,
  ): Promise<RunResult> {
    const imageId = this.nextImageId();
    const callIndex = this.nextRunNumber;
    this.nextRunNumber += 1;

    const call: InMemoryCall = opts
      ? { kind: 'run', parent, cmd, opts, imageId }
      : { kind: 'run', parent, cmd, imageId };
    this.calls.push(call);

    const operationId = opts?.operationId;
    if (operationId && this.operations.has(operationId)) throw new Error(`Operation ${operationId} already exists`);
    const operation: { cancelled: boolean; terminal?: OperationCompletion['terminal'] } | undefined = operationId ? { cancelled: false } : undefined;
    if (operationId && operation) this.operations.set(operationId, operation);
    this.active += 1;
    try {
      const scripted = await this.script(cmd, parent, callIndex, opts);
      if (operation?.cancelled) throw new Error(`Operation ${operationId} was cancelled`);
      if (operationId && operation && !operation.terminal) {
        operation.terminal = scripted.exitCode === 0 ? 'succeeded' : 'failed';
        this.completions.push({ operationId, cancellationRequested: false, terminal: operation.terminal });
      }
      return {
        ...scripted,
        imageId,
        ...(operationId === undefined || operation?.terminal === undefined ? {} : {
          operation: { operationId, terminal: operation.terminal, cancellationRequested: false },
        }),
      };
    } finally {
      this.active -= 1;
    }
  }

  async runMany(
    parent: ImageId,
    cmds: string[],
    opts?: RunOptions,
  ): Promise<RunResult[]> {
    return Promise.all(cmds.map((cmd) => this.run(parent, cmd, opts)));
  }

  private nextImageId(): ImageId {
    const imageId = `mem-${this.nextImageNumber}`;
    this.nextImageNumber += 1;
    return imageId;
  }
}
