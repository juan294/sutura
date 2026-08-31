import type { CaseFile } from '@sutura/core';

type ActionOutcome = CaseFile['outcome'] | 'already-attempted';

interface OutcomeReporter {
  setOutput(name: string, value: string): void;
  setFailed(message: string): void;
}

export function requiredOutcomeFailure(
  outcome: ActionOutcome,
  requireFixed: boolean,
): string | null {
  return requireFixed && outcome !== 'fixed'
    ? `Sutura required fixed but produced ${outcome}`
    : null;
}

export function reportOutcome(
  outcome: ActionOutcome,
  requireFixed: boolean,
  reporter: OutcomeReporter,
): void {
  reporter.setOutput('outcome', outcome);
  const failure = requiredOutcomeFailure(outcome, requireFixed);
  if (failure !== null) reporter.setFailed(failure);
}
