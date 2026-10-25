import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateFleetDigest } from './fleet-digest-worker.mjs';
import { readDigestSnapshot } from './fleet-digest-email.mjs';
import { digest } from './fleet-incident-queue.mjs';
import { persistIncidentEvidence, sealIncidentEvidence, verificationContractDigest } from './fleet-incident-evidence.mjs';
const startedAt = '2026-10-19T00:00:00.000Z', observedAt = '2026-10-25T12:00:00.000Z';
const hash = letter => letter.repeat(64), sha = letter => letter.repeat(40);
async function fixture(t) {
  const output = await mkdtemp(join(tmpdir(), 'sutura-worker-')); t.after(() => rm(output, { recursive: true, force: true }));
  const contract = { schemaVersion: 'sutura-native-verification-v1', repositoryId: 1, protected: true, fullRequired: true, baseBranch: 'develop',
    policySource: { repositoryId: 1, ref: 'refs/heads/develop', sha: sha('b'), path: '.github/native-policy.json' },
    stages: { proposal: { event: 'pull_request', branchRole: 'repair-head', requiredJobs: [{ workflowId: 2, jobKey: 'test' }] }, integration: { event: 'push', branchRole: 'base', requiredJobs: [{ workflowId: 2, jobKey: 'test' }] } } };
  contract.policyDigest = verificationContractDigest(contract);
  const config = { owner: 'example', repositories: ['example/private'], startedAt, verificationContracts: { 1: contract } };
  const incidents = [3, 4].map(id => ({ schemaVersion: 'sutura-fleet-incident-v2', repositoryId: 1, workflowId: 2, sourceRunId: id, sourceAttempt: 1, sourceSha: sha('a'), branch: 'develop', sourceCompletedAt: '2026-10-24T12:00:00.000Z', sourceRunUrl: `https://github.com/example/private/actions/runs/${id}` }));
  const write = (name, value) => writeFile(join(output, name), JSON.stringify(value));
  await write('config.json', config);
  await write('scope-v2.json', { startedAt, repositories: [{ repository: 'example/private', repositoryId: 1, workflowIds: [2] }] });
  await write('installations-v2.json', [{ repository: 'example/private', repositoryId: 1, state: 'active', inventoryComplete: true, actionShas: [sha('b')], workflows: [{ id: 2 }] }]);
  await write('post-windows-v2.json', [{ repository: 'example/private', workflowId: 2, startedAt, endedAt: observedAt, completedRuns: 8 }]);
  await write('qualifications-v1.json', incidents.map(item => ({ incidentKey: `1:${item.sourceRunId}:1`, integration: 'unmeasured', proofDigests: [] })));
  await write('recovery-summary.json', { observedAt, coverage: { complete: true, sourceDetailGaps: 0 } });
  await writeFile(join(output, 'incidents-v2.jsonl'), incidents.map(item => JSON.stringify(item)).join('\n')+'\n');
  const record = (index, override = {}) => sealIncidentEvidence({ schemaVersion: 'sutura-incident-evidence-v1', source: Object.fromEntries(['repositoryId','workflowId','sourceRunId','sourceAttempt','sourceSha','branch'].map(key => [key, incidents[index][key]])), observedAt,
    trigger: { event: 'push', actorId: 7, triggeringActorId: 7, authenticated: true }, classificationRevision: 'sutura-incident-classification-v1',
    classification: { schemaVersion: 'sutura-incident-classification-v1', cause: 'source-defect', ownerDomain: 'repository', confidence: 'confirmed' }, policyDigest: contract.policyDigest,
    completeness: { collection: true, source: true, logs: true, native: false }, proof: {},
    sourceEvidence: { complete: true, log: { truncated: false }, reproduction: 'unmeasured', failureIdentity: { version: 'sutura-failure-identity-v1', status: 'matched', nativeFingerprint: hash('c') } }, ...override });
  const append = value => persistIncidentEvidence(join(output, 'incident-evidence-v1'), value);
  const run = () => evaluateFleetDigest({ output, configPath: join(output,'config.json'), collectionFailed: false });
  const queue = async () => (await readDigestSnapshot(join(output,'weekly-digest'), digest({ owner: config.owner, repositories: config.repositories, startedAt }))).queue;
  const read = async name => JSON.parse(await readFile(join(output,name),'utf8'));
  return { output, write, read, incidents, record, append, run, queue };
}
test('normal locked local worker groups classified recurrence and writes private plus whitelisted public field reports', async t => {
  const f = await fixture(t); await f.append(f.record(0)); await f.append(f.record(1)); await f.run();
  const queue = await f.queue(); assert.equal(queue.groups.length, 1); assert.equal(queue.groups[0].identity,'known'); assert.equal(queue.incidents,2);
  const report = await f.read('field-report-v1.json'), publicReport = await f.read('field-report-public-v1.json');
  assert.equal(report.confirmedCauseBuckets['source-defect'],2); assert.equal(report.installations[0].ciOpportunities,8);
  assert.equal(report.qualifiedIntegratedRecoveries,0); assert.equal(publicReport.failedAttempts,2);
  assert.doesNotMatch(JSON.stringify(publicReport),/example\/private|repositoryId|sourceRunId|nativeFingerprint/);
});
test('missing companion evidence retains each exact incident as unknown and emits an incomplete field report', async t => {
  const f=await fixture(t); await f.run();
  const queue=await f.queue(); assert.equal(queue.groups.length,2); assert.ok(queue.groups.every(item=>item.identity==='unknown'));
  assert.equal(queue.scan_complete,false);
  assert.equal((await f.read('field-report-v1.json')).confirmedCauseBuckets.unknown,2);
});
test('latest incomplete evidence and equal-time conflicting identity do not resurrect older classification', async t => {
  const f=await fixture(t);
  await f.append(f.record(0,{observedAt:'2026-10-25T11:00:00.000Z'}));
  await f.append(f.record(0,{classification:null,completeness:{collection:true,source:true,logs:false,native:false}}));
  await f.append(f.record(1));
  const changed=f.record(1); changed.sourceEvidence.failureIdentity.nativeFingerprint=hash('d'); await f.append(sealIncidentEvidence(changed));
  await f.run(); const queue=await f.queue(); assert.ok(queue.groups.every(item=>item.identity==='unknown'));
  assert.equal((await f.read('field-report-v1.json')).confirmedCauseBuckets.unknown,2);
});
test('missing required projection inputs preserves last-good snapshot instead of publishing partial replacement', async t => {
  const f=await fixture(t); await f.append(f.record(0)); await f.append(f.record(1)); await f.run();
  const before=await f.queue(); await rm(join(f.output,'installations-v2.json'));
  await f.write('recovery-summary.json',{observedAt:'2026-10-25T13:00:00.000Z',coverage:{complete:true,sourceDetailGaps:0}}); await f.run();
  assert.deepEqual(await f.queue(),before);
});
test('scope drift and mismatched source identity cannot publish an expanded digest', async t => {
  const f=await fixture(t); await f.append(f.record(0)); await f.append(f.record(1)); await f.run(); const before=await f.queue();
  await f.write('scope-v2.json',{startedAt,repositories:[{repository:'other/private',repositoryId:1,workflowIds:[2]}]});
  await f.write('recovery-summary.json',{observedAt:'2026-10-25T13:00:00.000Z',coverage:{complete:true,sourceDetailGaps:0}});
  await f.run(); assert.deepEqual(await f.queue(),before);
});

test('conflicting companion source cannot replace a valid scoped snapshot', async t => {
  const f=await fixture(t); await f.append(f.record(0)); await f.append(f.record(1)); await f.run(); const before=await f.queue();
  const wrong=f.record(0); wrong.source.sourceSha=sha('d'); await f.append(sealIncidentEvidence(wrong));
  await f.write('recovery-summary.json',{observedAt:'2026-10-25T13:00:00.000Z',coverage:{complete:true,sourceDetailGaps:0}});
  await f.run(); assert.deepEqual(await f.queue(),before);
});
