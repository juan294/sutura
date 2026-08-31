import { describe, expect, it } from 'vitest';

import { DEFAULT_MODELS } from '@sutura/core';

import {
  MODEL_ABLATION_CANDIDATES,
  createModelAblation,
  selectModelProfile,
  validateModelAblation,
  type ModelAblationObservation,
} from './ablation.js';

const roles = ['nano', 'super', 'ultra'] as const;
const EXPERIMENT = {
  promptProfileId: 'repair-prompts-v1',
  schemaProfileId: 'tool-schemas-v1',
  toolProfileId: 'bounded-tools-v1',
  budgetProfileId: 'default-v1',
} as const;

const PRICES = [
  { inputUsdPerMillion: 2, outputUsdPerMillion: 4 },
  { inputUsdPerMillion: 1, outputUsdPerMillion: 2 },
  { inputUsdPerMillion: 3, outputUsdPerMillion: 6 },
  { inputUsdPerMillion: 4, outputUsdPerMillion: 8 },
] as const;

function cost(index: number): number {
  const price = PRICES[index]!;
  return Math.round((
    (100 * price.inputUsdPerMillion + 25 * price.outputUsdPerMillion) / 1_000_000 +
    Number.EPSILON
  ) * 1_000_000) / 1_000_000;
}

function observations(): ModelAblationObservation[] {
  return roles.flatMap((role) => MODEL_ABLATION_CANDIDATES.map((modelId, index) => ({
    caseId: 'case-1',
    experiment: EXPERIMENT,
    role,
    modelId,
    priceSnapshot: {
      ...PRICES[index]!,
      verified: true, verifiedAt: '2026-08-29T00:00:00.000Z', source: 'token-factory-catalog' as const,
    },
    inputTokens: 100,
    outputTokens: 20,
    reasoningTokens: 5,
    latencyMs: 100 + index,
    costUsd: cost(index),
    outcome: 'fixed' as const,
    providerRequestId: `request-${role}-${index}`,
    schemaValid: true,
    taskSucceeded: true,
    falseApproval: false,
  })));
}

describe('model-role ablation', () => {
  it('creates a deterministic sanitized manifest with every required measurement', () => {
    const first = createModelAblation({
      ablationId: 'ablation-1', corpusVersion: '0.1', expectedCasesPerCandidate: 1,
      experiment: EXPERIMENT,
      observations: observations(), complete: true,
    });
    const second = createModelAblation({
      ablationId: 'ablation-1', corpusVersion: '0.1', expectedCasesPerCandidate: 1,
      experiment: EXPERIMENT,
      observations: [...observations()].reverse(), complete: true,
    });
    expect(first.resultHash).toBe(second.resultHash);
    expect(JSON.stringify(first)).not.toContain('reasoning_content');
    expect(first.observations).toHaveLength(12);
  });

  it('cannot change defaults from a partial ablation', () => {
    const manifest = createModelAblation({
      ablationId: 'partial', corpusVersion: '0.1', expectedCasesPerCandidate: 1,
      experiment: EXPERIMENT,
      observations: observations().slice(0, -1), complete: false,
    });
    expect(selectModelProfile(manifest, DEFAULT_MODELS)).toMatchObject({
      complete: false, models: DEFAULT_MODELS,
    });
  });

  it('applies diagnosis and repair tie-break rules but retains Ultra on an audit tie', () => {
    const values = observations().map((item) => item.modelId === 'nvidia/Nemotron-3_5-Lightning'
      ? { ...item, latencyMs: 20 }
      : item);
    const manifest = createModelAblation({
      ablationId: 'complete', corpusVersion: '0.1', expectedCasesPerCandidate: 1,
      experiment: EXPERIMENT,
      observations: values, complete: true,
    });
    expect(selectModelProfile(manifest, DEFAULT_MODELS)).toMatchObject({
      complete: true,
      models: {
        nano: 'nvidia/Nemotron-3_5-Lightning',
        super: 'nvidia/Nemotron-3_5-Lightning',
        ultra: DEFAULT_MODELS.ultra,
      },
    });
  });

  it('requires zero false approvals for every audit challenger', () => {
    const values = observations().map((item) => item.role === 'ultra' && item.modelId !== DEFAULT_MODELS.ultra
      ? { ...item, taskSucceeded: true, falseApproval: true }
      : item);
    const manifest = createModelAblation({
      ablationId: 'audit-safe', corpusVersion: '0.1', expectedCasesPerCandidate: 1,
      experiment: EXPERIMENT,
      observations: values, complete: true,
    });
    expect(selectModelProfile(manifest, DEFAULT_MODELS).models.ultra).toBe(DEFAULT_MODELS.ultra);
  });

  it('does not produce a complete profile when every audit model has a false approval', () => {
    const values = observations().map((item) => item.role === 'ultra'
      ? { ...item, falseApproval: true }
      : item);
    const manifest = createModelAblation({
      ablationId: 'unsafe-audit', corpusVersion: '0.1', expectedCasesPerCandidate: 1,
      experiment: EXPERIMENT, observations: values, complete: true,
    });

    expect(selectModelProfile(manifest, DEFAULT_MODELS)).toMatchObject({
      complete: false,
      models: DEFAULT_MODELS,
    });
  });

  it('rejects a changed result after the manifest hash is recorded', () => {
    const manifest = createModelAblation({
      ablationId: 'hashed', corpusVersion: '0.1', expectedCasesPerCandidate: 1,
      experiment: EXPERIMENT,
      observations: observations(), complete: true,
    });
    const changed = {
      ...manifest,
      observations: manifest.observations.map((item, index) =>
        index === 0 ? { ...item, taskSucceeded: false } : item),
    };

    expect(() => validateModelAblation(changed)).toThrow('result hash mismatch');
    expect(() => selectModelProfile(changed, DEFAULT_MODELS)).toThrow('result hash mismatch');
  });

  it('keeps defaults when compared cells do not share one catalog snapshot', () => {
    const values = observations().map((item, index) => index === 0
      ? {
          ...item,
          priceSnapshot: { ...item.priceSnapshot, verifiedAt: '2026-08-29T01:00:00.000Z' },
        }
      : item);
    const manifest = createModelAblation({
      ablationId: 'inconsistent-price', corpusVersion: '0.1', expectedCasesPerCandidate: 1,
      experiment: EXPERIMENT,
      observations: values, complete: true,
    });

    expect(manifest.complete).toBe(false);
    expect(selectModelProfile(manifest, DEFAULT_MODELS)).toMatchObject({
      complete: false,
      pricesVerified: false,
      models: DEFAULT_MODELS,
    });
  });

  it('requires the same unique case set in every role and candidate cell', () => {
    const duplicated = observations().flatMap((item) => [item, { ...item }]);
    const duplicateManifest = createModelAblation({
      ablationId: 'duplicate-cases', corpusVersion: '0.1', expectedCasesPerCandidate: 2,
      experiment: EXPERIMENT, observations: duplicated, complete: true,
    });
    expect(duplicateManifest.complete).toBe(false);

    const missingManifest = createModelAblation({
      ablationId: 'missing-case', corpusVersion: '0.1', expectedCasesPerCandidate: 1,
      experiment: EXPERIMENT, observations: observations().slice(1), complete: true,
    });
    expect(missingManifest.complete).toBe(false);

    const mismatched = observations().map((item, index) => index === 0
      ? { ...item, caseId: 'different-case' }
      : item);
    const mismatchManifest = createModelAblation({
      ablationId: 'mismatched-cases', corpusVersion: '0.1', expectedCasesPerCandidate: 1,
      experiment: EXPERIMENT, observations: mismatched, complete: true,
    });
    expect(mismatchManifest.complete).toBe(false);
  });

  it.each([
    'promptProfileId',
    'schemaProfileId',
    'toolProfileId',
    'budgetProfileId',
  ] as const)('rejects a %s mismatch across compared cells', (field) => {
    const values = observations().map((item, index) => index === 0
      ? { ...item, experiment: { ...item.experiment, [field]: 'different-profile' } }
      : item);
    const manifest = createModelAblation({
      ablationId: `mismatched-${field}`, corpusVersion: '0.1', expectedCasesPerCandidate: 1,
      experiment: EXPERIMENT, observations: values, complete: true,
    });
    expect(manifest.complete).toBe(false);
  });

  it('rejects a falsified cost before profile selection', () => {
    const values = observations().map((item, index) => index === 0
      ? { ...item, costUsd: item.costUsd + 0.01 }
      : item);
    const manifest = createModelAblation({
      ablationId: 'falsified-cost', corpusVersion: '0.1', expectedCasesPerCandidate: 1,
      experiment: EXPERIMENT, observations: values, complete: true,
    });
    expect(manifest.complete).toBe(false);
    expect(selectModelProfile(manifest, DEFAULT_MODELS)).toMatchObject({
      complete: false,
      models: DEFAULT_MODELS,
    });
  });
});
