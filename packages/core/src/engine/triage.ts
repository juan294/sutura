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
  | { enforced: true; budgetSec: number; probeSec: number; spentSec: number; predictedSec: number; probes: number }
  | { enforced: false; budgetSec: number };

/** A narrowed rerun of the failing test, kept only while it reproduces the same failure. */
export interface FocusedProbe {
  command: string;
  sameFailure(result: RunResult): boolean;
}

export interface TriageFocusEvidence {
  command: string;
  kept: number;
  rejected: number;
}

/** How a probe's result was used: a kept or rejected focused probe, or a full-command probe. */
export type TriageProbeKind = 'focused-kept' | 'focused-rejected' | 'full';

/** The stage ledger note for each probe kind; reports count focused probes by these notes. */
export const TRIAGE_PROBE_NOTES: Readonly<Record<TriageProbeKind, string>> = Object.freeze({
  full: 'Reproduction probe',
  'focused-kept': 'Focused probe: same test, same failure',
  'focused-rejected': 'Focused probe: not the same failure; restarting with the full command',
});

export interface TriageRun {
  verdict: TriageVerdict;
  /** Present only when the policy sets a budget. */
  budget?: TriageBudgetEvidence;
  /** Present only when a focused probe was supplied. */
  focus?: TriageFocusEvidence;
}

function budgetStopVerdict(exitCodes: readonly number[], maximumAttempts: number): TriageVerdict {
  // A stop right after a focused restart has no full-command attempt to evaluate.
  if (exitCodes.length === 0) return { ...notRunTriageVerdict(), maximumAttempts, stopReason: 'sandbox-budget' };
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
 * Triage under a cumulative sandbox-time budget, optionally starting from a
 * focused probe. Probe 1 runs alone and is measured, because no other run
 * predicts what triage costs (Sutura reproduces one command and triages
 * another). Probes then run one at a time, and before each the seconds spent
 * plus the slowest probe so far times the remaining attempts must fit the
 * budget. Probes keep the legacy numbering and the legacy evaluation points
 * (after attempts 2, 4 and 5), so a run within budget reaches exactly the
 * legacy verdict. The worst case is the budget plus one probe.
 *
 * A focused probe counts only while it fails the same way as the original
 * failure; it can therefore only confirm `real`. At the first focused pass or
 * mismatch its probes are discarded and triage restarts with the full command
 * from attempt 0, still under the same budget.
 */
export async function boundedTriage(
  executor: Executor,
  failingImage: ImageId,
  failingCmd: string,
  N = DEFAULT_TRIAGE_RUNS,
  observe?: (result: RunResult, probe: number, kind: TriageProbeKind) => void,
  policy: TriagePolicy = LEGACY_TRIAGE_POLICY,
  focus?: FocusedProbe,
): Promise<TriageRun> {
  const budgetSec = policy.sandboxBudgetSec;
  if (budgetSec === undefined && focus === undefined) {
    return { verdict: await triage(executor, failingImage, failingCmd, N, (result, attempt) => observe?.(result, attempt, 'full')) };
  }
  if (!Number.isSafeInteger(N) || N <= 0 || N > MAX_TRIAGE_RUNS) {
    throw new RangeError(`N must be between 1 and ${MAX_TRIAGE_RUNS}`);
  }
  let exitCodes: number[] = [];
  let focused = focus !== undefined;
  const focusEvidence = focus === undefined ? undefined : { command: focus.command, kept: 0, rejected: 0 };
  let probes = 0;
  let spentSec = 0;
  let probeSec = 0;
  let enforced = true;
  const probe = async () => {
    const attempt = exitCodes.length;
    const command = focused && focus ? focus.command : failingCmd;
    const results = await executor.runMany(
      failingImage,
      [`SUTURA_TRIAGE_ATTEMPT=${shellQuote(String(attempt))} sh -lc ${shellQuote(command)}`],
      { cwd: SNAPSHOT_CWD },
    );
    const result = results[0];
    if (results.length !== 1 || result === undefined) throw new Error('executor returned an unexpected triage result count');
    probes += 1;
    const seconds = result.metrics.elapsedTimeSec;
    if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) {
      spentSec += seconds;
      probeSec = Math.max(probeSec, seconds);
    } else {
      enforced = false;
    }
    let kind: TriageProbeKind = 'full';
    if (focused && focus && focusEvidence) {
      kind = focus.sameFailure(result) ? 'focused-kept' : 'focused-rejected';
      focusEvidence[kind === 'focused-kept' ? 'kept' : 'rejected'] += 1;
      if (kind === 'focused-rejected') {
        // Restart: a focused pass or a different failure says nothing about the full command.
        focused = false;
        exitCodes = [];
      }
    }
    if (kind !== 'focused-rejected') exitCodes.push(result.exitCode);
    observe?.(result, probes, kind);
  };
  const gated = () => budgetSec !== undefined && enforced && probes > 0;
  for (;;) {
    if (gated()) {
      const predictedSec = Math.ceil(spentSec + probeSec * (N - exitCodes.length));
      if (predictedSec > budgetSec!) {
        return {
          verdict: budgetStopVerdict(exitCodes, N),
          budget: { enforced: true, budgetSec: budgetSec!, probeSec, spentSec, predictedSec, probes },
          ...(focusEvidence ? { focus: focusEvidence } : {}),
        };
      }
    }
    // One probe at a time: each is gated, so the worst case is the budget plus one probe.
    await probe();
    const attempts = exitCodes.length;
    // Evaluate only where legacy batches end (attempts 2, 4, ..., N), so verdicts match legacy.
    if ((attempts % 2 === 0 || attempts === N) && attempts > 0 &&
      evaluateFlakeConfidence(exitCodes, N).decision !== 'continue') break;
  }
  return {
    verdict: completedTriageVerdict(exitCodes, N),
    ...(budgetSec === undefined ? {} : {
      budget: enforced
        ? { enforced, budgetSec, probeSec, spentSec, predictedSec: Math.ceil(spentSec), probes }
        : { enforced, budgetSec },
    }),
    ...(focusEvidence ? { focus: focusEvidence } : {}),
  };
}
