import { describe, expect, it, vi } from 'vitest';

import type { Diagnosis } from '../domain.js';
import type { Executor, RunResult } from '../executor/types.js';
import type { ChatMessage, ChatOptions, FunctionToolCall, TierLlm } from '../llm/types.js';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import { DEFAULT_REPAIR_BUDGET_LIMITS, RepairBudget } from './repair-budget.js';
import { runRepairAgent } from './repair-agent.js';

const diagnosis: Diagnosis = {
  class: 'test-assertion', confidence: 1, signals: [], failingCmd: 'pnpm test', errorExcerpt: 'failed',
};
const diff = [
  'diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts',
  '@@ -1 +1 @@', '-export const a = 1;', '+export const a = 2;', '',
].join('\n');
function call(name: string, args: unknown, index: number): FunctionToolCall {
  return { id: `call-${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}
function result(imageId: string, stdout = '', exitCode = 0): RunResult {
  return { imageId, stdout, stderr: '', exitCode, truncated: false, metrics: {} };
}

describe('runRepairAgent', () => {
  it('requires tool calls and submits only a tested cumulative candidate', async () => {
    const replies = [
      call('apply_patch', { diff }, 1),
      call('run_test', { commandId: 'diagnosed' }, 2),
      call('submit_candidate', { id: 'fix', rationale: 'minimal repair' }, 3),
    ];
    const chat = vi.fn(async (
      _tier: 'super',
      _messages: readonly ChatMessage[],
      _options?: ChatOptions,
    ) => {
      void _tier;
      void _messages;
      void _options;
      return { text: '', toolCalls: [replies.shift()!], usd: 0.01 };
    });
    const runs = [result('patched', diff), result('test-child', 'passed')];
    const run = vi.fn(async () => runs.shift()!);
    const executor = { run, runMany: vi.fn(), importImage: vi.fn(), snapshot: vi.fn() } as unknown as Executor;
    const outcome = await runRepairAgent({
      llm: { chat } as TierLlm<'super'>, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(),
      budget: new RepairBudget(DEFAULT_REPAIR_BUDGET_LIMITS),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext: { sources: [] },
    });

    expect(outcome).toMatchObject({ status: 'submitted', candidate: { id: 'fix', diff }, imageId: 'patched' });
    expect(run).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls.every(([, , options]) =>
      options?.toolChoice === 'required' && options.parallelToolCalls === false,
    )).toBe(true);
  });

  it('stops repeated identical malformed calls before consuming every turn', async () => {
    const invalid = { id: 'bad', type: 'function' as const, function: { name: 'read_file', arguments: '{' } };
    const chat = vi.fn(async () => ({ text: 'hidden reasoning', toolCalls: [invalid], usd: 0.001 }));
    const executor = { run: vi.fn(), runMany: vi.fn(), importImage: vi.fn(), snapshot: vi.fn() } as unknown as Executor;
    const outcome = await runRepairAgent({
      llm: { chat } as TierLlm<'super'>, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(DEFAULT_REPAIR_BUDGET_LIMITS),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext: { sources: [] },
    });

    expect(outcome).toMatchObject({ status: 'gave-up', reason: expect.stringContaining('repeated') });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(executor.run).not.toHaveBeenCalled();
  });

  it('stops the same failing test state without exhausting every budget', async () => {
    const failing = call('run_test', { commandId: 'diagnosed' }, 1);
    const chat = vi.fn(async () => ({ text: '', toolCalls: [failing], usd: 0.001 }));
    const run = vi.fn(async () => result('test-child', 'still failing', 1));
    const executor = { run, runMany: vi.fn(), importImage: vi.fn(), snapshot: vi.fn() } as unknown as Executor;
    const outcome = await runRepairAgent({
      llm: { chat } as TierLlm<'super'>, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(DEFAULT_REPAIR_BUDGET_LIMITS),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext: { sources: [] },
    });

    expect(outcome).toMatchObject({ status: 'gave-up', reason: expect.stringContaining('repeated repair state') });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('rejects parallel mutating tool calls before sandbox execution', async () => {
    const parallel = [
      call('apply_patch', { diff }, 1),
      call('submit_candidate', { id: 'fix', rationale: 'repair' }, 2),
    ];
    const chat = vi.fn(async () => ({ text: '', toolCalls: parallel, usd: 0.001 }));
    const executor = { run: vi.fn(), runMany: vi.fn(), importImage: vi.fn(), snapshot: vi.fn() } as unknown as Executor;
    const outcome = await runRepairAgent({
      llm: { chat } as TierLlm<'super'>, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(DEFAULT_REPAIR_BUDGET_LIMITS),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext: { sources: [] },
    });

    expect(outcome).toMatchObject({ status: 'gave-up', reason: expect.stringContaining('parallel mutating') });
    expect(executor.run).not.toHaveBeenCalled();
  });

  it('aborts an in-flight model call when the elapsed budget expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const chat = vi.fn(async (
        _tier: 'super',
        _messages: readonly ChatMessage[],
        options?: ChatOptions,
      ) => new Promise<{ text: string }>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }));
      const executor = { run: vi.fn(), runMany: vi.fn(), importImage: vi.fn(), snapshot: vi.fn() } as unknown as Executor;
      const pending = runRepairAgent({
        llm: { chat } as TierLlm<'super'>, executor, initialImageId: 'baseline', diagnosis,
        policy: createDefaultRepositoryPolicy(),
        budget: new RepairBudget({ ...DEFAULT_REPAIR_BUDGET_LIMITS, elapsedTimeSec: 1 }),
        trustedCommands: { diagnosed: 'pnpm test' }, sourceContext: { sources: [] },
      });

      await vi.advanceTimersByTimeAsync(1_000);
      await expect(pending).resolves.toMatchObject({ status: 'gave-up', failureKind: 'budget' });
      expect(chat.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
