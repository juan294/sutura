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
  // The final full batch always makes evaluateFlakeConfidence terminal.
  return completedTriageVerdict(exitCodes, N);
}

export type TriageScope = 'focused' | 'full';

/** Recorded with a run; absent means the legacy policy (full command, no budget). */
export interface TriagePolicy {
  scope: TriageScope;
  /** Cumulative sandbox seconds triage may spend; absent disables the budget. */
  sandboxBudgetSec?: number;
}

export const LEGACY_TRIAGE_POLICY: TriagePolicy = Object.freeze({ scope: 'full' });

export type TriageBudgetEvidence =
  | { enforced: true; budgetSec: number; probeSec: number; spentSec: number; predictedSec: number }
  | { enforced: false; budgetSec: number };

export interface TriageRun {
  verdict: TriageVerdict;
  /** Present only when the policy sets a budget. */
  budget?: TriageBudgetEvidence;
}

function budgetStopVerdict(exitCodes: readonly number[], maximumAttempts: number): TriageVerdict {
  const evidence = evaluateFlakeConfidence(exitCodes, maximumAttempts);
  return {
    status: 'not-run',
    reproduced: evidence.reproduced,
    of: evidence.attemptsUsed,
    attemptsUsed: evidence.attemptsUsed,
    maximumAttempts: evidence.maximumAttempts,
    reproductionProbability: evidence.reproductionProbability,
    confidenceLower: evidence.confidenceLower,
    confidenceUpper: evidence.confidenceUpper,
    stopReason: 'sandbox-budget',
    methodVersion: evidence.methodVersion,
  };
}

/**
 * Triage under a cumulative sandbox-time budget. Probe 1 runs alone and is
 * measured, because no other run predicts what triage costs (Sutura reproduces
 * one command and triages another). Probes then run one at a time, and before
 * each the seconds spent plus the slowest probe so far times the remaining
 * attempts must fit the budget. Probes keep the legacy numbering and the legacy evaluation points
 * (after attempts 2, 4 and 5), so a run within budget reaches exactly the
 * legacy verdict. The worst case is the budget plus one probe.
 */
export async function boundedTriage(
  executor: Executor,
  failingImage: ImageId,
  failingCmd: string,
  N = DEFAULT_TRIAGE_RUNS,
  observe?: (result: RunResult, attempt: number) => void,
  policy: TriagePolicy = LEGACY_TRIAGE_POLICY,
): Promise<TriageRun> {
  const budgetSec = policy.sandboxBudgetSec;
  if (budgetSec === undefined) return { verdict: await triage(executor, failingImage, failingCmd, N, observe) };
  if (!Number.isSafeInteger(N) || N <= 0 || N > MAX_TRIAGE_RUNS) {
    throw new RangeError(`N must be between 1 and ${MAX_TRIAGE_RUNS}`);
  }
  const exitCodes: number[] = [];
  let spentSec = 0;
  let probeSec = 0;
  let enforced = true;
  const probe = async () => {
    const attempt = exitCodes.length;
    const results = await executor.runMany(
      failingImage,
      [`SUTURA_TRIAGE_ATTEMPT=${shellQuote(String(attempt))} sh -lc ${shellQuote(failingCmd)}`],
      { cwd: SNAPSHOT_CWD },
    );
    const result = results[0];
    if (results.length !== 1 || result === undefined) throw new Error('executor returned an unexpected triage result count');
    exitCodes.push(result.exitCode);
    const seconds = result.metrics.elapsedTimeSec;
    if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) {
      spentSec += seconds;
      probeSec = Math.max(probeSec, seconds);
    } else {
      enforced = false;
    }
    observe?.(result, attempt + 1);
  };
  // Evaluate only where legacy batches end (attempts 2, 4, ...), so verdicts match legacy.
  const batchEnds = Array.from({ length: Math.ceil(N / 2) }, (_, index) => Math.min(N, (index + 1) * 2));
  for (const end of batchEnds) {
    while (exitCodes.length < end) {
      if (enforced && exitCodes.length > 0) {
        const predictedSec = Math.ceil(spentSec + probeSec * (N - exitCodes.length));
        if (predictedSec > budgetSec) {
          return {
            verdict: budgetStopVerdict(exitCodes, N),
            budget: { enforced, budgetSec, probeSec, spentSec, predictedSec },
          };
        }
      }
      // One probe at a time: each is gated, so the worst case is the budget plus one probe.
      await probe();
    }
    const evidence = evaluateFlakeConfidence(exitCodes, N);
    if (evidence.decision !== 'continue') break;
  }
  const verdict = completedTriageVerdict(exitCodes, N);
  return {
    verdict,
    budget: enforced
      ? { enforced, budgetSec, probeSec, spentSec, predictedSec: Math.ceil(spentSec) }
      : { enforced, budgetSec },
  };
}

