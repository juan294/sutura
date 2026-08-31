import type { FailureClass } from '../domain.js';
import type { ModelPrice, ModelPrices, ModelTier } from './cost.js';

export const MODEL_SELECTION_SCHEMA_VERSION = 'sutura-model-selection-v1' as const;
export const DEFAULT_ROUTING_PROFILE_ID = 'production-baseline-v1' as const;

export interface ModelSelectionProfile {
  schemaVersion: typeof MODEL_SELECTION_SCHEMA_VERSION;
  profileId: string;
  complete: boolean;
  pricesVerified: boolean;
  models: Readonly<Record<ModelTier, string>>;
  prices: ModelPrices;
}

export interface ModelRoutingInput {
  requestedRole: ModelTier;
  failureClass: FailureClass | null;
  diagnosisConfidence: number | null;
  boundedContextBytes: number;
  remainingInferenceBudgetUsd: number;
  profileId: string;
}

export interface ModelRouteDecision {
  role: ModelTier;
  modelId: string;
  price: ModelPrice;
  profileId: string;
  fallbackReason?: string;
}

function validInput(input: ModelRoutingInput): void {
  if (!['nano', 'super', 'ultra'].includes(input.requestedRole)) {
    throw new RangeError('requestedRole is invalid');
  }
  if (input.diagnosisConfidence !== null && (
    !Number.isFinite(input.diagnosisConfidence) ||
    input.diagnosisConfidence < 0 ||
    input.diagnosisConfidence > 1
  )) throw new RangeError('diagnosisConfidence must be null or from zero to one');
  if (!Number.isSafeInteger(input.boundedContextBytes) || input.boundedContextBytes < 0) {
    throw new RangeError('boundedContextBytes must be a non-negative safe integer');
  }
  if (!Number.isFinite(input.remainingInferenceBudgetUsd) || input.remainingInferenceBudgetUsd < 0) {
    throw new RangeError('remainingInferenceBudgetUsd must be non-negative and finite');
  }
  if (!input.profileId.trim()) throw new RangeError('profileId must be non-empty');
}

export class ModelRouter {
  private readonly baseline: ModelSelectionProfile;
  private readonly profiles: ReadonlyMap<string, ModelSelectionProfile>;

  constructor(
    defaultModels: Readonly<Record<ModelTier, string>>,
    defaultPrices: ModelPrices,
    profiles: readonly ModelSelectionProfile[] = [],
  ) {
    this.baseline = {
      schemaVersion: MODEL_SELECTION_SCHEMA_VERSION,
      profileId: DEFAULT_ROUTING_PROFILE_ID,
      complete: true,
      pricesVerified: true,
      models: { ...defaultModels },
      prices: structuredClone(defaultPrices),
    };
    this.profiles = new Map(profiles.map((profile) => [profile.profileId, profile]));
  }

  select(input: ModelRoutingInput): ModelRouteDecision {
    validInput(input);
    const selected = input.profileId === DEFAULT_ROUTING_PROFILE_ID
      ? this.baseline
      : this.profiles.get(input.profileId);
    const usable = selected?.complete === true && selected.pricesVerified === true;
    const profile = usable ? selected : this.baseline;
    return {
      role: input.requestedRole,
      modelId: profile.models[input.requestedRole],
      price: { ...profile.prices[input.requestedRole] },
      profileId: profile.profileId,
      ...(!usable && input.profileId !== DEFAULT_ROUTING_PROFILE_ID
        ? { fallbackReason: selected === undefined
            ? 'selected profile is unavailable'
            : 'selected profile is incomplete or has unverified prices' }
        : {}),
    };
  }
}
