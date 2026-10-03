import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  boundedTriage,
  focusedTriage,
  InMemoryExecutor,
  sameFailure,
  triage,
  type FocusedTriage,
} from '@sutura/core';
import { describe, expect, it } from 'vitest';

import { discoverBenchmarkCases, fixtureTestCommand } from './corpus.js';
import type { CorpusCase } from './types.js';

const FOCUS_FIXTURES = new URL('../../core/src/engine/focus/__fixtures__/', import.meta.url);
// Real vitest 4.1.11 output of the flaky-timer-race fixture at a failing and a
// passing SUTURA_TRIAGE_ATTEMPT.
const FAIL = await readFile(new URL('vitest-default-fail.log', FOCUS_FIXTURES), 'utf8');
const PASS = await readFile(new URL('vitest-focused-pass.log', FOCUS_FIXTURES), 'utf8');

/** The command the benchmark triages: the fixture's `scripts.test`, or the Python suite command. */
async function triagedCommand(benchmarkCase: CorpusCase): Promise<string> {
  if (benchmarkCase.metadata.language === 'python') return fixtureTestCommand('python');
  const manifest = JSON.parse(await readFile(join(benchmarkCase.fixtureDirectory, 'package.json'), 'utf8')) as {
    scripts?: { test?: string };
  };
  return manifest.scripts?.test ?? '';
}

const cases = await discoverBenchmarkCases(undefined, { includeVersionedCases: true });

describe('focused triage on the Placebo benchmark', () => {
  it('applies only to the single-command vitest run cases', async () => {
    const applied: string[] = [];
    for (const benchmarkCase of cases) {
      const command = await triagedCommand(benchmarkCase);
      const result = focusedTriage(command, FAIL);
      if ('focus' in result) {
        applied.push(benchmarkCase.id);
        expect(command, benchmarkCase.id).toBe('vitest run');
        expect(result.focus.command).toBe('vitest run case.test.js');
      } else {
        expect(command, benchmarkCase.id).not.toBe('vitest run');
        expect(result.reason, benchmarkCase.id).toMatch(/shell syntax|not a direct/u);
      }
    }
    expect(applied.length).toBeGreaterThan(0);
  });

  // D5: a flaky fixture keys its behaviour on SUTURA_TRIAGE_ATTEMPT, which a
  // focused probe keeps. Focused probes fail the same way while the fixture
  // fails and pass when it passes, so the first pass restarts the full command
  // and the verdict, reproduced and of stay those of the legacy loop.
  it('keeps every flaky fixture verdict and reproduced/of', async () => {
    const flaky = cases.filter(({ metadata }) => metadata.kind === 'flaky' && metadata.language !== 'python');
    expect(flaky.length).toBeGreaterThan(0);
    const focus = (focusedTriage('vitest run', FAIL) as { focus: FocusedTriage }).focus;
    for (const benchmarkCase of flaky) {
      const exits = benchmarkCase.metadata.triageExitCodes ?? [];
      const executor = new InMemoryExecutor((command) => {
        const attempt = Number(/SUTURA_TRIAGE_ATTEMPT='?(\d+)/u.exec(command)?.[1]);
        const exitCode = exits[attempt] ?? 1;
        return {
          exitCode, stdout: command.includes(focus.command) && exitCode === 0 ? PASS : FAIL, stderr: '', truncated: false,
          metrics: { elapsedTimeSec: 2 },
        };
      });
      const run = await boundedTriage(executor, 'failure-image', 'vitest run', 5, undefined,
        { scope: 'focused', sandboxBudgetSec: 240 },
        { command: focus.command, sameFailure: (result) => sameFailure(focus, result.stdout, result.exitCode) });
      const legacy = await triage(new InMemoryExecutor((_command, _parent, index) => ({
        exitCode: exits[index] ?? 1, stdout: '', stderr: '', truncated: false, metrics: {},
      })), 'failure-image', 'vitest run', 5);

      expect(run.verdict, benchmarkCase.id).toEqual(legacy);
      expect(run.verdict.reproduced, benchmarkCase.id).toBe(exits.slice(0, run.verdict.of).filter((code) => code !== 0).length);
    }
  });
});
