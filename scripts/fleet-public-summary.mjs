/** Public exports use a closed vocabulary; private payloads and arbitrary object keys never pass through. */
export const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export const amount = value => Number.isFinite(value) && value >= 0 ? value : null;
export const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value ? value : null;
export function counts(value, keys) {
  return Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, count(value[key])]));
}
export const OUTCOMES = ['fixed', 'flaky-no-patch', 'refused', 'gave-up', 'infra-stop', 'unknown'];
const FAILURE_CODES = ['exact-source-unavailable', 'provider-disk-exhausted', 'runtime-evidence-limit', 'runtime-evidence-escape', 'runtime-evidence-changed',
  'runtime-not-detected', 'runtime-ambiguous', 'runtime-detection-failed', 'replay-snapshot-limit',
  'snapshot-file-limit', 'snapshot-source-limit', 'snapshot-archive-limit', 'snapshot-input-invalid',
  'missing-sandbox-prerequisite', 'dependency-preparation-failed', 'unknown-error', 'unstructured', 'unknown'];
function failureCounts(value) {
  const result = counts(value, FAILURE_CODES);
  const unknown = Object.entries(value ?? {}).filter(([key]) => !FAILURE_CODES.includes(key))
    .reduce((sum, [, value]) => sum + (count(value) ?? 0), 0);
  if (unknown) result.unknown = (result.unknown ?? 0) + unknown;
  return result;
}
export function publicDelivery(value) {
  return { ...counts(value, ['typedFixedOutcomes', 'verifiedRepairPrs', 'integratedRecoveries']),
    ...(value?.observedAt === undefined ? {} : { observedAt: instant(value.observedAt) }) };
}
function freshness(value) {
  return { observedAt: instant(value?.observedAt), ageSec: amount(value?.ageSec),
    status: ['current', 'stale', 'unavailable'].includes(value?.status) ? value.status : 'unavailable' };
}
export function sanitizeFleetSummary(summary) {
  if (summary?.schemaVersion !== 'sutura-fleet-summary-v2') throw new Error('Invalid fleet summary schema');
  const result = { schemaVersion: 'sutura-fleet-summary-v2', collectedAt: instant(summary.collectedAt), startedAt: instant(summary.startedAt),
    actionCommit: /^[a-f0-9]{40}$/u.test(summary.actionCommit ?? '') ? summary.actionCommit : null,
    ...counts(summary, ['fleetRepositories', 'installedRepositories', 'monitorRuns', 'noRepairNeeded', 'notTriggered', 'repairAttempts', 'repairPrsOpened']),
    attemptStages: { ...counts(summary.attemptStages, ['attempted', 'claimed', 'searchStarted', 'providerInvoked', 'fixed', 'recovered']),
      recoveryEvidenceComplete: summary.attemptStages?.recoveryEvidenceComplete === true },
    failureCauses: failureCounts(summary.failureCauses), costCompleteness: counts(summary.costCompleteness, ['measured', 'unavailable']),
    actionIdentity: counts(summary.actionIdentity, ['matched', 'mismatched', 'unavailable']), outcomes: counts(summary.outcomes, OUTCOMES),
    monitorConclusions: counts(summary.monitorConclusions, ['success', 'failure', 'timed_out', 'cancelled', 'skipped', 'unavailable']),
    ...Object.fromEntries(['inferenceCostUsd', 'sandboxCostUsd', 'totalCostUsd', 'medianAttemptDurationSec'].map(key => [key, amount(summary[key])])) };
  if (summary.delivery) result.delivery = publicDelivery(summary.delivery);
  if (summary.evidence) {
    const value = summary.evidence;
    result.evidence = { collection: ['complete', 'incomplete'].includes(value.collection) ? value.collection : 'unavailable',
      baseline: ['complete', 'incomplete'].includes(value.baseline) ? value.baseline : 'unavailable',
      actorProvenance: value.actorProvenance === 'available' ? 'available' : 'unavailable',
      freshness: { assessedAt: instant(value.freshness?.assessedAt), maxAgeSec: amount(value.freshness?.maxAgeSec),
        monitor: freshness(value.freshness?.monitor), recovery: freshness(value.freshness?.recovery) } };
  }
  return result;
}
/** Daily history keeps the schema each row was written under; v1 rows stay v1 and gain no invented fields. */
export function sanitizeFleetSnapshot(snapshot) {
  if (snapshot?.schemaVersion !== 'sutura-fleet-summary-v1') return sanitizeFleetSummary(snapshot);
  return { schemaVersion: 'sutura-fleet-summary-v1', collectedAt: instant(snapshot.collectedAt), startedAt: instant(snapshot.startedAt),
    actionCommit: /^[a-f0-9]{40}$/u.test(snapshot.actionCommit ?? '') ? snapshot.actionCommit : null,
    ...counts(snapshot, ['fleetRepositories', 'installedRepositories', 'monitorRuns', 'noRepairNeeded', 'notTriggered', 'repairAttempts', 'repairPrsOpened']),
    outcomes: counts(snapshot.outcomes, OUTCOMES),
    ...Object.fromEntries(['inferenceCostUsd', 'sandboxCostUsd', 'totalCostUsd', 'medianAttemptDurationSec'].map(key => [key, amount(snapshot[key])])) };
}
