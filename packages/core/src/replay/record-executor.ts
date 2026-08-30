import type { Executor } from '../executor/types.js';
import type { ReplayRecorder } from './bundle.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function recordingExecutor(
  executor: Executor,
  recorder: ReplayRecorder,
): Executor {
  const record = async <T>(
    method: keyof Executor,
    args: unknown[],
    operation: () => Promise<T>,
  ): Promise<T> => {
    const sequence = recorder.reserveExecutorSequence();
    try {
      const result = await operation();
      recorder.recordExecutor({ method, args, result }, sequence);
      return result;
    } catch (error) {
      recorder.recordExecutor({
        method,
        args,
        result: { error: errorMessage(error) },
      }, sequence);
      throw error;
    }
  };

  return {
    importImage(ref) {
      return record('importImage', [ref], () => executor.importImage(ref));
    },
    snapshot(dir, base, options) {
      return record('snapshot', [dir, base, options], () =>
        executor.snapshot(dir, base, options),
      );
    },
    run(parent, cmd, options) {
      return record('run', [parent, cmd, options], () =>
        executor.run(parent, cmd, options),
      );
    },
    runMany(parent, commands, options) {
      return record('runMany', [parent, commands, options], () =>
        executor.runMany(parent, commands, options),
      );
    },
    operationCapacity() {
      const sequence = recorder.reserveExecutorSequence();
      try {
        const result = executor.operationCapacity();
        recorder.recordExecutor({ method: 'operationCapacity', args: [], result }, sequence);
        return result;
      } catch (error) {
        recorder.recordExecutor({
          method: 'operationCapacity',
          args: [],
          result: { error: errorMessage(error) },
        }, sequence);
        throw error;
      }
    },
    cancel(operationId) {
      return record('cancel', [operationId], () => executor.cancel(operationId));
    },
  };
}
