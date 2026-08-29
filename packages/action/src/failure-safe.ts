export interface FailureSafeCheckPort {
  completeUnexpectedFailure(reason: string): Promise<void>;
}

export async function withFailureSafeCheck<T>(
  githubPort: FailureSafeCheckPort,
  operation: () => Promise<T>,
  warn: (message: string) => void = () => undefined,
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
    throw error;
  }
}
