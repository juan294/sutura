export const FLAKE_CONFIDENCE_METHOD_VERSION = 'sprt-p20-p80-a05-b05-v1' as const;

const PASS_PROBABILITY_WHEN_STABLE = 0.2;
const FAILURE_PROBABILITY_WHEN_STABLE = 0.8;
const FALSE_POSITIVE_LIMIT = 0.05;
const FALSE_NEGATIVE_LIMIT = 0.05;
const WILSON_Z_95 = 1.959963984540054;

export type FlakeDecision = 'continue' | 'real' | 'flaky' | 'intermittent';
export type FlakeStopReason =
  | 'continue'
  | 'failure-boundary'
  | 'pass-boundary'
  | 'maximum-attempts';

export interface FlakeConfidence {
  decision: FlakeDecision;
  stopReason: FlakeStopReason;
  attemptsUsed: number;
  maximumAttempts: number;
  reproduced: number;
  reproductionProbability: number;
  confidenceLower: number;
  confidenceUpper: number;
  logLikelihoodRatio: number;
  lowerBoundary: number;
  upperBoundary: number;
  methodVersion: typeof FLAKE_CONFIDENCE_METHOD_VERSION;
}

function validateCount(successes: number, attempts: number): void {
  if (!Number.isSafeInteger(attempts) || attempts <= 0) {
    throw new RangeError('attempts must be a positive safe integer');
  }
  if (!Number.isSafeInteger(successes) || successes < 0 || successes > attempts) {
    throw new RangeError('successes must be between zero and attempts');
  }
}

export function wilsonInterval(
  successes: number,
  attempts: number,
): { lower: number; upper: number } {
  validateCount(successes, attempts);
  const probability = successes / attempts;
  const zSquared = WILSON_Z_95 ** 2;
  const denominator = 1 + zSquared / attempts;
  const center = (probability + zSquared / (2 * attempts)) / denominator;
  const margin = WILSON_Z_95 * Math.sqrt(
    (probability * (1 - probability) + zSquared / (4 * attempts)) / attempts,
  ) / denominator;
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

export function evaluateFlakeConfidence(
  exitCodes: readonly number[],
  maximumAttempts: number,
): FlakeConfidence {
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts <= 0) {
    throw new RangeError('maximumAttempts must be a positive safe integer');
  }
  if (exitCodes.length === 0) throw new RangeError('at least one attempt is required');
  if (exitCodes.length > maximumAttempts) throw new RangeError('attempts exceed maximumAttempts');
  if (!exitCodes.every(Number.isSafeInteger)) throw new RangeError('exit codes must be safe integers');

  const attemptsUsed = exitCodes.length;
  const reproduced = exitCodes.filter((exitCode) => exitCode !== 0).length;
  const passed = attemptsUsed - reproduced;
  const mixed = reproduced > 0 && passed > 0;
  const failureEvidence = Math.log(
    FAILURE_PROBABILITY_WHEN_STABLE / PASS_PROBABILITY_WHEN_STABLE,
  );
  const logLikelihoodRatio = (reproduced - passed) * failureEvidence;
  const upperBoundary = Math.log((1 - FALSE_NEGATIVE_LIMIT) / FALSE_POSITIVE_LIMIT);
  const lowerBoundary = Math.log(FALSE_NEGATIVE_LIMIT / (1 - FALSE_POSITIVE_LIMIT));
  const atMaximum = attemptsUsed === maximumAttempts;
  let decision: FlakeDecision = 'continue';
  let stopReason: FlakeStopReason = 'continue';
  if (atMaximum) {
    decision = mixed ? 'intermittent' : reproduced === attemptsUsed ? 'real' : 'flaky';
    stopReason = 'maximum-attempts';
  } else if (!mixed && logLikelihoodRatio > upperBoundary) {
    decision = 'real';
    stopReason = 'failure-boundary';
  } else if (!mixed && logLikelihoodRatio < lowerBoundary) {
    decision = 'flaky';
    stopReason = 'pass-boundary';
  }
  const interval = wilsonInterval(reproduced, attemptsUsed);
  return {
    decision,
    stopReason,
    attemptsUsed,
    maximumAttempts,
    reproduced,
    reproductionProbability: reproduced / attemptsUsed,
    confidenceLower: interval.lower,
    confidenceUpper: interval.upper,
    logLikelihoodRatio,
    lowerBoundary,
    upperBoundary,
    methodVersion: FLAKE_CONFIDENCE_METHOD_VERSION,
  };
}
