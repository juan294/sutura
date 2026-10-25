import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFleetFieldReport, publicFieldReport } from './fleet-field-report.mjs';
import { sealIncidentEvidence, verificationContractDigest } from './fleet-incident-evidence.mjs';
const sha = letter => letter.repeat(40);
const source = { repositoryId: 42, workflowId: 10, sourceRunId: 100, sourceAttempt: 1, sourceSha: sha('a'), branch: 'integration' };
const incident = { schemaVersion: 'sutura-fleet-incident-v2', ...source, sourceCompletedAt: '2026-10-24T10:00:00.000Z', cause: 'fixed', state: 'sutura-green', monitorRunId: 200, actionSha: sha('b'), costCoverage: 'unavailable' };
const input = { observedAt: '2026-10-25T12:00:00.000Z', collectedAt: '2026-10-25T11:00:00.000Z',
  window: { start: '2026-10-01T00:00:00.000Z', end: '2026-10-25T00:00:00.000Z' },
  scope: { startedAt: '2026-10-01T00:00:00.000Z', repositories: [{ repository: 'example/private', repositoryId: 42, workflowIds: [10] }] },
  coverage: { complete: true }, incidents: [incident], installations: [{ repository: 'example/private', repositoryId: 42, state: 'active', inventoryComplete: true, actionShas: [sha('b')], workflows: [{ id: 10 }] }] };
function nativeEvidence() {
  const contract = { schemaVersion: 'sutura-native-verification-v1', repositoryId: 42, protected: true, fullRequired: true, baseBranch: 'integration',
    policySource: { repositoryId: 42, ref: 'refs/heads/integration', sha: sha('b'), path: '.github/native-obligations.json' },
    stages: { proposal: { event: 'pull_request', branchRole: 'repair-head', requiredJobs: [{ workflowId: 10, jobKey: 'test' }] }, integration: { event: 'push', branchRole: 'base', requiredJobs: [{ workflowId: 10, jobKey: 'test' }] } } };
  contract.policyDigest = verificationContractDigest(contract);
  const proof = { monitor: { repositoryId: 42, runId: 200, attempt: 1, sourceRunId: 100, sourceAttempt: 1, sourceSha: sha('a'), actionSha: sha('b'), outcome: 'fixed', complete: true,
    completedAt: '2026-10-24T11:00:00.000Z', publication: { prNumber: 5, headSha: sha('c'), diffDigest: 'd'.repeat(64) } },
    repairPr: { repositoryId: 42, number: 5, sourceRunId: 100, sourceAttempt: 1, sourceSha: sha('a'), sourceParentSha: sha('a'), headSha: sha('c'), headBranch: 'sutura/fix-100', baseBranch: 'integration', baseSha: sha('b'), diffDigest: 'd'.repeat(64), merged: true, integrationSha: sha('e') },
    native: ['proposal', 'integration'].map((stage, i) => ({ stage, repositoryId: 42, workflowId: 10, runId: 300 + i, attempt: 1, event: i ? 'push' : 'pull_request', branch: i ? 'integration' : 'sutura/fix-100',
      headSha: i ? sha('e') : sha('c'), testedSha: i ? sha('e') : sha('d'), mergeParents: i ? null : [sha('b'), sha('c')], status: 'completed', conclusion: 'success', jobsComplete: true,
      policyDigest: contract.policyDigest, policySourceSha: contract.policySource.sha, jobs: [{ jobKey: 'test', runId: 300 + i, attempt: 1, testedSha: i ? sha('e') : sha('d'), status: 'completed', conclusion: 'success' }] })) };
  const record = sealIncidentEvidence({ schemaVersion: 'sutura-incident-evidence-v1', source, observedAt: '2026-10-25T10:00:00.000Z', trigger: { event: 'push', actorId: 7, triggeringActorId: 7, authenticated: true },
    classificationRevision: 'sutura-incident-classification-v1', classification: null, policyDigest: contract.policyDigest,
    completeness: { collection: true, source: true, native: true, logs: true }, proof });
  return { contract, record };
}
test('uses exactly24 elapsed days, retains UTC daily buckets and refuses wrapper-green repair attribution', () => {
  const result = buildFleetFieldReport(input);
  assert.equal(result.elapsedDays, 24); assert.equal(result.failuresPerDay, 1 / 24);
  assert.equal(result.daily.length, 24); assert.equal(result.daily.at(-1).failedAttempts, 1);
  assert.equal(result.qualifiedIntegratedRecoveries, 0);
  assert.equal(result.organicIntegratedRecovery, 'unmeasured');
  assert.equal(result.costPerVerifiedRecoveryUsd, null);
  assert.equal(result.status, 'PARTIAL');
});
test('late valid native evidence upgrades qualification and a later contradiction revokes it', () => {
  const { contract, record } = nativeEvidence();
  const valid = { ...input, evidenceObservations: [record], verificationContracts: { 42: contract } };
  assert.equal(buildFleetFieldReport(valid).qualifiedIntegratedRecoveries, 1);
  const later = structuredClone(record); later.observedAt = '2026-10-25T10:30:00.000Z'; later.proof.native[0].jobs[0].conclusion = 'failure';
  assert.equal(buildFleetFieldReport({ ...valid, evidenceObservations: [record, sealIncidentEvidence(later)] }).qualifiedIntegratedRecoveries, 0);
});
test('stale, incomplete and future collection do not claim complete observation', () => {
  for (const override of [{ collectedAt: '2026-10-23T00:00:00.000Z' }, { coverage: { complete: false } }, { collectedAt: '2026-10-26T00:00:00.000Z' }]) {
    assert.equal(buildFleetFieldReport({ ...input, ...override }).scan_complete, false);
  }
  assert.throws(() => buildFleetFieldReport({ ...input, window: { start: input.window.start, end: input.window.start } }), /window/u);
});
test('keeps inaccessible, old-pin and zero-opportunity installations represented', () => {
  const installations = [...input.installations, { repository: 'external/inaccessible', state: 'inaccessible' },
    { repository: 'external/idle', repositoryId: 77, state: 'active', inventoryComplete: true, actionShas: [sha('c')], workflows: [{ id: 11 }] }];
  const report = buildFleetFieldReport({ ...input, installations, postWindows: [{ repository: 'external/idle', workflowId: 11, startedAt: input.window.start, endedAt: input.window.end, completedRuns: 0, incidents: 0 }] });
  assert.equal(report.installations.length, 3);
  assert.equal(report.installations[1].disposition, 'unknown');
  assert.equal(report.installations[2].disposition, 'unexercised');
  assert.deepEqual(report.installations[2].actionShas, [sha('c')]);
  assert.equal(report.recurrenceControl, 'unmeasured');
});
test('attempts remain distinct, out-of-window incidents stay outside rates and public export contains no private identities', () => {
  const result = buildFleetFieldReport({ ...input, incidents: [incident, { ...incident, sourceAttempt: 2 }, { ...incident, sourceRunId: 101, sourceCompletedAt: '2026-09-01T00:00:00.000Z' }] });
  assert.equal(result.failedAttempts, 2); assert.equal(result.independentSourceRuns, 1);
  const publicResult = publicFieldReport(result);
  assert.doesNotMatch(JSON.stringify(publicResult), /example\/private|repositoryId|workflowId|sourceRunId|branch|actionShas/);
  assert.deepEqual(buildFleetFieldReport(input), buildFleetFieldReport(input));
});
test('public projection strips nested free text and validates numerical aggregate fields', () => {
  const report = buildFleetFieldReport(input);
  report.daily[0].privateLog = 'PRIVATE_NESTED';
  report.window.repository = 'PRIVATE_REPOSITORY';
  report.triggerBuckets.privateActor = 'PRIVATE_ACTOR';
  assert.doesNotMatch(JSON.stringify(publicFieldReport(report)), /PRIVATE_/);
  assert.throws(() => publicFieldReport({ ...report, failedAttempts: 'PRIVATE_COUNT' }), /count|number/u);
});
