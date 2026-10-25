import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluateCompatibilityPilot, compatibilityContractDigest } from './fleet-compatibility-pilot.mjs';

const candidate = 'a'.repeat(40), installedSource = 'b'.repeat(40), source = 'c'.repeat(40), digest = 'd'.repeat(64);
function fixture() {
  const input = {
    schemaVersion: 'sutura-compatibility-pilot-v1', repositoryId: 42, candidateSha: candidate,
    defaultBranch: 'integration', expectedInstallationSha: installedSource, targetStage: 'snapshot',
    installation: { repositoryId: 42, branch: 'integration', sourceSha: installedSource,
      actionSha: candidate, monitorWorkflowId: 12, watchedWorkflowIds: [10], observedAt: '2026-10-28T00:00:00Z', activatedAt: '2026-10-25T00:00:00Z', complete: true, rolledBack: false },
    verificationContract: { version: 1, repositoryId: 42, protected: true, policyDigest: digest, fullRequired: true,
      policySource: { repositoryId: 42, ref: 'refs/heads/integration', sha: 'f'.repeat(40), path: '.github/native-policy.json' },
      eventApplicability: { event: 'push', branch: 'integration' },
      requiredJobs: [{ workflowId: 10, jobKey: 'checks/node=22' }, { workflowId: 10, jobKey: 'checks/node=24' }] },
    native: { complete: true, policyDigest: digest, runs: [{ repositoryId: 42, workflowId: 10,
      runId: 100, attempt: 2, event: 'push', branch: 'integration', headSha: installedSource, complete: true, status: 'completed', conclusion: 'success',
      jobs: ['checks/node=22', 'checks/node=24'].map(jobKey => ({ jobKey, runId: 100, attempt: 2,
        headSha: installedSource, status: 'completed', conclusion: 'success' })) }] },
    regression: { candidateSha: candidate, capturedRegression: 'passed', fullLocalChecks: 'passed' },
    observation: { complete: true, startedAt: '2026-10-25T00:00:00Z', endedAt: '2026-10-28T00:00:00Z', safetyRegression: false },
    events: [{ source: { repositoryId: 42, runId: 200, attempt: 3, sourceSha: source, workflowId: 10, conclusion: 'failure', completedAt: '2026-10-26T00:00:00Z' },
      monitor: { repositoryId: 42, workflowId: 12, runId: 300, attempt: 1, sourceRunId: 200,
        sourceAttempt: 3, sourceSha: source, actionSha: candidate, complete: true, completedAt: '2026-10-26T00:10:00Z',
        stages: [{ name: 'snapshot', status: 'passed', monitorRunId: 300, monitorAttempt: 1 },
          { name: 'reproduction', status: 'failed', monitorRunId: 300, monitorAttempt: 1 }] } }],
  };
  input.verificationContract.policyDigest = compatibilityContractDigest(input.verificationContract);
  input.native.policyDigest = input.verificationContract.policyDigest;
  return input;
}

test('exact stage passage proves only stop removal despite an unrelated later failure', () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = evaluateCompatibilityPilot(input);
  assert.equal(result.installation, 'verified');
  assert.equal(result.stopRemoval, 'proved');
  assert.equal(result.organicRecovery, 'unmeasured');
  assert.equal(result.compatibilityDistribution, 'evidence-ready');
  assert.deepEqual(result.stageProofs, [{ sourceRunId: 200, sourceAttempt: 3, sourceSha: source, monitorRunId: 300, monitorAttempt: 1 }]);
  assert.deepEqual(input, before);
});
test('an earlier stop cannot prove a stage it never entered', () => {
  const input = fixture();
  input.events[0].monitor.stages = [{ name: 'import', status: 'failed', monitorRunId: 300, monitorAttempt: 1 }];
  assert.equal(evaluateCompatibilityPilot(input).stopRemoval, 'unexercised');
});
test('a complete zero-event window permits compatibility distribution but no repair or stop-removal claim', () => {
  const input = fixture(); input.events = [];
  const result = evaluateCompatibilityPilot(input);
  assert.equal(result.installation, 'verified');
  assert.equal(result.stopRemoval, 'unexercised');
  assert.equal(result.organicRecovery, 'unmeasured');
  assert.equal(result.compatibilityDistribution, 'evidence-ready');
  assert.equal(result.eligibleEvents, 0);
});
test('incomplete collection retains installed identity but cannot prove stop removal or a safe window', () => {
  const input = fixture(); input.observation.complete = false;
  const result = evaluateCompatibilityPilot(input);
  assert.equal(result.installation, 'verified');
  assert.equal(result.stopRemoval, 'unmeasured');
  assert.equal(result.compatibilityDistribution, 'pending');
});
test('wrong pin, wrong default branch, wrong installation SHA and rollback cannot qualify installation', () => {
  for (const patch of [{ actionSha: 'e'.repeat(40) }, { branch: 'topic' },
    { sourceSha: 'e'.repeat(40) }, { complete: false }, { rolledBack: true }]) {
    const input = fixture(); Object.assign(input.installation, patch);
    const result = evaluateCompatibilityPilot(input);
    assert.notEqual(result.installation, 'verified');
    assert.equal(result.stopRemoval, 'unmeasured');
    assert.equal(result.compatibilityDistribution, 'pending');
  }
});
test('protected obligations are explicit; missing, skipped or wrong-attempt matrix children cannot qualify', () => {
  const variants = [
    input => { input.verificationContract = undefined; },
    input => { input.verificationContract.protected = false; },
    input => { input.verificationContract.requiredJobs = []; },
    input => { input.native.runs[0].jobs.pop(); },
    input => { input.native.runs[0].jobs[0].conclusion = 'skipped'; },
    input => { input.native.runs[0].jobs[0].attempt = 1; },
    input => { input.native.runs[0].jobs[0].runId = 999; },
    input => { input.native.runs[0].jobs[0].headSha = source; },
    input => { input.native.policyDigest = 'e'.repeat(64); },
    input => { input.native.complete = false; },
    input => { input.native.runs[0].conclusion = 'failure'; },
    input => { input.native.runs[0].status = 'in_progress'; },
    input => { input.native.runs[0].jobs.push(input.native.runs[0].jobs[0]); },
  ];
  for (const mutate of variants) {
    const input = fixture(); mutate(input);
    const result = evaluateCompatibilityPilot(input);
    assert.notEqual(result.installation, 'verified');
    assert.equal(result.stopRemoval, 'unmeasured');
  }
});
test('stage evidence must bind the exact source and monitor run, attempt, repository, workflow and candidate', () => {
  const variants = [
    input => { input.events[0].monitor.sourceRunId = 201; },
    input => { input.events[0].monitor.sourceAttempt = 2; },
    input => { input.events[0].monitor.sourceSha = installedSource; },
    input => { input.events[0].monitor.actionSha = 'e'.repeat(40); },
    input => { input.events[0].monitor.repositoryId = 43; },
    input => { input.events[0].monitor.workflowId = 13; },
    input => { input.events[0].monitor.stages[0].monitorRunId = 301; },
    input => { input.events[0].monitor.stages[0].monitorAttempt = 2; },
    input => { input.events[0].monitor.complete = false; },
    input => { input.events[0].source.workflowId = 999; },
    input => { input.events[0].monitor.completedAt = '2026-10-24T00:00:00Z'; },
    input => { input.events.push(structuredClone(input.events[0])); },
  ];
  for (const mutate of variants) {
    const input = fixture(); mutate(input);
    const result = evaluateCompatibilityPilot(input);
    assert.equal(result.stopRemoval, 'unmeasured');
    assert.equal(result.compatibilityDistribution, 'pending');
  }
});
test('failed target, short window, unsafe window and wrong-candidate local proof remain pending', () => {
  const input = fixture(); input.events[0].monitor.stages[0].status = 'failed';
  assert.equal(evaluateCompatibilityPilot(input).stopRemoval, 'not-removed');
  for (const mutate of [
    input => { input.observation.endedAt = '2026-10-27T00:00:00Z'; },
    input => { input.observation.safetyRegression = true; },
    input => { input.regression.candidateSha = source; },
    input => { input.observation.startedAt = '2026-10-25 (private-text)'; },
  ]) {
    const candidateInput = fixture(); mutate(candidateInput);
    assert.equal(evaluateCompatibilityPilot(candidateInput).compatibilityDistribution, 'pending');
  }
});
test('malformed records fail closed without returning input free text', () => {
  for (const input of [undefined, null, {}, { schemaVersion: 'unknown', privateText: 'private-value' }]) {
    const result = evaluateCompatibilityPilot(input);
    assert.equal(result.installation, 'unmeasured');
    assert.equal(result.organicRecovery, 'unmeasured');
    assert.equal(JSON.stringify(result).includes('private-value'), false);
  }
});

test('safety duration starts after activation and distinct events cannot reuse one monitor attempt', () => {
  const late = fixture(); late.installation.activatedAt = '2026-10-27T00:00:00Z';
  assert.equal(evaluateCompatibilityPilot(late).compatibilityDistribution, 'pending');
  const duplicate = fixture(); const other = structuredClone(duplicate.events[0]);
  other.source.runId = 201; other.monitor.sourceRunId = 201;
  duplicate.events.push(other);
  assert.equal(evaluateCompatibilityPilot(duplicate).stopRemoval, 'unmeasured');
});
test('CLI reads bounded evidence, gives machine status and refuses symlinks or malformed data', () => {
  const root = mkdtempSync(join(tmpdir(), 'sutura-pilot-'));
  const script = new URL('./fleet-compatibility-pilot.mjs', import.meta.url);
  try {
    const evidence = join(root, 'evidence.json'); writeFileSync(evidence, JSON.stringify(fixture()));
    const run = path => spawnSync(process.execPath, [script.pathname, path], { encoding: 'utf8', timeout: 5000 });
    let result = run(evidence);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).organicRecovery, 'unmeasured');
    const pending = fixture(); pending.events = []; pending.observation.complete = false;
    writeFileSync(evidence, JSON.stringify(pending)); result = run(evidence);
    assert.equal(result.status, 2);
    const link = join(root, 'link'); symlinkSync(evidence, link);
    assert.equal(run(link).status, 1);
    writeFileSync(evidence, '{private-data'); result = run(evidence);
    assert.equal(result.status, 1); assert.equal(result.stderr.includes('private-data'), false);
    writeFileSync(evidence, 'x'.repeat(2 * 1024 * 1024 + 1));
    assert.equal(run(evidence).status, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('protected descriptor digest binds full required obligations, source and event applicability', () => {
  for (const mutate of [
    input => { input.verificationContract.requiredJobs.pop(); input.native.runs[0].jobs.pop(); },
    input => { delete input.verificationContract.policySource; },
    input => { delete input.verificationContract.eventApplicability; },
    input => { delete input.verificationContract.fullRequired; },
    input => { input.verificationContract.policySource.sha = 'e'.repeat(40); },
    input => { input.native.runs[0].event = 'pull_request'; },
  ]) {
    const input = fixture(); mutate(input);
    assert.notEqual(evaluateCompatibilityPilot(input).installation, 'verified');
  }
  const input = fixture();
  const reversed = structuredClone(input.verificationContract); reversed.requiredJobs.reverse();
  assert.equal(compatibilityContractDigest(reversed), input.verificationContract.policyDigest);
});
test('CLI refuses a FIFO without blocking while opening it', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'sutura-pilot-fifo-'));
  try {
    const fifo = join(root, 'pipe');
    assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
    const result = spawnSync(process.execPath, [new URL('./fleet-compatibility-pilot.mjs', import.meta.url).pathname, fifo],
      { encoding: 'utf8', timeout: 1000 });
    assert.equal(result.status, 1, 'FIFO must be refused, not time out');
    assert.equal(result.error, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
