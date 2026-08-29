import { describe, expect, it } from 'vitest';

import { DEFAULT_MODELS } from '../config.js';
import type { Diagnosis } from '../domain.js';
import { generateCandidates } from '../engine/repair.js';
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

  it('returns a required nano function call with valid JSON arguments', async () => {
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
        toolChoice: 'required',
        parallelToolCalls: false,
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

  it('generates one locally valid Super candidate with bounded reasoning', async () => {
    const client = createLiveClient();
    const diagnosis: Diagnosis = {
      class: 'typecheck',
      confidence: 0.99,
      signals: ['mechanical:typecheck'],
      failingCmd: 'pnpm typecheck',
      errorExcerpt: "src/value.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.",
    };

    const candidates = await generateCandidates(client, diagnosis, 1, {
      sources: [{
        path: 'src/value.ts',
        startLine: 1,
        content: "const value: number = '1';",
        truncated: false,
      }],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.diff).toContain('diff --git a/src/value.ts b/src/value.ts');
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
