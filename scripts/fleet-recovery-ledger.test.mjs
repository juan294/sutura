import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

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
