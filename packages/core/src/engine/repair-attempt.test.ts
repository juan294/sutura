import { describe, expect, it, vi } from 'vitest';

import type { Diagnosis } from '../domain.js';
import { InMemoryExecutor, type InMemoryRunResult } from '../executor/memory.js';
import { DEFAULT_MODEL_PRICES } from '../llm/cost.js';
import type { ChatMessage, ChatOptions, TierLlm } from '../llm/types.js';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import { RepairBudget } from './repair-budget.js';
import { runControlledRepairAttempt } from './repair-attempt.js';
import type { RepairSourceContext } from './repair.js';

const diagnosis: Diagnosis = {
  class: 'test-assertion', confidence: 0.98, signals: ['expected 5'],
  failingCmd: 'pnpm test', errorExcerpt: 'expected -1 to be 5',
};
const sourceContext: RepairSourceContext = { sources: [{
  path: 'packages/core/src/dogfood-add.ts', startLine: 1, truncated: false,
  content: 'export function add(left: number, right: number): number {\n  return left - right;\n}\n',
}] };
const diff = [
  'diff --git a/packages/core/src/dogfood-add.ts b/packages/core/src/dogfood-add.ts',
  '--- a/packages/core/src/dogfood-add.ts', '+++ b/packages/core/src/dogfood-add.ts',
  '@@ -1,3 +1,3 @@', ' export function add(left: number, right: number): number {',
  '-  return left - right;', '+  return left + right;', ' }', '',
].join('\n');

function runResult(exitCode: number, stdout = '', stderr = ''): InMemoryRunResult {
  return { exitCode, stdout, stderr, truncated: false, metrics: {} };
}

function llm(
  text: string,
  price = DEFAULT_MODEL_PRICES.super,
): { model: TierLlm<'super'>; chat: ReturnType<typeof vi.fn> } {
  const chat = vi.fn(async (
    _tier: 'super',
    _messages: readonly ChatMessage[],
    _options?: ChatOptions,
  ) => {
    void _tier;
    void _messages;
    void _options;
    return { text, usd: 0.01 };
  });
  const model: TierLlm<'super'> = {
    modelQuote: vi.fn(() => ({
      role: 'super' as const, modelId: 'super', price, profileId: 'test',
    })),
    chat,
  };
  return { model, chat };
}

describe('runControlledRepairAttempt', () => {
  it('replays live run 8: an accepted patch is tested and submitted without exploration', async () => {
    const results = [
      runResult(0, diff),
      runResult(0, '1 passed'),
    ];
    const executor = new InMemoryExecutor((_command, _parent, index) => results[index]!);
    const { model, chat } = llm(JSON.stringify({
      id: 'fix-add', rationale: 'Use addition for the add function.',
      edits: [{ path: 'packages/core/src/dogfood-add.ts', startLine: 2, endLine: 2, new: '  return left + right;' }],
    }));
    const budget = new RepairBudget();

    const outcome = await runControlledRepairAttempt({
      llm: model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(),
      budget, trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
      branchId: 'search-001',
    });

    expect(outcome).toMatchObject({ status: 'submitted', candidate: { id: 'fix-add', diff } });
    expect(chat).toHaveBeenCalledOnce();
    const options = chat.mock.calls[0]?.[2] as ChatOptions | undefined;
    expect(options).toMatchObject({ responseFormat: { type: 'json_schema' } });
    expect(options).toMatchObject({ maxTokens: 16_384, temperature: 1, reasoningEffort: 'low' });
    expect(JSON.stringify(options)).toContain('"startLine"');
    expect(JSON.stringify(options)).not.toContain('"old"');
    expect(options).not.toHaveProperty('tools');
    expect(executor.calls.map((call) => call.kind === 'run' ? call.cmd : '')).toEqual([
      expect.stringContaining('git apply'), 'pnpm test',
    ]);
    expect(budget.snapshot()).toMatchObject({ modelTurns: 1, toolCalls: 3, branches: 1, sandboxOperations: 2 });
  });

  it('returns a checkpoint immediately after a trusted test failure', async () => {
    const results = [
      runResult(0, diff),
      runResult(1, '', 'expected 7 to be 5'),
    ];
    const executor = new InMemoryExecutor((_command, _parent, index) => results[index]!);
    const outcome = await runControlledRepairAttempt({
      llm: llm(JSON.stringify({
        id: 'wrong', rationale: 'First bounded attempt.',
        edits: [{ path: 'packages/core/src/dogfood-add.ts', startLine: 2, endLine: 2, new: '  return left * right;' }],
      })).model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(),
      budget: new RepairBudget(), trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    });

    expect(outcome).toMatchObject({ status: 'checkpoint', test: { exitCode: 1 } });
    expect(executor.calls).toHaveLength(2);
  });

  it('rejects missing bounded source before repair inference or sandbox work', async () => {
    const executor = new InMemoryExecutor(() => runResult(1));
    const { model, chat } = llm('not json');
    const empty = await runControlledRepairAttempt({
      llm: model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(),
      budget: new RepairBudget(), trustedCommands: { diagnosed: 'pnpm test' }, sourceContext: { sources: [] },
    });
    expect(empty).toMatchObject({ status: 'gave-up', failureKind: 'invalid' });
    expect(chat).not.toHaveBeenCalled();
    expect(executor.calls).toHaveLength(0);
  });

  it('replays live run 9: search-only text is invalid and cannot exhaust tool or sandbox budgets', async () => {
    const executor = new InMemoryExecutor(() => runResult(1));
    const { model, chat } = llm('Search the repository for the implementation.');

    const invalid = await runControlledRepairAttempt({
      llm: model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(),
      budget: new RepairBudget(), trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    });
    expect(invalid).toMatchObject({ status: 'gave-up', failureKind: 'invalid' });
    expect(chat).toHaveBeenCalledOnce();
    expect(executor.calls).toHaveLength(0);
  });

  it('replays live run 12: a provider length terminal is not misreported as malformed JSON', async () => {
    const executor = new InMemoryExecutor(() => runResult(1));
    const value = llm('{"id":"truncated"');
    value.chat.mockResolvedValueOnce({
      text: '{"id":"truncated"', usd: 0.01, finishReason: 'length',
    });

    const outcome = await runControlledRepairAttempt({
      llm: value.model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    });

    expect(outcome).toMatchObject({
      status: 'gave-up', failureKind: 'completion-limit',
      reason: 'Repair proposal reached the provider completion-token limit',
    });
    expect(executor.calls).toHaveLength(0);
  });

  it('replays live runs 1 and 2: unsupported parallel and tool-choice fields are absent', async () => {
    const executor = new InMemoryExecutor((_command, _parent, index) => [
      runResult(0, diff), runResult(0, '1 passed'),
    ][index]!);
    const { model, chat } = llm(JSON.stringify({
      id: 'compatible', rationale: 'Use one strict structured response.',
      edits: [{ path: 'packages/core/src/dogfood-add.ts', startLine: 2, endLine: 2, new: '  return left + right;' }],
    }));

    await runControlledRepairAttempt({
      llm: model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    });

    const options = chat.mock.calls[0]?.[2] as ChatOptions | undefined;
    expect(options).not.toHaveProperty('parallelToolCalls');
    expect(options).not.toHaveProperty('toolChoice');
    expect(options).not.toHaveProperty('tools');
  });

  it('replays live run 11: provider and local proposal bounds use one contract', async () => {
    const executor = new InMemoryExecutor(() => runResult(1));
    const { model, chat } = llm(JSON.stringify({
      id: 'x'.repeat(81), rationale: 'This exceeds the declared candidate ID bound.',
      edits: [{ path: 'packages/core/src/dogfood-add.ts', startLine: 2, endLine: 2, new: '  return left + right;' }],
    }));

    const outcome = await runControlledRepairAttempt({
      llm: model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    });

    expect(outcome).toMatchObject({ status: 'gave-up', failureKind: 'invalid' });
    expect(executor.calls).toHaveLength(0);
    expect(chat.mock.calls[0]?.[2]).toMatchObject({ responseFormat: { jsonSchema: { schema: {
      properties: {
        id: { minLength: 1, maxLength: 80 },
        rationale: { minLength: 1, maxLength: 240 },
        edits: { minItems: 1, maxItems: 8, items: { properties: {
          path: { minLength: 1, maxLength: 240, pattern: '\\S' },
          startLine: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
          endLine: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
          new: { maxLength: 12_000 },
        } } },
      },
    } } } });
    expect(chat.mock.calls[0]?.[2]).toMatchObject({ responseFormat: { jsonSchema: { schema: {
      properties: {
        id: { pattern: '\\S' },
        rationale: { pattern: '\\S' },
      },
    } } } });
  });

  it('uses JSON Schema code-point lengths and rejects unsafe line anchors locally', async () => {
    const acceptedExecutor = new InMemoryExecutor((_command, _parent, index) => [
      runResult(0, diff), runResult(0, '1 passed'),
    ][index]!);
    await expect(runControlledRepairAttempt({
      llm: llm(JSON.stringify({
        id: '😀'.repeat(80), rationale: 'A Unicode ID at the declared limit.',
        edits: [{ path: 'packages/core/src/dogfood-add.ts', startLine: 2, endLine: 2, new: '  return left + right;' }],
      })).model,
      executor: acceptedExecutor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    })).resolves.toMatchObject({ status: 'submitted' });

    const rejectedExecutor = new InMemoryExecutor(() => runResult(1));
    await expect(runControlledRepairAttempt({
      llm: llm(JSON.stringify({
        id: 'unsafe-line', rationale: 'Reject an unsafe JSON integer.',
        edits: [{
          path: 'packages/core/src/dogfood-add.ts',
          startLine: Number.MAX_SAFE_INTEGER + 1,
          endLine: Number.MAX_SAFE_INTEGER + 1,
          new: '',
        }],
      })).model,
      executor: rejectedExecutor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    })).resolves.toMatchObject({ status: 'gave-up', failureKind: 'invalid' });
    expect(rejectedExecutor.calls).toHaveLength(0);
  });

  it('returns typed provider, policy, sandbox, cancellation, and budget terminals', async () => {
    const provider = llm('unused');
    provider.chat.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(runControlledRepairAttempt({
      llm: provider.model, executor: new InMemoryExecutor(() => runResult(1)),
      initialImageId: 'baseline', diagnosis, policy: createDefaultRepositoryPolicy(),
      budget: new RepairBudget(), trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    })).resolves.toMatchObject({ status: 'infra-stop', failureKind: 'provider' });

    const protectedPolicy = createDefaultRepositoryPolicy();
    protectedPolicy.protectedPaths.push('packages/core/src/dogfood-add.ts');
    await expect(runControlledRepairAttempt({
      llm: llm(JSON.stringify({
        id: 'policy', rationale: 'Attempt a protected edit.',
        edits: [{ path: 'packages/core/src/dogfood-add.ts', startLine: 2, endLine: 2, new: '  return left + right;' }],
      })).model,
      executor: new InMemoryExecutor(() => runResult(1)), initialImageId: 'baseline', diagnosis,
      policy: protectedPolicy, budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    })).resolves.toMatchObject({ status: 'gave-up', failureKind: 'policy' });

    let runIndex = 0;
    const missingTest = new InMemoryExecutor(() => {
      runIndex += 1;
      if (runIndex === 1) return runResult(0, diff);
      throw new Error('trusted test evidence unavailable');
    });
    await expect(runControlledRepairAttempt({
      llm: llm(JSON.stringify({
        id: 'sandbox', rationale: 'Repair before unavailable test evidence.',
        edits: [{ path: 'packages/core/src/dogfood-add.ts', startLine: 2, endLine: 2, new: '  return left + right;' }],
      })).model,
      executor: missingTest, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    })).resolves.toMatchObject({ status: 'gave-up', failureKind: 'sandbox' });

    const controller = new AbortController();
    controller.abort();
    const cancelled = llm('unused');
    await expect(runControlledRepairAttempt({
      llm: cancelled.model, executor: new InMemoryExecutor(() => runResult(1)),
      initialImageId: 'baseline', diagnosis, policy: createDefaultRepositoryPolicy(),
      budget: new RepairBudget(), trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
      signal: controller.signal,
    })).resolves.toMatchObject({ status: 'gave-up', failureKind: 'sandbox' });
    expect(cancelled.chat).not.toHaveBeenCalled();

    const expensive = llm('unused', { input: 100, output: 100 });
    await expect(runControlledRepairAttempt({
      llm: expensive.model, executor: new InMemoryExecutor(() => runResult(1)),
      initialImageId: 'baseline', diagnosis, policy: createDefaultRepositoryPolicy(),
      budget: new RepairBudget({ inferenceCostUsd: 0.01 }),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    })).resolves.toMatchObject({ status: 'gave-up', failureKind: 'budget' });
    expect(expensive.chat).not.toHaveBeenCalled();
  });

  it('replays live run 7: a trusted-test timeout becomes checkpoint evidence without another model turn', async () => {
    const executor = new InMemoryExecutor((_command, _parent, index) => [
      runResult(0, diff), runResult(-1, '', 'command timed out'),
    ][index]!);
    const { model, chat } = llm(JSON.stringify({
      id: 'timeout', rationale: 'Apply the source correction before verification.',
      edits: [{ path: 'packages/core/src/dogfood-add.ts', startLine: 2, endLine: 2, new: '  return left + right;' }],
    }));

    const outcome = await runControlledRepairAttempt({
      llm: model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
    });

    expect(outcome).toMatchObject({
      status: 'checkpoint', test: { exitCode: -1, output: expect.stringContaining('timed out') },
    });
    expect(chat).toHaveBeenCalledOnce();
    expect(executor.calls).toHaveLength(2);
  });

  it('does not submit a candidate when cancellation arrives during the trusted test', async () => {
    const controller = new AbortController();
    const executor = new InMemoryExecutor((_command, _parent, index) => {
      if (index === 0) return runResult(0, diff);
      controller.abort();
      return runResult(0, '1 passed');
    });
    const { model, chat } = llm(JSON.stringify({
      id: 'cancelled', rationale: 'Repair before branch cancellation.',
      edits: [{ path: 'packages/core/src/dogfood-add.ts', startLine: 2, endLine: 2, new: '  return left + right;' }],
    }));
    const budget = new RepairBudget();

    const outcome = await runControlledRepairAttempt({
      llm: model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget,
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext,
      signal: controller.signal,
    });

    expect(outcome).toMatchObject({ status: 'gave-up', failureKind: 'sandbox' });
    expect(chat).toHaveBeenCalledOnce();
    expect(executor.calls).toHaveLength(2);
    expect(budget.snapshot().toolCalls).toBe(2);
  });
});
