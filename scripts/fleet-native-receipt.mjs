import { execFile as callbackExecFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { readdir, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { verificationContractDigest } from './fleet-incident-evidence.mjs';
const execFile = promisify(callbackExecFile), SHA = /^[a-f0-9]{40}$/u;
const requireFact = (value, reason) => { if (!value) throw new Error(`Native receipt refused: ${reason}`); };
/** Invoked only by a reviewed isolated producer, consuming immutable pre-verification checkout artifacts. */
export function buildNativeReceipt({ repository, runId, attempt, policySha, policyPath, run, workflowBlobSha, policy, jobs, checkouts }) {
  requireFact(/^[\w.-]+\/[\w.-]+$/u.test(repository) && Number.isSafeInteger(runId) && runId > 0 && Number.isSafeInteger(attempt) && attempt > 0 && SHA.test(policySha) && policyPath === '.github/native-policy.json', 'scope');
  requireFact(run.id === runId && run.run_attempt === attempt && SHA.test(run.head_sha) && run.repository?.id === run.head_repository?.id && Number.isSafeInteger(run.repository?.id) && run.repository.id > 0 && Number.isSafeInteger(run.workflow_id) && run.workflow_id > 0, 'run identity');
  const obligations = policy?.obligations;
  requireFact(policy?.schemaVersion === 'sutura-native-policy-v1' && obligations?.repositoryId === run.repository.id && obligations.protected === true && obligations.fullRequired === true, 'protected obligations');
  const enrolled = policy.receiptProducers?.filter(item => item.kind === 'native' && item.workflowId === run.workflow_id);
  requireFact(enrolled?.length === 1 && enrolled[0].path === run.path?.split('@')[0] && enrolled[0].blobSha === workflowBlobSha && SHA.test(workflowBlobSha), 'producer identity');
  const stage = run.event === 'push' ? obligations.stages.integration : run.event === 'pull_request' ? obligations.stages.proposal : null;
  requireFact(stage?.event === run.event && Array.isArray(stage.requiredJobs), 'event obligations');
  const required = stage.requiredJobs.filter(job => job.workflowId === run.workflow_id);
  requireFact(required.length > 0 && required.length <= 256 && new Set(required.map(job => job.jobKey)).size === required.length, 'job inventory');
  requireFact(Array.isArray(jobs) && jobs.length <= 256 && Array.isArray(checkouts) && checkouts.length <= 256, 'bounded evidence');
  const records = required.map(({ jobKey }) => {
    const captured = checkouts.filter(item => item.jobKey === jobKey);
    const native = jobs.filter(job => job.name === jobKey);
    requireFact(captured.length === 1 && native.length === 1 && captured[0].schemaVersion === 'sutura-native-checkout-v1' &&
      captured[0].runId === runId && captured[0].attempt === attempt && SHA.test(captured[0].testedSha), 'missing or conflicting actual checkout');
    const job = native[0];
    requireFact(Number.isSafeInteger(job.id) && job.id > 0 && job.run_id === runId && job.run_attempt === attempt && job.head_sha === run.head_sha && job.status === 'completed', 'native job identity');
    return { jobId: job.id, jobKey, testedSha: captured[0].testedSha };
  });
  const testedSha = records[0].testedSha;
  requireFact(records.every(job => job.testedSha === testedSha), 'different actual tested commits');
  const contract = { ...obligations, policySource: { repositoryId: run.repository.id, ref: `refs/heads/${obligations.baseBranch}`, sha: policySha, path: policyPath } };
  return { schemaVersion: 'sutura-native-receipt-v1', complete: true, repositoryId: run.repository.id, runId, attempt,
    workflowId: run.workflow_id, workflowBlobSha, headSha: run.head_sha, testedSha, policySourceSha: policySha,
    policyDigest: verificationContractDigest(contract), jobs: records };
}
function decodePolicy(content, requireBlobIdentity = false) {
  requireFact(content?.type === 'file' && content.encoding === 'base64' && Number.isSafeInteger(content.size) && content.size >= 0 && content.size <= 1024 * 1024 && typeof content.content === 'string' && content.content.length <= 2 * 1024 * 1024, 'policy content');
  const bytes = Buffer.from(content.content, 'base64');
  requireFact(bytes.length <= 1024 * 1024 && bytes.length === content.size, 'policy decoded byte count');
  new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (requireBlobIdentity) requireFact(SHA.test(content.sha ?? '') && createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') === content.sha, 'policy blob identity');
  return bytes;
}
async function main(args) {
  const [repository, runText, attemptText, policyRef, directory, policySourceSha] = args;
  requireFact((args.length === 5 || args.length === 6) && /^[\w.-]+\/[\w.-]+$/u.test(repository) && /^refs\/heads\/[\w./-]+$/u.test(policyRef) && !policyRef.includes('..'), 'CLI scope');
  requireFact(policySourceSha === undefined || SHA.test(policySourceSha), 'exact optional policy source SHA');
  let calls = 0;
  const api = async endpoint => {
    requireFact(++calls <= 12, 'API bound');
    const { stdout } = await execFile('gh', ['api', `repos/${repository}/${endpoint}`], { timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
    return JSON.parse(stdout);
  };
  const runId = Number(runText), attempt = Number(attemptText);
  requireFact(Number.isSafeInteger(runId) && runId > 0 && Number.isSafeInteger(attempt) && attempt > 0, 'CLI run identity');
  const run = await api(`actions/runs/${runId}/attempts/${attempt}`);
  requireFact(run.repository?.full_name.toLowerCase() === repository.toLowerCase(), 'repository identity');
  const commit = await api(`commits/${encodeURIComponent(policyRef)}`), tipSha = commit.sha, policySha = policySourceSha ?? tipSha, policyPath = '.github/native-policy.json';
  requireFact(SHA.test(tipSha) && SHA.test(policySha), 'policy commit');
  if (policySourceSha !== undefined && policySourceSha !== tipSha) {
    const source = await api(`commits/${policySourceSha}`);
    requireFact(source.sha === policySourceSha, 'exact policy source commit identity');
    const comparison = await api(`compare/${policySourceSha}...${tipSha}?per_page=1&page=1`);
    requireFact(comparison.status === 'ahead' && comparison.behind_by === 0 && comparison.base_commit?.sha === policySourceSha && comparison.merge_base_commit?.sha === policySourceSha, 'policy source ancestry');
  }
  const content = await api(`contents/${policyPath}?ref=${policySha}`);
  const policyBytes = decodePolicy(content, policySourceSha !== undefined);
  if (policySourceSha !== undefined && policySha !== tipSha) {
    const current = await api(`contents/${policyPath}?ref=${tipSha}`);
    const currentBytes = decodePolicy(current, true);
    requireFact(current.sha === content.sha && currentBytes.equals(policyBytes), 'protected policy changed since enrolled source');
  }
  const policy = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(policyBytes));
  requireFact(policyRef === `refs/heads/${policy.obligations?.baseBranch}`, 'policy branch');
  const workflowPath = run.path?.split('@')[0];
  requireFact(/^\.github\/workflows\/[\w.-]+\.ya?ml$/u.test(workflowPath), 'workflow path');
  const workflow = await api(`contents/${workflowPath}?ref=${run.head_sha}`);
  const jobs = []; let total;
  for (let page = 1; page <= 3; page++) {
    const data = await api(`actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100&page=${page}`);
    requireFact(Number.isSafeInteger(data.total_count) && data.total_count <= 256 && Array.isArray(data.jobs) && (total === undefined || total === data.total_count), 'job pages');
    total = data.total_count; jobs.push(...data.jobs); if (jobs.length >= total) break;
  }
  requireFact(jobs.length === total && new Set(jobs.map(job => job.id)).size === jobs.length, 'complete job pages');
  const entries = await readdir(directory, { withFileTypes: true });
  requireFact(entries.length > 0 && entries.length <= 256, 'checkout record count');
  const checkouts = [];
  for (const entry of entries) {
    requireFact(entry.isFile() && entry.name.endsWith('.json'), 'checkout record file');
    const handle = await open(join(directory, entry.name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await handle.stat();
      requireFact(before.isFile() && before.size <= 4096, 'checkout record file');
      const buffer = Buffer.alloc(4097), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const after = await handle.stat();
      requireFact(bytesRead <= 4096 && bytesRead === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs, 'checkout record changed or exceeded bound');
      checkouts.push(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))));
    } finally { await handle.close(); }
  }
  process.stdout.write(JSON.stringify(buildNativeReceipt({ repository, runId, attempt, policySha, policyPath, run, workflowBlobSha: workflow.sha, policy, jobs, checkouts })) + '\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
