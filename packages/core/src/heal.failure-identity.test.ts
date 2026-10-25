import { expect, it, vi } from 'vitest';
import { InMemoryExecutor } from './executor/memory.js';
import { repairFailure } from './heal.js';
import { triageSentence } from './report/format.js';
import { BudgetExceededError } from './engine/repair-budget.js';

const original = 'Run pnpm exec vitest run\n FAIL src/add.test.ts > adds\nAssertionError: expected 2 to be 3\n';

it.each([
  ['mismatch', original.replace('to be 3', 'to be 4'), false],
  ['unavailable', '', true],
] as const)('stops a %s baseline before classification, grounding, or repeated probes', async (status, output, truncated) => {
  const chat = vi.fn(async () => { throw new Error('Inference must not be reached'); });
  const search = vi.fn(async () => []);
  const executor = new InMemoryExecutor(() => ({ exitCode: 1, stdout: output, stderr: '', truncated, metrics: { elapsedTimeSec: 3 } }));
  const file = await repairFailure({
    runId: 'identity-case', repo: 'example/project', failedLog: original, failingImage: 'baseline',
    executor, llm: { chat }, tavily: { search }, cost: { entries: [], totalUsd: () => 0 },
    triageN: 5, raceK: 1, readSourceContext: async () => ({ sources: [] }),
  });
  expect(file.outcome).toBe('gave-up');
  expect(file.reproduction?.status).toBe(status);
  expect(file.triage).toMatchObject({ status: 'not-run', stopReason: 'failure-identity', reproduced: 0 });
  expect(chat).not.toHaveBeenCalled();
  expect(search).not.toHaveBeenCalled();
  expect(executor.calls).toHaveLength(1);
  expect(file.stages.some(stage => stage.metrics.elapsedTimeSec === 3)).toBe(true);
  expect(triageSentence(file)).toContain(status);
});

it('retains matched reproduction proof when later inference exhausts its budget', async () => {
  const executor = new InMemoryExecutor(() => ({ exitCode: 1, stdout: original, stderr: '', truncated: false, metrics: { elapsedTimeSec: 3 } }));
  const file = await repairFailure({
    runId: 'identity-budget', repo: 'example/project', failedLog: original, failingImage: 'baseline',
    executor, llm: { modelQuote: () => { throw new BudgetExceededError('inferenceCostUsd'); },
      chat: async () => { throw new Error('Exhausted inference must not dispatch'); } },
    cost: { entries: [], totalUsd: () => 0 }, triageN: 5, raceK: 1,
    readSourceContext: async () => ({ sources: [] }),
  });
  expect(file.outcome).toBe('gave-up');
  expect(file.reproduction).toMatchObject({ status: 'matched', version: 'sutura-failure-identity-v1' });
  expect(file.reproduction?.nativeFingerprint).toBe(file.reproduction?.sandboxFingerprint);
});
