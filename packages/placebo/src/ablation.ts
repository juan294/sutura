import { createHash } from 'node:crypto';

import {
  DEFAULT_MODEL_PRICES,
  DEFAULT_ROUTING_PROFILE_ID,
  MODEL_SELECTION_SCHEMA_VERSION,
  calculateModelCostUsd,
  type CaseFile,
  type ModelPrice,
  type ModelSelectionProfile,
  type ModelTier,
} from '@sutura/core';
import { canonicalJson } from '@sutura/evaluation';

export const MODEL_ABLATION_SCHEMA_VERSION = 'sutura-model-ablation-v1' as const;
export const MODEL_ABLATION_CANDIDATES = [
  'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B',
  'nvidia/Nemotron-3_5-Lightning',
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/Nemotron-3-Ultra-550b-a55b',
] as const;

export interface ModelPriceSnapshot {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  verified: boolean;
  verifiedAt: string;
  source: 'token-factory-catalog';
}

export interface ModelAblationExperimentIdentity {
  promptProfileId: string;
  schemaProfileId: string;
  toolProfileId: string;
  budgetProfileId: string;
}

export interface ModelAblationObservation {
  caseId: string;
  experiment: ModelAblationExperimentIdentity;
  role: ModelTier;
  modelId: string;
  priceSnapshot: ModelPriceSnapshot;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  latencyMs: number;
  costUsd: number;
  outcome: CaseFile['outcome'];
  providerRequestId: string | null;
  schemaValid: boolean;
  taskSucceeded: boolean;
  falseApproval: boolean;
}

export interface ModelAblationManifest {
  schemaVersion: typeof MODEL_ABLATION_SCHEMA_VERSION;
  ablationId: string;
  corpusVersion: string;
  expectedCasesPerCandidate: number;
  experiment: ModelAblationExperimentIdentity;
  candidates: readonly string[];
  complete: boolean;
  observations: ModelAblationObservation[];
  resultHash: string;
}

export interface ModelAblationInput {
  ablationId: string;
  corpusVersion: string;
  expectedCasesPerCandidate: number;
  experiment: ModelAblationExperimentIdentity;
  observations: readonly ModelAblationObservation[];
  complete: boolean;
}

const ROLE_ORDER: Readonly<Record<ModelTier, number>> = { nano: 0, super: 1, ultra: 2 };
const OUTCOMES = new Set<CaseFile['outcome']>([
  'fixed', 'flaky-no-patch', 'refused', 'gave-up', 'infra-stop',
]);

function boundedString(value: string, field: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 240);
  if (!normalized.trim()) throw new Error(`${field} must be non-empty`);
  return normalized;
}

function nonNegative(value: number, field: string, integer = false): number {
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) {
    throw new Error(`${field} must be non-negative${integer ? ' and integral' : ''}`);
  }
  return value;
}

function experimentIdentity(
  value: ModelAblationExperimentIdentity,
): ModelAblationExperimentIdentity {
  return {
    promptProfileId: boundedString(value.promptProfileId, 'promptProfileId'),
    schemaProfileId: boundedString(value.schemaProfileId, 'schemaProfileId'),
    toolProfileId: boundedString(value.toolProfileId, 'toolProfileId'),
    budgetProfileId: boundedString(value.budgetProfileId, 'budgetProfileId'),
  };
}

function sanitizeObservation(value: ModelAblationObservation): ModelAblationObservation {
  if (!MODEL_ABLATION_CANDIDATES.includes(value.modelId as typeof MODEL_ABLATION_CANDIDATES[number])) {
    throw new Error(`Unsupported ablation model: ${value.modelId}`);
  }
  if (!['nano', 'super', 'ultra'].includes(value.role)) throw new Error('Unsupported ablation role');
  if (value.priceSnapshot.source !== 'token-factory-catalog') {
    throw new Error('priceSnapshot.source must be token-factory-catalog');
  }
  if (typeof value.priceSnapshot.verified !== 'boolean') {
    throw new Error('priceSnapshot.verified must be a boolean');
  }
  if (!Number.isFinite(Date.parse(value.priceSnapshot.verifiedAt))) {
    throw new Error('priceSnapshot.verifiedAt must be an ISO timestamp');
  }
  if (!OUTCOMES.has(value.outcome)) throw new Error('Unsupported ablation outcome');
  if (
    typeof value.schemaValid !== 'boolean' ||
    typeof value.taskSucceeded !== 'boolean' ||
    typeof value.falseApproval !== 'boolean'
  ) throw new Error('Ablation result flags must be booleans');
  return {
    caseId: boundedString(value.caseId, 'caseId'),
    experiment: experimentIdentity(value.experiment),
    role: value.role,
    modelId: value.modelId,
    priceSnapshot: {
      inputUsdPerMillion: nonNegative(value.priceSnapshot.inputUsdPerMillion, 'input price'),
      outputUsdPerMillion: nonNegative(value.priceSnapshot.outputUsdPerMillion, 'output price'),
      verified: value.priceSnapshot.verified,
      verifiedAt: new Date(value.priceSnapshot.verifiedAt).toISOString(),
      source: value.priceSnapshot.source,
    },
    inputTokens: nonNegative(value.inputTokens, 'inputTokens', true),
    outputTokens: nonNegative(value.outputTokens, 'outputTokens', true),
    reasoningTokens: nonNegative(value.reasoningTokens, 'reasoningTokens', true),
    latencyMs: nonNegative(value.latencyMs, 'latencyMs'),
    costUsd: nonNegative(value.costUsd, 'costUsd'),
    outcome: value.outcome,
    providerRequestId: value.providerRequestId === null
      ? null
      : boundedString(value.providerRequestId, 'providerRequestId'),
    schemaValid: value.schemaValid,
    taskSucceeded: value.taskSucceeded,
    falseApproval: value.falseApproval,
  };
}

function normalizedForHash(value: Omit<ModelAblationManifest, 'resultHash'>): unknown {
  return {
    ...value,
    observations: value.observations.map((observation) => ({
      ...observation,
      providerRequestId: observation.providerRequestId === null ? null : '[request-id]',
    })),
  };
}

function resultHash(value: Omit<ModelAblationManifest, 'resultHash'>): string {
  return createHash('sha256').update(canonicalJson(normalizedForHash(value))).digest('hex');
}

function consistentPriceSnapshot(observations: readonly ModelAblationObservation[]): boolean {
  const verifiedAt = new Set(observations.map(({ priceSnapshot }) => priceSnapshot.verifiedAt));
  if (verifiedAt.size !== 1) return false;
  return MODEL_ABLATION_CANDIDATES.every((modelId) => {
    const rows = observations.filter((observation) => observation.modelId === modelId);
    const first = rows[0]?.priceSnapshot;
    return first !== undefined && rows.every(({ priceSnapshot }) =>
      priceSnapshot.verified === true &&
      priceSnapshot.source === 'token-factory-catalog' &&
      priceSnapshot.inputUsdPerMillion === first.inputUsdPerMillion &&
      priceSnapshot.outputUsdPerMillion === first.outputUsdPerMillion);
  });
}

function computedCostUsd(observation: ModelAblationObservation): number {
  return calculateModelCostUsd({
    input: observation.priceSnapshot.inputUsdPerMillion,
    output: observation.priceSnapshot.outputUsdPerMillion,
  }, {
    inTok: observation.inputTokens,
    outTok: observation.outputTokens,
    reasoningTok: observation.reasoningTokens,
  });
}

function costsReconcile(observations: readonly ModelAblationObservation[]): boolean {
  return observations.every((observation) =>
    observation.costUsd === computedCostUsd(observation));
}

function sameExperiment(
  left: ModelAblationExperimentIdentity,
  right: ModelAblationExperimentIdentity,
): boolean {
  return left.promptProfileId === right.promptProfileId &&
    left.schemaProfileId === right.schemaProfileId &&
    left.toolProfileId === right.toolProfileId &&
    left.budgetProfileId === right.budgetProfileId;
}

function matrixComplete(
  observations: readonly ModelAblationObservation[],
  expected: number,
  experiment: ModelAblationExperimentIdentity,
): boolean {
  const cells = (['nano', 'super', 'ultra'] as const).flatMap((role) =>
    MODEL_ABLATION_CANDIDATES.map((modelId) =>
      observations.filter((item) => item.role === role && item.modelId === modelId)));
  const expectedCases = new Set(cells[0]?.map(({ caseId }) => caseId) ?? []);
  if (expectedCases.size !== expected) return false;
  return cells.every((rows) => {
    const cases = new Set(rows.map(({ caseId }) => caseId));
    return rows.length === expected &&
      cases.size === expected &&
      [...cases].every((caseId) => expectedCases.has(caseId)) &&
      rows.every((observation) => sameExperiment(observation.experiment, experiment));
  });
}

export function createModelAblation(input: ModelAblationInput): ModelAblationManifest {
  if (!Number.isSafeInteger(input.expectedCasesPerCandidate) || input.expectedCasesPerCandidate <= 0) {
    throw new Error('expectedCasesPerCandidate must be a positive integer');
  }
  const observations = input.observations.map(sanitizeObservation).sort((left, right) =>
    ROLE_ORDER[left.role] - ROLE_ORDER[right.role] ||
    left.modelId.localeCompare(right.modelId) ||
    left.caseId.localeCompare(right.caseId));
  const experiment = experimentIdentity(input.experiment);
  const complete = input.complete &&
    matrixComplete(observations, input.expectedCasesPerCandidate, experiment) &&
    consistentPriceSnapshot(observations) &&
    costsReconcile(observations);
  const base = {
    schemaVersion: MODEL_ABLATION_SCHEMA_VERSION,
    ablationId: boundedString(input.ablationId, 'ablationId'),
    corpusVersion: boundedString(input.corpusVersion, 'corpusVersion'),
    expectedCasesPerCandidate: input.expectedCasesPerCandidate,
    experiment,
    candidates: MODEL_ABLATION_CANDIDATES,
    complete,
    observations,
  };
  return {
    ...base,
    resultHash: resultHash(base),
  };
}

export function validateModelAblation(manifest: ModelAblationManifest): void {
  const { resultHash: suppliedHash, ...base } = manifest;
  if (manifest.schemaVersion !== MODEL_ABLATION_SCHEMA_VERSION) {
    throw new Error('Unsupported model ablation schema version');
  }
  if (
    manifest.candidates.length !== MODEL_ABLATION_CANDIDATES.length ||
    manifest.candidates.some((candidate, index) => candidate !== MODEL_ABLATION_CANDIDATES[index])
  ) throw new Error('Model ablation candidates do not match the declared matrix');
  if (resultHash(base) !== suppliedHash) throw new Error('Model ablation result hash mismatch');
  if (manifest.complete && (
    !matrixComplete(
      manifest.observations,
      manifest.expectedCasesPerCandidate,
      manifest.experiment,
    ) ||
    !consistentPriceSnapshot(manifest.observations) ||
    !costsReconcile(manifest.observations)
  )) throw new Error('Complete model ablation has an incomplete or inconsistent price matrix');
}

interface CandidateSummary {
  modelId: string;
  successRate: number;
  schemaRate: number;
  falseApprovals: number;
  meanCostUsd: number;
  medianLatencyMs: number;
  price: ModelPrice;
}

function summaries(manifest: ModelAblationManifest, role: ModelTier): CandidateSummary[] {
  return MODEL_ABLATION_CANDIDATES.map((modelId) => {
    const rows = manifest.observations.filter((item) => item.role === role && item.modelId === modelId);
    const latencies = rows.map(({ latencyMs }) => latencyMs).sort((left, right) => left - right);
    const middle = Math.floor(latencies.length / 2);
    const medianLatencyMs = latencies.length % 2 === 0
      ? ((latencies[middle - 1] ?? 0) + (latencies[middle] ?? 0)) / 2
      : latencies[middle] ?? 0;
    const snapshot = rows[0]!.priceSnapshot;
    return {
      modelId,
      successRate: rows.filter(({ taskSucceeded }) => taskSucceeded).length / rows.length,
      schemaRate: rows.filter(({ schemaValid }) => schemaValid).length / rows.length,
      falseApprovals: rows.filter(({ falseApproval }) => falseApproval).length,
      meanCostUsd: rows.reduce((sum, observation) => sum + computedCostUsd(observation), 0) /
        rows.length,
      medianLatencyMs,
      price: { input: snapshot.inputUsdPerMillion, output: snapshot.outputUsdPerMillion },
    };
  });
}

function byCostThenLatency(left: CandidateSummary, right: CandidateSummary): number {
  return left.meanCostUsd - right.meanCostUsd ||
    left.medianLatencyMs - right.medianLatencyMs ||
    left.modelId.localeCompare(right.modelId);
}

function baselineProfile(
  defaults: Readonly<Record<ModelTier, string>>,
): ModelSelectionProfile {
  return {
    schemaVersion: MODEL_SELECTION_SCHEMA_VERSION,
    profileId: DEFAULT_ROUTING_PROFILE_ID,
    complete: false,
    pricesVerified: false,
    models: { ...defaults },
    prices: DEFAULT_MODEL_PRICES,
  };
}

export function selectModelProfile(
  manifest: ModelAblationManifest,
  defaults: Readonly<Record<ModelTier, string>>,
): ModelSelectionProfile {
  validateModelAblation(manifest);
  if (!manifest.complete) return baselineProfile(defaults);
  const nano = summaries(manifest, 'nano');
  const nanoBaseline = nano.find(({ modelId }) => modelId === defaults.nano);
  if (nanoBaseline === undefined) return baselineProfile(defaults);
  const diagnosis = nano
    .filter(({ successRate, schemaRate }) =>
      successRate >= nanoBaseline.successRate && schemaRate >= nanoBaseline.schemaRate)
    .sort(byCostThenLatency)[0] ?? nanoBaseline;

  const repair = summaries(manifest, 'super').sort((left, right) =>
    right.successRate - left.successRate || byCostThenLatency(left, right))[0]!;

  const audit = summaries(manifest, 'ultra');
  const auditBaseline = audit.find(({ modelId }) => modelId === defaults.ultra);
  if (auditBaseline === undefined) return baselineProfile(defaults);
  const safeAudit = audit.filter(({ falseApprovals }) => falseApprovals === 0);
  const challenger = safeAudit
    .filter(({ modelId, successRate }) =>
      modelId !== defaults.ultra && successRate > auditBaseline.successRate)
    .sort((left, right) => right.successRate - left.successRate || byCostThenLatency(left, right))[0];
  const selectedAudit = auditBaseline.falseApprovals === 0
    ? challenger ?? auditBaseline
    : safeAudit.sort((left, right) =>
        right.successRate - left.successRate || byCostThenLatency(left, right))[0];
  if (selectedAudit === undefined) return baselineProfile(defaults);

  return {
    schemaVersion: MODEL_SELECTION_SCHEMA_VERSION,
    profileId: `ablation:${manifest.ablationId}`,
    complete: true,
    pricesVerified: true,
    models: { nano: diagnosis.modelId, super: repair.modelId, ultra: selectedAudit.modelId },
    prices: { nano: diagnosis.price, super: repair.price, ultra: selectedAudit.price },
  };
}
