import type {
  CancellationResult,
  Executor,
  ImageId,
  OperationCapacity,
  RunOptions,
  RunResult,
  SnapshotOptions,
} from '../executor/types.js';
import type { RecordedExecutorCall } from './bundle.js';
import { describeMethodCall, RecordedCallCursor } from './recorded-call-cursor.js';
import { throwRecordedErrorResult } from './recorded-error.js';

export class RecordedExecutor implements Executor {
  private readonly cursor: RecordedCallCursor<RecordedExecutorCall>;

  constructor(
    calls: readonly RecordedExecutorCall[],
    private readonly normalizeArgs: (args: unknown[]) => unknown[] = (args) => args,
    cursor?: RecordedCallCursor<RecordedExecutorCall>,
  ) {
    this.cursor = cursor ?? new RecordedCallCursor(calls, describeMethodCall, 'executor');
  }

  private next<T>(method: keyof Executor, args: unknown[]): T {
    const call = this.cursor.next(method, args, this.normalizeArgs);
    throwRecordedErrorResult(call.result);
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
