import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNativeReceipt } from './fleet-native-receipt.mjs';
const sha = letter => letter.repeat(40);
const input = { repository: 'example/project', runId: 3, attempt: 2, policySha: sha('a'), policyPath: '.github/native-policy.json',
  run: { id: 3, run_attempt: 2, head_sha: sha('b'), workflow_id: 4, path: '.github/workflows/ci.yml', event: 'push', repository: { id: 1 }, head_repository: { id: 1 } },
  workflowBlobSha: sha('c'), policy: { schemaVersion: 'sutura-native-policy-v1', obligations: {
    schemaVersion: 'sutura-native-verification-v1', repositoryId: 1, baseBranch: 'develop', protected: true, fullRequired: true,
    stages: { proposal: { event: 'pull_request', branchRole: 'repair-head', requiredJobs: [{ workflowId: 4, jobKey: 'test' }] }, integration: { event: 'push', branchRole: 'base', requiredJobs: [{ workflowId: 4, jobKey: 'test' }] } } },
    receiptProducers: [{ kind: 'native', workflowId: 4, path: '.github/workflows/ci.yml', blobSha: sha('c') }] },
  jobs: [{ id: 5, name: 'test', run_id: 3, run_attempt: 2, head_sha: sha('b'), status: 'completed', conclusion: 'failure' }],
  checkouts: [{ schemaVersion: 'sutura-native-checkout-v1', runId: 3, attempt: 2, jobKey: 'test', testedSha: sha('b') }] };
test('binds actual pre-test checkout and protected producer, retaining failed native evidence', () => {
  const receipt = buildNativeReceipt(input);
  assert.equal(receipt.testedSha, sha('b')); assert.equal(receipt.jobs[0].jobId, 5);
  assert.equal(receipt.schemaVersion, 'sutura-native-receipt-v1'); assert.match(receipt.policyDigest, /^[a-f0-9]{64}$/);
});
for (const [name, mutate] of [
  ['missing checkout', x => { x.checkouts = []; }], ['duplicate checkout', x => { x.checkouts.push(x.checkouts[0]); }],
  ['wrong attempt', x => { x.checkouts[0].attempt = 1; }], ['wrong job identity', x => { x.jobs[0].head_sha = sha('d'); }],
  ['untrusted producer bytes', x => { x.workflowBlobSha = sha('d'); }],
]) test(`refuses ${name}`, () => { const changed = structuredClone(input); mutate(changed); assert.throws(() => buildNativeReceipt(changed)); });

// Exercise the real CLI with a local fake gh executable; no network or credentials.
import { execFile as callbackExecFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
const execFile = promisify(callbackExecFile);
async function cliFixture(operation, { policyContent, policySize, swap = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'sutura-native-receipt-'));
  try {
    const directory = join(root, 'checkout'); await mkdir(directory);
    const checkout = join(directory, 'test.json'), outside = join(root, 'outside.json');
    await writeFile(checkout, JSON.stringify(input.checkouts[0]));
    await writeFile(outside, JSON.stringify({ ...input.checkouts[0], testedSha: sha('d') }));
    const policy = policyContent ?? JSON.stringify(input.policy);
    const responses = {
      'actions/runs/3/attempts/2': { ...input.run, repository: { id: 1, full_name: input.repository } },
      'commits/refs%2Fheads%2Fdevelop': { sha: input.policySha },
      [`contents/.github/native-policy.json?ref=${input.policySha}`]: { type: 'file', encoding: 'base64', size: policySize ?? Buffer.byteLength(policy), content: Buffer.from(policy).toString('base64') },
      [`contents/.github/workflows/ci.yml?ref=${input.run.head_sha}`]: { sha: input.workflowBlobSha },
      'actions/runs/3/attempts/2/jobs?per_page=100&page=1': { total_count: 1, jobs: input.jobs },
    };
    const responsePath = join(root, 'responses.json'); await writeFile(responsePath, JSON.stringify(responses));
    await writeFile(join(root, 'gh'), `#!${process.execPath}\nconst fs = require('node:fs'); const data = JSON.parse(fs.readFileSync(process.env.RECEIPT_TEST_RESPONSES, 'utf8')); const key = process.argv[3].replace('repos/example/project/', ''); if (!Object.hasOwn(data,key)) process.exit(2); process.stdout.write(JSON.stringify(data[key]));\n`, { mode: 0o700 });
    const shim = join(root, 'swap.mjs');
    await writeFile(shim, `import fs from 'node:fs/promises';\nimport { syncBuiltinESMExports } from 'node:module';\nconst originalStat = fs.lstat, originalOpen = fs.open; let swapped = false;\nasync function swap(path) { if (!swapped && path === process.env.RECEIPT_TEST_CHECKOUT) { swapped = true; await fs.unlink(path); await fs.symlink(process.env.RECEIPT_TEST_OUTSIDE, path); } }\nfs.lstat = async (...args) => { const result = await originalStat(...args); await swap(args[0]); return result; };\nfs.open = async (...args) => { const result = await originalOpen(...args); await swap(args[0]); return result; };\nsyncBuiltinESMExports();\n`);
    let result;
    try {
      const output = await execFile(process.execPath, [...(swap ? ['--import', shim] : []), resolve('scripts/fleet-native-receipt.mjs'), input.repository, '3', '2', 'refs/heads/develop', directory],
        { timeout: 5000, maxBuffer: 3 * 1024 * 1024, env: { ...process.env, PATH: `${root}:${process.env.PATH}`, RECEIPT_TEST_RESPONSES: responsePath, RECEIPT_TEST_CHECKOUT: checkout, RECEIPT_TEST_OUTSIDE: outside } });
      result = { exit: 0, ...output };
    } catch (error) { result = { exit: error.code, stdout: error.stdout, stderr: error.stderr }; }
    await operation(result);
  } finally { await rm(root, { recursive: true, force: true }); }
}
test('CLI refuses actual decoded policy beyond the declared 1 MiB bound', async () => {
  const policyContent = JSON.stringify({ ...input.policy, padding: 'x'.repeat(1_048_576) });
  await cliFixture(result => assert.notEqual(result.exit, 0), { policyContent, policySize: 1 });
});
test('CLI requires the decoded policy byte count to equal authenticated size metadata', async () => {
  await cliFixture(result => assert.notEqual(result.exit, 0), { policySize: 1 });
});
test('CLI descriptor read cannot be redirected by a pathname swap after metadata lookup or open', async () => {
  await cliFixture(result => {
    assert.equal(result.exit, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).testedSha, input.checkouts[0].testedSha);
  }, { swap: true });
});
for (const [name, mutate] of [
  ['nonpositive repository ID', value => { value.run.repository.id = 0; value.run.head_repository.id = 0; value.policy.obligations.repositoryId = 0; }],
  ['nonpositive workflow ID', value => { value.run.workflow_id = 0; value.policy.receiptProducers[0].workflowId = 0; for (const stage of Object.values(value.policy.obligations.stages)) stage.requiredJobs[0].workflowId = 0; }],
]) test(`refuses ${name}`, () => { const changed = structuredClone(input); mutate(changed); assert.throws(() => buildNativeReceipt(changed)); });
