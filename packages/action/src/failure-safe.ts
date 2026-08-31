import type { ReplayRecorder } from '@sutura/core';

export interface FailureSafeCheckPort {
  completeUnexpectedFailure(reason: string): Promise<void>;
  uploadReplayBundle?(name: string, json: string): Promise<{ url: string }>;
}

export async function withFailureSafeCheck<T>(
  githubPort: FailureSafeCheckPort,
  operation: () => Promise<T>,
  warn: (message: string) => void = () => undefined,
  replay?: ReplayRecorder,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    try {
      await githubPort.completeUnexpectedFailure(
        error instanceof Error ? error.message : 'Sutura stopped unexpectedly',
      );
    } catch {
      warn('Sutura could not complete its GitHub check after an unexpected failure.');
    }
    if (replay && githubPort.uploadReplayBundle) {
      try {
        await githubPort.uploadReplayBundle(
          `sutura-replay-${replay.runId}.json`,
          JSON.stringify(replay.finish('infra-stop')),
        );
      } catch {
        warn('Sutura could not upload the replay bundle after an unexpected failure.');
      }
    }
    throw error;
  }
}
