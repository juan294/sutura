import type { TriageVerdict } from '../domain.js';
import {
  SNAPSHOT_CWD,
  type Executor,
  type ImageId,
  type RunResult,
} from '../executor/types.js';
import { MAX_TRIAGE_RUNS } from '../config.js';
import { shellQuote } from './shell.js';
import {
  FLAKE_CONFIDENCE_METHOD_VERSION,
  evaluateFlakeConfidence,
} from './flake-confidence.js';

const DEFAULT_TRIAGE_RUNS = 5;

export function notRunTriageVerdict(): TriageVerdict {
  return {
    status: 'not-run', reproduced: 0, of: 0, attemptsUsed: 0, maximumAttempts: 0,
    reproductionProbability: 0, confidenceLower: 0, confidenceUpper: 1,
    stopReason: 'not-run', methodVersion: FLAKE_CONFIDENCE_METHOD_VERSION,
  };
}

export function completedTriageVerdict(
  exitCodes: readonly number[],
  maximumAttempts: number,
): TriageVerdict {
  const evidence = evaluateFlakeConfidence(exitCodes, maximumAttempts);
  if (evidence.decision === 'continue' || evidence.stopReason === 'continue') {
    throw new Error('triage evidence is not terminal');
  }
  return {
    status: evidence.decision,
    reproduced: evidence.reproduced,
    of: evidence.attemptsUsed,
    attemptsUsed: evidence.attemptsUsed,
    maximumAttempts: evidence.maximumAttempts,
    reproductionProbability: evidence.reproductionProbability,
    confidenceLower: evidence.confidenceLower,
    confidenceUpper: evidence.confidenceUpper,
    stopReason: evidence.stopReason,
    methodVersion: evidence.methodVersion,
  };
}

export async function triage(
  executor: Executor,
  failingImage: ImageId,
  failingCmd: string,
  N = DEFAULT_TRIAGE_RUNS,
  observe?: (result: RunResult, attempt: number) => void,
): Promise<TriageVerdict> {
  if (!Number.isSafeInteger(N) || N <= 0 || N > MAX_TRIAGE_RUNS) {
    throw new RangeError(`N must be between 1 and ${MAX_TRIAGE_RUNS}`);
  }

  const exitCodes: number[] = [];
  while (exitCodes.length < N) {
    const batchSize = Math.min(2, N - exitCodes.length);
    const firstAttempt = exitCodes.length;
    const results = await executor.runMany(
      failingImage,
      Array.from(
        { length: batchSize },
        (_, offset) =>
          `SUTURA_TRIAGE_ATTEMPT=${shellQuote(String(firstAttempt + offset))} sh -lc ${shellQuote(failingCmd)}`,
      ),
      { cwd: SNAPSHOT_CWD },
    );
    if (results.length !== batchSize) throw new Error('executor returned an unexpected triage result count');
    results.forEach((result, offset) => {
      exitCodes.push(result.exitCode);
      observe?.(result, firstAttempt + offset + 1);
    });
    const evidence = evaluateFlakeConfidence(exitCodes, N);
    if (evidence.decision !== 'continue') {
      return completedTriageVerdict(exitCodes, N);
    }
  }
  throw new Error('progressive triage ended without a terminal decision');
}
