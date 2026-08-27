import { describe, expect, it } from 'vitest';

import { assertSuccessfulRun } from './live-diagnostics.js';
import type { RunResult } from './types.js';

function result(overrides: Partial<RunResult> = {}): RunResult {
  return {
    imageId: 'image-1',
    exitCode: 0,
    stdout: '',
    stderr: '',
    truncated: false,
    metrics: {},
    ...overrides,
  };
}

describe('assertSuccessfulRun', () => {
  it('does nothing for a successful run', () => {
    expect(() => assertSuccessfulRun('verification', result())).not.toThrow();
  });

  it('throws bounded stdout and stderr diagnostics for a failed run', () => {
    const stdout = `stdout-start-${'o'.repeat(100)}`;
    const stderr = `stderr-start-${'e'.repeat(100)}`;

    expect(() =>
      assertSuccessfulRun(
        'sandbox verification',
        result({ exitCode: 1, stdout, stderr }),
        24,
      ),
    ).toThrowError(
      [
        'sandbox verification failed with exit code 1',
        'stdout:',
        `${stdout.slice(0, 24)}\n[output truncated]`,
        'stderr:',
        `${stderr.slice(0, 24)}\n[output truncated]`,
      ].join('\n'),
    );
  });
});
