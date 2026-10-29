import { CI_CONTROL_NEXT_ACTION, ContreeError, RuntimeDetectionError, type CaseFile } from '@sutura/core';
import { ActionInputError } from './input.js';
type ActionOutcome = CaseFile['outcome'] | 'already-attempted' | 'repair-branch-skipped';
interface OutcomeReporter { setOutput(name: string, value: string): void; setFailed(message: string): void }
const STAGES = {
  'native-command-admission': ['admission'],
  'unsupported-input': ['runtime-detection', 'preparation', 'snapshot'],
  'setup-blocked': ['configuration', 'admission'],
  'resource-blocked': ['provider-request', 'preparation', 'reproduction', 'search', 'audit'],
  'reproduction-mismatch': ['reproduction', 'triage'],
  'identity-unavailable': ['inspection', 'reproduction', 'triage'],
  'budget-exhausted': ['triage', 'search', 'audit'],
  'repair-not-fixed': ['search'], 'policy-refused': ['audit'],
  'unexpected-exception': [],
} as const;
export interface TerminalDetail { reason: keyof typeof STAGES; stage: string; nextAction: string }
export function requiredOutcomeFailure(outcome: ActionOutcome, requireFixed: boolean): string | null {
  return requireFixed && outcome !== 'fixed' ? `Sutura required fixed but produced ${outcome}` : null;
}
export function reportOutcome(outcome: ActionOutcome, requireFixed: boolean, reporter: OutcomeReporter, detail?: TerminalDetail): void {
  reporter.setOutput('outcome', outcome);
  if (!detail && outcome !== 'fixed') reporter.setOutput('next-action', outcome === 'already-attempted' || outcome === 'repair-branch-skipped'
    ? 'Inspect the existing linked attempt and retain its claim; wait for a distinct eligible event.'
    : outcome === 'flaky-no-patch' ? 'Retain the flaky evidence and observe the next organic run; no repair was proposed.'
      : 'Inspect the retained case and failing-stage diagnostics before another authorized event.');
  if (detail) {
    reporter.setOutput('terminal-reason', detail.reason);
    reporter.setOutput('failing-stage', detail.stage);
    reporter.setOutput('next-action', detail.nextAction);
  }
  const known = detail && Object.hasOwn(STAGES, detail.reason) && (STAGES[detail.reason] as readonly string[]).includes(detail.stage) && detail.nextAction.trim();
  const failure = requiredOutcomeFailure(outcome, requireFixed) ??
    ((detail && !known) || (outcome === 'infra-stop' && !known) ? 'Sutura monitor failed: unexpected or invalid terminal evidence; inspect retained diagnostics.' : null);
  if (failure !== null) reporter.setFailed(failure);
}
/** Admit only typed, exact source-defined boundaries. Error prose or broad provider status never creates success. */
export function expectedActionStop(error: unknown): TerminalDetail | undefined {
  if (error instanceof ActionInputError && /^Missing required action input: (?:nebius-api-key|contree-token|contree-project)$/u.test(error.message)) {
    return { reason: 'setup-blocked', stage: 'configuration', nextAction: `${error.message}. Prepare the missing named provider configuration with sutura init --plan; do not run a paid smoke.` };
  }
  if (error instanceof RuntimeDetectionError && ['runtime-not-detected', 'runtime-ambiguous', 'runtime-evidence-limit'].includes(error.code)) {
    return { reason: 'unsupported-input', stage: 'runtime-detection', nextAction: `Resolve ${error.code} using sutura assess and an explicit supported runtime/root before a distinct eligible event.` };
  }
  if (error instanceof ContreeError && error.status === 429) {
    return { reason: 'resource-blocked', stage: 'provider-request', nextAction: 'ConTree returned HTTP 429. Review the existing provider quota/rate-limit evidence; preserve consumed-resource receipts and wait for an authorized later event.' };
  }
  if (error instanceof ContreeError && error.status === undefined && (error.message === 'ConTree snapshot exceeds 10000 files' ||
    error.message === 'ConTree dependency snapshot package.json is too large' || error.message === 'ConTree dependency snapshot workspace file is too large')) {
    return { reason: 'unsupported-input', stage: 'snapshot', nextAction: 'Select a supported bounded repository snapshot with sutura assess; do not retry the same oversized input.' };
  }
  return undefined;
}
export function caseTerminalDetail(result: CaseFile): TerminalDetail | undefined {
  if (result.outcome === 'gave-up' && result.reproduction?.parser === 'native-command-admission' && result.diagnosis.signals.includes('native-command-admission:ci-control')) return { reason: 'native-command-admission', stage: 'admission', nextAction: CI_CONTROL_NEXT_ACTION };
  const identity = result.reproduction ?? result.triage.reproduction;
  if (identity?.status === 'mismatch') return { reason: 'reproduction-mismatch', stage: 'reproduction', nextAction: 'Compare retained native and sandbox failure identities; repair the reproduction boundary before a new attempt.' };
  if (identity?.status === 'unavailable') return { reason: 'identity-unavailable', stage: 'reproduction', nextAction: 'Provide complete supported native and sandbox diagnostics; a nonzero exit alone cannot authorize repair.' };
  if (result.outcome === 'refused') return { reason: 'policy-refused', stage: 'audit', nextAction: 'Review the retained audit refusal and protected contract; do not bypass the verifier.' };
  if (result.outcome === 'gave-up') return { reason: 'repair-not-fixed', stage: 'search', nextAction: 'Review retained search evidence and measured bounds before selecting a distinct supported repair opportunity.' };
  return undefined;
}
