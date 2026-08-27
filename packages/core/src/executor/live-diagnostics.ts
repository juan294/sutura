import type { RunResult } from './types.js';

const DEFAULT_OUTPUT_LIMIT = 8_000;

export function assertSuccessfulRun(
  label: string,
  result: RunResult,
  outputLimit = DEFAULT_OUTPUT_LIMIT,
): void {
  if (result.exitCode === 0) return;

  throw new Error(
    [
      `${label} failed with exit code ${result.exitCode}`,
      'stdout:',
      boundedOutput(result.stdout, outputLimit),
      'stderr:',
      boundedOutput(result.stderr, outputLimit),
    ].join('\n'),
  );
}

function boundedOutput(output: string, limit: number): string {
  if (output.length <= limit) return output;
  return `${output.slice(0, limit)}\n[output truncated]`;
}
