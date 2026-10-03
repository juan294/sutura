import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import {
  collectFleetMetrics,
  GhFleetClient,
  mergeMonitorEvents,
  parseCaseFileHtml,
  parseReplayIdentityJson,
  parseTerminalFailureJson,
  publicFleetSummary,
  readMonitorEvidence,
  writeFleetMetrics,
} from './fleet-dogfood-metrics.mjs';

const FIXED_HTML = `<!doctype html><body class="outcome-fixed">
  <div><span>Inference cost</span><strong>$0.125000</strong></div>
  <p>12 operations · 45.500 s elapsed · 40.000 s CPU · 100 KB peak RSS · $0.375000 sandbox cost</p>
</body>`;

test('case-file parser extracts the terminal outcome, costs, operations, and elapsed time', () => {
  assert.deepEqual(parseCaseFileHtml(FIXED_HTML), {
    outcome: 'fixed',
    inferenceCostUsd: 0.125,
    sandboxCostUsd: 0.375,
    sandboxOperations: 12,
    sandboxElapsedTimeSec: 45.5,
    providerInvoked: null,
    searchStarted: true,
    triageStopReason: null,
  });
  assert.throws(() => parseCaseFileHtml('<body>missing evidence</body>'), /outcome/u);
});

test('case-file parser records a triage sandbox-budget stop so the fleet can count it', () => {
  const html = FIXED_HTML.replace('outcome-fixed', 'outcome-gave-up').replace('</body>',
    '<p>Reproduced 1/1 (maximum 5); probability 100.0% (95% Wilson 20.7–100.0%); sprt-p20-p80-a05-b05-v1; sandbox-budget — not decided: the triage sandbox budget stopped it.</p></body>');

  assert.equal(parseCaseFileHtml(html).triageStopReason, 'sandbox-budget');
  assert.equal(parseCaseFileHtml(html).outcome, 'gave-up');
});

test('terminal failure parser preserves an infrastructure stop without inventing cost', () => {
  assert.deepEqual(parseTerminalFailureJson(JSON.stringify({
    schemaVersion: 'sutura-terminal-failure-v1',
    outcome: 'infra-stop',
    errorMessage: 'Repository snapshot exceeded its bounded source size',
  })), {
    outcome: 'infra-stop',
    costStatus: 'unavailable',
    evidenceError: 'Repository snapshot exceeded its bounded source size',
    failureCode: 'replay-snapshot-limit',
    failureStage: 'replay-capture',
    errorClass: 'UnknownError',
  });
  assert.throws(() => parseTerminalFailureJson('{}'), /schema or outcome/u);
});

test('terminal failure parser preserves structured stage, identity, and progress telemetry', () => {
  const input = {
    schemaVersion: 'sutura-terminal-failure-v2',
    outcome: 'infra-stop',
    errorMessage: 'Runtime evidence exceeds 500 entries',
    failure: {
      code: 'runtime-evidence-limit', stage: 'runtime-detection',
      class: 'RuntimeDetectionError', details: { visitedEntries: 511, maximumEntries: 500 },
    },
    fixtureIdentity: {
      targetRunId: '495', fixtureCommit: 'b'.repeat(40), pullRequestNumber: 114,
    },
    packageIdentity: {
      actionSha: 'a'.repeat(40), actionShaSource: 'runner-action-path',
    },
    execution: {
      claimState: 'claimed', providerInvocations: 0, sandboxOperations: 0,
      searchStarted: false, terminalCommentState: 'updated',
    },
    runtimeDetection: {
      runtime: 'node', evidenceSource: 'root',
      evidenceCount: 2, visitedEntries: 2,
    },
    costStatus: 'unavailable',
  };
  const expected = {
    outcome: 'infra-stop', costStatus: 'unavailable',
    evidenceError: 'Runtime evidence exceeds 500 entries',
    failureCode: 'runtime-evidence-limit', failureStage: 'runtime-detection',
    errorClass: 'RuntimeDetectionError', failureDetails: { visitedEntries: 511, maximumEntries: 500 },
    sourceRunId: '495', sourceCommit: 'b'.repeat(40), pullRequestNumber: 114,
    actionSha: 'a'.repeat(40), actionShaSource: 'runner-action-path',
    claimState: 'claimed', providerInvocations: 0, sandboxOperations: 0,
    providerInvoked: false, searchStarted: false, terminalCommentState: 'updated',
    runtime: 'node', runtimeEvidenceSource: 'root',
    runtimeEvidenceCount: 2, runtimeVisitedEntries: 2,
  };
  assert.deepEqual(parseTerminalFailureJson(JSON.stringify(input)), expected);
});

test('replay parser links the source run, action commit, provider, sandbox, and search state', () => {
  assert.deepEqual(parseReplayIdentityJson(JSON.stringify({
    schemaVersion: 'sutura-replay-v1', runId: '495', repo: 'juan294/clarity',
    actionSha: 'a'.repeat(40),
    github: [
      { method: 'getWorkflowRun', result: { headSha: 'b'.repeat(40), pullRequests: [{ number: 114 }] } },
      { method: 'createIssueComment', result: { id: 1 } },
    ],
    executor: [{ result: { operation: { operationId: 'search-001-op-001' } } }],
    http: [{ boundary: 'nebius' }, { boundary: 'contree' }],
    completeness: { complete: true },
    runtimeDetection: {
      runtime: 'python', evidenceSource: 'bounded-scan',
      evidencePaths: ['tests/test_widget.py'], visitedEntries: 8,
    },
  })), {
    sourceRunId: '495', sourceCommit: 'b'.repeat(40), pullRequestNumber: 114,
    actionSha: 'a'.repeat(40), actionShaSource: 'replay-bundle',
    claimState: 'claimed', providerInvocations: 1, providerInvoked: true,
    sandboxOperations: 1, searchStarted: true, replayComplete: true,
    runtime: 'python', runtimeEvidenceSource: 'bounded-scan',
    runtimeEvidenceCount: 1, runtimeVisitedEntries: 8,
  });
});

test('collector keeps every monitor run and distinguishes skipped CI from repair attempts', async () => {
  const client = {
    async listWorkflowRuns(repository) {
      if (repository === 'other-owner/missing') {
        const error = new Error('not found');
        error.status = 404;
        throw error;
      }
      return [
        { id: 9, conclusion: 'skipped', display_title: 'Repair not triggered: CI #8 (cancelled) on develop', run_started_at: '2026-09-13T07:00:00Z', updated_at: '2026-09-13T07:00:05Z', html_url: 'https://example.test/9' },
        { id: 10, conclusion: 'skipped', display_title: 'No repair needed: CI #9 (success) on develop', run_started_at: '2026-09-13T08:00:00Z', updated_at: '2026-09-13T08:00:05Z', html_url: 'https://example.test/10' },
        { id: 11, conclusion: 'success', run_started_at: '2026-09-13T09:00:00Z', updated_at: '2026-09-13T09:02:00Z', html_url: 'https://example.test/11' },
        { id: 12, conclusion: 'failure', run_started_at: '2026-09-13T10:00:00Z', updated_at: '2026-09-13T10:01:00Z', html_url: 'https://example.test/12' },
      ];
    },
    async listArtifacts(_repository, runId) {
      if (runId === 11) return [
        { id: 100, name: 'sutura-case-file-99.html', expired: false },
        { id: 102, name: 'sutura-replay-99.json', expired: false },
      ];
      if (runId === 12) return [
        { id: 101, name: 'sutura-terminal-failure-12.json', expired: false },
        { id: 103, name: 'sutura-replay-12.json', expired: false },
      ];
      return [];
    },
    async downloadArtifact(_repository, runId, artifact) {
      if (artifact.name.endsWith('.html')) return FIXED_HTML;
      if (artifact.name.startsWith('sutura-replay-')) return JSON.stringify({
        schemaVersion: 'sutura-replay-v1', runId: '99', repo: 'juan294/alpha',
        actionSha: 'a'.repeat(40), github: [], executor: [],
        http: runId === 11 ? [{ boundary: 'nebius' }] : [],
        completeness: { complete: true },
      });
      return JSON.stringify({
        schemaVersion: 'sutura-terminal-failure-v2',
        outcome: 'infra-stop',
        errorMessage: 'bounded infrastructure stop',
        failure: { code: 'runtime-evidence-limit', stage: 'runtime-detection', class: 'RuntimeDetectionError' },
        fixtureIdentity: { targetRunId: '99', fixtureCommit: 'b'.repeat(40), pullRequestNumber: 114 },
        packageIdentity: { actionSha: 'a'.repeat(40), actionShaSource: 'runner-action-path' },
        execution: { claimState: 'claimed', providerInvocations: 0, sandboxOperations: 0, searchStarted: false, terminalCommentState: 'updated' },
      });
    },
  };
  const result = await collectFleetMetrics({
    schemaVersion: 'sutura-fleet-config-v1',
    owner: 'juan294',
    repositories: ['alpha', 'other-owner/missing'],
    startedAt: '2026-09-13T00:00:00.000Z',
    actionCommit: 'a'.repeat(40),
  }, client, new Date('2026-09-13T12:00:00.000Z'));

  assert.equal(result.summary.fleetRepositories, 2);
  assert.equal(result.summary.installedRepositories, 1);
  assert.equal(result.summary.monitorRuns, 4);
  assert.equal(result.summary.noRepairNeeded, 1);
  assert.equal(result.summary.notTriggered, 1);
  assert.equal(result.summary.repairAttempts, 2);
  assert.equal(result.summary.outcomes.fixed, 1);
  assert.equal(result.summary.outcomes['infra-stop'], 1);
  assert.equal(result.summary.outcomes.unknown, 0);
  assert.equal(result.summary.repairPrsOpened, 1);
  assert.equal(result.summary.attemptStages.attempted, 2);
  assert.equal(result.summary.attemptStages.searchStarted, 1);
  assert.equal(result.summary.attemptStages.providerInvoked, 1);
  assert.equal(result.summary.attemptStages.fixed, 1);
  assert.equal(result.summary.attemptStages.recovered, null);
  assert.deepEqual(result.summary.failureCauses, { 'runtime-evidence-limit': 1 });
  assert.deepEqual(result.summary.actionIdentity, { matched: 2, mismatched: 0, unavailable: 0 });
  assert.equal(result.summary.totalCostUsd, 0.5);
  assert.equal(result.summary.medianAttemptDurationSec, 90);
  assert.equal(result.events.length, 4);
  const terminalEvent = result.events.find(({ runId }) => runId === 12);
  assert.equal(terminalEvent.actionShaSource, 'runner-action-path');
  assert.equal(terminalEvent.sourceCommit, 'b'.repeat(40));
});

test('collector preserves valid primary evidence when optional replay evidence is corrupt', async () => {
  const client = {
    async listWorkflowRuns() {
      return [{
        id: 20, conclusion: 'success', run_started_at: '2026-09-13T09:00:00Z',
        updated_at: '2026-09-13T09:01:00Z', html_url: 'https://example.test/20',
      }];
    },
    async listArtifacts() {
      return [
        { id: 200, name: 'sutura-case-file-20.html', expired: false },
        { id: 201, name: 'sutura-replay-20.json', expired: false },
      ];
    },
    async downloadArtifact(_repository, _runId, artifact) {
      return artifact.name.endsWith('.html') ? FIXED_HTML : '{not-json';
    },
  };
  const result = await collectFleetMetrics({
    schemaVersion: 'sutura-fleet-config-v1', owner: 'juan294', repositories: ['alpha'],
    startedAt: '2026-09-13T00:00:00.000Z', actionCommit: 'a'.repeat(40),
  }, client, new Date('2026-09-13T12:00:00.000Z'));

  assert.equal(result.summary.outcomes.fixed, 1);
  assert.equal(result.summary.outcomes.unknown, 0);
  assert.match(result.events[0].replayEvidenceError, /valid JSON/u);
});

test('collector accepts mixed-owner repositories and rejects duplicate identities', async () => {
  const seen = [];
  const client = {
    async listWorkflowRuns(repository) {
      seen.push(repository);
      return [];
    },
  };
  await collectFleetMetrics({
    schemaVersion: 'sutura-fleet-config-v1',
    owner: 'juan294',
    repositories: ['alpha', 'frivas/roots'],
    startedAt: '2026-09-13T00:00:00.000Z',
    actionCommit: 'a'.repeat(40),
  }, client, new Date('2026-09-13T12:00:00.000Z'));
  assert.deepEqual(seen, ['alpha', 'frivas/roots']);

  await assert.rejects(() => collectFleetMetrics({
    schemaVersion: 'sutura-fleet-config-v1',
    owner: 'juan294',
    repositories: ['alpha', 'juan294/alpha'],
    startedAt: '2026-09-13T00:00:00.000Z',
    actionCommit: 'a'.repeat(40),
  }, client, new Date('2026-09-13T12:00:00.000Z')), /unique/u);
});

test('public summary removes repository identities and daily snapshots are idempotent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-fleet-metrics-'));
  try {
    const result = {
      summary: {
        schemaVersion: 'sutura-fleet-summary-v2', collectedAt: '2026-09-13T12:00:00.000Z',
        startedAt: '2026-09-13T00:00:00.000Z', actionCommit: 'a'.repeat(40), fleetRepositories: 1,
        installedRepositories: 1, monitorRuns: 1, noRepairNeeded: 0, notTriggered: 0, repairAttempts: 1,
        attemptStages: { attempted: 1, claimed: 1, searchStarted: 1, providerInvoked: 1, fixed: 1, recovered: null, recoveryEvidenceComplete: false },
        failureCauses: {}, costCompleteness: { measured: 1, unavailable: 0 },
        outcomes: { fixed: 1, 'flaky-no-patch': 0, refused: 0, 'gave-up': 0, 'infra-stop': 0, unknown: 0 },
        repairPrsOpened: 1, inferenceCostUsd: 0.1, sandboxCostUsd: 0.2, totalCostUsd: 0.3,
        medianAttemptDurationSec: 60,
      },
      events: [{ repository: 'private-project', runId: 1 }],
      installations: [{ repository: 'private-project', installed: true }],
    };
    const publicValue = publicFleetSummary(result.summary);
    assert.equal(JSON.stringify(publicValue).includes('private-project'), false);
    await writeFleetMetrics(result, directory);
    await writeFleetMetrics(result, directory);
    const snapshots = (await readFile(join(directory, 'snapshots.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(snapshots.length, 1);
    assert.equal((await readFile(join(directory, 'events.jsonl'), 'utf8')).includes('private-project'), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('parsed terminal evidence survives collector crash and later artifact expiry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-monitor-proof-'));
  const config = { schemaVersion: 'sutura-fleet-config-v1', owner: 'owner', repositories: ['alpha'],
    startedAt: '2026-09-13T00:00:00.000Z', actionCommit: 'a'.repeat(40) };
  const runs = [11, 12].map((id) => ({ id, conclusion: 'success',
    run_started_at: '2026-09-13T09:00:00Z', updated_at: '2026-09-13T09:01:00Z',
    html_url: `https://example.test/${id}` }));
  try {
    const crashing = {
      async listWorkflowRuns() { return runs; },
      async listArtifacts(_repository, id) {
        if (id === 12) throw new Error('later API page failed');
        return [{ id: 1, name: 'sutura-case-file-11.html', expired: false }];
      },
      async downloadArtifact() { return FIXED_HTML; },
    };
    await assert.rejects(() => collectFleetMetrics(config, crashing,
      new Date('2026-09-14T00:00:00.000Z'), { evidenceDirectory: directory }), /later API page/u);
    const saved = await readMonitorEvidence(directory);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].outcome, 'fixed');
    const expired = {
      async listWorkflowRuns() { return [runs[0]]; },
      async listArtifacts() { return [{ id: 1, name: 'sutura-case-file-11.html', expired: true }]; },
    };
    const result = await collectFleetMetrics(config, expired,
      new Date('2026-09-15T00:00:00.000Z'), { previousEvents: saved });
    assert.equal(result.events[0].outcome, 'fixed');
    assert.equal(result.summary.outcomes.fixed, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('replay-enriched evidence wins over the primary checkpoint regardless of read order', () => {
  const primary = { repository: 'alpha', runId: 11, runAttempt: 1, outcome: 'infra-stop',
    sourceRunId: '41', actionSha: 'a'.repeat(40), costStatus: 'unavailable' };
  const enriched = { ...primary, replayComplete: true, providerInvocations: 1,
    runtime: 'node', searchStarted: true };
  assert.equal(mergeMonitorEvents([primary, enriched], [])[0].replayComplete, true);
  assert.equal(mergeMonitorEvents([enriched, primary], [])[0].replayComplete, true);
});

test('CI pagination expands prior failed attempts hidden by a successful rerun', async () => {
  const client = new GhFleetClient('owner');
  let queriedWindow;
  client.api = async (path) => {
    if (path.includes('/attempts/1')) return {
      id: 41, run_attempt: 1, workflow_id: 12, head_branch: 'develop',
      head_sha: 'a'.repeat(40), conclusion: 'failure', created_at: '2026-09-12T10:00:00Z',
      updated_at: '2026-09-20T10:00:00Z',
    };
    if (path.includes('/attempts/2')) return {
      id: 41, run_attempt: 2, workflow_id: 12, head_branch: 'develop',
      head_sha: 'a'.repeat(40), conclusion: 'success', created_at: '2026-09-20T10:30:00Z',
      updated_at: '2026-09-20T11:00:00Z',
    };
    queriedWindow = path;
    return [{ total_count: 1, workflow_runs: [{ id: 41, run_attempt: 2, workflow_id: 12,
      head_branch: 'develop', head_sha: 'a'.repeat(40), conclusion: 'success',
      created_at: '2026-09-12T10:00:00Z', updated_at: '2026-09-20T11:00:00Z' }] }];
  };
  const runs = await client.listCiRuns('alpha', { id: 12 }, '2026-09-13T00:00:00.000Z');
  assert.deepEqual(runs.map(({ attempt, conclusion }) => [attempt, conclusion]),
    [[1, 'failure'], [2, 'success']]);
  assert.equal(runs[1].createdAt, '2026-09-20T10:30:00Z');
  assert.match(queriedWindow, /2026-08-09T00%3A00%3A00\.000Z/u);
});

test('CI pagination rejects a capped or incomplete API result', async () => {
  const client = new GhFleetClient('owner');
  client.api = async () => [{ total_count: 1000, workflow_runs: [{ id: 41 }] }];
  await assert.rejects(() => client.listCiRuns('alpha', { id: 12 }, '2026-09-13T00:00:00.000Z'),
    /cap|incomplete/u);
});

test('CI listing skips parent runs whose latest attempt predates the comparison window', async () => {
  const client = new GhFleetClient('owner');
  let attemptReads = 0;
  client.api = async (path) => {
    if (path.includes('/attempts/')) { attemptReads += 1; throw new Error('stale run should not be expanded'); }
    return [{ total_count: 1, workflow_runs: [{ id: 41, run_attempt: 3,
      updated_at: '2026-09-12T23:59:00Z' }] }];
  };
  const runs = await client.listCiRuns('alpha', { id: 12 }, '2026-09-13T00:00:00.000Z');
  assert.equal(runs.length, 0);
  assert.equal(attemptReads, 0);
});

test('CI pagination splits a capped time window without losing either half', async () => {
  const client = new GhFleetClient('owner');
  let requests = 0;
  client.api = async () => {
    requests += 1;
    if (requests === 1) return [{ total_count: 1000, workflow_runs: [] }];
    const id = requests === 2 ? 41 : 42;
    return [{ total_count: 1, workflow_runs: [{ id, run_attempt: 1,
      workflow_id: 12, head_branch: 'develop', head_sha: 'a'.repeat(40),
      conclusion: 'failure', updated_at: '2026-09-20T10:00:00Z' }] }];
  };
  const runs = await client.listCiRuns('alpha', { id: 12 }, '2026-09-13T00:00:00.000Z');
  assert.deepEqual(runs.map(({ id }) => id), [41, 42]);
  assert.equal(requests, 3);
});

test('terminal evidence is checkpointed before the optional replay request finishes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-terminal-checkpoint-'));
  let releaseReplay;
  const replay = new Promise((resolve) => { releaseReplay = resolve; });
  const client = {
    async listWorkflowRuns() { return [{ id: 11, conclusion: 'success',
      run_started_at: '2026-09-13T09:00:00Z', updated_at: '2026-09-13T09:01:00Z' }]; },
    async listArtifacts() { return [
      { id: 1, name: 'sutura-case-file-11.html', expired: false },
      { id: 2, name: 'sutura-replay-11.json', expired: false },
    ]; },
    async downloadArtifact(_repository, _id, artifact) {
      return artifact.name.includes('case-file') ? FIXED_HTML : replay;
    },
  };
  const config = { schemaVersion: 'sutura-fleet-config-v1', owner: 'owner', repositories: ['alpha'],
    startedAt: '2026-09-13T00:00:00.000Z', actionCommit: 'a'.repeat(40) };
  try {
    const collection = collectFleetMetrics(config, client, new Date('2026-09-14T00:00:00.000Z'),
      { evidenceDirectory: directory });
    let saved = [];
    for (let index = 0; index < 30 && saved.length === 0; index += 1) {
      await delay(10);
      saved = await readMonitorEvidence(directory);
    }
    assert.equal(saved[0]?.outcome, 'fixed');
    releaseReplay('{}');
    await collection;
  } finally {
    releaseReplay('{}');
    await rm(directory, { recursive: true, force: true });
  }
});

test('repair PR lookup proves the source marker, parent commit and real diff digest', async () => {
  const sourceSha = 'a'.repeat(40);
  const client = new GhFleetClient('owner');
  client.api = async (path) => {
    if (path.includes('/pulls?')) return [[{ number: 91,
      head: { ref: 'sutura/fix-41', sha: 'c'.repeat(40) }, base: { ref: 'develop' },
      body: '<!-- sutura-run:NDE -->', merged_at: '2026-09-20T11:00:00Z',
      merge_commit_sha: 'e'.repeat(40) }]];
    if (path.includes('/pulls/91/files')) return [[{ filename: 'src/index.ts', status: 'modified', patch: '@@ -1 +1 @@' }]];
    if (path.includes('/commits/')) return { parents: [{ sha: sourceSha }] };
    throw new Error(`Unexpected path: ${path}`);
  };
  const pr = await client.findRepairPr('alpha', { id: 41, branch: 'develop', headSha: sourceSha });
  assert.equal(pr.diffSha.length, 64);
  assert.equal(pr.sourceSha, sourceSha);
  assert.equal(pr.merged, true);
  client.api = async (path) => {
    if (path.includes('/pulls?')) return [[{ number: 91,
      head: { ref: 'sutura/fix-41', sha: 'c'.repeat(40) }, base: { ref: 'develop' },
      body: '<!-- sutura-run:NDE -->', merged_at: null, merge_commit_sha: null }]];
    if (path.includes('/pulls/91/files')) return [[{ filename: 'src/index.ts', status: 'modified', patch: '@@ -1 +1 @@' }]];
    if (path.includes('/commits/')) return { parents: [{ sha: 'b'.repeat(40) }] };
    throw new Error(`Unexpected path: ${path}`);
  };
  await assert.rejects(() => client.findRepairPr('alpha', { id: 41, branch: 'develop', headSha: sourceSha }),
    /parent|source/u);
});
