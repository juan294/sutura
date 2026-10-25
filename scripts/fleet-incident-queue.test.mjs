import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIncidentQueue, renderIncidentQueue } from './fleet-incident-queue.mjs';

const at = '2026-10-25T12:00:00.000Z';
const incident = (id, attempt = 1) => ({ schemaVersion: 'sutura-fleet-incident-v2', repositoryId: 1, workflowId: 2, sourceRunId: id, sourceAttempt: attempt, sourceSha: 'a'.repeat(40), sourceCompletedAt: at, state: 'sutura-green', cause: 'fixed', sourceRunUrl: `https://github.com/example/project/actions/runs/${id}` });
const classification = id => ({ incidentKey: `1:${id}:1`, sourceSha: 'a'.repeat(40), failureIdentityDigest: 'b'.repeat(64), signatureVersion: 'sutura-failure-identity-v1', ownerDomain: 'repository', cause: 'source-defect', verificationContractDigest: 'c'.repeat(64) });
const input = { observedAt: at, scopeDigest: 'd'.repeat(64), scanComplete: true, window: { start: '2026-10-19T00:00:00.000Z', end: at } };
test('groups known recurrence while retaining every exact attempt and no false v2 closure', () => {
  const queue = buildIncidentQueue({ ...input, incidents: [incident(3), incident(4), incident(4, 2)], classifications: [classification(3), classification(4)] });
  assert.equal(queue.groups.length, 2);
  assert.equal(queue.incidents, 3);
  assert.equal(queue.verifiedRecoveries, 0);
  assert.equal(queue.groups[0].state, 'open');
});
test('qualifies closure from companion proof and reopens on a new incident', () => {
  const previous = buildIncidentQueue({ ...input, incidents: [incident(3)], classifications: [classification(3)], qualifications: [{ incidentKey: '1:3:1', integration: 'qualified', proofDigests: ['e'.repeat(64)] }] });
  assert.equal(previous.groups[0].state, 'closed');
  assert.match(renderIncidentQueue(previous), new RegExp('e'.repeat(64))); 
  const next = buildIncidentQueue({ ...input, previous, incidents: [incident(3), incident(4)], classifications: [classification(3), classification(4)], qualifications: [{ incidentKey: '1:3:1', integration: 'qualified', proofDigests: ['e'.repeat(64)] }] });
  assert.equal(next.groups[0].state, 'open');
  assert.equal(next.groups[0].occurrence, 2);
  assert.deepEqual(buildIncidentQueue({ ...input, previous: next, incidents: [incident(3), incident(4)], classifications: [classification(3), classification(4)], qualifications: [{ incidentKey: '1:3:1', integration: 'qualified', proofDigests: ['e'.repeat(64)] }] }), next);
});
test('does not collapse repositories or unknown identities, and excludes free text from rendering', () => {
  const queue = buildIncidentQueue({ ...input, scanComplete: false, incidents: [incident(3), { ...incident(3), repositoryId: 5, rawLog: 'SECRET_MARKER', reason: 'SECRET_MARKER' }] });
  assert.equal(queue.groups.length, 2);
  assert.equal(queue.scan_complete, false);
  assert.doesNotMatch(renderIncidentQueue(queue), /SECRET_MARKER/);
  assert.equal(queue.costPerVerifiedRecoveryUsd, null);
});
test('keeps older unresolved incidents visible while counting only the half-open rate window', () => {
  const queue = buildIncidentQueue({ ...input, incidents: [
    { ...incident(3), sourceCompletedAt: input.window.start },
    { ...incident(4), sourceCompletedAt: '2026-10-20T00:00:00.000Z' },
    { ...incident(5), sourceCompletedAt: '2026-10-18T23:59:59.999Z' },
    { ...incident(6), sourceCompletedAt: input.window.end },
  ] });
  assert.equal(queue.incidents, 4);
  assert.equal(queue.groups.length, 4);
  assert.equal(queue.windowIncidentCount, 2);
  assert.equal(queue.failuresPerDay, 2 / queue.elapsedDays);
  assert.match(renderIncidentQueue(queue), /2 incidents in the observation window/);
});
test('unknown completion times stay visible and disclose incomplete rate coverage', () => {
  const queue = buildIncidentQueue({ ...input, incidents: [{ ...incident(3), sourceCompletedAt: null }, { ...incident(4), sourceCompletedAt: 'invalid' }] });
  assert.equal(queue.incidents, 2);
  assert.equal(queue.windowIncidentCount, 0);
  assert.equal(queue.windowUnknownTimeIncidents, 2);
  assert.equal(queue.failuresPerDay, null);
  assert.equal(queue.scan_complete, false);
  assert.match(renderIncidentQueue(queue), /2 incidents have unknown completion time/);
});
