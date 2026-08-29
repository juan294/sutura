import { describe, expect, it, vi } from 'vitest';

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
    { exits: [1, 1, 1, 1, 1], status: 'real', reproduced: 4, attempts: 4, reason: 'failure-boundary' },
    { exits: [0, 0, 0, 0, 0], status: 'flaky', reproduced: 0, attempts: 4, reason: 'pass-boundary' },
    { exits: [1, 0, 1, 0, 0], status: 'intermittent', reproduced: 2, attempts: 5, reason: 'maximum-attempts' },
  ] as const)('classifies $status with $attempts/5 attempts', async ({
    exits,
    status,
    reproduced,
    attempts,
    reason,
  }) => {
    const executor = scriptedTriage(exits);

    await expect(triage(executor, 'failure-image', 'pnpm test')).resolves.toMatchObject({
      status,
      reproduced,
      of: attempts,
      attemptsUsed: attempts,
      maximumAttempts: 5,
      stopReason: reason,
      methodVersion: 'sprt-p20-p80-a05-b05-v1',
    });
    expect(executor.calls).toHaveLength(attempts);
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

  it('gives every independent branch a deterministic attempt index and quotes the failing command', async () => {
    const executor = scriptedTriage([1, 0, 1]);
    const failingCmd = `node -e "console.log('quoted value')" && printf '%s' "done"`;

    await triage(executor, 'failure-image', failingCmd, 3);

    expect(executor.calls.map((call) => call.kind === 'run' ? call.cmd : '')).toEqual([
      `SUTURA_TRIAGE_ATTEMPT='0' sh -lc 'node -e "console.log('"'"'quoted value'"'"')" && printf '"'"'%s'"'"' "done"'`,
      `SUTURA_TRIAGE_ATTEMPT='1' sh -lc 'node -e "console.log('"'"'quoted value'"'"')" && printf '"'"'%s'"'"' "done"'`,
      `SUTURA_TRIAGE_ATTEMPT='2' sh -lc 'node -e "console.log('"'"'quoted value'"'"')" && printf '"'"'%s'"'"' "done"'`,
    ]);
  });

  it('runs batches of two and a final one when an odd mixed maximum remains', async () => {
    const executor = scriptedTriage([1, 0, 1, 0, 1]);
    const runMany = vi.spyOn(executor, 'runMany');

    const verdict = await triage(executor, 'failure-image', 'pnpm test', 5);

    expect(runMany.mock.calls.map(([, commands]) => commands.length)).toEqual([2, 2, 1]);
    expect(verdict).toMatchObject({
      status: 'intermittent', attemptsUsed: 5, maximumAttempts: 5,
      reproduced: 3, of: 5, stopReason: 'maximum-attempts',
    });
  });
});
