import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type { getOctokit } from '@actions/github';
import { isAuthenticatedActionAuthority, type AuthenticatedActionAuthority } from '@sutura/core';
export interface AuthenticatedSourceRun { repositoryId: number; repository: string; runId: number; attempt: number; workflowId: number; sha: string; branch: string }
interface PublicationInput {
  octokit: ReturnType<typeof getOctokit>; source: AuthenticatedSourceRun; monitorRunId: number; monitorAttempt: number; actionSha: string; prNumber: number;
  explicitAuthority?: AuthenticatedActionAuthority;
}
const SHA = /^[a-f0-9]{40}$/u;
const id = (value: number): boolean => Number.isSafeInteger(value) && value > 0;
function requireFact(value: unknown, message: string): asserts value { if (!value) throw new Error(`Publication receipt ${message}`); }
/** Run only after the audited repair was committed and its actual PR creation returned successfully. */
export async function buildPublicationReceipt(input: PublicationInput): Promise<Record<string, unknown>> {
  const { source, octokit } = input, [owner = '', repo = ''] = source.repository.split('/');
  requireFact(/^[\w.-]+\/[\w.-]+$/u.test(source.repository) && [source.repositoryId, source.runId, source.attempt, source.workflowId, input.monitorRunId, input.monitorAttempt, input.prNumber].every(id) && SHA.test(source.sha) && SHA.test(input.actionSha), 'identity is unavailable');
  const { data: sourceRun } = await octokit.rest.actions.getWorkflowRunAttempt({ owner, repo, run_id: source.runId, attempt_number: source.attempt });
  requireFact(sourceRun.id === source.runId && sourceRun.run_attempt === source.attempt && sourceRun.workflow_id === source.workflowId && sourceRun.repository.id === source.repositoryId && sourceRun.head_repository?.id === source.repositoryId && sourceRun.head_sha === source.sha && sourceRun.head_branch === source.branch, 'source attempt mismatch');
  const { data: monitor } = await octokit.rest.actions.getWorkflowRunAttempt({ owner, repo, run_id: input.monitorRunId, attempt_number: input.monitorAttempt });
  requireFact(monitor.id === input.monitorRunId && monitor.run_attempt === input.monitorAttempt && monitor.repository.id === source.repositoryId && monitor.head_repository?.id === source.repositoryId && id(monitor.workflow_id) && SHA.test(monitor.head_sha), 'producer identity mismatch');
  const path = monitor.path?.split('@')[0] ?? '';
  requireFact(/^\.github\/workflows\/[\w.-]+\.ya?ml$/u.test(path), 'workflow path is invalid');
  const { data: workflow } = await octokit.rest.repos.getContent({ owner, repo, path, ref: monitor.head_sha });
  requireFact(!Array.isArray(workflow) && workflow.type === 'file' && 'content' in workflow && workflow.encoding === 'base64' && workflow.size <= 1_048_576 && SHA.test(workflow.sha), 'workflow blob unavailable');
  const workflowBytes = Buffer.from(workflow.content, 'base64');
  requireFact(workflowBytes.length === workflow.size && createHash('sha1').update(`blob ${workflowBytes.length}\0`).update(workflowBytes).digest('hex') === workflow.sha, 'workflow blob digest mismatch');
  let authorization: { kind: 'authenticated-owner-dispatch'; provenance: string; packetDigest: string } | undefined;
  let executionSuffix = '';
  if (monitor.event === 'workflow_dispatch') {
    const authority = input.explicitAuthority;
    requireFact(isAuthenticatedActionAuthority(authority), 'dispatch requires authenticated live authority');
    const binding = authority.provenance.split(':');
    requireFact(input.monitorAttempt === 1 && binding.length === 7 && binding[0] === 'authenticated-workflow-dispatch' &&
      binding[1] === source.repository && binding[2] === String(monitor.id) && binding[3] === '1' &&
      /^[1-9]\d*$/u.test(binding[4] ?? '') && Number.isSafeInteger(Number(binding[4])) &&
      binding[5] === workflow.sha && binding[6] === authority.packetDigest, 'dispatch caller provenance mismatch');
    requireFact(authority.actual.repository === source.repository && authority.actual.runId === String(source.runId) &&
      authority.actual.attempt === source.attempt && authority.actual.sourceSha === source.sha &&
      authority.actual.engineSha === input.actionSha, 'dispatch source or engine mismatch');
    authorization = { kind: 'authenticated-owner-dispatch', provenance: authority.provenance, packetDigest: authority.packetDigest };
    executionSuffix = `-dispatch-${createHash('sha256').update(authority.provenance).digest('hex').slice(0, 16)}`;
  } else {
    requireFact(monitor.event === 'workflow_run' && input.explicitAuthority === undefined, 'ordinary monitor event mismatch');
  }
  const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number: input.prNumber });
  requireFact(pr.number === input.prNumber && pr.head.repo?.id === source.repositoryId && pr.base.repo.id === source.repositoryId && pr.base.ref === source.branch && pr.head.ref === `sutura/fix-${source.runId}${executionSuffix}` && SHA.test(pr.head.sha), 'published PR identity mismatch');
  const { data: commit } = await octokit.rest.repos.getCommit({ owner, repo, ref: pr.head.sha });
  requireFact(commit.sha === pr.head.sha && commit.parents.length === 1 && commit.parents[0]?.sha === source.sha, 'repair parent mismatch');
  requireFact(Number.isSafeInteger(pr.changed_files) && pr.changed_files > 0 && pr.changed_files <= 2, 'diff file count is unsupported');
  const { data: files } = await octokit.rest.pulls.listFiles({ owner, repo, pull_number: input.prNumber, per_page: 100, page: 1 });
  requireFact(files.length === pr.changed_files && files.every(file => typeof file.filename === 'string' && typeof file.status === 'string' && typeof file.patch === 'string'), 'diff inventory is incomplete');
  const diff = files.map(({ filename, status, patch }) => ({ filename, status, patch }));
  const bytes = JSON.stringify(diff); requireFact(Buffer.byteLength(bytes) <= 1_048_576, 'diff exceeds bound');
  // Confirm the head did not move while reading its file inventory.
  const { data: after } = await octokit.rest.pulls.get({ owner, repo, pull_number: input.prNumber });
  requireFact(after.head.sha === pr.head.sha && after.base.ref === pr.base.ref && after.changed_files === pr.changed_files, 'published PR changed during capture');
  return { schemaVersion: 'sutura-publication-receipt-v1', complete: true, repositoryId: source.repositoryId,
    runId: input.monitorRunId, attempt: input.monitorAttempt, workflowId: monitor.workflow_id, workflowBlobSha: workflow.sha, actionSha: input.actionSha, outcome: 'fixed',
    ...(authorization ? { authorization } : {}),
    source: { runId: source.runId, attempt: source.attempt, sha: source.sha, workflowId: source.workflowId, branch: source.branch },
    publication: { prNumber: pr.number, headSha: pr.head.sha, diffDigest: createHash('sha256').update(bytes).digest('hex') } };
}
