import { describe, expect, it } from 'vitest';

import { DEFAULT_MODELS, TOKEN_FACTORY_BASE_URL } from '../config.js';
import type { NebiusClient } from './nebius.js';
import { runSuperRepairProviderContractCanary } from './provider-contract-canary.js';
import { createTokenFactoryClient } from './token-factory.js';

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
  return createTokenFactoryClient({ apiKey });
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

  it('passes the exact production Super provider-contract canary', async () => {
    const apiKey = environment.NEBIUS_API_KEY;
    if (!apiKey) throw new Error('NEBIUS_API_KEY is required when SUTURA_LIVE=1');

    const result = await runSuperRepairProviderContractCanary({ apiKey });

    expect(result).toMatchObject({
      endpoint: `${TOKEN_FACTORY_BASE_URL}chat/completions`,
      model: DEFAULT_MODELS.super,
      finishReason: 'stop',
      usage: {
        inTok: expect.any(Number),
        outTok: expect.any(Number),
        reasoningTok: expect.any(Number),
      },
      replacementCodePoints: expect.any(Number),
    });
    expect(result.usage.inTok).toBeGreaterThan(0);
    expect(result.usage.outTok + result.usage.reasoningTok).toBeGreaterThan(0);
  });
});
