import { ATTEMPT_OUTCOMES, validateAttemptLedger } from './review-study.mjs';
import { contentHash, exactSha, nonnegativeInteger } from './evidence-contract.mjs';
import { exactReleaseVersion } from './install-test-lib.mjs';

const COHORTS = ['independent-newcomer', 'existing-assisted', 'synthetic-rehearsal'];
const COSTS = ['inferenceUsd', 'sandboxUsd', 'runnerUsd'];
function instant(value) {
  const time = Date.parse(value);
  if (typeof value !== 'string' || !Number.isFinite(time) || new Date(time).toISOString() !== value) throw new Error('Invalid journey instant');
  return time;
}
function measuredDuration(value, maximum, label) {
  if (value === null) return;
  nonnegativeInteger(value, label);
  if (value > maximum) throw new Error(`${label} exceeds elapsed interest time`);
}

/** Complements the legacy three-outcome coverage artifact; every attempt stays in its original cohort. */
export function summarizeAdoptionAttempts(attempts) {
  if (!Array.isArray(attempts) || attempts.length > 10_000) throw new Error('Bounded attempt array required');
  const ledger = attempts.length ? validateAttemptLedger(attempts) : null;
  for (const attempt of attempts) {
    const j = attempt.journey;
    if (!j || !COHORTS.includes(j.cohort) || !['node', 'python', 'unsupported'].includes(j.profile)) throw new Error('Explicit journey cohort/profile required');
    const elapsed = instant(j.observedAt) - instant(j.interestAt);
    if (elapsed < 0) throw new Error('Journey observation predates interest');
    measuredDuration(j.activeSetupMs, elapsed, 'activeSetupMs');
    measuredDuration(j.accessWaitMs, elapsed, 'accessWaitMs');
    nonnegativeInteger(j.authorInterventions, 'authorInterventions');
    nonnegativeInteger(j.manualConfigurationCount, 'manualConfigurationCount');
    if (!['none', 'provider-access', 'permission', 'runtime', 'configuration', 'unknown'].includes(j.blockingStatus)) throw new Error('Explicit blocking status required');
    if (![null, 'readiness', 'diagnosis', 'repair', 'refusal'].includes(j.resultKind) ||
      ![null, true, false].includes(j.resultUnderstood) || ![null, true, false].includes(j.limitExplainedBeforePaid)) throw new Error('Invalid useful-result measurement');
    const artifact = j.artifact;
    if (artifact?.installSource === 'public-npm-and-immutable-action') {
      exactReleaseVersion(artifact.packageVersion); exactSha(artifact.actionCommit, 'artifact.actionCommit');
    } else if (artifact?.installSource === 'unavailable' || (j.cohort === 'synthetic-rehearsal' && artifact?.installSource === 'local-rehearsal')) {
      if (artifact.packageVersion !== null || artifact.actionCommit !== null) throw new Error('Unavailable/local artifact is not a public release identity');
    } else throw new Error('Independent attempts require public release identity or explicit unavailable artifact');
    for (const key of COSTS) {
      const value = j.costs?.[key];
      if (value !== null && !(typeof value === 'number' && Number.isFinite(value) && value >= 0)) throw new Error('Each cost component must be measured or null');
    }
  }
  const cohorts = Object.fromEntries(COHORTS.map(cohort => {
    const rows = attempts.filter(attempt => attempt.journey.cohort === cohort);
    const journeys = rows.map(attempt => attempt.journey);
    return [cohort, {
      attempts: rows.length,
      outcomes: Object.fromEntries(ATTEMPT_OUTCOMES.map(outcome => [outcome, rows.filter(row => row.outcome === outcome).length])),
      profiles: Object.fromEntries(['node', 'python', 'unsupported'].map(profile => [profile, journeys.filter(row => row.profile === profile).length])),
      blocked: journeys.filter(row => row.blockingStatus !== 'none').length,
      assisted: journeys.filter(row => row.authorInterventions > 0).length,
      authorInterventions: journeys.reduce((sum, row) => sum + row.authorInterventions, 0),
      manualConfigurations: journeys.reduce((sum, row) => sum + row.manualConfigurationCount, 0),
      elapsedFromInterestMs: journeys.map(row => instant(row.observedAt) - instant(row.interestAt)),
      activeSetupMs: journeys.map(row => row.activeSetupMs), accessWaitMs: journeys.map(row => row.accessWaitMs),
      supportedUnaidedUsefulWithin30Minutes: journeys.filter(row => row.profile !== 'unsupported' && row.resultKind !== null && row.resultUnderstood === true &&
        row.authorInterventions === 0 && row.activeSetupMs !== null && row.activeSetupMs <= 30 * 60_000 && row.artifact.installSource === 'public-npm-and-immutable-action').length,
      unsupportedExplainedBeforePaid: journeys.filter(row => row.profile === 'unsupported' && row.limitExplainedBeforePaid === true && row.resultUnderstood === true).length,
      reportedResults: Object.fromEntries(['readiness', 'diagnosis', 'repair', 'refusal'].map(kind => [kind, journeys.filter(row => row.resultKind === kind).length])),
    }];
  }));
  const components = Object.fromEntries(COSTS.map(key => {
    const values = attempts.map(attempt => attempt.journey.costs[key]).filter(value => value !== null);
    return [key, { measuredUsd: values.reduce((sum, value) => sum + value, 0), measuredAttempts: values.length, unknownAttempts: attempts.length - values.length }];
  }));
  return { schemaVersion: 'sutura-adoption-attempt-summary-v1', status: cohorts['independent-newcomer'].attempts ? 'PARTIAL' : 'unmeasured',
    totalAttempts: attempts.length, ledgerHash: ledger?.ledgerHash ?? contentHash([]), cohorts,
    costs: { components, totalUsd: attempts.length > 0 && Object.values(components).every(value => value.unknownAttempts === 0) ?
      Object.values(components).reduce((sum, value) => sum + value.measuredUsd, 0) : null },
    verifiedRepairPath: 'unmeasured',
    evidenceLimit: 'Recorded onboarding results are not independent native-green repair proof. The legacy three-outcome artifact is not this denominator.',
    nextAction: 'Retain every attempt and obtain separately authorized public-release, native-verification and independent comprehension evidence.' };
}
