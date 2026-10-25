import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { collectNativeVerification } from './fleet-native-verification.mjs';
import { GhFleetClient } from './fleet-dogfood-metrics.mjs';
import { verificationContractDigest, qualifyIncident, sealIncidentEvidence } from './fleet-incident-evidence.mjs';
const sha = c => c.repeat(40);
const diffFiles = [{ filename: 'src/fix.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+fixed' }];
const digest = createHash('sha256').update(JSON.stringify(diffFiles)).digest('hex');
function fixture() {
  const repository = 'example/project';
  const source = { id: 100, attempt: 2, repositoryId: 42, workflowId: 10, branch: 'develop', headSha: sha('a'), createdAt: '2026-10-24T08:00:00Z' };
  const monitor = { id: 200, runAttempt: 1, outcome: 'fixed', sourceRunId: '100', sourceCommit: sha('a'), actionSha: sha('b') };
  const repairPr = { number: 5 };
  const jobs = [{ workflowId: 10, jobKey: 'test (22)' }, { workflowId: 10, jobKey: 'test (24)' }, { workflowId: 11, jobKey: 'lint' }];
  const contract = { schemaVersion: 'sutura-native-verification-v1', repositoryId: 42, protected: true, fullRequired: true, baseBranch: 'develop',
    policySource: { repositoryId: 42, ref: 'refs/heads/develop', sha: sha('b'), path: '.github/native-policy.json' },
    stages: { proposal: { event: 'pull_request', branchRole: 'repair-head', requiredJobs: jobs }, integration: { event: 'push', branchRole: 'base', requiredJobs: jobs } } };
  contract.policyDigest = verificationContractDigest(contract);
  const workflow = id => `.github/workflows/${id}.yml`;
  const content = text => ({ type: 'file', encoding: 'base64', size: Buffer.byteLength(text), content: Buffer.from(text).toString('base64'),
    sha: createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0${text}`).digest('hex') });
  const workflowContent = content('name: Protected receipt producer\n');
  const policy = { schemaVersion: 'sutura-native-policy-v1', obligations: { ...contract },
    receiptProducers: [20, 10, 11].map(id => ({ workflowId: id, kind: id === 20 ? 'publication' : 'native', path: workflow(id), blobSha: workflowContent.sha, ...(id === 20 ? { actionSha: sha('b') } : {}) })) };
  delete policy.obligations.policySource; delete policy.obligations.policyDigest;
  const run = (id, workflowId, headSha, branch, event) => ({ id, workflow_id: workflowId, repository: { id: 42 }, head_repository: { id: 42 }, run_attempt: 1,
    head_sha: headSha, head_branch: branch, event, status: 'completed', conclusion: 'success', updated_at: '2026-10-25T08:00:00Z', path: workflow(workflowId) });
  const runs = [run(300, 10, sha('c'), 'sutura/fix-100', 'pull_request'), run(301, 11, sha('c'), 'sutura/fix-100', 'pull_request'),
    run(400, 10, sha('e'), 'develop', 'push'), run(401, 11, sha('e'), 'develop', 'push')];
  const monitorRun = run(200, 20, sha('b'), 'develop', 'workflow_run');
  const publication = { schemaVersion: 'sutura-publication-receipt-v1', complete: true, repositoryId: 42, runId: 200, attempt: 1, workflowId: 20,
    workflowBlobSha: workflowContent.sha, source: { runId: 100, attempt: 2, sha: sha('a'), workflowId: 10, branch: 'develop' },
    actionSha: sha('b'), outcome: 'fixed', publication: { prNumber: 5, headSha: sha('c'), diffDigest: digest } };
  const receipts = new Map([[200, publication]]), jobMap = new Map();
  for (const r of runs) {
    const runJobs = jobs.filter(j => j.workflowId === r.workflow_id).map((j, i) => ({ id: r.id * 10 + i, name: j.jobKey, run_id: r.id, run_attempt: 1, head_sha: r.head_sha, status: 'completed', conclusion: 'success' }));
    jobMap.set(r.id, runJobs);
    receipts.set(r.id, { schemaVersion: 'sutura-native-receipt-v1', complete: true, repositoryId: 42, runId: r.id, attempt: 1, workflowId: r.workflow_id,
      workflowBlobSha: workflowContent.sha, headSha: r.head_sha, testedSha: r.event === 'pull_request' ? sha('f') : sha('e'),
      policyDigest: contract.policyDigest, policySourceSha: sha('b'), jobs: runJobs.map(j => ({ jobId: j.id, jobKey: j.name, testedSha: r.event === 'pull_request' ? sha('f') : sha('e') })) });
  }
  const artifacts = new Map([monitorRun, ...runs].map(r => [r.id, [{ id: r.id, name: `sutura-${r.id === 200 ? 'publication' : 'native'}-v1-${r.id}-1`, expired: false, size_in_bytes: 2000,
    workflow_run: { id: r.id, repository_id: 42, head_repository_id: 42, head_sha: r.head_sha } }]]));
  const calls = [], api = async path => {
    calls.push(path); const suffix = path.replace(`repos/${repository}`, '');
    if (suffix === '') return { id: 42 };
    if (suffix === '/branches/develop') return { protected: true, commit: { sha: sha('b') } };
    if (suffix.startsWith('/contents/.github/native-policy.json?')) return content(JSON.stringify(policy));
    if (suffix.startsWith('/contents/.github/workflows/')) return workflowContent;
    if (suffix.startsWith('/compare/')) return { status: 'ahead', behind_by: 0, base_commit: { sha: sha('b') }, merge_base_commit: { sha: sha('b') } };
    let m;
    if ((m = /^\/actions\/runs\/(\d+)\/artifacts\?per_page=100&page=(\d+)$/.exec(suffix))) {
      const all = artifacts.get(Number(m[1])) ?? [];
      return { total_count: all.length, artifacts: all.slice((Number(m[2]) - 1) * 100, Number(m[2]) * 100) };
    }
    if ((m = /^\/actions\/workflows\/(\d+)\/runs\?/.exec(suffix))) {
      const params = new URLSearchParams(suffix.split('?')[1]);
      const selected = runs.filter(r => r.workflow_id === Number(m[1]) && r.head_sha === params.get('head_sha') && r.head_branch === params.get('branch') && r.event === params.get('event'));
      const latest = new Map();
      for (const run of selected) if (!latest.has(run.id) || latest.get(run.id).run_attempt < run.run_attempt) latest.set(run.id, run);
      return { total_count: latest.size, workflow_runs: [...latest.values()] };
    }
    if ((m = /^\/actions\/workflows\/(\d+)$/.exec(suffix))) return { id: Number(m[1]), path: workflow(Number(m[1])) };
    if ((m = /^\/actions\/runs\/(\d+)\/attempts\/(\d+)$/.exec(suffix))) {
      if (Number(m[1]) === 100) return { ...run(100, 10, sha('a'), 'develop', 'push'), run_attempt: 2 };
      return structuredClone([monitorRun, ...runs].find(r => r.id === Number(m[1]) && r.run_attempt === Number(m[2])));
    }
    if ((m = /^\/actions\/runs\/(\d+)\/attempts\/(\d+)\/jobs\?per_page=100&page=(\d+)$/.exec(suffix))) { const jobs_ = jobMap.get(`${m[1]}:${m[2]}`) ?? jobMap.get(Number(m[1])); return { total_count: jobs_.length, jobs: jobs_ }; }
    if (suffix === '/pulls/5/files?per_page=100&page=1') return diffFiles;
    if (suffix === '/pulls/5') return { number: 5, head: { sha: sha('c'), ref: 'sutura/fix-100', repo: { id: 42 } }, base: { sha: sha('b'), ref: 'develop', repo: { id: 42 } }, merged: true, merge_commit_sha: sha('e') };
    if (suffix === `/commits/${sha('c')}`) return { sha: sha('c'), parents: [{ sha: sha('a') }] };
    if (suffix === `/commits/${sha('f')}`) return { sha: sha('f'), parents: [{ sha: sha('b') }, { sha: sha('c') }] };
    throw new Error(`unexpected API ${path}`);
  };
  const client = { api, async listCiRuns() { throw new Error('Unbounded helper must not be used'); },
    async listArtifacts() { throw new Error('Unbounded helper must not be used'); },
    async downloadArtifact(_repository, runId, artifact) { const attempt = artifact.name.split('-').at(-1); return JSON.stringify(receipts.get(`${runId}:${attempt}`) ?? receipts.get(runId)); } };
  return { input: { client, repository, source, monitor, repairPr, contract }, calls, runs, receipts, artifacts, jobMap, policy, monitorRun };
}
test('collects every explicit workflow and matrix child and qualifies only independently checked receipts', async () => {
  const f = fixture(), client = new GhFleetClient('example');
  client.api = f.input.client.api;
  client.downloadArtifact = f.input.client.downloadArtifact;
  const result = await client.collectNativeVerification(f.input.repository, f.input.source, f.input.monitor, f.input.repairPr, f.input.contract);
  assert.equal(result.complete, true, JSON.stringify(result.requiredInput)); assert.equal(result.proof.native.length, 4);
  assert.equal(result.proof.repairPr.sourceAttempt, 2);
  const source = { repositoryId: 42, sourceRunId: 100, sourceAttempt: 2, sourceSha: sha('a'), workflowId: 10, branch: 'develop' };
  const record = sealIncidentEvidence({ schemaVersion: 'sutura-incident-evidence-v1', source, observedAt: '2026-10-25T09:00:00.000Z', classificationRevision: 'v1',
    policyDigest: f.input.contract.policyDigest, completeness: { collection: true, source: true, native: true, logs: false }, proof: result.proof });
  assert.equal(qualifyIncident(source, [record], f.input.contract).integration, 'qualified');
  assert.equal(f.calls.some(path => path.includes('/logs')), false);
});
test('missing publication producer stays unmeasured and transitions when the receipt arrives', async () => {
  const f = fixture(), saved = f.artifacts.get(200); f.artifacts.set(200, []);
  const missing = await collectNativeVerification(f.input); assert.equal(missing.complete, false); assert.deepEqual(missing.proof, {});
  assert.ok(missing.requiredInput.includes('publication-receipt-unavailable'));
  f.artifacts.set(200, saved); assert.equal((await collectNativeVerification(f.input)).complete, true);
});
for (const [name, mutate] of [
  ['invalid monitor calendar timestamp', f => { f.monitorRun.updated_at = '2026-02-30T08:00:00Z'; }],
  ['missing native capture completeness', f => { f.receipts.get(300).complete = false; }],
  ['wrong publication source attempt', f => { f.receipts.get(200).source.attempt = 1; }],
  ['wrong artifact repository', f => { f.artifacts.get(300)[0].workflow_run.repository_id = 43; }],
  ['wrong artifact head', f => { f.artifacts.get(300)[0].workflow_run.head_sha = sha('a'); }],
  ['wrong native attempt', f => { f.receipts.get(300).attempt = 2; }],
  ['missing matrix job', f => { f.receipts.get(300).jobs.pop(); }],
  ['wrong API job', f => { f.jobMap.get(300)[0].run_attempt = 2; }],
  ['wrong tested SHA', f => { f.receipts.get(300).testedSha = sha('a'); }],
  ['wrong policy', f => { f.receipts.get(300).policySourceSha = sha('a'); }],
  ['untrusted producer', f => { f.receipts.get(300).workflowBlobSha = sha('a'); }],
  ['oversized artifact', f => { f.artifacts.get(300)[0].size_in_bytes = 2_000_000; }],
  ['unknown policy producer', f => { f.policy.receiptProducers = []; }],
  ['incomplete run inventory', f => { const api = f.input.client.api; f.input.client.api = async path => path.includes('/runs?') ? { workflow_runs: [] } : api(path); }],
]) test(name, async () => { const f = fixture(); mutate(f); assert.equal((await collectNativeVerification(f.input)).complete, false); });
test('failed native child remains contradictory evidence instead of a fabricated success', async () => {
  const f = fixture(); f.jobMap.get(300)[0].conclusion = 'failure';
  const result = await collectNativeVerification(f.input); assert.equal(result.complete, true);
  assert.equal(result.proof.native.find(r => r.runId === 300).jobs[0].conclusion, 'failure');
});

test('collects every matching attempt without replacing it with the latest run object', async () => {
  const f = fixture(), original = f.runs[0];
  f.runs.push({ ...original, run_attempt: 2 });
  f.jobMap.set('300:2', f.jobMap.get(300).map(job => ({ ...job, run_attempt: 2 })));
  f.receipts.set('300:2', { ...structuredClone(f.receipts.get(300)), attempt: 2 });
  f.artifacts.get(300).push({ ...structuredClone(f.artifacts.get(300)[0]), id: 900, name: 'sutura-native-v1-300-2' });
  const result = await collectNativeVerification(f.input);
  assert.equal(result.complete, true, JSON.stringify(result.requiredInput));
  assert.deepEqual(result.proof.native.filter(run => run.runId === 300).map(run => run.attempt), [1, 2]);
});
test('truncated job pagination cannot be promoted by a complete producer receipt', async () => {
  const f = fixture(), api = f.input.client.api;
  f.input.client.api = async path => { const result = await api(path); return path.includes('/300/attempts/1/jobs?') ? { ...result, total_count: 3 } : result; };
  const result = await collectNativeVerification(f.input); assert.equal(result.complete, false);
  assert.ok(result.requiredInput.includes('native-jobs-truncated'));
});
test('bounded receipt reader rejects excessive expanded contents and action pin mismatch', async () => {
  for (const mutate of [f => { f.input.client.downloadArtifact = async () => 'x'.repeat(1_048_577); },
    f => { f.receipts.get(200).actionSha = sha('a'); }]) {
    const f = fixture(); mutate(f); assert.equal((await collectNativeVerification(f.input)).complete, false);
  }
});

test('unprotected refs and changed producer workflow bytes remain unmeasured', async () => {
  for (const mode of ['unprotected', 'changed']) {
    const f = fixture(), api = f.input.client.api;
    f.input.client.api = async path => {
      const value = await api(path);
      if (mode === 'unprotected' && path.includes('/branches/')) return { ...value, protected: false };
      if (mode === 'changed' && path.includes('/contents/.github/workflows/') && path.includes(sha('c'))) return { ...value, sha: sha('a') };
      return value;
    };
    assert.equal((await collectNativeVerification(f.input)).complete, false);
  }
});

test('unchanged enrolled policy survives unrelated advances on its protected branch', async () => {
  const f = fixture(), api = f.input.client.api;
  f.input.client.api = async path => { const result = await api(path); return path.includes('/branches/') ? { ...result, commit: { sha: sha('e') } } : result; };
  const result = await collectNativeVerification(f.input);
  assert.equal(result.complete, true, JSON.stringify(result.requiredInput));
  assert.equal(result.proof.policyProvenance.observedTipSha, sha('e'));
  assert.equal(result.proof.policyProvenance.policySourceSha, sha('b'));
  assert.equal(result.proof.policyProvenance.mergeBaseSha, sha('b'));
});
test('ancestry never blesses a changed policy, rewritten history or wrong merge base', async () => {
  for (const mode of ['policy-changed', 'diverged', 'wrong-base']) {
    const f = fixture(), api = f.input.client.api;
    f.input.client.api = async path => {
      const value = await api(path);
      if (path.includes('/branches/')) return { ...value, commit: { sha: sha('e') } };
      if (path.includes('/compare/')) return mode === 'diverged' ? { ...value, status: 'diverged', behind_by: 1 } : mode === 'wrong-base' ? { ...value, merge_base_commit: { sha: sha('a') } } : value;
      if (mode === 'policy-changed' && path.includes('/contents/.github/native-policy.json?') && path.includes(sha('e'))) {
        const text = JSON.stringify({ ...f.policy, receiptProducers: [] });
        return { type: 'file', encoding: 'base64', size: Buffer.byteLength(text), content: Buffer.from(text).toString('base64'),
          sha: createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0${text}`).digest('hex') };
      }
      return value;
    };
    assert.equal((await collectNativeVerification(f.input)).complete, false);
  }
});
test('bounded explicit inventory rejects run/artifact caps before expanding hidden pages', async () => {
  for (const kind of ['runs', 'artifacts']) {
    const f = fixture(), api = f.input.client.api;
    f.input.client.api = async path => path.includes(`/${kind}?`) ? { total_count: 1001, [kind === 'runs' ? 'workflow_runs' : 'artifacts']: [] } : api(path);
    const result = await collectNativeVerification(f.input); assert.equal(result.complete, false);
    assert.ok(f.calls.length < 30);
  }
});
test('exposes counted explicit API operations and bounded artifact downloads', async () => {
  const f = fixture(), result = await collectNativeVerification(f.input);
  assert.equal(result.complete, true); assert.equal(result.operations.api, f.calls.length);
  assert.equal(result.operations.artifactDownloads, 5); assert.ok(result.operations.api + result.operations.artifactDownloads <= result.operations.limit);
  const inventory = f.calls.filter(path => path.includes('/runs?'));
  assert.equal(inventory.length, 4); assert.ok(inventory.every(path => path.includes('head_sha=') && path.includes('event=') && path.includes('branch=') && path.includes('page=1')));
});
