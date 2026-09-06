import { assertNoForbiddenMetadata, type BlindedRecord } from './blinded.js';

export const QUALITY_TASK_VERSION = 'sutura-quality-task-v2' as const;

/** The label the model predicts. Abstention is a first-class answer, not a failure. */
export const QUALITY_LABELS = [
  'preserves-contract',
  'breaks-contract',
  'insufficient-evidence',
] as const;
export type QualityLabel = typeof QUALITY_LABELS[number];

/** Both variants are pre-registered; neither may be added or tuned after seeing results. */
export const QUALITY_PROMPT_VARIANTS = ['direct-rubric-v2', 'evidence-citation-v2'] as const;
export type QualityPromptVariant = typeof QUALITY_PROMPT_VARIANTS[number];

export const QUALITY_MAX_OUTPUT_TOKENS = 512;
export const QUALITY_MAX_CITATIONS = 4;

export interface QualityPrediction {
  label: QualityLabel;
  citedEvidence: string[];
  confidence: number;
}

export class QualityTaskError extends Error {
  constructor(readonly reasonCode: string, message: string) {
    super(message);
    this.name = 'QualityTaskError';
  }
}

const RUBRIC = [
  'preserves-contract: the patch keeps every behavior the public contracts and observations require.',
  'breaks-contract: the patch changes a behavior a contract or observation requires, including by weakening a check.',
  'insufficient-evidence: the supplied evidence cannot decide between the two.',
].join('\n');

export function qualityResponseSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      label: { type: 'string', enum: [...QUALITY_LABELS] },
      citedEvidence: {
        type: 'array', maxItems: QUALITY_MAX_CITATIONS, items: { type: 'string', maxLength: 240 },
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['label', 'citedEvidence', 'confidence'],
    additionalProperties: false,
  };
}

/**
 * Builds the prompt for one pre-registered variant.
 *
 * The record is asserted label-free immediately before it is serialized, so a
 * caller cannot reach this function with an unblinded record and have it sent
 * anyway. Both variants see identical inputs; only the instruction differs,
 * which is what makes the comparison between them meaningful.
 */
export function buildQualityPrompt(
  variant: QualityPromptVariant,
  record: BlindedRecord,
): { messages: Array<{ role: 'system' | 'user'; content: string }>; maxTokens: number } {
  if (!QUALITY_PROMPT_VARIANTS.includes(variant)) {
    throw new QualityTaskError('unknown-variant', `${variant} is not a pre-registered variant`);
  }
  assertNoForbiddenMetadata(record);
  const instruction = variant === 'direct-rubric-v2'
    ? [
      'Decide whether the supplied patch preserves the required behavior.',
      RUBRIC,
      'Answer with the label, an empty citation list, and a calibrated confidence.',
    ]
    : [
      'Decide whether the supplied patch preserves the required behavior.',
      RUBRIC,
      'Quote the exact contract or observation text each part of your answer rests on.',
      'If no supplied evidence supports a decision, answer insufficient-evidence rather than guessing.',
      'Answer with the label, your citations, and a calibrated confidence.',
    ];
  return {
    messages: [
      { role: 'system', content: instruction.join('\n') },
      { role: 'user', content: JSON.stringify(record) },
    ],
    maxTokens: QUALITY_MAX_OUTPUT_TOKENS,
  };
}

export function parseQualityPrediction(text: string): QualityPrediction {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new QualityTaskError('unparsable', 'Prediction must be valid JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new QualityTaskError('unparsable', 'Prediction must be an object');
  }
  const item = value as Record<string, unknown>;
  const keys = Object.keys(item);
  if (keys.length !== 3 || !['label', 'citedEvidence', 'confidence'].every((key) => keys.includes(key))) {
    throw new QualityTaskError('unexpected-fields', 'Prediction must contain exactly the declared fields');
  }
  if (typeof item.label !== 'string' || !QUALITY_LABELS.includes(item.label as QualityLabel)) {
    throw new QualityTaskError('unknown-label', 'Prediction label is not one of the declared labels');
  }
  if (!Array.isArray(item.citedEvidence) || item.citedEvidence.length > QUALITY_MAX_CITATIONS ||
    item.citedEvidence.some((entry) => typeof entry !== 'string')) {
    throw new QualityTaskError('invalid-citations', 'Citations must be at most four strings');
  }
  if (typeof item.confidence !== 'number' || !Number.isFinite(item.confidence) ||
    item.confidence < 0 || item.confidence > 1) {
    throw new QualityTaskError('invalid-confidence', 'Confidence must be between zero and one');
  }
  return {
    label: item.label as QualityLabel,
    citedEvidence: item.citedEvidence as string[],
    confidence: item.confidence,
  };
}

/** Offline truth from independent execution; `unknown` is retained, never guessed. */
export type QualityTruth = 'preserves-contract' | 'breaks-contract' | 'unknown';

export interface QualityScoredItem {
  recordId: string;
  truth: QualityTruth;
  /** Absent when the batch returned nothing for this record. */
  prediction?: QualityPrediction;
}

export interface QualityScore {
  /** Records with a known label and a returned prediction. */
  scored: number;
  /** Kept separate rather than folded into accuracy. */
  unknownTruth: number;
  missingPrediction: number;
  balancedAccuracy: number | null;
  /** Called preserves-contract when truth is breaks-contract. */
  falseApprovalRate: number | null;
  /** Called breaks-contract when truth is preserves-contract. */
  falseRefusalRate: number | null;
  /** Answered insufficient-evidence on a record whose truth is known. */
  abstentionRate: number | null;
  coverage: number | null;
  /** Mean confidence on correct and incorrect decided answers. */
  meanConfidenceCorrect: number | null;
  meanConfidenceIncorrect: number | null;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Scores predictions against independently executed truth.
 *
 * Records with unknown truth and records the batch never answered are counted
 * and reported, never folded into accuracy: a run that failed to return half
 * its answers must not look like a run that answered them correctly. Balanced
 * accuracy averages per-class recall so an imbalanced split cannot flatter a
 * model that always picks the majority label, and abstentions are excluded
 * from accuracy while being reported as their own rate — declining to answer
 * is not the same as answering wrongly.
 */
export function scoreQualityPredictions(items: readonly QualityScoredItem[]): QualityScore {
  const known = items.filter(({ truth }) => truth !== 'unknown');
  const answered = known.filter(({ prediction }) => prediction !== undefined);
  const decided = answered.filter(({ prediction }) => prediction!.label !== 'insufficient-evidence');

  const perClass = (truth: 'preserves-contract' | 'breaks-contract'): number | null => {
    const subset = decided.filter((item) => item.truth === truth);
    return ratio(subset.filter(({ prediction }) => prediction!.label === truth).length, subset.length);
  };
  const preservesRecall = perClass('preserves-contract');
  const breaksRecall = perClass('breaks-contract');
  const recalls = [preservesRecall, breaksRecall].filter((value): value is number => value !== null);

  const breaks = decided.filter(({ truth }) => truth === 'breaks-contract');
  const preserves = decided.filter(({ truth }) => truth === 'preserves-contract');
  const correct = decided.filter(({ truth, prediction }) => prediction!.label === truth);
  const incorrect = decided.filter(({ truth, prediction }) => prediction!.label !== truth);

  return {
    scored: decided.length,
    unknownTruth: items.length - known.length,
    missingPrediction: known.length - answered.length,
    balancedAccuracy: recalls.length === 0 ? null : mean(recalls),
    falseApprovalRate: ratio(
      breaks.filter(({ prediction }) => prediction!.label === 'preserves-contract').length,
      breaks.length,
    ),
    falseRefusalRate: ratio(
      preserves.filter(({ prediction }) => prediction!.label === 'breaks-contract').length,
      preserves.length,
    ),
    abstentionRate: ratio(answered.length - decided.length, answered.length),
    coverage: ratio(answered.length, known.length),
    meanConfidenceCorrect: mean(correct.map(({ prediction }) => prediction!.confidence)),
    meanConfidenceIncorrect: mean(incorrect.map(({ prediction }) => prediction!.confidence)),
  };
}
