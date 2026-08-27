import { describe, expect, it } from 'vitest';

import { InMemoryExecutor } from '../executor/memory.js';
import { triage } from './triage.js';

function scriptedTriage(exitCodes: readonly number[]): InMemoryExecutor {
  return new InMemoryExecutor((_cmd, _parent, callIndex) => ({
    exitCode: exitCodes[callIndex] ?? 1,
    stdout: '',
    stderr: '',
    truncated: false,
    metrics: {},
  }));
}

describe('triage', () => {
  it.each([
    { exits: [1, 1, 1, 1, 1], status: 'real', reproduced: 5 },
    { exits: [0, 0, 0, 0, 0], status: 'flaky', reproduced: 0 },
    { exits: [1, 0, 1, 0, 0], status: 'intermittent', reproduced: 2 },
  ] as const)('classifies $reproduced/5 as $status', async ({
    exits,
    status,
    reproduced,
  }) => {
    const executor = scriptedTriage(exits);

    await expect(triage(executor, 'failure-image', 'pnpm test')).resolves.toEqual({
      status,
      reproduced,
      of: 5,
    });
    expect(executor.calls).toHaveLength(5);
    expect(
      executor.calls.every(
        (call) =>
          call.kind === 'run' &&
          call.parent === 'failure-image' &&
          call.opts?.cwd === '/workspace',
      ),
    ).toBe(true);
  });

  it('rejects an invalid sample count before using the executor', async () => {
    const executor = scriptedTriage([]);

    await expect(triage(executor, 'failure-image', 'pnpm test', 0)).rejects.toThrow(
      'N must be between 1 and 20',
    );
    expect(executor.calls).toEqual([]);
  });

  it('rejects an excessive sample count before using the executor', async () => {
    const executor = scriptedTriage([]);

    await expect(
      triage(executor, 'failure-image', 'pnpm test', 21),
    ).rejects.toThrow('N must be between 1 and 20');
    expect(executor.calls).toEqual([]);
  });
});
