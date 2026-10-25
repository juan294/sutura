import { contentHash } from './evidence-contract.mjs';
import { incidentEvidenceKey, qualifyIncident, validateIncidentEvidence } from './fleet-incident-evidence.mjs';
import { buildIncidentQueue } from './fleet-incident-queue.mjs';
const DAY = 86_400_000, SHA = /^[a-f0-9]{40}$/u;
const EVENTS = ['push', 'pull_request', 'schedule', 'workflow_dispatch', 'other', 'unknown'];
const CAUSES = ['source-defect', 'generated-bundle-stale', 'action-version-mismatch', 'installation', 'credential-boundary', 'live-probe', 'provider-resource', 'network', 'sutura-internal', 'unknown'];
function instant(value) {
  const time = Date.parse(value);
  if (typeof value !== 'string' || !Number.isFinite(time) || new Date(time).toISOString() !== value) throw new Error('Invalid field-report instant');
  return time;
}
function count(value) { return Number.isSafeInteger(value) && value >= 0; }
function array(value, label, maximum = 100_000) {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`Bounded ${label} array required`);
  return value;
}

/** Offline projection of immutable collector observations. Native qualification is recomputed by the existing reducer. */
export function buildFleetFieldReport({ observedAt, collectedAt, window, scope, coverage, incidents, installations,
  evidenceObservations = [], verificationContracts = {}, postWindows = [] }) {
  const now = instant(observedAt), collected = instant(collectedAt), start = instant(window?.start), end = instant(window?.end);
  if (!(end > start) || end - start > 366 * DAY || end > now) throw new Error('Invalid bounded observation window');
  array(incidents, 'incident'); array(installations, 'installation', 1000); array(evidenceObservations, 'companion'); array(postWindows, 'source-window', 10_000);
  const observations = evidenceObservations.map(validateIncidentEvidence);
  if (observations.some(record => instant(record.observedAt) > collected)) throw new Error('Companion evidence postdates collection');
  const qualifications = incidents.map(incident => qualifyIncident(incident, observations, verificationContracts[String(incident.repositoryId)]));
  const ageMs = now - collected, fresh = ageMs >= 0 && ageMs <= 36 * 3_600_000;
  const queue = buildIncidentQueue({ incidents, qualifications, observedAt, window, scopeDigest: contentHash(scope),
    scanComplete: coverage?.complete === true && fresh && collected >= end });
  const selected = incidents.filter(incident => {
    const time = Date.parse(incident.sourceCompletedAt ?? ''); return time >= start && time < end;
  });
  const selectedKeys = new Set(selected.map(incidentEvidenceKey));
  const latest = new Map();
  for (const record of [...observations].sort((a, b) => a.observedAt.localeCompare(b.observedAt) || contentHash(a).localeCompare(contentHash(b)))) latest.set(record.incidentKey, record);
  const triggers = Object.fromEntries(EVENTS.map(event => [event, 0])), causes = Object.fromEntries(CAUSES.map(cause => [cause, 0]));
  for (const incident of selected) {
    const record = latest.get(incidentEvidenceKey(incident));
    const event = record?.trigger?.authenticated === true ? record.trigger.event : null;
    triggers[event === null ? 'unknown' : EVENTS.includes(event) ? event : 'other'] += 1;
    const classification = record?.classification;
    const cause = classification?.schemaVersion === 'sutura-incident-classification-v1' && classification.confidence === 'confirmed' &&
      record.completeness.source && record.completeness.logs && CAUSES.includes(classification.cause) ? classification.cause : 'unknown';
    causes[cause] += 1;
  }
  const daily = [];
  for (let cursor = Math.floor(start / DAY) * DAY; cursor < end; cursor += DAY) {
    const from = Math.max(start, cursor), to = Math.min(end, cursor + DAY), elapsedDays = (to - from) / DAY;
    const failures = selected.filter(incident => { const time = Date.parse(incident.sourceCompletedAt); return time >= from && time < to; }).length;
    daily.push({ day: new Date(cursor).toISOString().slice(0, 10), elapsedDays, failedAttempts: failures,
      failuresPerDay: queue.windowUnknownTimeIncidents ? null : failures / elapsedDays });
  }
  const selectedQualifications = qualifications.filter(item => selectedKeys.has(item.incidentKey));
  const integrated = selectedQualifications.filter(item => item.integration === 'qualified').length;
  const costs = selected.filter(incident => incident.costCoverage === 'measured' &&
    [incident.inferenceCostUsd, incident.sandboxCostUsd].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0));
  const measuredCostUsd = costs.reduce((sum, incident) => sum + incident.inferenceCostUsd + incident.sandboxCostUsd, 0);
  const installationRows = installations.map(item => {
    const records = selected.filter(incident => incident.repositoryId === item.repositoryId);
    const windows = postWindows.filter(row => row.repository === item.repository && row.startedAt === window.start && row.endedAt === window.end && count(row.completedRuns));
    const workflowIds = (item.workflows ?? []).map(workflow => workflow.id);
    const volumeComplete = item.inventoryComplete === true && workflowIds.length > 0 &&
      workflowIds.every(id => windows.filter(row => row.workflowId === id).length === 1);
    const opportunities = volumeComplete ? windows.reduce((sum, row) => sum + row.completedRuns, 0) : null;
    return { installationKey: contentHash({ repository: item.repository ?? null, repositoryId: item.repositoryId ?? null }),
      repositoryId: Number.isSafeInteger(item.repositoryId) ? item.repositoryId : null,
      state: ['active', 'disabled', 'uninstalled', 'inaccessible'].includes(item.state) ? item.state : 'unknown',
      actionShas: [...new Set((item.actionShas ?? []).filter(value => SHA.test(value)))].sort(),
      failedAttempts: records.length, ciOpportunities: opportunities,
      disposition: item.state === 'inaccessible' || !item.inventoryComplete ? 'unknown' : records.length ? 'observed-failures' :
        opportunities === 0 ? 'unexercised' : opportunities === null ? 'unknown' : 'no-eligible-failure-observed',
      nextAction: records.length ? 'Review the exact incident and its observed Action version.' : 'Retain enrollment and collect the next applicable event; silence is not repair evidence.' };
  });
  return { schemaVersion: 'sutura-fleet-field-report-v1', status: 'PARTIAL', observedAt, collectedAt, window: { start: window.start, end: window.end },
    elapsedDays: (end - start) / DAY, freshness: fresh ? 'fresh' : ageMs < 0 ? 'invalid-future' : 'stale', freshnessLimitHours: 36,
    scan_complete: queue.scan_complete, failedAttempts: selected.length,
    independentSourceRuns: new Set(selected.map(incident => `${incident.repositoryId}:${incident.sourceRunId}`)).size,
    attemptCountingRule: 'Every exact repository/run/attempt remains counted; independent source runs are separate.',
    failuresPerDay: queue.failuresPerDay, unknownCompletionTimes: queue.windowUnknownTimeIncidents,
    daily, triggerBuckets: triggers, confirmedCauseBuckets: causes,
    typedFixedOutcomes: selected.filter(incident => incident.cause === 'fixed').length,
    qualifiedRepairProposals: selectedQualifications.filter(item => item.proposal === 'qualified').length,
    qualifiedIntegratedRecoveries: integrated, qualificationUnknown: selectedQualifications.filter(item => item.integration === 'unmeasured').length,
    measuredInferenceAndSandboxUsd: measuredCostUsd, costCoverage: { measured: costs.length, unknown: selected.length - costs.length, runner: 'UNAVAILABLE' },
    costPerVerifiedRecoveryUsd: integrated > 0 && costs.length === selected.length ? measuredCostUsd / integrated : null,
    installations: installationRows, organicIntegratedRecovery: 'unmeasured', recurrenceControl: 'unmeasured',
    unavailable: ['organic-attribution', 'defect-specific-opportunities', 'owner-notification-and-intervention', 'comprehension', 'complete-installation-native-checks'],
    inputDigests: Object.fromEntries(Object.entries({ scope, coverage, incidents, installations, evidenceObservations, verificationContracts, postWindows }).map(([key, value]) => [key, contentHash(value)])),
    nextAction: 'Continue the normal authorized collection; obtain organic attribution, native installation proof and defect-specific opportunities before raising field acceptance levels.' };
}

/** Public whitelist excludes enrollment identities, workflow/source IDs and all input free text. */
export function publicFieldReport(report) {
  function number(value, nullable = false) {
    if (nullable && value === null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Invalid public aggregate number');
    return value;
  }
  function integer(value) { if (!count(value)) throw new Error('Invalid public aggregate count'); return value; }
  function time(value) { instant(value); return value; }
  if (report?.schemaVersion !== 'sutura-fleet-field-report-v1' || report.status !== 'PARTIAL' ||
    typeof report.scan_complete !== 'boolean' || !['fresh', 'stale', 'invalid-future'].includes(report.freshness)) throw new Error('Invalid public field report');
  const result = { schemaVersion: report.schemaVersion, status: 'PARTIAL', observedAt: time(report.observedAt), collectedAt: time(report.collectedAt),
    window: { start: time(report.window.start), end: time(report.window.end) }, elapsedDays: number(report.elapsedDays), freshness: report.freshness,
    freshnessLimitHours: 36, scan_complete: report.scan_complete,
    daily: array(report.daily, 'daily', 367).map(row => {
      time(`${row.day}T00:00:00.000Z`);
      return { day: row.day, elapsedDays: number(row.elapsedDays), failedAttempts: integer(row.failedAttempts), failuresPerDay: number(row.failuresPerDay, true) };
    }),
    triggerBuckets: Object.fromEntries(EVENTS.map(event => [event, integer(report.triggerBuckets[event])])),
    confirmedCauseBuckets: Object.fromEntries(CAUSES.map(cause => [cause, integer(report.confirmedCauseBuckets[cause])])),
    costCoverage: { measured: integer(report.costCoverage.measured), unknown: integer(report.costCoverage.unknown), runner: 'UNAVAILABLE' },
    organicIntegratedRecovery: 'unmeasured', recurrenceControl: 'unmeasured',
  };
  for (const key of ['failedAttempts', 'independentSourceRuns', 'unknownCompletionTimes', 'typedFixedOutcomes', 'qualifiedRepairProposals', 'qualifiedIntegratedRecoveries', 'qualificationUnknown']) result[key] = integer(report[key]);
  for (const key of ['failuresPerDay', 'measuredInferenceAndSandboxUsd', 'costPerVerifiedRecoveryUsd']) result[key] = number(report[key], key !== 'measuredInferenceAndSandboxUsd');
  return result;
}
