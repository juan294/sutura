import type { CostLedger } from '../domain.js';
import { DEFAULT_MODELS } from '../config.js';

export type ModelTier = keyof typeof DEFAULT_MODELS;

export interface ModelPrice {
  input: number;
  output: number;
}

export type ModelPrices = Readonly<Record<ModelTier, ModelPrice>>;

export type LedgerEntry = CostLedger['entries'][number];
export type TokenUsage = Pick<
  LedgerEntry,
  'inTok' | 'outTok' | 'reasoningTok'
>;

/** Prices in USD per one million tokens, verified on 2026-08-27. */
export const DEFAULT_MODEL_PRICES: ModelPrices = {
  nano: { input: 0.06, output: 0.24 },
  super: { input: 0.3, output: 0.9 },
  ultra: { input: 1, output: 3 },
};

const TOKENS_PER_MILLION = 1_000_000;
const USD_DECIMAL_PLACES = 6;

function roundUsd(value: number): number {
  const scale = 10 ** USD_DECIMAL_PLACES;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function assertUsage(usage: TokenUsage): void {
  for (const [name, value] of Object.entries(usage)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative safe integer`);
    }
  }
}

export class Ledger implements CostLedger {
  readonly entries: LedgerEntry[] = [];

  constructor(private readonly prices: Readonly<Record<string, ModelPrice>>) {}

  add(model: string, usage: TokenUsage): LedgerEntry {
    assertUsage(usage);
    const price = this.prices[model];
    if (!price) {
      throw new Error(`No token prices configured for model: ${model}`);
    }

    const usd = roundUsd(
      (usage.inTok * price.input +
        (usage.outTok + usage.reasoningTok) * price.output) /
        TOKENS_PER_MILLION,
    );
    const entry = { model, ...usage, usd };
    this.entries.push(entry);
    return entry;
  }

  totalUsd(): number {
    return roundUsd(this.entries.reduce((total, entry) => total + entry.usd, 0));
  }
}
