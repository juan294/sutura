import { describe, expect, it, vi } from 'vitest';

import { InMemoryExecutor } from '../executor/memory.js';
import { boundedTriage, LEGACY_TRIAGE_POLICY, triage, type FocusedProbe, type TriageProbeKind } from './triage.js';

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

function timedTriage(exitCodes: readonly number[], seconds: number | undefined): InMemoryExecutor {
  return new InMemoryExecutor((_cmd, _parent, callIndex) => ({
    exitCode: exitCodes[callIndex] ?? 1,
    stdout: '',
    stderr: '',
    truncated: false,
    metrics: seconds === undefined ? {} : { elapsedTimeSec: seconds },
  }));
}

describe('boundedTriage', () => {
  const budget = { scope: 'full', sandboxBudgetSec: 240 } as const;

  // Fleet replay 2026-10-03: chapa's sharded vitest triage probes took
  // 229-237 sandbox seconds each (USD 9.27 for four). One probe is measured,
  // then the remaining four would bring triage to about 1157 s.
  it('stops after one measured probe when the rest would exceed the budget', async () => {
    const executor = timedTriage([1, 1, 1, 1, 1], 231.26);

    const run = await boundedTriage(executor, 'failure-image', 'pnpm exec vitest run', 5, undefined, budget);

    expect(executor.calls).toHaveLength(1);
    expect(run.verdict).toMatchObject({ status: 'not-run', stopReason: 'sandbox-budget', reproduced: 1, of: 1, attemptsUsed: 1, maximumAttempts: 5 });
    expect(run.budget).toEqual({ enforced: true, budgetSec: 240, probeSec: 231.26, spentSec: 231.26, predictedSec: 1157, probes: 1 });
  });

  it.each([
    { exits: [1, 1, 1, 1, 1], status: 'real', of: 4, reason: 'failure-boundary' },
    { exits: [0, 0, 0, 0, 0], status: 'flaky', of: 4, reason: 'pass-boundary' },
    { exits: [1, 0, 1, 0, 0], status: 'intermittent', of: 5, reason: 'maximum-attempts' },
  ] as const)('reaches the legacy $status verdict when probes fit the budget', async ({ exits, status, of, reason }) => {
    const bounded = await boundedTriage(timedTriage(exits, 2), 'failure-image', 'pnpm test', 5, undefined, budget);
    const legacy = await triage(scriptedTriage(exits), 'failure-image', 'pnpm test', 5);

    expect(bounded.verdict).toEqual(legacy);
    expect(bounded.verdict).toMatchObject({ status, of, stopReason: reason });
  });

  it('numbers attempts exactly as the legacy loop does', async () => {
    const executor = timedTriage([1, 1, 1, 1, 1], 2);
    await boundedTriage(executor, 'failure-image', 'pnpm test', 5, undefined, budget);
    const legacy = scriptedTriage([1, 1, 1, 1, 1]);
    await triage(legacy, 'failure-image', 'pnpm test', 5);

    expect(executor.calls.map((call) => call.kind === 'run' ? call.cmd : '')).toEqual(legacy.calls.map((call) => call.kind === 'run' ? call.cmd : ''));
  });

  it('accounts cumulatively and gates on the slowest probe so far', async () => {
    const seconds = [40, 40, 90, 90, 90];
    const executor = new InMemoryExecutor((_cmd, _parent, callIndex) => ({
      exitCode: [1, 0, 1, 0, 1][callIndex] ?? 1, stdout: '', stderr: '', truncated: false,
      metrics: { elapsedTimeSec: seconds[callIndex] ?? 90 },
    }));

    const run = await boundedTriage(executor, 'failure-image', 'pnpm test', 5, undefined, budget);

    expect(executor.calls).toHaveLength(3);
    expect(run.verdict).toMatchObject({ status: 'not-run', stopReason: 'sandbox-budget', reproduced: 2, of: 3 });
    expect(run.budget).toEqual({ enforced: true, budgetSec: 240, probeSec: 90, spentSec: 170, predictedSec: 350, probes: 3 });
  });

  it('runs the legacy loop and reports an unenforced budget when probes report no sandbox time', async () => {
    const executor = timedTriage([1, 1, 1, 1, 1], undefined);

    const run = await boundedTriage(executor, 'failure-image', 'pnpm test', 5, undefined, budget);

    expect(run.verdict).toMatchObject({ status: 'real', of: 4 });
    expect(run.budget).toEqual({ enforced: false, budgetSec: 240 });
  });

  it('is exactly the legacy loop without a budget', async () => {
    const executor = timedTriage([1, 1, 1, 1, 1], 231.26);
    const legacy = scriptedTriage([1, 1, 1, 1, 1]);

    const run = await boundedTriage(executor, 'failure-image', 'pnpm test', 5, undefined, LEGACY_TRIAGE_POLICY);
    await triage(legacy, 'failure-image', 'pnpm test', 5);

    expect(run.budget).toBeUndefined();
    expect(run.verdict.of).toBe(4);
    expect(executor.calls.map((call) => call.kind)).toEqual(legacy.calls.map((call) => call.kind));
  });

  // Review 2026-10-03: a batch gate let probes of 1, 1, 500 and 500 s spend
  // 1002 s against a 240 s budget. The gate runs before every probe, so the
  // worst case is the budget plus one probe.
  it('gates before every probe so the worst case is the budget plus one probe', async () => {
    const seconds = [1, 1, 500, 500, 500];
    const executor = new InMemoryExecutor((_cmd, _parent, callIndex) => ({
      exitCode: 1, stdout: '', stderr: '', truncated: false,
      metrics: { elapsedTimeSec: seconds[callIndex] ?? 500 },
    }));

    const run = await boundedTriage(executor, 'failure-image', 'pnpm test', 5, undefined, budget);

    expect(executor.calls).toHaveLength(3);
    expect(run.verdict).toMatchObject({ status: 'not-run', stopReason: 'sandbox-budget', reproduced: 3, of: 3 });
    expect(run.budget).toMatchObject({ spentSec: 502, predictedSec: 1502 });
    expect(run.budget?.enforced === true && run.budget.spentSec <= 240 + 500).toBe(true);
  });

  it('matches the legacy verdict for every exit pattern and attempt limit when the budget is not reached', async () => {
    for (const N of [1, 2, 3, 5, 7]) {
      for (let mask = 0; mask < 2 ** N; mask += 1) {
        const exits = Array.from({ length: N }, (_, index) => (mask >> index) & 1);
        const bounded = await boundedTriage(timedTriage(exits, 1), 'failure-image', 'pnpm test', N, undefined, { scope: 'full', sandboxBudgetSec: 3600 });
        const legacy = await triage(scriptedTriage(exits), 'failure-image', 'pnpm test', N);
        expect(bounded.verdict, `N=${N} exits=${exits.join('')}`).toEqual(legacy);
      }
    }
  });
});


type FocusedOutcome = 'same' | 'pass' | 'other';
const FOCUSED = 'vitest run case.test.js';

/** Full probes exit by attempt; focused probes report the same failure, pass, or another failure. */
function focusedExecutor(fullExits: readonly number[], focused: readonly FocusedOutcome[], seconds = { full: 1, focused: 1 }) {
  return new InMemoryExecutor((cmd) => {
    const attempt = Number(/SUTURA_TRIAGE_ATTEMPT='?(\d+)/u.exec(cmd)?.[1]);
    const isFocused = cmd.includes(FOCUSED);
    const outcome = isFocused ? focused[attempt] ?? 'same' : undefined;
    return {
      exitCode: isFocused ? (outcome === 'pass' ? 0 : 1) : fullExits[attempt] ?? 1,
      stdout: outcome ?? 'full', stderr: '', truncated: false,
      metrics: { elapsedTimeSec: isFocused ? seconds.focused : seconds.full },
    };
  });
}

const probe: FocusedProbe = { command: FOCUSED, sameFailure: (result) => result.exitCode !== 0 && result.stdout === 'same' };
const commands = (executor: InMemoryExecutor) =>
  executor.calls.map((call) => call.kind === 'run' ? `${/SUTURA_TRIAGE_ATTEMPT='?(\d+)/u.exec(call.cmd)?.[1]}:${call.cmd.includes(FOCUSED) ? 'focused' : 'full'}` : '');

describe('boundedTriage with a focused probe', () => {
  const budget = { scope: 'focused', sandboxBudgetSec: 240 } as const;

  it('reaches real from four focused probes that fail the same way', async () => {
    const executor = focusedExecutor([1, 1, 1, 1, 1], ['same', 'same', 'same', 'same']);
    const kinds: TriageProbeKind[] = [];

    const run = await boundedTriage(executor, 'failure-image', 'pnpm exec vitest run', 5, (_result, _probe, kind) => kinds.push(kind), budget, probe);

    expect(run.verdict).toMatchObject({ status: 'real', reproduced: 4, of: 4, stopReason: 'failure-boundary' });
    expect(commands(executor)).toEqual(['0:focused', '1:focused', '2:focused', '3:focused']);
    expect(kinds).toEqual(['focused-kept', 'focused-kept', 'focused-kept', 'focused-kept']);
    expect(run.focus).toEqual({ command: FOCUSED, kept: 4, rejected: 0 });
  });

  it.each([
    { name: 'a focused pass at probe 1', focused: ['pass'], focusedCalls: ['0:focused'] },
    { name: 'a focused pass at probe 3', focused: ['same', 'same', 'pass'], focusedCalls: ['0:focused', '1:focused', '2:focused'] },
    { name: 'a different failure', focused: ['other'], focusedCalls: ['0:focused'] },
  ] as const)('restarts the full command from attempt 0 after $name', async ({ focused, focusedCalls }) => {
    const exits = [1, 0, 1, 0, 0];
    const executor = focusedExecutor(exits, focused);

    const run = await boundedTriage(executor, 'failure-image', 'pnpm exec vitest run', 5, undefined, budget, probe);
    const legacy = await triage(scriptedTriage(exits), 'failure-image', 'pnpm exec vitest run', 5);

    expect(run.verdict).toEqual(legacy);
    expect(commands(executor)).toEqual([...focusedCalls, '0:full', '1:full', '2:full', '3:full', '4:full']);
    expect(run.focus).toEqual({ command: FOCUSED, kept: focusedCalls.length - 1, rejected: 1 });
  });

  it('keeps the cumulative budget across the restart', async () => {
    const executor = focusedExecutor([1, 1, 1, 1, 1], ['same', 'same', 'pass'], { focused: 10, full: 100 });

    const run = await boundedTriage(executor, 'failure-image', 'pnpm exec vitest run', 5, undefined, budget, probe);

    expect(commands(executor)).toEqual(['0:focused', '1:focused', '2:focused', '0:full']);
    expect(run.verdict).toMatchObject({ status: 'not-run', stopReason: 'sandbox-budget', reproduced: 1, of: 1 });
    expect(run.budget).toEqual({ enforced: true, budgetSec: 240, probeSec: 100, spentSec: 130, predictedSec: 530, probes: 4 });
  });

  // Review 2026-10-03: a 41 s focused probe that passes leaves no counted
  // attempt, and 41 + 41 x 5 > 240 stopped triage with nothing to evaluate.
  it('stops on the budget right after a restart without a counted attempt', async () => {
    const executor = focusedExecutor([1, 1, 1, 1, 1], ['pass'], { focused: 60, full: 60 });

    const run = await boundedTriage(executor, 'failure-image', 'vitest run', 5, undefined, budget, probe);

    expect(commands(executor)).toEqual(['0:focused']);
    expect(run.verdict).toMatchObject({ status: 'not-run', stopReason: 'sandbox-budget', reproduced: 0, of: 0, attemptsUsed: 0, maximumAttempts: 5 });
    expect(run.budget).toEqual({ enforced: true, budgetSec: 240, probeSec: 60, spentSec: 60, predictedSec: 360, probes: 1 });
    expect(run.focus).toEqual({ command: FOCUSED, kept: 0, rejected: 1 });
  });

  it('runs focused probes without a budget', async () => {
    const executor = focusedExecutor([1, 1, 1, 1, 1], []);

    const run = await boundedTriage(executor, 'failure-image', 'vitest run', 5, undefined, { scope: 'focused' }, probe);

    expect(run.verdict).toMatchObject({ status: 'real', of: 4 });
    expect(run.budget).toBeUndefined();
    expect(run.focus).toMatchObject({ kept: 4, rejected: 0 });
  });

  // D4: narrowing can confirm a real failure but never manufacture flaky or
  // intermittent. Every focused outcome sequence against every full exit
  // pattern: a non-real verdict always comes from full probes only, and then
  // equals the legacy verdict.
  it('never reaches flaky or intermittent from focused probes', async () => {
    const outcomes: FocusedOutcome[] = ['same', 'pass', 'other'];
    const sequences: FocusedOutcome[][] = [[]];
    for (let length = 1; length <= 4; length += 1) {
      for (let code = 0; code < 3 ** length; code += 1) {
        sequences.push(Array.from({ length }, (_, index) => outcomes[Math.floor(code / 3 ** index) % 3]!));
      }
    }
    for (let mask = 0; mask < 32; mask += 1) {
      const exits = Array.from({ length: 5 }, (_, index) => (mask >> index) & 1);
      const legacy = await triage(scriptedTriage(exits), 'failure-image', 'vitest run', 5);
      for (const focused of sequences) {
        const run = await boundedTriage(focusedExecutor(exits, focused), 'failure-image', 'vitest run', 5, undefined, { scope: 'focused', sandboxBudgetSec: 3600 }, probe);
        const label = `exits=${exits.join('')} focused=${focused.join(',')}`;
        if (run.focus?.rejected === 0) {
          expect(run.verdict.status, label).toBe('real');
        } else {
          expect(run.verdict, label).toEqual(legacy);
        }
      }
    }
  });
});
