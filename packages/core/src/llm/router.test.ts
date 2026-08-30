import { describe, expect, it } from 'vitest';

import { DEFAULT_MODELS } from '../config.js';
import { DEFAULT_MODEL_PRICES } from './cost.js';
import {
  DEFAULT_ROUTING_PROFILE_ID,
  ModelRouter,
  type ModelSelectionProfile,
} from './router.js';

const completed: ModelSelectionProfile = {
  schemaVersion: 'sutura-model-selection-v1',
  profileId: 'evaluated-v1',
  complete: true,
  pricesVerified: true,
  models: {
    nano: 'nvidia/Nemotron-3_5-Lightning',
    super: DEFAULT_MODELS.super,
    ultra: DEFAULT_MODELS.ultra,
  },
  prices: DEFAULT_MODEL_PRICES,
};

function input(profileId: string = DEFAULT_ROUTING_PROFILE_ID) {
  return {
    requestedRole: 'nano' as const,
    failureClass: 'typecheck' as const,
    diagnosisConfidence: 0.9,
    boundedContextBytes: 1_024,
    remainingInferenceBudgetUsd: 0.2,
    profileId,
  };
}

describe('ModelRouter', () => {
  it('routes deterministically from the bounded public input contract', () => {
    const router = new ModelRouter(DEFAULT_MODELS, DEFAULT_MODEL_PRICES, [completed]);
    expect(router.select(input('evaluated-v1'))).toEqual(router.select(input('evaluated-v1')));
    expect(router.select(input('evaluated-v1'))).toMatchObject({
      role: 'nano', modelId: 'nvidia/Nemotron-3_5-Lightning', profileId: 'evaluated-v1',
    });
    expect(Object.keys(input())).not.toEqual(expect.arrayContaining(['repo', 'repository', 'maintainer']));
  });

  it.each([
    { ...completed, profileId: 'partial', complete: false },
    { ...completed, profileId: 'unpriced', pricesVerified: false },
  ])('does not let an incomplete or unpriced evaluation change defaults', (profile) => {
    const router = new ModelRouter(DEFAULT_MODELS, DEFAULT_MODEL_PRICES, [profile]);
    expect(router.select(input(profile.profileId))).toMatchObject({
      role: 'nano', modelId: DEFAULT_MODELS.nano, profileId: DEFAULT_ROUTING_PROFILE_ID,
      fallbackReason: expect.any(String),
    });
  });

  it('falls back for an unknown selected evaluation profile', () => {
    const router = new ModelRouter(DEFAULT_MODELS, DEFAULT_MODEL_PRICES);
    expect(router.select(input('missing'))).toMatchObject({
      modelId: DEFAULT_MODELS.nano, profileId: DEFAULT_ROUTING_PROFILE_ID,
    });
  });

  it.each([
    ['requestedRole', { requestedRole: 'invalid' }],
    ['diagnosisConfidence below zero', { diagnosisConfidence: -0.1 }],
    ['diagnosisConfidence above one', { diagnosisConfidence: 1.1 }],
    ['diagnosisConfidence non-finite', { diagnosisConfidence: Number.NaN }],
    ['boundedContextBytes negative', { boundedContextBytes: -1 }],
    ['boundedContextBytes unsafe', { boundedContextBytes: Number.MAX_SAFE_INTEGER + 1 }],
    ['remainingInferenceBudgetUsd negative', { remainingInferenceBudgetUsd: -0.01 }],
    ['remainingInferenceBudgetUsd non-finite', { remainingInferenceBudgetUsd: Infinity }],
    ['profileId empty', { profileId: '  ' }],
  ])('rejects invalid routing input: %s', (_label, override) => {
    const router = new ModelRouter(DEFAULT_MODELS, DEFAULT_MODEL_PRICES);
    expect(() => router.select({ ...input(), ...override } as ReturnType<typeof input>))
      .toThrow();
  });
});
