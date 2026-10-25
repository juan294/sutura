import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verificationContractDigest, sealIncidentEvidence, qualifyIncident,
  persistIncidentEvidence, readIncidentEvidence, rebuildLegacyEvidence,
  summarizeQualifications, publicQualificationSummary, readLegacyIncidentEvidence } from './fleet-incident-evidence.mjs';

const sha = n => n.repeat(40), digest = 'a'.repeat(64);
const source = { repositoryId: 42, sourceRunId: 100, sourceAttempt: 2,
  sourceSha: sha('a'), workflowId: 10, branch: 'integration' };
function fixture() {
  const jobs = [{ workflowId: 10, jobKey: 'test (22)' }, { workflowId: 10, jobKey: 'test (24)' }];
  const contract = { schemaVersion: 'sutura-native-verification-v1', repositoryId: 42,
    protected: true, fullRequired: true, baseBranch: source.branch,
    policySource: { repositoryId: 42, ref: 'refs/heads/integration', sha: sha('b'), path: '.github/native-obligations.json' },
    stages: { proposal: { event: 'pull_request', branchRole: 'repair-head', requiredJobs: jobs },
      integration: { event: 'push', branchRole: 'base', requiredJobs: jobs } } };
  contract.policyDigest = verificationContractDigest(contract);
  const proof = { monitor: { repositoryId: 42, runId: 200, attempt: 1,
    sourceRunId: 100, sourceAttempt: 2, sourceSha: sha('a'), actionSha: sha('b'), outcome: 'fixed', complete: true, completedAt: '2026-10-25T08:00:00.000Z',
    publication: { prNumber: 5, headSha: sha('c'), diffDigest: digest } },
    repairPr: { repositoryId: 42, number: 5, sourceRunId: 100, sourceAttempt: 2,
      sourceSha: sha('a'), sourceParentSha: sha('a'), headSha: sha('c'), headBranch: 'sutura/fix-100',
      baseBranch: 'integration', baseSha: sha('b'), diffDigest: digest, merged: true, integrationSha: sha('e') },
    native: ['proposal', 'integration'].map((stage, i) => ({ stage, repositoryId: 42, workflowId: 10,
      runId: 300 + i, attempt: 1, event: i ? 'push' : 'pull_request',
      branch: i ? 'integration' : 'sutura/fix-100', headSha: i ? sha('e') : sha('c'),
      testedSha: i ? sha('e') : sha('d'), mergeParents: i ? null : [sha('b'), sha('c')],
      status: 'completed', conclusion: 'success', jobsComplete: true, policyDigest: contract.policyDigest, policySourceSha: contract.policySource.sha,
      jobs: jobs.map(({ jobKey }) => ({ jobKey, runId: 300 + i, attempt: 1,
        testedSha: i ? sha('e') : sha('d'), status: 'completed', conclusion: 'success' })) })) };
  const record = { schemaVersion: 'sutura-incident-evidence-v1', observedAt: '2026-10-25T09:00:00.000Z',
    source, trigger: { event: 'push', actorId: 7, triggeringActorId: 7, authenticated: true },
    classificationRevision: 'sutura-classification-v1', classification: null,
    completeness: { collection: true, source: true, native: true, logs: false },
    policyDigest: contract.policyDigest, proof, nextObservedGreen: { runId: 301, headSha: sha('e') } };
  return { contract, record: sealIncidentEvidence(record) };
}
function qualify(mutate = () => {}) {
  const { record, contract } = fixture(); mutate(record, contract);
  return qualifyIncident(source, [sealIncidentEvidence(record)], contract);
}

test('full exact native obligations qualify proposal and integration without attributing human labor', () => {
  const result = qualify();
  assert.equal(result.proposal, 'qualified'); assert.equal(result.integration, 'qualified');
  assert.equal(result.attribution, 'unmeasured');
  assert.equal(result.currentScanComplete, true);
  assert.ok(result.proofDigests.length > 0);
});
test('missing/skipped/cancelled matrix children and failed wrapper cannot qualify', () => {
  for (const mutate of [
    r => r.proof.native[0].jobs.pop(),
    r => { r.proof.native[0].jobs[0].conclusion = 'skipped'; },
    r => { r.proof.native[0].jobs[0].conclusion = 'cancelled'; },
    r => { r.proof.native[0].conclusion = 'failure'; },
    r => { r.proof.native[0].jobs[0].attempt = 2; },
    r => { r.proof.native[0].jobs[0].testedSha = sha('f'); },
    r => { r.proof.native[0].jobsComplete = false; },
  ]) assert.notEqual(qualify(mutate).proposal, 'qualified');
});
test('wrong SHA, PR source/attempt and native merge relationship cannot qualify', () => {
  for (const mutate of [
    r => { r.proof.native[0].headSha = sha('f'); },
    r => { r.proof.native[0].mergeParents = [sha('a'), sha('c')]; },
    r => { r.proof.repairPr.sourceAttempt = 1; },
    r => { r.proof.repairPr.repositoryId = 43; },
    r => { r.proof.repairPr.sourceParentSha = sha('f'); },
    r => { r.proof.monitor.sourceAttempt = 1; },
    r => { r.proof.monitor.outcome = 'gave-up'; },
  ]) assert.notEqual(qualify(mutate).proposal, 'qualified');
  assert.notEqual(qualify(r => { r.proof.native[1].headSha = sha('f'); }).integration, 'qualified');
});
test('reduced obligations, missing protected policy and old-policy proof remain unmeasured', () => {
  for (const mutate of [
    (_r, c) => { c.stages.proposal.requiredJobs.pop(); },
    (_r, c) => { c.protected = false; },
    (_r, c) => { delete c.policySource; },
    (_r, c) => { c.fullRequired = false; },
    (_r, c) => { c.policySource.sha = sha('f'); c.policyDigest = verificationContractDigest(c); },
  ]) assert.equal(qualify(mutate).proposal, 'unmeasured');
});
test('same-branch unrelated next green is descriptive only', () => {
  const result = qualify(r => { r.proof = {}; });
  assert.equal(result.proposal, 'unmeasured'); assert.equal(result.integration, 'unmeasured');
  assert.equal(result.nextObservedGreen.runId, 301);
});
test('later incomplete collection preserves valid historical proof but discloses incomplete current coverage', () => {
  const { record, contract } = fixture();
  const later = sealIncidentEvidence({ ...record, observedAt: '2026-10-26T09:00:00.000Z',
    completeness: { collection: false, source: false, native: false, logs: false }, proof: {} });
  const result = qualifyIncident(source, [record, later], contract);
  assert.equal(result.proposal, 'qualified'); assert.equal(result.integration, 'qualified');
  assert.equal(result.currentScanComplete, false);
});
test('later authoritative contradiction revokes proof even during a partial scan', () => {
  const { record, contract } = fixture(); const later = structuredClone(record);
  later.observedAt = '2026-10-26T09:00:00.000Z'; later.completeness.collection = false;
  later.proof.native[0].jobs[0].conclusion = 'failure';
  const result = qualifyIncident(source, [record, sealIncidentEvidence(later)], contract);
  assert.equal(result.proposal, 'not-qualified'); assert.equal(result.integration, 'not-qualified');
  assert.equal(result.currentScanComplete, false);
});
test('records for a different repository, attempt or SHA cannot contaminate qualification', () => {
  const { record, contract } = fixture();
  for (const patch of [{ repositoryId: 43 }, { sourceAttempt: 1 }]) {
    assert.equal(qualifyIncident({ ...source, ...patch }, [record], contract).proposal, 'unmeasured');
  }
  assert.throws(() => qualifyIncident({ ...source, sourceSha: sha('f') }, [record], contract), /identity.*integrity/i);
});
test('a later scan of an older successful attempt cannot resurrect revoked proof', () => {
  const { record, contract } = fixture(); const failed = structuredClone(record), stale = structuredClone(record);
  failed.observedAt = '2026-10-26T09:00:00.000Z'; failed.proof.native[0].attempt = 2;
  failed.proof.native[0].conclusion = 'failure';
  stale.observedAt = '2026-10-27T09:00:00.000Z';
  assert.equal(qualifyIncident(source, [record, sealIncidentEvidence(failed), sealIncidentEvidence(stale)], contract).proposal, 'not-qualified');
});
test('a stale failed receipt cannot move the proof cursor backwards before an older success', () => {
  const { record, contract } = fixture();
  const observations = [record];
  for (const [day, attempt, conclusion] of [[26, 3, 'failure'], [27, 1, 'failure'], [28, 2, 'success']]) {
    const next = structuredClone(record); next.observedAt = `2026-10-${day}T09:00:00.000Z`;
    next.proof.native[0].attempt = attempt; next.proof.native[0].conclusion = conclusion;
    for (const job of next.proof.native[0].jobs) job.attempt = attempt;
    observations.push(sealIncidentEvidence(next));
  }
  assert.equal(qualifyIncident(source, observations, contract).proposal, 'not-qualified');
});
test('unrelated native receipts cannot revoke prior exact proof or hide comparable native receipts', () => {
  const { record, contract } = fixture(); const later = structuredClone(record);
  later.observedAt = '2026-10-26T09:00:00.000Z'; later.completeness.collection = false;
  const unrelated = { ...structuredClone(later.proof.native[0]), repositoryId: 43,
    runId: 999, completedAt: '2026-10-26T08:00:00.000Z', conclusion: 'failure' };
  later.proof.native = [unrelated];
  assert.equal(qualifyIncident(source, [record, sealIncidentEvidence(later)], contract).proposal, 'qualified');
  const merged = structuredClone(record); merged.proof.native.push(unrelated);
  assert.equal(qualifyIncident(source, [sealIncidentEvidence(merged)], contract).proposal, 'qualified');
});
test('same-instant contradictory receipts produce the same conservative result regardless of journal order', () => {
  const { record, contract } = fixture(); const failed = structuredClone(record);
  failed.proof.native[0].conclusion = 'failure'; const contradiction = sealIncidentEvidence(failed);
  for (const records of [[record, contradiction], [contradiction, record]]) {
    assert.equal(qualifyIncident(source, records, contract).proposal, 'not-qualified');
  }
});
test('current proposal and integration must bind the same published PR head and diff', () => {
  const { record, contract } = fixture(); const later = structuredClone(record);
  later.observedAt = '2026-10-26T09:00:00.000Z'; later.proof.repairPr.headSha = sha('f');
  later.proof.repairPr.merged = false; later.proof.repairPr.integrationSha = null;
  later.proof.monitor.attempt = 2; later.proof.monitor.completedAt = '2026-10-26T08:00:00.000Z';
  later.proof.monitor.publication.headSha = sha('f');
  later.proof.native = [later.proof.native[0]];
  later.proof.native[0].headSha = sha('f'); later.proof.native[0].mergeParents[1] = sha('f');
  assert.equal(qualifyIncident(source, [record, sealIncidentEvidence(later)], contract).proposal, 'qualified');
  assert.notEqual(qualifyIncident(source, [record, sealIncidentEvidence(later)], contract).integration, 'qualified');
});
test('a fixed monitor must bind its actual published PR, head and audited diff', () => {
  for (const mutate of [
    r => { delete r.proof.monitor.publication; },
    r => { r.proof.monitor.publication.prNumber = 6; },
    r => { r.proof.monitor.publication.headSha = sha('f'); },
    r => { r.proof.monitor.publication.diffDigest = 'b'.repeat(64); },
  ]) assert.notEqual(qualify(mutate).proposal, 'qualified');
});
test('immutable companion files validate byte digest, reject corrupt history and preserve original bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sutura-companion-'));
  try {
    const { record, contract } = fixture(); const receipt = await persistIncidentEvidence(root, record);
    const before = await readFile(receipt.path); await persistIncidentEvidence(root, record);
    assert.deepEqual(await readFile(receipt.path), before);
    assert.equal(qualifyIncident(source, await readIncidentEvidence(root), contract).proposal, 'qualified');
    await writeFile(receipt.path, '{}');
    await assert.rejects(readIncidentEvidence(root), /integrity.*rebuild/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('legacy rebuild never invents actor, obligations or qualification, and keeps original records untouched', () => {
  const legacy = { schemaVersion: 'sutura-fleet-observation-v1', observedAt: '2026-10-25T09:00:00.000Z',
    incident: { schemaVersion: 'sutura-fleet-incident-v2', ...source, state: 'sutura-green' } };
  const before = structuredClone(legacy); const records = rebuildLegacyEvidence([legacy]);
  assert.deepEqual(legacy, before); assert.equal(records[0].trigger.authenticated, false);
  assert.equal(qualifyIncident(source, records, fixture().contract).integration, 'unmeasured');
});
test('summary separates qualified proposals, integrated repairs and unmeasured incidents; zero census is incomplete', () => {
  const qualified = qualify(); const unmeasured = qualify(r => { r.proof = {}; });
  const summary = summarizeQualifications([qualified, unmeasured], { complete: true });
  assert.equal(summary.verifiedRepairPrs, 1); assert.equal(summary.integratedRecoveries, 1);
  assert.equal(summary.unmeasured, 1); assert.equal(summary.complete, false);
  assert.equal(summarizeQualifications([], { complete: true }).complete, false);
});
test('public qualification export rejects identifiers/free text at every nesting level', () => {
  const clean = publicQualificationSummary({ ...summarizeQualifications([qualify()], { complete: true }),
    repository: 'private-value', proofDigests: ['private-value'], extra: { secret: 'private-value' } });
  assert.equal(JSON.stringify(clean).includes('private-value'), false);
  assert.throws(() => publicQualificationSummary({ verifiedRepairPrs: 'private-value' }), /summary/i);
  const valid = summarizeQualifications([qualify()], { complete: true });
  for (const patch of [{ verifiedRepairPrs: 2 }, { integratedRecoveries: 2 }, { unmeasured: 1 }, { verifiedRepairPrs: 0 }]) {
    assert.throws(() => publicQualificationSummary({ ...valid, ...patch }), /summary/i);
  }
});
test('source and native partial coverage remain incomplete even if a collector flag says complete', () => {
  const { record, contract } = fixture();
  const later = sealIncidentEvidence({ ...record, observedAt: '2026-10-26T09:00:00.000Z',
    completeness: { collection: true, source: false, native: false, logs: false }, proof: {} });
  const result = qualifyIncident(source, [record, later], contract);
  assert.equal(result.proposal, 'qualified'); assert.equal(result.currentScanComplete, false);
  assert.equal(summarizeQualifications([result], { complete: true }).complete, false);
});

function withAttempt(run, attempt, conclusion = 'success') {
  run.attempt = attempt; run.conclusion = conclusion;
  for (const job of run.jobs) job.attempt = attempt;
  return run;
}
test('workflow contradiction cursors survive partial receipts from other workflows', () => {
  const { record, contract } = fixture();
  contract.stages.proposal.requiredJobs.push({ workflowId: 11, jobKey: 'test (22)' });
  contract.policyDigest = verificationContractDigest(contract); record.policyDigest = contract.policyDigest;
  for (const run of record.proof.native) run.policyDigest = contract.policyDigest;
  const extra = structuredClone(record.proof.native[0]); extra.workflowId = 11; extra.runId = 400;
  for (const job of extra.jobs) job.runId = 400;
  record.proof.native.push(extra);
  const observations = [];
  for (const [day, a, b, failedWorkflow] of [[25, 3, 3, 11], [26, 3, 1, 10], [27, 3, 2, null]]) {
    const next = structuredClone(record); next.observedAt = `2026-10-${day}T09:00:00.000Z`;
    for (const run of next.proof.native.filter(run => run.stage === 'proposal')) {
      withAttempt(run, run.workflowId === 10 ? a : b, run.workflowId === failedWorkflow ? 'failure' : 'success');
    }
    observations.push(sealIncidentEvidence(next));
  }
  assert.equal(qualifyIncident(source, observations, contract).proposal, 'not-qualified');
});
test('an older same-run attempt cannot supersede a newer failure through a later completedAt', () => {
  const { record, contract } = fixture(); const failed = structuredClone(record), stale = structuredClone(record);
  failed.observedAt = '2026-10-26T09:00:00.000Z';
  withAttempt(failed.proof.native[0], 3, 'failure').completedAt = '2026-10-25T08:00:00.000Z';
  stale.observedAt = '2026-10-27T09:00:00.000Z';
  withAttempt(stale.proof.native[0], 2).completedAt = '2026-10-26T08:00:00.000Z';
  assert.equal(qualifyIncident(source, [sealIncidentEvidence(failed), sealIncidentEvidence(stale)], contract).proposal, 'not-qualified');
});
test('unrelated PR identity does not revoke exact historical proof', () => {
  for (const patch of [{ repositoryId: 43 }, { sourceAttempt: 1 }, { sourceSha: sha('f') }]) {
    const { record, contract } = fixture(); const unrelated = structuredClone(record);
    unrelated.observedAt = '2026-10-26T09:00:00.000Z'; Object.assign(unrelated.proof.repairPr, patch);
    const result = qualifyIncident(source, [record, sealIncidentEvidence(unrelated)], contract);
    assert.equal(result.proposal, 'qualified'); assert.equal(result.integration, 'qualified');
  }
});
test('superseded integration receipt digests are absent from current proof references', () => {
  const { record, contract } = fixture(); const later = structuredClone(record);
  later.observedAt = '2026-10-26T09:00:00.000Z'; later.proof.repairPr.headSha = sha('f');
  later.proof.repairPr.merged = false; later.proof.repairPr.integrationSha = null;
  later.proof.monitor.attempt = 2; later.proof.monitor.completedAt = '2026-10-26T08:00:00.000Z';
  later.proof.monitor.publication.headSha = sha('f'); later.proof.native = [later.proof.native[0]];
  later.proof.native[0].headSha = sha('f'); later.proof.native[0].mergeParents[1] = sha('f');
  const next = sealIncidentEvidence(later), result = qualifyIncident(source, [record, next], contract);
  const obsolete = record.proofReferences.filter(ref => !next.proofReferences.some(current => current.digest === ref.digest));
  assert.equal(result.integration, 'unmeasured');
  for (const ref of obsolete) assert.equal(result.proofDigests.includes(ref.digest), false);
});
test('native verification must identify the protected policy source SHA', () => {
  for (const value of [undefined, sha('f')]) {
    assert.notEqual(qualify(r => { r.proof.native[0].policySourceSha = value; }).proposal, 'qualified');
  }
});
test('legacy rebuild rejects symlinks, FIFOs and oversized files without changing original bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sutura-legacy-boundary-'));
  try {
    const bytes = JSON.stringify({ schemaVersion: 'sutura-fleet-observation-v1', observedAt: '2026-10-25T09:00:00.000Z',
      incident: { schemaVersion: 'sutura-fleet-incident-v2', ...source } }) + '\n';
    const name = `42-100-2-${createHash('sha256').update(bytes).digest('hex')}.json`;
    const input = join(root, 'input'); await mkdir(input); const path = join(input, name);
    const target = join(root, 'target'); await writeFile(target, bytes); await symlink(target, path);
    await assert.rejects(readLegacyIncidentEvidence(input), /integrity/); await rm(path);
    execFileSync('mkfifo', [path]);
    const script = fileURLToPath(new URL('./fleet-incident-evidence.mjs', import.meta.url));
    const fifo = spawnSync(process.execPath, [script, '--rebuild-from-v2', input, '--output', join(root, 'fifo-out')], { timeout: 3000, encoding: 'utf8' });
    assert.equal(fifo.error, undefined); assert.equal(fifo.status, 1); assert.match(fifo.stderr, /integrity/); await rm(path);
    await writeFile(path, Buffer.alloc(2 * 1024 * 1024 + 1));
    await assert.rejects(readLegacyIncidentEvidence(input), /integrity/); await writeFile(path, bytes);
    const rebuild = spawnSync(process.execPath, [script, '--rebuild-from-v2', input, '--output', join(root, 'new')], { timeout: 3000, encoding: 'utf8' });
    assert.equal(rebuild.status, 0, rebuild.stderr); assert.equal(JSON.parse(rebuild.stdout).qualification, 'unmeasured');
    assert.equal(await readFile(path, 'utf8'), bytes); assert.equal(await readFile(target, 'utf8'), bytes);
    assert.equal((await readIncidentEvidence(join(root, 'new'))).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('native selection orders attempts within each run before comparing separate runs', () => {
  const result = qualify(r => {
    const failed = withAttempt(structuredClone(r.proof.native[0]), 3, 'failure');
    failed.completedAt = '2026-10-25T08:00:00.000Z';
    const stale = withAttempt(structuredClone(r.proof.native[0]), 1);
    stale.completedAt = '2026-10-25T10:00:00.000Z';
    const olderRun = structuredClone(stale); olderRun.runId = 299; olderRun.completedAt = '2026-10-25T07:00:00.000Z';
    for (const job of olderRun.jobs) job.runId = 299;
    r.proof.native = [failed, stale, olderRun, r.proof.native[1]];
  });
  assert.equal(result.proposal, 'not-qualified');
});

test('protected obligations are bound to the intended base branch', () => {
  const { record, contract } = fixture();
  const wrongBranch = { ...source, branch: 'main' };
  const wrongRecord = structuredClone(record); wrongRecord.source = wrongBranch;
  wrongRecord.proof.repairPr.baseBranch = 'main';
  wrongRecord.proof.native[1].branch = 'main';
  assert.equal(qualifyIncident(wrongBranch, [sealIncidentEvidence(wrongRecord)], contract).proposal, 'unmeasured');
  assert.equal(qualify().proposal, 'qualified');
  assert.equal(qualify((_r, c) => { c.baseBranch = 'main'; }).proposal, 'unmeasured');
  assert.equal(qualify((_r, c) => { delete c.baseBranch; }).proposal, 'unmeasured');
});

function republished(record) {
  const next = structuredClone(record); next.observedAt = '2026-10-26T09:00:00.000Z';
  next.proof.monitor.attempt = 2; next.proof.monitor.completedAt = '2026-10-26T08:00:00.000Z';
  next.proof.monitor.publication.headSha = sha('f'); next.proof.repairPr.headSha = sha('f');
  next.proof.repairPr.merged = false; next.proof.repairPr.integrationSha = null;
  next.proof.native = [next.proof.native[0]]; next.proof.native[0].headSha = sha('f');
  next.proof.native[0].mergeParents[1] = sha('f'); next.proof.native[0].conclusion = 'failure';
  return next;
}
test('stale publication receipts cannot restore an old head after a newer monitor attempt', () => {
  const { record, contract } = fixture(), next = republished(record), stale = structuredClone(record);
  stale.observedAt = '2026-10-27T09:00:00.000Z';
  // Even an inconsistent later completion clock cannot outrank the monitor attempt.
  stale.proof.monitor.completedAt = '2026-10-27T08:00:00.000Z';
  assert.equal(qualifyIncident(source, [record, sealIncidentEvidence(next), sealIncidentEvidence(stale)], contract).proposal, 'not-qualified');
});
test('different monitor runs use completion order rather than collection order', () => {
  const { record, contract } = fixture(), next = republished(record), stale = structuredClone(record);
  next.proof.monitor.runId = 201; next.proof.monitor.attempt = 1;
  stale.observedAt = '2026-10-27T09:00:00.000Z';
  assert.equal(qualifyIncident(source, [record, sealIncidentEvidence(next), sealIncidentEvidence(stale)], contract).proposal, 'not-qualified');
});
test('publication ordering requires a valid completion instant no later than observation', () => {
  for (const value of [undefined, 'not-a-date', '2026-10-26T08:00:00.000Z']) {
    const result = qualify(r => { r.proof.monitor.completedAt = value; });
    assert.equal(result.proposal, 'unmeasured'); assert.equal(result.integration, 'unmeasured');
  }
});
test('conflicting publications at the same monitor attempt or tied different-run completion are ambiguous', () => {
  for (const differentRun of [false, true]) {
    const { record, contract } = fixture(), next = republished(record);
    next.proof.monitor.runId = differentRun ? 201 : record.proof.monitor.runId;
    next.proof.monitor.attempt = 1; next.proof.monitor.completedAt = record.proof.monitor.completedAt;
    for (const observations of [[record, sealIncidentEvidence(next)], [sealIncidentEvidence(next), record]]) {
      const result = qualifyIncident(source, observations, contract);
      assert.equal(result.proposal, 'unmeasured'); assert.equal(result.integration, 'unmeasured');
      assert.ok(result.reasons.includes('publication-order-ambiguous'));
      assert.deepEqual(result.proofDigests, []);
    }
  }
});
test('an unordered competing publication cannot inherit earlier qualified proof', () => {
  const { record, contract } = fixture(), next = republished(record); delete next.proof.monitor.completedAt;
  const result = qualifyIncident(source, [record, sealIncidentEvidence(next)], contract);
  assert.equal(result.proposal, 'unmeasured'); assert.equal(result.integration, 'unmeasured');
});

test('an unordered receipt of the same publication preserves history but marks current coverage incomplete', () => {
  const { record, contract } = fixture(), later = structuredClone(record);
  later.observedAt = '2026-10-26T09:00:00.000Z'; delete later.proof.monitor.completedAt;
  const result = qualifyIncident(source, [record, sealIncidentEvidence(later)], contract);
  assert.equal(result.proposal, 'qualified'); assert.equal(result.integration, 'qualified');
  assert.equal(result.currentScanComplete, false);
});
