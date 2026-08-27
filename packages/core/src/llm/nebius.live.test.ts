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

  it('generates one locally valid Super candidate with bounded reasoning', async () => {
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
      expect.objectContaining({ model: 'super', outTok: expect.any(Number) }),
    ]));
    expect(client.ledger.entries.at(-1)?.outTok).toBeGreaterThan(0);
  });
});
