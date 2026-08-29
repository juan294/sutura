import { describe, expect, it, vi } from 'vitest';

import type { Diagnosis } from '../domain.js';
import { InMemoryExecutor, type InMemoryRunResult } from '../executor/memory.js';
import { DEFAULT_MODEL_PRICES } from '../llm/cost.js';
import type { ChatMessage, ChatOptions, TierLlm } from '../llm/types.js';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import { RepairBudget } from './repair-budget.js';
import {
  prepareControlledRepairProposalTemplate,
  runControlledRepairAttempt,
} from './repair-attempt.js';
import { anchoredEditsDiff, type RepairSourceContext } from './repair.js';

const diagnosis: Diagnosis = {
  class: 'test-assertion', confidence: 0.98, signals: ['expected 5'],
  failingCmd: 'pnpm test', errorExcerpt: 'expected -1 to be 5',
};
const sourceContext: RepairSourceContext = { sources: [{
  path: 'packages/core/src/dogfood-add.ts', startLine: 1, truncated: false,
  content: 'export function add(left: number, right: number): number {\n  return left - right;\n}\n',
}] };
const ambiguousSourceContext: RepairSourceContext = { sources: [
  {
    path: 'packages/core/src/dogfood-add.test.ts', startLine: 1, truncated: false,
    content: [
      "import { expect, it } from 'vitest';", '', "import { add } from './dogfood-add.js';", '',
      "it('adds two values', () => {", '  expect(add(2, 3)).toBe(5);', '});', '',
    ].join('\n'),
  },
  sourceContext.sources[0]!,
] };
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

    const emptyFile = await runControlledRepairAttempt({
      llm: model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' },
      sourceContext: { sources: [{ path: 'src/empty.ts', startLine: 1, content: '', truncated: false }] },
    });
    expect(emptyFile).toMatchObject({
      status: 'gave-up', failureKind: 'invalid',
      reason: 'No non-empty anchorable repair source was available',
    });
    expect(chat).not.toHaveBeenCalled();
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

  it('replays live run 13: the provider schema binds each edit range to its source path', async () => {
    const executor = new InMemoryExecutor(() => runResult(1));
    const value = llm(JSON.stringify({
      id: 'wrong-line', rationale: 'Use the assertion stack line.',
      edits: [{
        path: 'packages/core/src/dogfood-add.ts', startLine: 6, endLine: 6,
        new: '  return left + right;',
      }],
    }));

    const outcome = await runControlledRepairAttempt({
      llm: value.model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext: ambiguousSourceContext,
    });

    expect(outcome).toMatchObject({ status: 'gave-up', failureKind: 'invalid' });
    expect(executor.calls).toHaveLength(0);
    const messages = value.chat.mock.calls[0]?.[1] as readonly ChatMessage[] | undefined;
    const user = messages?.find(({ role }) => role === 'user');
    const evidence = JSON.parse(user?.content ?? '{}') as {
      sources?: Array<{ path: string; startLine: number; endLine: number; lines: Array<{ line: number; text: string }> }>;
    };
    expect(evidence.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'packages/core/src/dogfood-add.test.ts', editable: false,
      }),
      expect.objectContaining({
        path: 'packages/core/src/dogfood-add.ts', startLine: 1, endLine: 3, editable: true,
        lines: [
          { line: 1, text: 'export function add(left: number, right: number): number {' },
          { line: 2, text: '  return left - right;' },
          { line: 3, text: '}' },
        ],
      }),
    ]));
    const options = value.chat.mock.calls[0]?.[2] as ChatOptions | undefined;
    if (options?.responseFormat?.type !== 'json_schema') throw new Error('Expected repair JSON schema');
    const schema = options.responseFormat.jsonSchema.schema as {
      properties: { edits: { items: { properties: Record<string, unknown> } } };
    };
    expect(schema.properties.edits.items.properties).toEqual(expect.objectContaining({
      path: { type: 'string', const: 'packages/core/src/dogfood-add.ts' },
      startLine: { type: 'integer', minimum: 1, maximum: 3 },
      endLine: { type: 'integer', minimum: 1, maximum: 3 },
    }));
    expect(JSON.stringify(schema)).not.toContain('dogfood-add.test.ts');
  });

  it('uses a non-empty CRLF source beside an empty excerpt without schema drift', async () => {
    const crlfContext: RepairSourceContext = { sources: [
      { path: 'src/empty.ts', startLine: 1, content: '', truncated: false },
      { path: 'src/value.ts', startLine: 10, content: 'const old = 1;\r\nexport { old };\r\n', truncated: false },
    ] };
    const crlfDiff = anchoredEditsDiff([{
      path: 'src/value.ts', startLine: 10, endLine: 10, new: 'const old = 2;',
    }], crlfContext);
    const executor = new InMemoryExecutor((_command, _parent, index) => [
      runResult(0, crlfDiff), runResult(0, '1 passed'),
    ][index]!);
    const value = llm(JSON.stringify({
      id: 'crlf', rationale: 'Update the production value.',
      edits: [{ path: 'src/value.ts', startLine: 10, endLine: 10, new: 'const old = 2;' }],
    }));

    const outcome = await runControlledRepairAttempt({
      llm: value.model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' }, sourceContext: crlfContext,
    });

    expect(outcome).toMatchObject({ status: 'submitted', candidate: { diff: crlfDiff } });
    const messages = value.chat.mock.calls[0]?.[1] as readonly ChatMessage[];
    const user = messages.find(({ role }) => role === 'user');
    const evidence = JSON.parse(user?.content ?? '{}') as {
      sources: Array<{ path: string; startLine: number; endLine: number; lines: Array<{ line: number; text: string }> }>;
    };
    expect(evidence.sources).toEqual([expect.objectContaining({
      path: 'src/value.ts', startLine: 10, endLine: 11,
      lines: [{ line: 10, text: 'const old = 1;' }, { line: 11, text: 'export { old };' }],
    })]);
  });

  it('caches immutable source contracts across admission and execution', () => {
    const template = prepareControlledRepairProposalTemplate({
      diagnosis, policy: createDefaultRepositoryPolicy(), sourceContext: ambiguousSourceContext,
    });
    expect(template.contract()).toBe(template.contract());
    const feedback = { candidateDiff: diff, testOutput: 'still failing', errorFingerprint: 'abc' };
    expect(template.contract(feedback)).toBe(template.contract({ ...feedback }));
  });

  it('keeps an admissible source path identical in prompt evidence and provider schema', () => {
    const credentialShapedPath = 'src/sk_test_abcdefgh.ts';
    const contract = prepareControlledRepairProposalTemplate({
      diagnosis, policy: createDefaultRepositoryPolicy(),
      sourceContext: { sources: [{
        path: credentialShapedPath, startLine: 1, content: 'export const value = 1;\n', truncated: false,
      }] },
    }).contract();
    const evidence = JSON.parse(contract.messages[1]!.content ?? '{}') as { sources: Array<{ path: string }> };
    expect(evidence.sources[0]?.path).toBe(credentialShapedPath);
    expect(JSON.stringify(contract.schema)).toContain(credentialShapedPath);
  });

  it('rejects source ranges that overflow safe line anchors before inference', async () => {
    const executor = new InMemoryExecutor(() => runResult(1));
    const value = llm('unused');
    const outcome = await runControlledRepairAttempt({
      llm: value.model, executor, initialImageId: 'baseline', diagnosis,
      policy: createDefaultRepositoryPolicy(), budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' },
      sourceContext: { sources: [{
        path: 'src/value.ts', startLine: Number.MAX_SAFE_INTEGER,
        content: 'const first = 1;\nconst second = 2;\n', truncated: false,
      }] },
    });
    expect(outcome).toMatchObject({
      status: 'gave-up', failureKind: 'invalid',
      reason: 'repair source src/value.ts line range exceeds safe integers',
    });
    expect(value.chat).not.toHaveBeenCalled();
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
          path: { type: 'string', const: 'packages/core/src/dogfood-add.ts' },
          startLine: { type: 'integer', minimum: 1, maximum: 3 },
          endLine: { type: 'integer', minimum: 1, maximum: 3 },
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
