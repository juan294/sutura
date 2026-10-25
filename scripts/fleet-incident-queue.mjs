import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { incidentEvidenceKey } from './fleet-incident-evidence.mjs';

export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const HASH = /^[a-f0-9]{64}$/u;
const owners = new Set(['repository', 'installation', 'provider', 'sutura', 'unknown']);
const actions = {
  'source-defect': 'Inspect the original failure and matching native verification before integrating a fix.',
  installation: 'Review the prepared installation repair and missing access names.',
  'credential-boundary': 'Review the scoped credential repair; do not disclose credential values.',
  'provider-resource': 'Inspect the failing resource and approve any capacity change separately.',
  network: 'Inspect the captured network failure before a distinct authorized attempt.',
  'generated-bundle-stale': 'Rebuild and verify the exact source before publishing.',
  'action-version-mismatch': 'Review the immutable Action pin and runtime contract.',
  'live-probe': 'Inspect the service probe; source repair is not established.',
  'sutura-internal': 'Inspect the Sutura failure; internal faults remain unresolved.',
  unknown: 'Collect complete selected-step evidence and the native verification contract.',
};
function safeUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password && /^\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/u.test(url.pathname) ? url.origin + url.pathname : null; }
  catch { return null; }
}

/** Presentation only: exact incidents and immutable observations remain the source of truth. */
export function buildIncidentQueue({ incidents, qualifications = [], classifications = [], previous = null, observedAt, scopeDigest, scanComplete, window }) {
  if (!HASH.test(scopeDigest ?? '') || !Number.isFinite(Date.parse(observedAt)) || !Array.isArray(incidents) || incidents.length > 100_000) throw new Error('Invalid bounded queue scope');
  const days = (Date.parse(window?.end) - Date.parse(window?.start)) / 86_400_000;
  if (!(days > 0)) throw new Error('Queue rates require an explicit nonempty observation window');
  const proof = new Map(qualifications.map(item => [item.incidentKey, item]));
  const classified = new Map(classifications.map(item => [item.incidentKey, item]));
  const groups = new Map(), seen = new Set();
  let measuredCostUsd = 0, costMeasuredIncidents = 0, verifiedRecoveries = 0;
  let windowIncidentCount = 0, windowUnknownTimeIncidents = 0;
  for (const item of incidents) {
    if (!['repositoryId', 'workflowId', 'sourceRunId', 'sourceAttempt'].every(key => Number.isSafeInteger(item[key]) && item[key] > 0) || !/^[a-f0-9]{40}$/u.test(item.sourceSha ?? '')) throw new Error('Invalid exact incident identity');
    const completedAt = Date.parse(item.sourceCompletedAt ?? '');
    if (!Number.isFinite(completedAt)) windowUnknownTimeIncidents += 1;
    else if (completedAt >= Date.parse(window.start) && completedAt < Date.parse(window.end)) windowIncidentCount += 1;
    const key = incidentEvidenceKey(item);
    if (seen.has(key)) throw new Error('Duplicate exact incident');
    seen.add(key);
    const record = classified.get(key);
    const known = record?.sourceSha === item.sourceSha && HASH.test(record.failureIdentityDigest ?? '') && HASH.test(record.verificationContractDigest ?? '') && record.signatureVersion === 'sutura-failure-identity-v1' && owners.has(record.ownerDomain);
    const groupKey = known ? digest([item.repositoryId, item.workflowId, record.failureIdentityDigest, record.signatureVersion, record.ownerDomain, record.verificationContractDigest]) : digest(['exact-incident', key]);
    const cause = known && Object.hasOwn(actions, record.cause) ? record.cause : 'unknown';
    const group = groups.get(groupKey) ?? { key: groupKey, repositoryId: item.repositoryId, workflowId: item.workflowId,
      identity: known ? 'known' : 'unknown', cause, owner: known ? record.ownerDomain : 'unknown', nextAction: actions[cause], members: [] };
    const qualification = proof.get(key);
    const qualified = qualification?.integration === 'qualified' && Array.isArray(qualification.proofDigests) && qualification.proofDigests.length > 0 && qualification.proofDigests.every(value => HASH.test(value));
    if (qualified) verifiedRecoveries += 1;
    const measured = item.costCoverage === 'measured' && [item.inferenceCostUsd, item.sandboxCostUsd].every(value => Number.isFinite(value) && value >= 0);
    if (measured) { measuredCostUsd += item.inferenceCostUsd + item.sandboxCostUsd; costMeasuredIncidents += 1; }
    group.members.push({ incidentKey: key, sourceSha: item.sourceSha, sourceCompletedAt: item.sourceCompletedAt,
      sourceRunUrl: safeUrl(item.sourceRunUrl), qualification: qualified ? 'qualified' : qualification?.integration === 'not-qualified' ? 'not-qualified' : 'unmeasured',
      proofDigests: qualified ? [...qualification.proofDigests].sort() : [] });
    groups.set(groupKey, group);
  }
  const previousGroups = new Map(previous?.scopeDigest === scopeDigest ? previous.groups.map(group => [group.key, group]) : []);
  const result = [...groups.values()].sort((a, b) => a.key.localeCompare(b.key)).map(group => {
    group.members.sort((a, b) => a.incidentKey.localeCompare(b.incidentKey));
    const state = group.members.every(member => member.qualification === 'qualified') ? 'closed' : 'open';
    const prior = previousGroups.get(group.key);
    const occurrence = (prior?.occurrence ?? 1) + (prior?.state === 'closed' && state === 'open' ? 1 : 0);
    return { ...group, state, occurrence, transitionKey: digest([group.key, occurrence, state]) };
  });
  return { schemaVersion: 'sutura-incident-queue-v1', observedAt, scopeDigest, scan_complete: scanComplete === true && windowUnknownTimeIncidents === 0,
    window, elapsedDays: days, incidents: incidents.length, windowIncidentCount, windowUnknownTimeIncidents,
    failuresPerDay: windowUnknownTimeIncidents === 0 ? windowIncidentCount / days : null,
    verifiedRecoveries, measuredCostUsd, costMeasuredIncidents,
    costPerVerifiedRecoveryUsd: verifiedRecoveries > 0 && costMeasuredIncidents === incidents.length ? measuredCostUsd / verifiedRecoveries : null,
    groups: result };
}

export function renderIncidentQueue(queue) {
  return [`Sutura weekly recovery queue`, `Coverage: ${queue.scan_complete ? 'complete' : 'PARTIAL; scan_complete=false'}.`,
    `${queue.incidents} exact incidents retained; ${queue.verifiedRecoveries} verified integrations.`,
    `${queue.windowIncidentCount} incidents in the observation window; ${queue.windowUnknownTimeIncidents} incidents have unknown completion time. Rate: ${queue.failuresPerDay === null ? 'UNAVAILABLE' : `${queue.failuresPerDay.toFixed(2)} failures/day`}.`,
    `Measured cost: ${queue.measuredCostUsd.toFixed(2)} USD across ${queue.costMeasuredIncidents}/${queue.incidents} incidents; unmeasured components remain unknown.`,
    ...queue.groups.map(group => `${group.state.toUpperCase()} ${group.cause} / ${group.owner}; occurrence ${group.occurrence}; ${group.members.length} incident(s). ${group.nextAction}\n${group.members.map(member => `${member.sourceRunUrl ?? `Incident ${member.incidentKey}`}${member.proofDigests.length ? `; proof digests: ${member.proofDigests.join(', ')}` : ''}`).join('\n')}`),
    'Accepted email is not delivered email; delivery does not establish owner comprehension.'].join('\n\n');
}

export async function writePrivateAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
    const directory = await open(dirname(path), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await rm(temporary, { force: true }); }
}
