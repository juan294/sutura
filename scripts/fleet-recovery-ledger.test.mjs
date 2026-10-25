import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { sealIncidentEvidence, verificationContractDigest } from './fleet-incident-evidence.mjs';

import {
  classifyFleetIncident, collectRecoveryLedger, mergeObservations, persistObservation,
  publicRecoverySummary, summarizeRecovery, writeRecoveryLedger,
} from './fleet-recovery-ledger.mjs';

const SHA = (letter) => letter.repeat(40);
const DIGEST = (letter) => letter.repeat(64);
const source = {
  id: 41, repositoryId: 7, workflowId: 12, branch: 'develop',
  headSha: SHA('a'), conclusion: 'failure', completedAt: '2026-09-20T10:00:00.000Z',
};
const monitor = {
  id: 51, sourceRunId: 41, sourceCommit: SHA('a'), outcome: 'fixed',
  actionSha: SHA('b'), costStatus: 'measured', inferenceCostUsd: 0.2,
  sandboxCostUsd: 0.3, completedAt: '2026-09-20T10:10:00.000Z',
};
const repairPr = {
  number: 91, sourceRunId: 41, sourceSha: SHA('a'), baseBranch: 'develop', headSha: SHA('c'),
  diffSha: DIGEST('d'), merged: true, integrationSha: SHA('e'),
};
const repairCi = {
  id: 61, workflowId: 12, branch: 'sutura/fix-41',
  headSha: SHA('c'), conclusion: 'success',
};
const nextGreen = {
  id: 71, workflowId: 12, branch: 'develop',
  headSha: SHA('e'), conclusion: 'success',
  startedAt: '2026-09-20T10:20:00.000Z',
  completedAt: '2026-09-20T10:30:00.000Z',
};
const complete = { source, monitor, repairPr, repairCi, nextGreen };

test('writer publishes companion qualification and revokes it without changing historical v2 labels', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-qualified-writer-'));
  try {
    const exactSource = { repositoryId: 7, sourceRunId: 41, sourceAttempt: 1, sourceSha: SHA('a'), workflowId: 12, branch: 'develop' };
    const jobs = [{ workflowId: 12, jobKey: 'checks' }];
    const contract = { schemaVersion: 'sutura-native-verification-v1', repositoryId: 7, protected: true, fullRequired: true, baseBranch: 'develop',
      policySource: { repositoryId: 7, ref: 'refs/heads/develop', sha: SHA('b'), path: '.github/native.json' },
      stages: { proposal: { event: 'pull_request', branchRole: 'repair-head', requiredJobs: jobs },
        integration: { event: 'push', branchRole: 'base', requiredJobs: jobs } } };
    contract.policyDigest = verificationContractDigest(contract);
    const record = { schemaVersion: 'sutura-incident-evidence-v1', source: exactSource, observedAt: '2026-09-21T00:00:00.000Z',
      classificationRevision: 'v1', policyDigest: contract.policyDigest,
      completeness: { collection: true, source: true, native: true, logs: false }, proof: {
        monitor: { ...monitor, repositoryId: 7, runId: 51, attempt: 1, sourceAttempt: 1, sourceSha: SHA('a'), complete: true,
          publication: { prNumber: 91, headSha: SHA('c'), diffDigest: DIGEST('d') } },
        repairPr: { ...repairPr, repositoryId: 7, sourceAttempt: 1, sourceParentSha: SHA('a'), baseSha: SHA('b'),
          headBranch: 'sutura/fix-41', diffDigest: DIGEST('d') },
        native: ['proposal', 'integration'].map((stage, index) => ({ stage, repositoryId: 7, workflowId: 12, runId: 61 + index, attempt: 1,
          event: index ? 'push' : 'pull_request', branch: index ? 'develop' : 'sutura/fix-41', headSha: index ? SHA('e') : SHA('c'),
          testedSha: index ? SHA('e') : SHA('c'), status: 'completed', conclusion: 'success', jobsComplete: true,
          policyDigest: contract.policyDigest, policySourceSha: SHA('b'),
          jobs: [{ jobKey: 'checks', runId: 61 + index, attempt: 1, testedSha: index ? SHA('e') : SHA('c'), status: 'completed', conclusion: 'success' }] })),
      } };
    const result = { installations: [], incidents: [classifyFleetIncident(complete)], baselines: [], coverage: { complete: true },
      verificationContracts: { 7: contract }, evidenceObservations: [sealIncidentEvidence(record)] };
    const first = await writeRecoveryLedger(result, directory, record.observedAt);
    assert.equal(first.delivery.verifiedRepairPrs, 1); assert.equal(first.delivery.integratedRecoveries, 1);
    record.observedAt = '2026-09-22T00:00:00.000Z';
    record.proof.native[1].jobs[0].conclusion = 'failure';
    const second = await writeRecoveryLedger({ ...result, evidenceObservations: [sealIncidentEvidence(record)] }, directory, record.observedAt);
    assert.equal(second.delivery.integratedRecoveries, 0); assert.equal(second.states['sutura-green'], 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('recovery needs exact repair PR, passing repair CI, integration and same-workflow branch green', () => {
  assert.equal(classifyFleetIncident(complete).state, 'sutura-green');
  for (const candidate of [
    { ...complete, repairPr: null },
    { ...complete, repairPr: { ...repairPr, merged: false } },
    { ...complete, repairPr: { ...repairPr, diffSha: null } },
    { ...complete, repairPr: { ...repairPr, sourceRunId: 42 } },
    { ...complete, repairCi: { ...repairCi, conclusion: 'skipped' } },
    { ...complete, repairCi: { ...repairCi, headSha: SHA('f') } },
    { ...complete, nextGreen: { ...nextGreen, headSha: SHA('f') } },
    { ...complete, nextGreen: { ...nextGreen, workflowId: 13 } },
    { ...complete, nextGreen: { ...nextGreen, branch: 'main' } },
    { ...complete, nextGreen: { ...nextGreen, startedAt: '2026-09-20T09:59:00.000Z' } },
  ]) assert.notEqual(classifyFleetIncident(candidate).state, 'sutura-green');
  assert.equal(classifyFleetIncident({ ...complete, repairPr: { ...repairPr, merged: false }, nextGreen: null }).state, 'sutura-proposed');
});

test('ambiguous source, branch movement, missing cost and expired artifact remain explicit', () => {
  assert.equal(classifyFleetIncident({ ...complete, monitor: { ...monitor, sourceRunId: 42 } }).state, 'unknown');
  assert.equal(classifyFleetIncident({ ...complete, monitor: { ...monitor, costStatus: 'unavailable' } }).costCoverage, 'unavailable');
  assert.equal(classifyFleetIncident({ ...complete, monitor: { ...monitor, outcome: 'unknown', evidenceError: 'expired' } }).state, 'unknown');
  assert.equal(classifyFleetIncident({ ...complete, monitor: null }).state, 'unknown');
  assert.equal(classifyFleetIncident({ ...complete, source: { ...source, conclusion: 'success' } }).state, 'unknown');
  assert.equal(classifyFleetIncident({ ...complete, nextGreen: { ...nextGreen, headSha: SHA('f') } }).state, 'unknown');
  assert.equal(classifyFleetIncident({ ...complete, lookupError: 'ambiguous-repair-pr' }).state, 'unknown');
});

test('fallback green needs authenticated matching actor provenance; later green alone is external', () => {
  const failed = { source, monitor: { ...monitor, outcome: 'gave-up' }, nextGreen: { ...nextGreen, headSha: SHA('f') } };
  assert.equal(classifyFleetIncident(failed).state, 'resolved-externally');
  const actor = { authenticated: true, sessionId: 'session-1', actorId: 'agent-1',
    sourceRunId: 41, repositoryId: 7, workflowId: 12, branch: 'develop', integrationSha: SHA('f') };
  assert.equal(classifyFleetIncident({ ...failed, actor }).state, 'agent-fallback-green');
  assert.equal(classifyFleetIncident({ ...failed, actor: { ...actor, authenticated: false } }).state, 'resolved-externally');
  assert.equal(classifyFleetIncident({ ...failed, actor: { ...actor, workflowId: 13 } }).state, 'resolved-externally');
});

test('immutable observations survive incomplete reruns and do not double count', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-ledger-'));
  try {
    const good = classifyFleetIncident(complete);
    const weak = classifyFleetIncident({ source, monitor: null });
    await persistObservation(directory, good, '2026-09-20T11:00:00.000Z');
    await persistObservation(directory, good, '2026-09-20T11:00:00.000Z');
    await persistObservation(directory, weak, '2026-09-21T11:00:00.000Z');
    const files = (await import('node:fs/promises')).readdir;
    assert.equal((await files(directory)).length, 2);
    const observations = await Promise.all((await files(directory)).map(async (name) => JSON.parse(await readFile(join(directory, name), 'utf8'))));
    assert.equal(mergeObservations(observations)[0].state, 'sutura-green');
    assert.equal(summarizeRecovery(mergeObservations(observations)).incidents, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('journal rejects an older externally resolved claim with no monitor link', () => {
  const invalid = { ...classifyFleetIncident({ source, monitor: null }),
    state: 'resolved-externally', observedAt: '2026-09-20T11:00:00.000Z' };
  const corrected = { ...classifyFleetIncident({ source, monitor: null }),
    observedAt: '2026-09-21T11:00:00.000Z' };
  assert.equal(mergeObservations([invalid, corrected])[0].state, 'unknown');
});

test('two failed attempts of one run remain separate incidents', () => {
  const first = classifyFleetIncident({ source: { ...source, attempt: 1 }, monitor: null });
  const second = classifyFleetIncident({ source: { ...source, attempt: 2 }, monitor: null });
  const merged = mergeObservations([first, second]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map(({ sourceAttempt }) => sourceAttempt), [1, 2]);
});

test('monitor is assigned to the failure attempt that preceded it', async () => {
  const attempts = [
    { ...source, attempt: 1, completedAt: '2026-09-20T10:00:00.000Z',
      startedAt: '2026-09-20T09:00:00.000Z' },
    { ...source, attempt: 2, completedAt: '2026-09-20T12:00:00.000Z',
      startedAt: '2026-09-20T11:00:00.000Z' },
  ];
  const client = {
    async inspectRepository() { return { state: 'active', repositoryId: 7,
      activationAt: '2026-09-15T00:00:00.000Z', workflows: [{ id: 12, name: 'CI' }] }; },
    async listCiRuns() { return attempts; },
  };
  const result = await collectRecoveryLedger({ owner: 'owner', repositories: ['alpha'],
    startedAt: '2026-09-13T00:00:00.000Z' }, client,
  [{ ...monitor, repository: 'alpha', runId: 51, startedAt: '2026-09-20T10:15:00.000Z' }]);
  assert.equal(result.incidents[0].monitorRunId, 51);
  assert.equal(result.incidents[1].monitorRunId, null);
});

test('public report excludes private identifiers, URLs and free text', () => {
  const incident = { ...classifyFleetIncident(complete), repository: 'private-project',
    url: 'https://example.test/private', log: 'SECRET_SENTINEL',
    text: 'IDENTIFYING_SENTINEL' };
  const publicValue = JSON.stringify(publicRecoverySummary(summarizeRecovery([incident])));
  for (const secret of ['private-project', 'https://example.test/private', 'SECRET_SENTINEL', 'IDENTIFYING_SENTINEL']) {
    assert.equal(publicValue.includes(secret), false);
  }
  assert.equal(JSON.parse(publicValue).states['sutura-green'], 1);
});

test('v2 green labels remain historical and cannot populate current qualified delivery', () => {
  const summary = summarizeRecovery([classifyFleetIncident(complete)]);
  assert.equal(summary.states['sutura-green'], 1);
  assert.equal(summary.verifiedRepairPrs, null);
  assert.equal(summary.delivery.integratedRecoveries, null);
  assert.equal(summary.qualification.unmeasured, 1);
});
test('public recovery export allows only fixed nested fields and numeric aggregates', () => {
  const summary = summarizeRecovery([classifyFleetIncident(complete)]);
  summary.states.privateSentinel = 'secret-value'; summary.delivery.privateSentinel = 'secret-value';
  summary.actionCohorts.privateSentinel = 1; summary.causes['private-value'] = 1;
  summary.costCoverage.privateSentinel = 'secret-value';
  const result = JSON.stringify(publicRecoverySummary(summary));
  assert.doesNotMatch(result, /secret-value|privateSentinel|private-value/u);
});
test('zero repository census is incomplete rather than vacuously green', async () => {
  const result = await collectRecoveryLedger({ repositories: [], startedAt: '2026-09-13T00:00:00.000Z' }, {}, []);
  assert.equal(result.coverage.complete, false);
});
test('collector preserves source metadata in a separate companion without changing the v2 incident schema', async () => {
  const result = await collectRecoveryLedger({ repositories: ['alpha'], startedAt: '2026-09-13T00:00:00.000Z' }, {
    async inspectRepository() { return { state: 'active', repositoryId: 7, workflows: [{ id: 12, name: 'CI' }] }; },
    async listCiRuns() { return [{ ...source, attempt: 2, event: 'schedule', actorId: 9, triggeringActorId: 10, metadataComplete: true }]; },
    async inspectFailedRun() { return { complete: true, selectedJobId: 81, selectedStepNumber: 4,
      log: { text: 'synthetic assertion', sha256: DIGEST('a'), truncated: false }, jobs: [] }; },
  }, [], new Date('2026-09-21T00:00:00.000Z'));
  assert.equal(result.incidents[0].schemaVersion, 'sutura-fleet-incident-v2');
  assert.equal(Object.hasOwn(result.incidents[0], 'trigger'), false);
  assert.equal(result.evidenceObservations[0].trigger.event, 'schedule');
  assert.equal(result.evidenceObservations[0].trigger.actorId, 9);
  assert.equal(result.evidenceObservations[0].source.sourceAttempt, 2);
  assert.equal(result.evidenceObservations[0].sourceEvidence.selectedStepNumber, 4);
});
test('corrupt companion history leaves the last good summary and original v2 journal bytes unchanged', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-companion-summary-'));
  try {
    const result = { installations: [], incidents: [classifyFleetIncident(complete)], baselines: [],
      coverage: { complete: true, unmeasuredRepositories: 0, actorProvenanceAvailable: false, baselineComplete: false } };
    await writeRecoveryLedger(result, directory, '2026-09-20T11:00:00.000Z');
    const before = await readFile(join(directory, 'recovery-summary.json'));
    const { mkdir, writeFile } = await import('node:fs/promises');
    const journal = join(directory, 'incident-evidence-v1'); await mkdir(journal, { recursive: true });
    await writeFile(join(journal, `7-41-1-${DIGEST('a')}.json`), '{}');
    await assert.rejects(writeRecoveryLedger(result, directory, '2026-09-21T11:00:00.000Z'), /integrity/u);
    assert.deepEqual(await readFile(join(directory, 'recovery-summary.json')), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('invalid incoming companion cannot append v2 history before rejection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-incoming-integrity-'));
  try {
    const result = { installations: [], incidents: [classifyFleetIncident(complete)], baselines: [],
      coverage: { complete: true, unmeasuredRepositories: 0, actorProvenanceAvailable: false, baselineComplete: false } };
    await writeRecoveryLedger(result, directory, '2026-09-20T11:00:00.000Z');
    const journal = join(directory, 'observations-v2');
    const before = await readdir(journal), summary = await readFile(join(directory, 'recovery-summary.json'));
    await assert.rejects(writeRecoveryLedger({ ...result, evidenceObservations: [{}] }, directory, '2026-09-21T11:00:00.000Z'));
    assert.deepEqual(await readdir(journal), before);
    assert.deepEqual(await readFile(join(directory, 'recovery-summary.json')), summary);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('missing monitor discloses incomplete scope without hiding previously observed incidents', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-missing-monitor-'));
  try {
    const scope = { startedAt: '2026-09-13T00:00:00.000Z', repositories: [{ repository: 'alpha', repositoryId: 7, workflowIds: [12], activationAt: null }] };
    await writeRecoveryLedger({ installations: [], incidents: [classifyFleetIncident(complete)], baselines: [], scope,
      coverage: { complete: true, unmeasuredRepositories: 0, actorProvenanceAvailable: false, baselineComplete: false } }, directory);
    const result = await collectRecoveryLedger({ repositories: ['alpha'], startedAt: scope.startedAt }, {
      async inspectRepository() { return { state: 'uninstalled', repositoryId: 7, workflows: [], inventoryComplete: true,
        allWorkflows: [{ id: 12, disposition: 'not-watched-intent-unmeasured' }] }; },
    }, []);
    assert.equal(result.coverage.complete, false);
    assert.equal(result.coverage.baselineComplete, false);
    await writeRecoveryLedger(result, directory);
    const incidents = (await readFile(join(directory, 'incidents-v2.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].sourceRunId, 41);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('conflicting incident identity is rejected even without native enrollment', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-conflicting-identity-'));
  try {
    const incident = classifyFleetIncident(complete);
    const record = sha => sealIncidentEvidence({ schemaVersion: 'sutura-incident-evidence-v1',
      source: { repositoryId: 7, sourceRunId: 41, sourceAttempt: 1, sourceSha: sha, workflowId: 12, branch: 'develop' },
      observedAt: '2026-09-20T11:00:00.000Z', classificationRevision: 'v1',
      completeness: { collection: true, source: true, native: false, logs: false }, proof: {} });
    await assert.rejects(writeRecoveryLedger({ installations: [], incidents: [incident], baselines: [],
      evidenceObservations: [record(SHA('a')), record(SHA('c'))], coverage: { complete: false } }, directory), /integrity|identity/iu);
    assert.deepEqual((await readdir(directory)).filter(name => name !== 'incident-evidence-v1'), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('collector inventories every repository and keeps separate activation baselines', async () => {
  const starts = [];
  const client = {
    async inspectRepository(repository) {
      if (repository === 'missing') return { state: 'uninstalled', repositoryId: 8 };
      return { state: 'active', repositoryId: 7, activationAt: '2026-09-15T00:00:00.000Z',
        workflows: [{ id: 12, name: 'CI' }] };
    },
    async listCiRuns(_repository, workflow, since) {
      starts.push([workflow.id, since]);
      return [
        { ...source, completedAt: '2026-09-14T10:00:00.000Z', id: 40 },
        source,
        nextGreen,
      ];
    },
    async findRepairPr() { return null; },
  };
  const result = await collectRecoveryLedger({ owner: 'owner', repositories: ['alpha', 'missing'],
    startedAt: '2026-09-13T00:00:00.000Z' }, client, [
    { ...monitor, repository: 'alpha', runId: 51, sourceRunId: 41, sourceCommit: SHA('a'),
      startedAt: '2026-09-20T10:05:00.000Z' },
  ], new Date('2026-09-28T00:00:00.000Z'));
  assert.deepEqual(starts, [[12, '2026-08-01T00:00:00.000Z']]);
  assert.equal(result.installations.length, 2);
  assert.equal(result.baselines[0].incidents, 1);
  assert.equal(result.baselines[0].completedRuns, 1);
  assert.equal(result.baselines[0].incidentRate, 1);
  assert.equal(result.postWindows[0].incidents, 1);
  assert.equal(result.postWindows[0].completedRuns, 2);
  assert.equal(result.postWindows[0].medianRecoverySec, 1800);
  assert.equal(result.incidents.length, 1);
  assert.equal(result.incidents[0].state, 'resolved-externally');
  assert.equal(result.summary.incidents, 1);
});

test('public comparison uses matched windows and omits private workflow identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-comparison-'));
  try {
    const metrics = { completedRuns: 10, incidents: 2, resolved: 1, censored: 1,
      recoveryDurationsSec: [600], runsToGreenValues: [2] };
    await writeRecoveryLedger({ incidents: [], installations: [], baselines: [
      { ...metrics, status: 'censored', repository: 'SECRET_REPO', workflowId: 987 }],
    postWindows: [{ ...metrics, repository: 'SECRET_REPO', workflowId: 987 }],
    coverage: { complete: true, unmeasuredRepositories: 0, baselineComplete: false } }, directory);
    const publicValue = await readFile(join(directory, 'recovery-summary.json'), 'utf8');
    assert.equal(publicValue.includes('SECRET_REPO'), false);
    assert.equal(publicValue.includes('987'), false);
    const comparison = JSON.parse(publicValue).comparison;
    assert.equal(comparison.before.incidentRate, 0.2);
    assert.equal(comparison.after.medianRecoverySec, 600);
    assert.equal(comparison.before.censored, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('baseline uses the same workflow and branch and reports recovery tail and censoring', async () => {
  const beforeFailure = { ...source, id: 31, completedAt: '2026-09-10T10:00:00.000Z' };
  const beforeGreen = { ...nextGreen, id: 32, headSha: SHA('f'),
    startedAt: '2026-09-10T10:20:00.000Z',
    completedAt: '2026-09-10T10:30:00.000Z' };
  const wrongBranch = { ...nextGreen, id: 33, branch: 'main',
    startedAt: '2026-09-10T10:03:00.000Z',
    completedAt: '2026-09-10T10:05:00.000Z' };
  const client = {
    async inspectRepository() { return { state: 'active', repositoryId: 7,
      activationAt: '2026-09-15T00:00:00.000Z', workflows: [{ id: 12, name: 'CI' }] }; },
    async listCiRuns() { return [beforeFailure, wrongBranch, beforeGreen]; },
  };
  const result = await collectRecoveryLedger({ owner: 'owner', repositories: ['alpha'],
    startedAt: '2026-09-13T00:00:00.000Z' }, client, []);
  assert.equal(result.baselines[0].incidents, 1);
  assert.equal(result.baselines[0].completedRuns, 3);
  assert.equal(result.baselines[0].resolved, 1);
  assert.equal(result.baselines[0].medianRecoverySec, 1800);
  assert.equal(result.baselines[0].p95RecoverySec, 1800);
  assert.equal(result.baselines[0].runsToGreenMedian, 1);
});

test('a CI run created before activation stays in the baseline if it finishes after activation', async () => {
  const crossing = { ...source, id: 30, createdAt: '2026-09-14T23:59:00.000Z',
    completedAt: '2026-09-15T00:01:00.000Z' };
  const client = {
    async inspectRepository() { return { state: 'active', repositoryId: 7,
      activationAt: '2026-09-15T00:00:00.000Z', workflows: [{ id: 12, name: 'CI' }] }; },
    async listCiRuns() { return [crossing]; },
  };
  const result = await collectRecoveryLedger({ owner: 'owner', repositories: ['alpha'],
    startedAt: '2026-09-13T00:00:00.000Z' }, client, []);
  assert.equal(result.baselines[0].incidents, 1);
  assert.equal(result.postWindows[0].incidents, 0);
  assert.equal(result.incidents.length, 0);
});

test('a failed rerun attempt created after activation belongs to the post window', async () => {
  const first = { ...source, id: 30, attempt: 1, createdAt: '2026-09-14T23:00:00.000Z',
    completedAt: '2026-09-14T23:30:00.000Z' };
  const rerun = { ...source, id: 30, attempt: 2, createdAt: '2026-09-15T01:00:00.000Z',
    startedAt: '2026-09-15T01:00:00.000Z', completedAt: '2026-09-15T01:30:00.000Z' };
  const client = {
    async inspectRepository() { return { state: 'active', repositoryId: 7,
      activationAt: '2026-09-15T00:00:00.000Z', workflows: [{ id: 12, name: 'CI' }] }; },
    async listCiRuns() { return [first, rerun]; },
  };
  const result = await collectRecoveryLedger({ owner: 'owner', repositories: ['alpha'],
    startedAt: '2026-09-13T00:00:00.000Z' }, client, []);
  assert.equal(result.baselines[0].incidents, 1);
  assert.equal(result.postWindows[0].incidents, 1);
  assert.equal(result.incidents.length, 1);
  assert.equal(result.incidents[0].sourceAttempt, 2);
});

test('collector passes authenticated actor evidence to fallback attribution', async () => {
  const client = {
    async inspectRepository() { return { state: 'active', repositoryId: 7,
      activationAt: '2026-09-15T00:00:00.000Z', workflows: [{ id: 12, name: 'CI' }] }; },
    async listCiRuns() { return [source, { ...nextGreen, headSha: SHA('f') }]; },
    async findAuthenticatedActor() { return { authenticated: true, sessionId: 'session-1',
      actorId: 'agent-1', repositoryId: 7, sourceRunId: 41, workflowId: 12,
      branch: 'develop', integrationSha: SHA('f') }; },
  };
  const result = await collectRecoveryLedger({ owner: 'owner', repositories: ['alpha'],
    startedAt: '2026-09-13T00:00:00.000Z' }, client,
  [{ ...monitor, outcome: 'gave-up', repository: 'alpha', runId: 51,
    startedAt: '2026-09-20T10:05:00.000Z' }]);
  assert.equal(result.incidents[0].state, 'agent-fallback-green');
});

test('partial repository API failure remains unmeasured without deleting another incident', async () => {
  const client = {
    async inspectRepository() { return { state: 'active', repositoryId: 7, activationAt: null,
      workflows: [{ id: 12, name: 'CI' }] }; },
    async listCiRuns() { throw new Error('page unavailable'); },
  };
  const result = await collectRecoveryLedger({ owner: 'owner', repositories: ['alpha'],
    startedAt: '2026-09-13T00:00:00.000Z' }, client, [], new Date('2026-09-28T00:00:00.000Z'));
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.unmeasuredRepositories, 1);
  assert.equal(result.incidents.length, 0);
});

test('activation interval is censored until the first observed monitor run', async () => {
  const client = {
    async inspectRepository() { return { state: 'active', repositoryId: 7,
      activationAt: '2026-09-15T00:00:00.000Z',
      activationUpperBoundAt: '2026-09-15T01:00:00.000Z',
      workflows: [{ id: 12, name: 'CI' }] }; },
    async listCiRuns() { return []; },
  };
  const result = await collectRecoveryLedger({ owner: 'owner', repositories: ['alpha'],
    startedAt: '2026-09-13T00:00:00.000Z' }, client, []);
  assert.equal(result.baselines[0].status, 'censored');
  assert.equal(result.coverage.baselineComplete, false);
});

test('writer retains prior complete proof when a later collection is partial', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-ledger-write-'));
  try {
    const good = classifyFleetIncident(complete);
    const first = { incidents: [good], installations: [], baselines: [],
      coverage: { complete: true, unmeasuredRepositories: 0, baselineComplete: true } };
    await writeRecoveryLedger(first, directory, '2026-09-20T11:00:00.000Z');
    const second = { incidents: [classifyFleetIncident({ source, monitor: null })],
      installations: [], baselines: [],
      coverage: { complete: false, unmeasuredRepositories: 1, baselineComplete: false } };
    await writeRecoveryLedger(second, directory, '2026-09-21T11:00:00.000Z');
    const summary = JSON.parse(await readFile(join(directory, 'recovery-summary.json'), 'utf8'));
    assert.equal(summary.states['sutura-green'], 1);
    assert.equal(summary.coverage.complete, false);
    assert.equal((await readFile(join(directory, 'incidents-v2.jsonl'), 'utf8')).includes('sutura-green'), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a disappeared GitHub run stays in the journal view and makes completeness false', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-disappeared-'));
  try {
    const scope = { startedAt: '2026-09-13T00:00:00.000Z', repositories: [
      { repository: 'alpha', repositoryId: 7, activationAt: null, workflowIds: [12] }] };
    const coverage = { complete: true, unmeasuredRepositories: 0, baselineComplete: false };
    const first = { incidents: [classifyFleetIncident(complete)], installations: [],
      baselines: [], scope, coverage };
    await writeRecoveryLedger(first, directory);
    const second = await writeRecoveryLedger({ ...first, incidents: [] }, directory);
    assert.equal(second.incidents, 1);
    assert.equal(second.coverage.complete, false);
    assert.equal(second.coverage.missingPreviouslyObserved, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('old observations without per-attempt creation time keep denominator coverage incomplete', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-legacy-window-'));
  try {
    const legacy = { ...classifyFleetIncident(complete) };
    delete legacy.sourceCreatedAt;
    await persistObservation(join(directory, 'observations-v2'), legacy);
    const result = { incidents: [], installations: [], baselines: [],
      scope: { startedAt: '2026-09-13T00:00:00.000Z', repositories: [
        { repository: 'alpha', repositoryId: 7, activationAt: null, workflowIds: [12] }] },
      coverage: { complete: true, unmeasuredRepositories: 0, baselineComplete: false } };
    const summary = await writeRecoveryLedger(result, directory);
    assert.equal(summary.incidents, 1);
    assert.equal(summary.coverage.complete, false);
    assert.equal(summary.coverage.legacyWindowUnknown, 1);
    assert.equal((await (await import('node:fs/promises')).readdir(join(directory, 'observations-v2'))).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('new scope excludes old incidents from the aggregate while retaining journal history', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-scope-'));
  try {
    const first = { incidents: [classifyFleetIncident(complete)], installations: [], baselines: [],
      scope: { startedAt: '2026-09-13T00:00:00.000Z', repositories: [
        { repository: 'alpha', repositoryId: 7, activationAt: null, workflowIds: [12] }] },
      coverage: { complete: true, unmeasuredRepositories: 0, baselineComplete: true } };
    await writeRecoveryLedger(first, directory);
    const next = { ...first, incidents: [], scope: { startedAt: '2026-09-13T00:00:00.000Z',
      repositories: [{ repository: 'beta', repositoryId: 8, activationAt: null, workflowIds: [12] }] } };
    await writeRecoveryLedger(next, directory);
    const summary = JSON.parse(await readFile(join(directory, 'recovery-summary.json'), 'utf8'));
    assert.equal(summary.incidents, 0);
    const journal = await (await import('node:fs/promises')).readdir(join(directory, 'observations-v2'));
    assert.equal(journal.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('delivery stages require native proposal and integration proof independently of fixed outcome', () => {
  const fixedOnly = classifyFleetIncident({ source, monitor });
  const proposed = classifyFleetIncident({ ...complete, repairPr: { ...repairPr, merged: false }, nextGreen: null });
  const integrated = classifyFleetIncident(complete);
  const result = publicRecoverySummary(summarizeRecovery([fixedOnly, proposed, integrated]));
  assert.deepEqual(result.delivery, {
    typedFixedOutcomes: 3, verifiedRepairPrs: null, integratedRecoveries: null,
  });
});
