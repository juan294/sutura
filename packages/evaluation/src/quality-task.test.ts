import { describe, expect, it } from 'vitest';

import { blindExecutedRecord, type BlindedRecord } from './blinded.js';
import {
  buildQualityPrompt,
  parseQualityPrediction,
  QUALITY_LABELS,
  QUALITY_MAX_CITATIONS,
  QUALITY_PROMPT_VARIANTS,
  QualityTaskError,
  qualityResponseSchema,
  scoreQualityPredictions,
  type QualityScoredItem,
  type QualityTruth,
} from './quality-task.js';

const record: BlindedRecord = blindExecutedRecord({
  recordId: 'repair-off-by-one-1',
  failureExcerpt: 'expected 3 to be 2',
  candidateDiff: 'diff --git a/page-count.js b/page-count.js\n',
  publicContracts: [{ contractId: 'ceiling', excerpt: 'pageCount(20,10) === 2' }],
  observations: [{ command: 'pnpm test', exitCode: 1, output: 'FAIL' }],
  changedPaths: ['page-count.js'],
});

function prediction(
  label: string, confidence = 0.9, citedEvidence: string[] = [],
): string {
  return JSON.stringify({ label, citedEvidence, confidence });
}

function item(
  recordId: string,
  truth: QualityTruth,
  label?: string,
  confidence = 0.9,
): QualityScoredItem {
  return {
    recordId,
    truth,
    ...(label === undefined
      ? {}
      : { prediction: { label: label as never, citedEvidence: [], confidence } }),
  };
}

describe('quality task prompts', () => {
  it.each(QUALITY_PROMPT_VARIANTS)('builds the %s variant over identical inputs', (variant) => {
    const built = buildQualityPrompt(variant, record);

    expect(built.messages).toHaveLength(2);
    expect(JSON.parse(String(built.messages[1]!.content))).toEqual(record);
  });

  it('differs between variants only in the instruction', () => {
    const [direct, citation] = QUALITY_PROMPT_VARIANTS
      .map((variant) => buildQualityPrompt(variant, record));

    expect(direct!.messages[1]!.content).toBe(citation!.messages[1]!.content);
    expect(direct!.messages[0]!.content).not.toBe(citation!.messages[0]!.content);
    expect(String(citation!.messages[0]!.content)).toContain('Quote the exact contract');
  });

  it('refuses a variant that was not pre-registered', () => {
    expect(() => buildQualityPrompt('tuned-after-results' as never, record))
      .toThrow(/not a pre-registered variant/u);
  });

  it('refuses to build a prompt from a record carrying a label', () => {
    const leaked = { ...record, verdict: 'refused' } as unknown as BlindedRecord;

    expect(() => buildQualityPrompt('direct-rubric-v2', leaked)).toThrow(/would leak the answer/u);
  });

  it('declares a closed response schema over the three labels', () => {
    const schema = qualityResponseSchema() as {
      properties: { label: { enum: string[] } };
      additionalProperties: boolean;
    };

    expect(schema.properties.label.enum).toEqual([...QUALITY_LABELS]);
    expect(schema.additionalProperties).toBe(false);
  });
});

describe('quality prediction parsing', () => {
  it('accepts a well formed prediction', () => {
    expect(parseQualityPrediction(prediction('breaks-contract', 0.75, ['pageCount(20,10) === 2'])))
      .toEqual({ label: 'breaks-contract', citedEvidence: ['pageCount(20,10) === 2'], confidence: 0.75 });
  });

  it.each([
    ['unparsable text', 'not json', 'unparsable'],
    ['an array', '[]', 'unparsable'],
    ['an unknown label', prediction('probably-fine'), 'unknown-label'],
    ['a missing field', JSON.stringify({ label: 'breaks-contract' }), 'unexpected-fields'],
    ['an extra field', JSON.stringify({ label: 'breaks-contract', citedEvidence: [], confidence: 1, note: 'x' }), 'unexpected-fields'],
    ['too many citations', prediction('breaks-contract', 1, Array.from({ length: QUALITY_MAX_CITATIONS + 1 }, () => 'x')), 'invalid-citations'],
    ['confidence above one', prediction('breaks-contract', 1.5), 'invalid-confidence'],
    ['confidence below zero', prediction('breaks-contract', -0.1), 'invalid-confidence'],
  ])('refuses %s', (_name, text, reasonCode) => {
    try {
      parseQualityPrediction(text);
      expect.unreachable('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(QualityTaskError);
      expect((error as QualityTaskError).reasonCode).toBe(reasonCode);
    }
  });
});

describe('quality scoring', () => {
  it('reports perfect agreement on a balanced split', () => {
    const score = scoreQualityPredictions([
      item('a', 'preserves-contract', 'preserves-contract'),
      item('b', 'breaks-contract', 'breaks-contract'),
    ]);

    expect(score.balancedAccuracy).toBe(1);
    expect(score.falseApprovalRate).toBe(0);
    expect(score.falseRefusalRate).toBe(0);
    expect(score.coverage).toBe(1);
  });

  it('keeps unknown truth and missing answers out of accuracy', () => {
    const score = scoreQualityPredictions([
      item('a', 'preserves-contract', 'preserves-contract'),
      item('b', 'breaks-contract', 'breaks-contract'),
      item('c', 'unknown', 'preserves-contract'),
      item('d', 'breaks-contract'),
    ]);

    expect(score.balancedAccuracy).toBe(1);
    expect(score.unknownTruth).toBe(1);
    expect(score.missingPrediction).toBe(1);
    expect(score.coverage).toBeCloseTo(2 / 3);
  });

  it('does not let a majority guess flatter balanced accuracy', () => {
    const alwaysPreserves = scoreQualityPredictions([
      ...Array.from({ length: 9 }, (_v, i) => item(`p${i}`, 'preserves-contract', 'preserves-contract')),
      item('b', 'breaks-contract', 'preserves-contract'),
    ]);

    expect(alwaysPreserves.balancedAccuracy).toBe(0.5);
    expect(alwaysPreserves.falseApprovalRate).toBe(1);
  });

  it('separates a false approval from a false refusal', () => {
    const score = scoreQualityPredictions([
      item('a', 'breaks-contract', 'preserves-contract'),
      item('b', 'preserves-contract', 'breaks-contract'),
    ]);

    expect(score.falseApprovalRate).toBe(1);
    expect(score.falseRefusalRate).toBe(1);
    expect(score.balancedAccuracy).toBe(0);
  });

  it('treats an abstention as its own rate, not as a wrong answer', () => {
    const score = scoreQualityPredictions([
      item('a', 'preserves-contract', 'insufficient-evidence'),
      item('b', 'breaks-contract', 'breaks-contract'),
    ]);

    expect(score.abstentionRate).toBe(0.5);
    expect(score.scored).toBe(1);
    expect(score.falseRefusalRate).toBeNull();
    expect(score.balancedAccuracy).toBe(1);
  });

  it('reports confidence separately for correct and incorrect answers', () => {
    const score = scoreQualityPredictions([
      item('a', 'preserves-contract', 'preserves-contract', 0.9),
      item('b', 'breaks-contract', 'preserves-contract', 0.8),
    ]);

    expect(score.meanConfidenceCorrect).toBeCloseTo(0.9);
    expect(score.meanConfidenceIncorrect).toBeCloseTo(0.8);
  });

  it('returns nulls rather than zeros when nothing could be scored', () => {
    const score = scoreQualityPredictions([item('a', 'unknown'), item('b', 'unknown')]);

    expect(score.scored).toBe(0);
    expect(score.balancedAccuracy).toBeNull();
    expect(score.falseApprovalRate).toBeNull();
    expect(score.coverage).toBeNull();
    expect(score.unknownTruth).toBe(2);
  });

  it('does not let a run that answered nothing look like a correct one', () => {
    const answeredNothing = scoreQualityPredictions([
      item('a', 'preserves-contract'), item('b', 'breaks-contract'),
    ]);

    expect(answeredNothing.balancedAccuracy).toBeNull();
    expect(answeredNothing.missingPrediction).toBe(2);
    expect(answeredNothing.coverage).toBe(0);
  });
});

describe('perturbing execution truth', () => {
  const answers: QualityScoredItem[] = [
    { recordId: 'a', truth: 'preserves-contract', prediction: { label: 'preserves-contract', citedEvidence: [], confidence: 0.9 } },
    { recordId: 'b', truth: 'breaks-contract', prediction: { label: 'breaks-contract', citedEvidence: [], confidence: 0.8 } },
    { recordId: 'c', truth: 'preserves-contract', prediction: { label: 'preserves-contract', citedEvidence: [], confidence: 0.7 } },
    { recordId: 'd', truth: 'breaks-contract', prediction: { label: 'breaks-contract', citedEvidence: [], confidence: 0.6 } },
  ];

  it('changes the score when the executable truth changes and the answers do not', () => {
    const before = scoreQualityPredictions(answers);
    const perturbed = scoreQualityPredictions(answers.map((item, index) => (index === 1
      ? { ...item, truth: 'preserves-contract' as const }
      : item)));

    expect(before.balancedAccuracy).toBe(1);
    expect(perturbed.balancedAccuracy).not.toBe(before.balancedAccuracy);
    expect(perturbed.falseRefusalRate).toBeGreaterThan(0);
    expect(before.falseRefusalRate).toBe(0);
  });

  it('moves the false-approval rate when a deceptive record is relabelled', () => {
    const deceptive = answers.map((item) => (item.recordId === 'b'
      ? { ...item, prediction: { label: 'preserves-contract' as const, citedEvidence: [], confidence: 0.95 } }
      : item));

    expect(scoreQualityPredictions(deceptive).falseApprovalRate).toBeGreaterThan(0);
    expect(scoreQualityPredictions(answers).falseApprovalRate).toBe(0);
  });

  it('keeps an unknown truth and a missing answer out of every rate', () => {
    const partial = scoreQualityPredictions([
      ...answers,
      { recordId: 'e', truth: 'unknown', prediction: { label: 'preserves-contract', citedEvidence: [], confidence: 0.9 } },
      { recordId: 'f', truth: 'breaks-contract' },
    ]);

    expect(partial.scored).toBe(answers.length);
    expect(partial.unknownTruth).toBe(1);
    expect(partial.missingPrediction).toBe(1);
    expect(partial.balancedAccuracy).toBe(1);
    expect(partial.coverage).toBeLessThan(1);
  });
});
