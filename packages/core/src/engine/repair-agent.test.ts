import { describe, expect, it, vi } from 'vitest';

import type { Diagnosis } from '../domain.js';
import type { Executor, RunResult } from '../executor/types.js';
import type { ChatMessage, ChatOptions, FunctionToolCall, TierLlm } from '../llm/types.js';
import { DEFAULT_MODEL_PRICES, type ModelPrice } from '../llm/cost.js';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import { DEFAULT_REPAIR_BUDGET_LIMITS, RepairBudget } from './repair-budget.js';
import { runRepairAgent } from './repair-agent.js';
import { TraceRecorder } from '../trace/recorder.js';

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

function quotedLlm(
  chat: TierLlm<'super'>['chat'],
  price: ModelPrice = DEFAULT_MODEL_PRICES.super,
): TierLlm<'super'> {
  return {
    chat,
    modelQuote: () => ({
      role: 'super', modelId: 'nvidia/test-super', price,
      profileId: 'test-profile',
    }),
  };
}

describe('runRepairAgent', () => {
  it('automatically tests and submits an accepted patch', async () => {
    const patchCall = call('apply_patch', { diff }, 1);
    const chat = vi.fn(async (
      _tier: 'super',
      _messages: readonly ChatMessage[],
      _options?: ChatOptions,
    ) => {
      void _tier;
      void _messages;
      void _options;
      return { text: '', toolCalls: [patchCall], usd: 0.01 };
    });
    const runs = [result('patched', diff), result('test-child', 'passed')];
    const run = vi.fn(async () => runs.shift()!);
    const executor = { run, runMany: vi.fn(), importImage: vi.fn(), snapshot: vi.fn() } as unknown as Executor;
    const budget = new RepairBudget(DEFAULT_REPAIR_BUDGET_LIMITS);
    const trace = new TraceRecorder('repair-agent-success');
    const outcome = await runRepairAgent({
      llm: quotedLlm(chat), executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(),
      budget,
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext: { sources: [] },
      trace,
    });

    expect(outcome).toMatchObject({
      status: 'submitted',
      candidate: { id: 'repair-candidate', diff },
      imageId: 'patched',
      test: { commandId: 'diagnosed', exitCode: 0 },
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(chat).toHaveBeenCalledOnce();
    expect(budget.snapshot()).toMatchObject({ toolCalls: 3, sandboxOperations: 2 });
    expect(trace.events().flatMap((event) => {
      if (event.type === 'candidate-submitted') return [[event.type, event.candidateId]];
      if (event.type === 'tool-request' || event.type === 'tool-result') {
        return [[event.type, event.toolCallId, event.toolName]];
      }
      return [];
    })).toEqual([
      ['tool-request', 'call-1', 'apply_patch'],
      ['tool-result', 'call-1', 'apply_patch'],
      ['tool-request', 'call-1-automatic-test', 'run_test'],
      ['tool-result', 'call-1-automatic-test', 'run_test'],
      ['tool-request', 'call-1-automatic-submit', 'submit_candidate'],
      ['tool-result', 'call-1-automatic-submit', 'submit_candidate'],
      ['candidate-submitted', 'repair-candidate'],
    ]);
    expect(chat.mock.calls.every(([, , options]) =>
      options?.toolChoice === 'auto' && !('parallelToolCalls' in options),
    )).toBe(true);
  });

  it('returns an automatic checkpoint when an accepted patch still fails', async () => {
    const chat = vi.fn(async () => ({
      text: '',
      toolCalls: [call('apply_patch', { diff }, 1)],
      usd: 0.01,
    }));
    const runs = [result('patched', diff), result('test-child', 'still failing', 1)];
    const run = vi.fn(async () => runs.shift()!);
    const executor = { run, runMany: vi.fn(), importImage: vi.fn(), snapshot: vi.fn() } as unknown as Executor;

    const outcome = await runRepairAgent({
      llm: quotedLlm(chat), executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(),
      budget: new RepairBudget(DEFAULT_REPAIR_BUDGET_LIMITS),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext: { sources: [] },
      branchId: 'search-001',
    });

    expect(outcome).toMatchObject({
      status: 'checkpoint',
      candidate: { id: 'search-001', diff },
      imageId: 'patched',
      test: { commandId: 'diagnosed', exitCode: 1 },
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(chat).toHaveBeenCalledOnce();
  });

  it('fails closed when the automatic submission tool budget is exhausted', async () => {
    const chat = vi.fn(async () => ({
      text: '', toolCalls: [call('apply_patch', { diff }, 1)], usd: 0.01,
    }));
    const runs = [result('patched', diff), result('test-child', 'passed')];
    const run = vi.fn(async () => runs.shift()!);
    const executor = { run, runMany: vi.fn(), importImage: vi.fn(), snapshot: vi.fn() } as unknown as Executor;
    const budget = new RepairBudget({ ...DEFAULT_REPAIR_BUDGET_LIMITS, toolCalls: 2 });

    const outcome = await runRepairAgent({
      llm: quotedLlm(chat), executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget,
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext: { sources: [] },
    });

    expect(outcome).toMatchObject({ status: 'gave-up', failureKind: 'budget' });
    expect(run).toHaveBeenCalledTimes(2);
    expect(chat).toHaveBeenCalledOnce();
    expect(budget.snapshot()).toMatchObject({ toolCalls: 2, sandboxOperations: 2 });
  });

  it('does not start automatic verification after cancellation during patching', async () => {
    const controller = new AbortController();
    const chat = vi.fn(async () => ({
      text: '', toolCalls: [call('apply_patch', { diff }, 1)], usd: 0.01,
    }));
    const run = vi.fn(async () => {
      controller.abort();
      return result('patched', diff);
    });
    const executor = { run, runMany: vi.fn(), importImage: vi.fn(), snapshot: vi.fn() } as unknown as Executor;

    const outcome = await runRepairAgent({
      llm: quotedLlm(chat), executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(DEFAULT_REPAIR_BUDGET_LIMITS),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext: { sources: [] },
      signal: controller.signal,
    });

    expect(outcome).toMatchObject({ status: 'gave-up', reason: 'Repair branch was cancelled' });
    expect(run).toHaveBeenCalledOnce();
  });

  it('does not submit after cancellation during automatic verification', async () => {
    const controller = new AbortController();
    const chat = vi.fn(async () => ({
      text: '', toolCalls: [call('apply_patch', { diff }, 1)], usd: 0.01,
    }));
    const runs = [result('patched', diff), result('test-child', 'passed')];
    const run = vi.fn(async () => {
      const next = runs.shift()!;
      if (next.imageId === 'test-child') controller.abort();
      return next;
    });
    const executor = { run, runMany: vi.fn(), importImage: vi.fn(), snapshot: vi.fn() } as unknown as Executor;
    const budget = new RepairBudget(DEFAULT_REPAIR_BUDGET_LIMITS);

    const outcome = await runRepairAgent({
      llm: quotedLlm(chat), executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget,
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext: { sources: [] },
      signal: controller.signal,
    });

    expect(outcome).toMatchObject({ status: 'gave-up', reason: 'Repair branch was cancelled' });
    expect(run).toHaveBeenCalledTimes(2);
    expect(budget.snapshot().toolCalls).toBe(2);
  });

  it('stops repeated identical malformed calls before consuming every turn', async () => {
    const invalid = { id: 'bad', type: 'function' as const, function: { name: 'read_file', arguments: '{' } };
    const chat = vi.fn(async () => ({ text: 'hidden reasoning', toolCalls: [invalid], usd: 0.001 }));
    const executor = { run: vi.fn(), runMany: vi.fn(), importImage: vi.fn(), snapshot: vi.fn() } as unknown as Executor;
    const outcome = await runRepairAgent({
      llm: quotedLlm(chat), executor, initialImageId: 'baseline', diagnosis,
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
      llm: quotedLlm(chat), executor, initialImageId: 'baseline', diagnosis,
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
      llm: quotedLlm(chat), executor, initialImageId: 'baseline', diagnosis,
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
        llm: quotedLlm(chat), executor, initialImageId: 'baseline', diagnosis,
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

  it('reserves the routed model quote before sending repair inference', async () => {
    const chat = vi.fn(async () => ({ text: '', toolCalls: [], usd: 0 }));
    const executor = {
      run: vi.fn(), runMany: vi.fn(), importImage: vi.fn(), snapshot: vi.fn(),
    } as unknown as Executor;

    const outcome = await runRepairAgent({
      llm: quotedLlm(chat, { input: 100, output: 100 }),
      executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(DEFAULT_REPAIR_BUDGET_LIMITS),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext: { sources: [] },
    });

    expect(outcome).toMatchObject({ status: 'gave-up', failureKind: 'budget' });
    expect(chat).not.toHaveBeenCalled();
  });
});
