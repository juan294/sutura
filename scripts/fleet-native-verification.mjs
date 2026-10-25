import { createHash } from 'node:crypto';
import { verificationContractDigest } from './fleet-incident-evidence.mjs';

export const NATIVE_RECEIPT_LIMITS = Object.freeze({ bytes: 1_048_576, workflows: 16, jobs: 256, runs: 200, artifacts: 1000, operations: 2000 });
const SHA = /^[a-f0-9]{40}$/u, DIGEST = /^[a-f0-9]{64}$/u;
const id = value => Number.isSafeInteger(value) && value > 0;
const hash = value => createHash('sha256').update(value).digest('hex');
const safePath = value => typeof value === 'string' && value.length <= 300 && !value.startsWith('/') &&
  !/[\\\0\r\n?#]/u.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..');
function canonicalTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) || !Number.isFinite(Date.parse(value))) return null;
  const canonical = new Date(value).toISOString();
  return canonical === (value.includes('.') ? value : value.replace('Z', '.000Z')) ? canonical : null;
}
function requireFact(condition, reason) { if (!condition) throw new Error(reason); }
function decodeContent(value) {
  requireFact(value?.type === 'file' && value.encoding === 'base64' && Number.isSafeInteger(value.size) && value.size <= NATIVE_RECEIPT_LIMITS.bytes &&
    typeof value.content === 'string' && value.content.length <= NATIVE_RECEIPT_LIMITS.bytes * 2, 'protected-content-unavailable');
  const bytes = Buffer.from(value.content, 'base64');
  requireFact(bytes.length === value.size && bytes.length <= NATIVE_RECEIPT_LIMITS.bytes, 'protected-content-truncated');
  const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  requireFact(blob === value.sha, 'protected-content-identity-mismatch');
  return bytes.toString('utf8');
}
function runIdentity(run, expected) {
  return run?.id === expected.id && run.run_attempt === expected.attempt && run.repository?.id === expected.repositoryId &&
    run.head_repository?.id === expected.repositoryId && run.workflow_id === expected.workflowId && run.head_sha === expected.headSha;
}
function boundedJson(text) {
  requireFact(typeof text === 'string' && Buffer.byteLength(text) <= NATIVE_RECEIPT_LIMITS.bytes, 'receipt-content-truncated');
  const value = JSON.parse(text);
  requireFact(value && typeof value === 'object' && !Array.isArray(value) && value.complete === true, 'receipt-incomplete');
  return value;
}

/** Read-only GitHub adapter. Producer enrollment must be reviewed at the protected policy source.
 * Receipt identity/digests never replace API authentication or execution/publication authorization.
 * No existing emitter is assumed to provide these v1 receipts; absence remains unmeasured.
 */
export async function collectNativeVerification({ client, repository, source, monitor, repairPr, contract }) {
  const proof = {}, requiredInput = [];
  let apiOperations = 0, artifactDownloads = 0;
  const fetch = async path => {
    requireFact(apiOperations + artifactDownloads < NATIVE_RECEIPT_LIMITS.operations, 'native-operation-bound-exceeded');
    apiOperations++;
    return client.api(path);
  };
  const identity = repository?.includes('/') ? repository : `${client.owner}/${repository}`;
  const prefix = `repos/${identity}`;
  const content = (path, ref) => fetch(`${prefix}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`);
  const gap = reason => { if (!requiredInput.includes(reason)) requiredInput.push(reason); };
  async function pages(path, field, maximum) {
    const values = []; let total = null;
    for (let page = 1; page <= Math.ceil(maximum / 100); page++) {
      const result = await fetch(`${path}&page=${page}`);
      requireFact(Number.isSafeInteger(result.total_count) && result.total_count >= 0 && result.total_count <= maximum &&
        Array.isArray(result[field]) && result[field].length <= 100 && (total === null || total === result.total_count), 'native-inventory-bound-or-completeness');
      total = result.total_count; values.push(...result[field]);
      if (values.length === total) {
        requireFact(values.every(value => id(value.id)) && new Set(values.map(value => value.id)).size === values.length, 'native-inventory-identity-ambiguous');
        return values;
      }
      requireFact(values.length < total && result[field].length === 100, 'native-inventory-truncated');
    }
    throw new Error('native-inventory-truncated');
  }
  try {
    requireFact(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(identity) && id(source?.repositoryId) && id(source.id) && id(source.attempt) &&
      id(source.workflowId) && SHA.test(source.headSha ?? '') && canonicalTime(source.createdAt), 'source-identity-unavailable');
    requireFact(contract?.schemaVersion === 'sutura-native-verification-v1' && contract.repositoryId === source.repositoryId &&
      contract.protected === true && contract.fullRequired === true && contract.baseBranch === source.branch &&
      DIGEST.test(contract.policyDigest ?? '') && verificationContractDigest(contract) === contract.policyDigest, 'protected-native-contract-unavailable');
    const policySource = contract.policySource;
    requireFact(policySource?.repositoryId === source.repositoryId && SHA.test(policySource.sha ?? '') && safePath(policySource.path) &&
      /^refs\/heads\/[A-Za-z0-9_./-]+$/u.test(policySource.ref ?? '') && !policySource.ref.includes('..'), 'protected-policy-source-unavailable');
    const repo = await fetch(prefix);
    requireFact(repo.id === source.repositoryId, 'repository-identity-mismatch');
    const branch = await fetch(`${prefix}/branches/${encodeURIComponent(policySource.ref.slice('refs/heads/'.length))}`);
    requireFact(branch.protected === true && SHA.test(branch.commit?.sha ?? ''), 'protected-policy-ref-unavailable');
    const tipSha = branch.commit.sha;
    let comparison = { status: 'identical', base_commit: { sha: policySource.sha }, merge_base_commit: { sha: policySource.sha } };
    if (tipSha !== policySource.sha) {
      comparison = await fetch(`${prefix}/compare/${policySource.sha}...${tipSha}?per_page=1&page=1`);
      requireFact(comparison.status === 'ahead' && comparison.behind_by === 0 && comparison.base_commit?.sha === policySource.sha &&
        comparison.merge_base_commit?.sha === policySource.sha, 'protected-policy-ancestry-unavailable');
    }
    const policyFile = await content(policySource.path, policySource.sha);
    const policy = JSON.parse(decodeContent(policyFile));
    if (tipSha !== policySource.sha) {
      const currentPolicy = await content(policySource.path, tipSha); decodeContent(currentPolicy);
      requireFact(currentPolicy.sha === policyFile.sha, 'protected-policy-changed');
    }
    const policyProvenance = { repositoryId: source.repositoryId, ref: policySource.ref, policySourceSha: policySource.sha,
      observedTipSha: tipSha, policyBlobSha: policyFile.sha, protectedAtObservation: true, observedAt: new Date().toISOString(),
      ancestry: comparison.status, baseSha: comparison.base_commit.sha, mergeBaseSha: comparison.merge_base_commit.sha };
    const resolved = { ...policy.obligations, policySource };
    requireFact(policy.schemaVersion === 'sutura-native-policy-v1' && verificationContractDigest(resolved) === contract.policyDigest &&
      Array.isArray(policy.receiptProducers) && policy.receiptProducers.length <= NATIVE_RECEIPT_LIMITS.workflows + 1, 'protected-policy-definition-mismatch');
    for (const stage of ['proposal', 'integration']) {
      const scope = contract.stages?.[stage];
      requireFact(['push', 'pull_request', 'workflow_dispatch', 'schedule'].includes(scope?.event) &&
        ['base', 'repair-head'].includes(scope.branchRole) && (stage !== 'integration' || (scope.event === 'push' && scope.branchRole === 'base')) &&
        Array.isArray(scope.requiredJobs) && scope.requiredJobs.length > 0 && scope.requiredJobs.length <= NATIVE_RECEIPT_LIMITS.jobs &&
        scope.requiredJobs.every(job => id(job.workflowId) && typeof job.jobKey === 'string' && job.jobKey.length > 0 && job.jobKey.length <= 300) &&
        new Set(scope.requiredJobs.map(job => `${job.workflowId}:${job.jobKey}`)).size === scope.requiredJobs.length, 'native-obligations-unavailable');
    }
    const sourceRun = await fetch(`${prefix}/actions/runs/${source.id}/attempts/${source.attempt}`);
    requireFact(runIdentity(sourceRun, source) && sourceRun.head_branch === source.branch, 'source-api-identity-mismatch');
    requireFact(id(monitor?.id) && id(monitor.runAttempt) && monitor.outcome === 'fixed' && id(repairPr?.number), 'publication-source-unavailable');
    const monitorRun = await fetch(`${prefix}/actions/runs/${monitor.id}/attempts/${monitor.runAttempt}`);
    requireFact(monitorRun?.id === monitor.id && monitorRun.run_attempt === monitor.runAttempt && monitorRun.repository?.id === source.repositoryId &&
      monitorRun.head_repository?.id === source.repositoryId && monitorRun.event === 'workflow_run' && monitorRun.status === 'completed' &&
      SHA.test(monitorRun.head_sha ?? '') && canonicalTime(monitorRun.updated_at), 'monitor-api-identity-mismatch');
    const producerCache = new Map();
    async function trustedProducer(run, kind) {
      const producers = policy.receiptProducers.filter(producer => producer.workflowId === run.workflow_id && producer.kind === kind);
      requireFact(producers.length === 1, 'receipt-producer-unavailable');
      const producer = producers[0];
      requireFact(safePath(producer.path) && producer.path.startsWith('.github/workflows/') && SHA.test(producer.blobSha ?? '') &&
        run.path?.split('@')[0] === producer.path, 'receipt-producer-identity-mismatch');
      const key = `${run.workflow_id}:${run.head_sha}`;
      if (!producerCache.has(key)) {
        const workflow = await fetch(`${prefix}/actions/workflows/${run.workflow_id}`);
        requireFact(workflow.id === run.workflow_id && workflow.path === producer.path, 'workflow-api-identity-mismatch');
        for (const ref of new Set([policySource.sha, run.head_sha])) {
          const file = await content(producer.path, ref); decodeContent(file);
          requireFact(file.sha === producer.blobSha, 'receipt-producer-definition-mismatch');
        }
        producerCache.set(key, producer.blobSha);
      }
      return producer.blobSha;
    }
    async function receipt(run, kind) {
      const blobSha = await trustedProducer(run, kind);
      const artifacts = await pages(`${prefix}/actions/runs/${run.id}/artifacts?per_page=100`, 'artifacts', NATIVE_RECEIPT_LIMITS.artifacts);
      const name = `sutura-${kind}-v1-${run.id}-${run.run_attempt}`;
      const matching = artifacts.filter(artifact => artifact.name === name);
      requireFact(matching.length === 1, `${kind}-receipt-unavailable`);
      const artifact = matching[0];
      requireFact(id(artifact.id) && artifact.expired === false && Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0 &&
        artifact.size_in_bytes <= NATIVE_RECEIPT_LIMITS.bytes && artifact.workflow_run?.id === run.id &&
        artifact.workflow_run.repository_id === source.repositoryId && artifact.workflow_run.head_repository_id === source.repositoryId &&
        artifact.workflow_run.head_sha === run.head_sha, 'artifact-provenance-unavailable');
      requireFact(apiOperations + artifactDownloads < NATIVE_RECEIPT_LIMITS.operations, 'native-operation-bound-exceeded');
      artifactDownloads++;
      const value = boundedJson(await client.downloadArtifact(repository, run.id, artifact, { maximumBytes: NATIVE_RECEIPT_LIMITS.bytes, singleRegularFile: true }));
      if (kind === 'publication') {
        const enrolled = policy.receiptProducers.find(producer => producer.workflowId === run.workflow_id && producer.kind === kind);
        requireFact(SHA.test(enrolled.actionSha ?? '') && value.actionSha === enrolled.actionSha, 'publication-action-pin-mismatch');
      }
      requireFact(value.schemaVersion === `sutura-${kind}-receipt-v1` && value.repositoryId === source.repositoryId && value.runId === run.id &&
        value.attempt === run.run_attempt && value.workflowId === run.workflow_id && value.workflowBlobSha === blobSha, 'receipt-identity-mismatch');
      return value;
    }
    const publication = await receipt(monitorRun, 'publication');
    requireFact(publication.source?.runId === source.id && publication.source.attempt === source.attempt && publication.source.sha === source.headSha &&
      publication.source.workflowId === source.workflowId && publication.source.branch === source.branch && publication.outcome === 'fixed' &&
      SHA.test(publication.actionSha ?? '') && publication.actionSha === monitor.actionSha && publication.publication?.prNumber === repairPr.number &&
      SHA.test(publication.publication.headSha ?? '') && DIGEST.test(publication.publication.diffDigest ?? ''), 'publication-source-identity-mismatch');
    const pr = await fetch(`${prefix}/pulls/${repairPr.number}`);
    requireFact(pr.number === repairPr.number && pr.head?.repo?.id === source.repositoryId && pr.base?.repo?.id === source.repositoryId &&
      pr.head.sha === publication.publication.headSha && pr.base.ref === source.branch && SHA.test(pr.base.sha ?? '') &&
      typeof pr.head.ref === 'string', 'publication-pr-identity-mismatch');
    const parent = await fetch(`${prefix}/commits/${pr.head.sha}`);
    requireFact(parent.sha === pr.head.sha && parent.parents?.length === 1 && parent.parents[0].sha === source.headSha, 'repair-parent-identity-mismatch');
    const diff = [];
    for (let page = 1; page <= 10; page++) {
      const files = await fetch(`${prefix}/pulls/${pr.number}/files?per_page=100&page=${page}`);
      requireFact(Array.isArray(files) && files.length <= 100 && files.every(file => typeof file.filename === 'string' && typeof file.status === 'string' && typeof file.patch === 'string'), 'repair-diff-incomplete');
      diff.push(...files.map(({ filename, status, patch }) => ({ filename, status, patch })));
      requireFact(Buffer.byteLength(JSON.stringify(diff)) <= NATIVE_RECEIPT_LIMITS.bytes, 'repair-diff-truncated');
      if (files.length < 100) break;
      requireFact(page < 10, 'repair-diff-truncated');
    }
    requireFact(diff.length > 0 && hash(JSON.stringify(diff)) === publication.publication.diffDigest, 'repair-diff-identity-mismatch');
    proof.monitor = { repositoryId: source.repositoryId, runId: monitorRun.id, attempt: monitorRun.run_attempt, completedAt: canonicalTime(monitorRun.updated_at),
      sourceRunId: publication.source.runId, sourceAttempt: publication.source.attempt, sourceSha: publication.source.sha,
      actionSha: publication.actionSha, outcome: publication.outcome, complete: true, publication: { prNumber: publication.publication.prNumber, headSha: publication.publication.headSha, diffDigest: publication.publication.diffDigest } };
    proof.repairPr = { repositoryId: source.repositoryId, number: pr.number, sourceRunId: publication.source.runId, sourceAttempt: publication.source.attempt,
      sourceSha: publication.source.sha, sourceParentSha: parent.parents[0].sha, headSha: pr.head.sha, headBranch: pr.head.ref,
      baseSha: pr.base.sha, baseBranch: pr.base.ref, diffDigest: publication.publication.diffDigest,
      merged: pr.merged === true, integrationSha: pr.merged === true && SHA.test(pr.merge_commit_sha ?? '') ? pr.merge_commit_sha : null };
    proof.policyProvenance = policyProvenance;
    proof.native = [];
    const workflowIds = [...new Set(['proposal', 'integration'].flatMap(stage => contract.stages[stage].requiredJobs.map(job => job.workflowId)))];
    requireFact(workflowIds.length <= NATIVE_RECEIPT_LIMITS.workflows, 'native-workflow-bound-exceeded');
    let candidateCount = 0;
    for (const workflowId of workflowIds) {
      for (const stage of ['proposal', 'integration']) {
        const scope = contract.stages[stage], obligations = scope.requiredJobs.filter(job => job.workflowId === workflowId);
        if (!obligations.length) continue;
        const expectedSha = stage === 'proposal' ? pr.head.sha : proof.repairPr.integrationSha;
        if (!expectedSha) { gap('integration-not-observed'); continue; }
        const branchName = scope.branchRole === 'base' ? source.branch : pr.head.ref;
        const selected = [];
        try {
          const inventory = await pages(`${prefix}/actions/workflows/${workflowId}/runs?head_sha=${expectedSha}&event=${encodeURIComponent(scope.event)}&branch=${encodeURIComponent(branchName)}&per_page=100`, 'workflow_runs', NATIVE_RECEIPT_LIMITS.runs);
          for (const run of inventory) {
            requireFact(run.repository?.id === source.repositoryId && run.head_repository?.id === source.repositoryId && run.workflow_id === workflowId &&
              run.head_sha === expectedSha && run.head_branch === branchName && run.event === scope.event && id(run.run_attempt) && run.run_attempt <= 50, 'native-run-inventory-identity');
            requireFact(candidateCount + run.run_attempt <= NATIVE_RECEIPT_LIMITS.runs, 'native-attempt-bound-exceeded');
            candidateCount += run.run_attempt;
            for (let attempt = 1; attempt <= run.run_attempt; attempt++) selected.push({ id: run.id, attempt,
              repositoryId: source.repositoryId, workflowId, headSha: run.head_sha });
          }
        } catch (error) { gap(error.message?.match(/^[a-z-]+$/u) ? error.message : 'native-inventory-unavailable'); continue; }
        if (!selected.length) gap('required-native-run-unavailable');
        const seen = new Set();
        for (const candidate of selected) {
          try {
            requireFact(id(candidate.id) && id(candidate.attempt) && !seen.has(`${candidate.id}:${candidate.attempt}`), 'native-run-identity-ambiguous');
            seen.add(`${candidate.id}:${candidate.attempt}`);
            const run = await fetch(`${prefix}/actions/runs/${candidate.id}/attempts/${candidate.attempt}`);
            requireFact(runIdentity(run, candidate) && run.head_branch === branchName && run.event === scope.event, 'native-run-api-mismatch');
            const native = await receipt(run, 'native');
            requireFact(native.headSha === run.head_sha && SHA.test(native.testedSha ?? '') && native.policyDigest === contract.policyDigest &&
              native.policySourceSha === policySource.sha && Array.isArray(native.jobs) && native.jobs.length <= NATIVE_RECEIPT_LIMITS.jobs, 'native-receipt-policy-mismatch');
            let mergeParents = null;
            if (native.testedSha !== expectedSha) {
              requireFact(stage === 'proposal' && scope.event === 'pull_request', 'native-tested-sha-mismatch');
              const commit = await fetch(`${prefix}/commits/${native.testedSha}`);
              requireFact(commit.sha === native.testedSha && commit.parents?.length === 2 && commit.parents[0].sha === pr.base.sha && commit.parents[1].sha === pr.head.sha, 'native-tested-merge-mismatch');
              mergeParents = commit.parents.map(value => value.sha);
            }
            const jobs = []; let total = null;
            for (let page = 1; page <= 3; page++) {
              const result = await fetch(`${prefix}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`);
              requireFact(id(result.total_count) && result.total_count <= NATIVE_RECEIPT_LIMITS.jobs && Array.isArray(result.jobs) && result.jobs.length <= 100 &&
                (total === null || total === result.total_count), 'native-jobs-incomplete');
              total = result.total_count; jobs.push(...result.jobs);
              if (jobs.length >= total) break;
              requireFact(result.jobs.length === 100, 'native-jobs-truncated');
            }
            requireFact(jobs.length === total && new Set(jobs.map(job => job.id)).size === jobs.length, 'native-jobs-truncated');
            const checked = obligations.map(obligation => {
              const claims = native.jobs.filter(job => job.jobKey === obligation.jobKey);
              requireFact(claims.length === 1 && claims[0].testedSha === native.testedSha, 'required-native-job-receipt-unavailable');
              const matching = jobs.filter(job => job.id === claims[0].jobId && job.name === obligation.jobKey);
              requireFact(matching.length === 1 && matching[0].run_id === run.id && matching[0].run_attempt === run.run_attempt && matching[0].head_sha === run.head_sha, 'required-native-job-api-mismatch');
              const job = matching[0];
              return { jobKey: obligation.jobKey, runId: run.id, attempt: run.run_attempt, testedSha: claims[0].testedSha, status: job.status, conclusion: job.conclusion };
            });
            proof.native.push({ stage, repositoryId: source.repositoryId, workflowId, runId: run.id, attempt: run.run_attempt, headSha: run.head_sha,
              branch: run.head_branch, event: run.event, testedSha: native.testedSha, mergeParents, completedAt: canonicalTime(run.updated_at),
              status: run.status, conclusion: run.conclusion, jobsComplete: true, policyDigest: native.policyDigest, policySourceSha: native.policySourceSha, jobs: checked });
          } catch (error) { gap(error.message?.match(/^[a-z-]+$/u) ? error.message : 'native-evidence-unavailable'); }
        }
      }
    }
  } catch (error) { gap(error.message?.match(/^[a-z-]+$/u) ? error.message : 'native-evidence-unavailable'); }
  return { complete: requiredInput.length === 0 && Array.isArray(proof.native) && proof.native.length > 0, proof, requiredInput,
    operations: { api: apiOperations, artifactDownloads, limit: NATIVE_RECEIPT_LIMITS.operations } };
}
