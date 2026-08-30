import type {
  CancellationResult,
  Executor,
  ImageId,
  OperationCapacity,
  RunOptions,
  RunResult,
  SnapshotOptions,
} from '../executor/types.js';
import { canonicalJson, firstJsonDifference } from './canonical-json.js';
import { ReplayMismatchError } from './replay-fetch.js';
import type { RecordedExecutorCall } from './bundle.js';

function recordedError(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Object.keys(value).length !== 1) return null;
  const error = (value as { error?: unknown }).error;
  return typeof error === 'string' ? error : null;
}

export class RecordedExecutor implements Executor {
  private readonly calls: RecordedExecutorCall[];
  private index = 0;

  constructor(
    calls: readonly RecordedExecutorCall[],
    private readonly normalizeArgs: (args: unknown[]) => unknown[] = (args) => args,
  ) {
    this.calls = [...calls].toSorted((left, right) => left.sequence - right.sequence);
  }

  private next<T>(method: keyof Executor, args: unknown[]): T {
    const call = this.calls[this.index];
    if (!call) throw new ReplayMismatchError(this.index + 1, '$', method, 'sequence exhausted');
    this.index += 1;
    if (call.method !== method) {
      throw new ReplayMismatchError(call.sequence, '$.method', call.method, method);
    }
    const normalized = this.normalizeArgs(args);
    if (canonicalJson(call.args) !== canonicalJson(normalized)) {
      const difference = firstJsonDifference(call.args, normalized);
      throw new ReplayMismatchError(
        call.sequence,
        difference?.path ?? '$.args',
        difference?.expected,
        difference?.actual,
      );
    }
    const error = recordedError(call.result);
    if (error) throw new Error(error);
    return call.result as T;
  }

  importImage(ref: string): Promise<ImageId> {
    return Promise.resolve(this.next<ImageId>('importImage', [ref]));
  }

  snapshot(dir: string, base: ImageId, options: SnapshotOptions): Promise<ImageId> {
    return Promise.resolve(this.next<ImageId>('snapshot', [dir, base, options]));
  }

  run(parent: ImageId, cmd: string, options?: RunOptions): Promise<RunResult> {
    return Promise.resolve(this.next<RunResult>('run', [parent, cmd, options ?? null]));
  }

  runMany(parent: ImageId, commands: string[], options?: RunOptions): Promise<RunResult[]> {
    return Promise.resolve(this.next<RunResult[]>('runMany', [parent, commands, options ?? null]));
  }

  operationCapacity(): OperationCapacity {
    return this.next<OperationCapacity>('operationCapacity', []);
  }

  cancel(operationId: string): Promise<CancellationResult> {
    return Promise.resolve(this.next<CancellationResult>('cancel', [operationId]));
  }
}
