import { describe, expect, it } from 'vitest';

import { DEFAULT_MODELS } from '../config.js';
import { DEFAULT_MODEL_PRICES } from './cost.js';
import { NebiusClient } from './nebius.js';

const environment = (
  globalThis as unknown as {
    process?: { env?: Readonly<Record<string, string | undefined>> };
  }
).process?.env ?? {};

describe.skipIf(environment.SUTURA_LIVE !== '1')('NebiusClient live', () => {
  it('round-trips a nano call and records a non-zero inference cost', async () => {
    const apiKey = environment.NEBIUS_API_KEY;
    if (!apiKey) {
      throw new Error('NEBIUS_API_KEY is required when SUTURA_LIVE=1');
    }

    const client = new NebiusClient({
      apiKey,
      baseUrl: 'https://api.tokenfactory.nebius.com/v1/',
      models: DEFAULT_MODELS,
      prices: DEFAULT_MODEL_PRICES,
    });

    const reply = await client.chat(
      'nano',
      [{ role: 'user', content: 'Reply with only the word healthy.' }],
      { maxTokens: 2_048, temperature: 0 },
    );

    expect(reply.text.trim().toLowerCase()).toContain('healthy');
    expect(reply.usd).toBeGreaterThan(0);
    expect(client.ledger.totalUsd()).toBe(reply.usd);
  });
});
