import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { DEFAULT_MODELS } from '../config.js';
import type { Diagnosis } from '../domain.js';
import { runControlledRepairAttempt } from '../engine/repair-attempt.js';
import { RepairBudget } from '../engine/repair-budget.js';
import { InMemoryExecutor } from '../executor/memory.js';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import { DEFAULT_MODEL_PRICES } from './cost.js';
import { NebiusClient } from './nebius.js';

const environment = (
  globalThis as unknown as {
    process?: { env?: Readonly<Record<string, string | undefined>> };
  }
).process?.env ?? {};

function createLiveClient(): NebiusClient {
  const apiKey = environment.NEBIUS_API_KEY;
  if (!apiKey) {
    throw new Error('NEBIUS_API_KEY is required when SUTURA_LIVE=1');
  }
  return new NebiusClient({
    apiKey,
    baseUrl: 'https://api.tokenfactory.nebius.com/v1/',
    models: DEFAULT_MODELS,
    prices: DEFAULT_MODEL_PRICES,
  });
}

describe.skipIf(environment.SUTURA_LIVE !== '1')('NebiusClient live', () => {
  it('returns a nano reply that matches a strict JSON Schema', async () => {
    const client = createLiveClient();

    const reply = await client.chat(
      'nano',
      [{ role: 'user', content: 'Return fixed as true.' }],
      {
        maxTokens: 2_048,
        temperature: 0,
        responseFormat: {
          type: 'json_schema',
          jsonSchema: {
            name: 'health_check',
            strict: true,
            schema: {
              type: 'object',
              properties: { fixed: { type: 'boolean' } },
              required: ['fixed'],
              additionalProperties: false,
            },
          },
        },
      },
    );

    expect(JSON.parse(reply.text)).toEqual({ fixed: true });
    expect(reply.finishReason).toBeTruthy();
    expect(reply.usage.inTok).toBeGreaterThan(0);
    expect(reply.usage.outTok + reply.usage.reasoningTok).toBeGreaterThan(0);
  });

  it('returns a nano function call with valid JSON arguments in auto mode', async () => {
    const client = createLiveClient();

    const reply = await client.chat(
      'nano',
      [{ role: 'user', content: 'Read src/example.ts.' }],
      {
        maxTokens: 2_048,
        temperature: 0,
        tools: [{
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a repository file',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
            strict: true,
          },
        }],
        toolChoice: 'auto',
      },
    );

    expect(reply.toolCalls).toHaveLength(1);
    expect(reply.toolCalls[0]?.function.name).toBe('read_file');
    expect(JSON.parse(reply.toolCalls[0]?.function.arguments ?? '')).toEqual({
      path: 'src/example.ts',
    });
    expect(reply.finishReason).toBeTruthy();
    expect(reply.usage.inTok).toBeGreaterThan(0);
    expect(reply.usage.outTok + reply.usage.reasoningTok).toBeGreaterThan(0);
  });

  it('round-trips a nano call and records a non-zero inference cost', async () => {
    const client = createLiveClient();

    const reply = await client.chat(
      'nano',
      [{ role: 'user', content: 'Reply with only the word healthy.' }],
      { maxTokens: 2_048, temperature: 0 },
    );

    expect(reply.text.trim().toLowerCase()).toContain('healthy');
    expect(reply.usd).toBeGreaterThan(0);
    expect(client.ledger.totalUsd()).toBe(reply.usd);
  });

  it('runs the production Super anchored-proposal contract with bounded reasoning', async () => {
    const client = createLiveClient();
    const diagnosis: Diagnosis = {
      class: 'test-assertion',
      confidence: 0.99,
      signals: ['expected -1 to be 5'],
      failingCmd: 'pnpm test',
      errorExcerpt: 'src/add.test.ts: expected -1 to be 5',
    };
    const expectedDiff = [
      'diff --git a/src/add.ts b/src/add.ts',
      '--- a/src/add.ts', '+++ b/src/add.ts',
      '@@ -1,3 +1,3 @@',
      ' export function add(left: number, right: number): number {',
      '-  return left - right;', '+  return left + right;', ' }', '',
    ].join('\n');
    const executor = new InMemoryExecutor((command, _parent, index) => {
      if (index === 0) {
        expect(command).toContain(Buffer.from(expectedDiff, 'utf8').toString('base64'));
        return { exitCode: 0, stdout: expectedDiff, stderr: '', truncated: false, metrics: {} };
      }
      return { exitCode: 0, stdout: '1 passed', stderr: '', truncated: false, metrics: {} };
    });

    const outcome = await runControlledRepairAttempt({
      llm: client,
      executor,
      initialImageId: 'baseline',
      diagnosis,
      policy: createDefaultRepositoryPolicy(),
      budget: new RepairBudget(),
      trustedCommands: { diagnosed: 'pnpm test' },
      sourceContext: {
        sources: [
          {
            path: 'src/add.test.ts',
            startLine: 1,
            content: "import { expect, it } from 'vitest';\n\nimport { add } from './add.js';\n\nit('adds', () => {\n  expect(add(2, 3)).toBe(5);\n});\n",
            truncated: false,
          },
          {
            path: 'src/add.ts',
            startLine: 1,
            content: 'export function add(left: number, right: number): number {\n  return left - right;\n}\n',
            truncated: false,
          },
        ],
      },
    });

    expect(outcome).toMatchObject({
      status: 'submitted',
      candidate: { diff: expectedDiff },
    });
    expect(client.ledger.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'super',
        model: DEFAULT_MODELS.super,
        outTok: expect.any(Number),
      }),
    ]));
    expect(client.ledger.entries.at(-1)?.outTok).toBeGreaterThan(0);
  });
});
