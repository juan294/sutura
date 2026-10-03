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
import {
  describeMethodCall,
  RecordedCallCursor,
  type RecordedCallCursorOptions,
  type RecordedCallDescription,
} from './recorded-call-cursor.js';
import { throwRecordedErrorResult } from './recorded-error.js';
import { ReplayMismatchError } from './replay-error.js';

/**
 * The adaptive search expands branches concurrently and each branch issues its
 * sandbox calls after its own provider turn, so a live recording orders
 * executor calls by provider latency. Every such call carries a distinct
 * operation id, so an exact match among unconsumed records identifies it
 * regardless of order. Capacity probes and cancellation requests are
 * observational: their number depends on scheduling, never on the repair.
 */
export const EXECUTOR_CURSOR_OPTIONS: RecordedCallCursorOptions = Object.freeze({
  unordered: true,
  optional: ({ method }: RecordedCallDescription) => method === 'operationCapacity' || method === 'cancel',
});

export interface RecordedExecutorOrdering {
  /**
   * How long a released result's continuation may run without issuing another
   * executor call before the next result is released anyway.
   */
  readonly quietMs?: number;
  /**
   * How long a result may wait on an earlier recorded call the replay has not
   * issued. A faithful replay always issues it; this only ends a replay that
   * took a different path, which then fails closed on its mismatch.
   */
  readonly deadlineMs?: number;
}

const DEFAULT_QUIET_MS = 1_000;
const DEFAULT_DEADLINE_MS = 10_000;

/**
 * Serves recorded executor results in recorded order. Live branch results
 * arrive seconds apart in sandbox latency order, and each branch runs until it
 * blocks on its next sandbox call; the adaptive search admits whichever passing
 * branch gets there first. Served from memory, results would arrive together
 * and a replay could admit a different branch.
 *
 * A result therefore waits until every earlier recorded call has been issued
 * and served. After each release, the next result also waits until the replay
 * issues another executor call, so the released continuation runs as far as it
 * did live; a continuation that ends without one releases the next result after
 * a quiet period. Matching stays synchronous, so a mismatch still throws at the
 * call. Recorded order is the order calls were issued, which is the closest a
 * bundle records to the order their results arrived.
 */
export class RecordedExecutor implements Executor {
  private readonly cursor: RecordedCallCursor<RecordedExecutorCall>;
  private lastCapacity: OperationCapacity | undefined;
  private readonly blocking: number[];
  private readonly served = new Set<number>();
  private readonly waiting = new Map<number, () => void>();
  private readonly quietMs: number;
  private readonly deadlineMs: number;
  private releaseScheduled = false;
  private awaitingFollowUp = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(
    calls: readonly RecordedExecutorCall[],
    private readonly normalizeArgs: (args: unknown[]) => unknown[] = (args) => args,
    cursor?: RecordedCallCursor<RecordedExecutorCall>,
    ordering: RecordedExecutorOrdering = {},
  ) {
    this.cursor = cursor ?? new RecordedCallCursor(calls, describeMethodCall, 'executor', EXECUTOR_CURSOR_OPTIONS);
    this.blocking = calls
      .filter((call) => EXECUTOR_CURSOR_OPTIONS.optional?.(call) !== true)
      .map(({ sequence }) => sequence)
      .toSorted((left, right) => left - right);
    this.quietMs = ordering.quietMs ?? DEFAULT_QUIET_MS;
    this.deadlineMs = ordering.deadlineMs ?? DEFAULT_DEADLINE_MS;
  }

  /** Drop waiting results and timers once the replay has finished. */
  dispose(): void {
    this.disposed = true;
    this.waiting.clear();
    this.clearTimer();
  }

  private ordered<T>(method: keyof Executor, args: unknown[]): Promise<T> {
    let call: RecordedExecutorCall;
    try {
      call = this.cursor.next(method, args, this.normalizeArgs);
    } catch (error) {
      // The positional record was consumed by the mismatch and will never be served.
      if (error instanceof ReplayMismatchError) this.served.add(error.sequence);
      throw error;
    }
    // The released continuation reached its next sandbox call.
    this.awaitingFollowUp = false;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(call.sequence, () => {
        try {
          throwRecordedErrorResult(call.result);
          resolve(call.result as T);
        } catch (error) {
          reject(error);
        }
      });
      this.scheduleRelease();
    });
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private scheduleRelease(): void {
    this.clearTimer();
    if (this.releaseScheduled || this.disposed) return;
    this.releaseScheduled = true;
    setImmediate(() => {
      this.releaseScheduled = false;
      this.releaseNext(false);
    });
  }

  private releaseNext(timedOut: boolean): void {
    const next = Math.min(...this.waiting.keys());
    if (this.disposed || !Number.isFinite(next)) return;
    const blocked = this.blocking.some((sequence) => sequence < next && !this.served.has(sequence));
    if (!timedOut && (blocked || this.awaitingFollowUp)) {
      this.timer ??= setTimeout(() => {
        this.timer = undefined;
        this.releaseNext(true);
      }, blocked ? this.deadlineMs : this.quietMs);
      return;
    }
    // A deadline release gives up on the earlier records; they no longer block.
    for (const sequence of this.blocking) if (sequence < next) this.served.add(sequence);
    const release = this.waiting.get(next)!;
    this.waiting.delete(next);
    this.served.add(next);
    this.awaitingFollowUp = true;
    release();
    if (this.waiting.size > 0) this.scheduleRelease();
  }

  private tryNext<T>(method: keyof Executor, args: unknown[]): T | undefined {
    const call = this.cursor.tryNext(method, args, this.normalizeArgs);
    if (call === undefined) return undefined;
    throwRecordedErrorResult(call.result);
    return call.result as T;
  }

  private next<T>(method: keyof Executor, args: unknown[]): T {
    const call = this.cursor.next(method, args, this.normalizeArgs);
    throwRecordedErrorResult(call.result);
    return call.result as T;
  }

  importImage(ref: string): Promise<ImageId> {
    return this.ordered<ImageId>('importImage', [ref]);
  }

  snapshot(dir: string, base: ImageId, options: SnapshotOptions): Promise<ImageId> {
    return this.ordered<ImageId>('snapshot', [dir, base, options]);
  }

  run(parent: ImageId, cmd: string, options?: RunOptions): Promise<RunResult> {
    return this.ordered<RunResult>('run', [parent, cmd, options ?? null]);
  }

  runMany(parent: ImageId, commands: string[], options?: RunOptions): Promise<RunResult[]> {
    return this.ordered<RunResult[]>('runMany', [parent, commands, options ?? null]);
  }

  operationCapacity(): OperationCapacity {
    // The number of probes depends on batch shape; a probe beyond the recording repeats the last answer.
    const recorded = this.tryNext<OperationCapacity>('operationCapacity', []);
    if (recorded !== undefined) this.lastCapacity = recorded;
    return this.lastCapacity ?? this.next<OperationCapacity>('operationCapacity', []);
  }

  cancel(operationId: string): Promise<CancellationResult> {
    // A cancellation the live run never issued reports that nothing was requested.
    return Promise.resolve(
      this.tryNext<CancellationResult>('cancel', [operationId]) ?? { operationId, requested: false },
    );
  }
}
