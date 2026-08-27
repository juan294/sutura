import { describe, expect, it } from 'vitest';

import { DEFAULT_MODEL_PRICES, Ledger } from './cost.js';

describe('Ledger', () => {
  it('ships the verified per-million-token prices for each model tier', () => {
    expect(DEFAULT_MODEL_PRICES).toEqual({
      nano: { input: 0.06, output: 0.24 },
      super: { input: 0.3, output: 0.9 },
      ultra: { input: 1, output: 3 },
    });
  });

  it('prices normal and reasoning output tokens to exactly six decimals', () => {
    const ledger = new Ledger(DEFAULT_MODEL_PRICES);

    const entry = ledger.add('nano', {
      inTok: 1_000,
      outTok: 2_000,
      reasoningTok: 3_000,
    });

    expect(entry.usd).toBe(0.00126);
    expect(ledger.entries).toEqual([
      {
        model: 'nano',
        inTok: 1_000,
        outTok: 2_000,
        reasoningTok: 3_000,
        usd: 0.00126,
      },
    ]);
    expect(ledger.totalUsd()).toBe(0.00126);
  });

  it('keeps an exact six-decimal running total across tiers', () => {
    const ledger = new Ledger(DEFAULT_MODEL_PRICES);

    ledger.add('super', { inTok: 2_000, outTok: 1_000, reasoningTok: 0 });
    ledger.add('ultra', { inTok: 1_000, outTok: 2_000, reasoningTok: 1_000 });

    expect(ledger.totalUsd()).toBe(0.0115);
  });

  it('rejects usage for a model without configured prices', () => {
    const ledger = new Ledger(DEFAULT_MODEL_PRICES);

    expect(() =>
      ledger.add('unknown', { inTok: 1, outTok: 1, reasoningTok: 0 }),
    ).toThrow(/No token prices configured for model: unknown/);
  });
});
