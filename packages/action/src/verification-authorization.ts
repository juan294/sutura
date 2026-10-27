import { createHash } from 'node:crypto';
import type { getOctokit } from '@actions/github';
import { authenticateActionVerification, canonicalJson, loadRepositoryPolicy, parseVerificationPacket, type ActionAuthorityApi, type ActionGrantBinding } from '@sutura/core';
type Octokit = ReturnType<typeof getOctokit>;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
function checkRepository(expected: string, actual: string): void { if (expected !== actual) throw new Error('Authorization API repository differs'); }
/** Bounded authenticated GitHub reads; the immutable owner dispatch is the authority. */
export function actionVerificationApi(octokit: Octokit, owner: string, repo: string): ActionAuthorityApi {
  const repository = `${owner}/${repo}`;
  return {
    async getRun(requested, runId, attempt) {
      checkRepository(repository, requested);
      const { data } = await octokit.rest.actions.getWorkflowRunAttempt({ owner, repo, run_id: runId, attempt_number: attempt });
      const latest = await octokit.rest.actions.getWorkflowRun({ owner, repo, run_id: runId });
      // A caller rerun cannot masquerade as attempt 1; source history remains exact.
      if (data.event === 'workflow_dispatch' && latest.data.run_attempt !== attempt) throw new Error('Dispatch run was rerun');
      return { id: data.id, attempt: data.run_attempt ?? 0, repository: data.repository.full_name, repositoryId: data.repository.id, headRepositoryId: data.head_repository?.id ?? 0,
        headSha: data.head_sha, headBranch: data.head_branch ?? '', event: data.event, actorId: data.actor?.id ?? 0, triggeringActorId: data.triggering_actor?.id ?? 0, workflowId: data.workflow_id, workflowPath: data.path ?? '', conclusion: data.conclusion };
    },
    async getProtectedRef(requested, ref) {
      checkRepository(repository, requested);
      if (!ref.startsWith('refs/heads/')) throw new Error('Protected branch ref required');
      const [branch, metadata] = await Promise.all([octokit.rest.repos.getBranch({ owner, repo, branch: ref.slice(11) }), octokit.rest.repos.get({ owner, repo })]);
      return { repositoryId: metadata.data.id, ref, protected: branch.data.protected, sha: branch.data.commit.sha };
    },
    async compareCommits(requested, baseSha, headSha) {
      checkRepository(repository, requested);
      const { data } = await octokit.rest.repos.compareCommits({ owner, repo, base: baseSha, head: headSha });
      return { baseSha: data.base_commit.sha, mergeBaseSha: data.merge_base_commit.sha, headSha, status: data.status, behindBy: data.behind_by };
    },
    async getFileBlob(requested, path, commitSha) {
      checkRepository(repository, requested);
      const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref: commitSha });
      if (Array.isArray(data) || data.type !== 'file' || !('content' in data) || data.encoding !== 'base64' || data.size > 65_536) throw new Error('Bounded regular protected Git blob required');
      const bytes = Buffer.from(data.content, 'base64'), content = bytes.toString('utf8');
      if (!Buffer.from(content).equals(bytes)) throw new Error('Protected Git blob must be UTF-8');
      return { repository, path: data.path, commitSha, blobSha: data.sha, content, size: data.size };
    },
    async getJobs(requested, runId, attempt) {
      checkRepository(repository, requested);
      const { data } = await octokit.rest.actions.listJobsForWorkflowRunAttempt({ owner, repo, run_id: runId, attempt_number: attempt, per_page: 100 });
      return { complete: data.total_count === data.jobs.length && data.total_count <= 100, totalCount: data.total_count, jobs: data.jobs.map(job => ({ id: job.id, runId: job.run_id, attempt: job.run_attempt ?? attempt, headSha: job.head_sha, name: job.name, status: job.status,
        steps: (job.steps ?? []).map(step => ({ name: step.name, number: step.number, status: step.status })) })) };
    },
    claimGrant: binding => claimActionVerificationGrant(octokit, owner, repo, binding),
  };
}
/** One enrolled workflow's incident concurrency serializes this append-only source account. */
async function claimActionVerificationGrant(octokit: Octokit, owner: string, repo: string, binding: Readonly<ActionGrantBinding>): Promise<void> {
  const marker = `sutura-long-source:${binding.actual.runId}:${binding.actual.attempt}`;
  const comments = [];
  let complete = false;
  for (let page = 1; page <= 10; page++) {
    const { data } = await octokit.rest.repos.listCommentsForCommit({ owner, repo, commit_sha: binding.actual.sourceSha, per_page: 100, page });
    comments.push(...data); if (data.length < 100) { complete = true; break; }
  }
  if (!complete) throw new Error('Long-verification source account history is incomplete');
  const records = comments.flatMap(comment => {
    const match = /^<!-- sutura-long-source:[1-9]\d*:[1-9]\d* -->\n([\s\S]+)$/u.exec(comment.body ?? '');
    if (!match) return [];
    try { return [{ commentId: comment.id, authorId: comment.user?.id, record: JSON.parse(match[1]!) as Record<string, unknown> }]; }
    catch { throw new Error('Long-verification source account is corrupt; reconcile before another attempt'); }
  });
  if (records.some(item => !Number.isSafeInteger(item.authorId) || !['pending', 'reconciled'].includes(String(item.record.state)) || typeof item.record.packetDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(item.record.packetDigest))) throw new Error('Long-verification source account is corrupt; reconcile before execution');
  for (const pending of records.filter(item => item.record.state === 'pending')) {
    const settled = records.some(item => item.authorId === pending.authorId && item.record.state === 'reconciled' && item.record.pendingCommentId === pending.commentId && item.record.packetDigest === pending.record.packetDigest && typeof item.record.billingReceiptSha256 === 'string' && /^[a-f0-9]{64}$/u.test(item.record.billingReceiptSha256) && typeof item.record.actualUsd === 'number' && Number.isFinite(item.record.actualUsd) && item.record.actualUsd >= 0 && typeof pending.record.reservationUsd === 'number' && item.record.actualUsd <= pending.record.reservationUsd && item.record.billingComplete === true && typeof item.record.billingReceiptReference === 'string' && /^https:\/\/[^\s]+$/u.test(item.record.billingReceiptReference));
    if (!settled) throw new Error('Prior long-verification source account is pending; reconcile authoritative billing before another approved attempt');
  }
  if (records.some(item => item.record.grantId === binding.id)) throw new Error('Dispatch grant was already issued or consumed');
  const body = `<!-- ${marker} -->\n${canonicalJson({ state: 'pending', reservationUsd: binding.sandboxReservationUsd, grantId: binding.id, packetDigest: binding.packetDigest, source: binding.actual, callerRunId: binding.callerRunId, callerJobId: binding.callerJobId, issuedAt: new Date().toISOString() })}`;
  await octokit.rest.repos.createCommitComment({ owner, repo, commit_sha: binding.actual.sourceSha, body });
  // Never remove this tag or pending record, including on exceptions.
  await octokit.rest.git.createRef({ owner, repo, ref: `refs/tags/sutura-long-${binding.callerRunId}-${binding.callerJobId}-1`, sha: binding.actual.sourceSha });
}
export async function prepareActionVerificationAuthorization(input: { octokit: Octokit; owner: string; repo: string; callerRunId: number; packetInput: string; packetDigestInput: string }) {
  if (Buffer.byteLength(input.packetInput) > 16_384) throw new Error('Verification packet exceeds bound');
  const packet = parseVerificationPacket(JSON.parse(input.packetInput));
  const api = actionVerificationApi(input.octokit, input.owner, input.repo), repository = `${input.owner}/${input.repo}`;
  checkRepository(repository, packet.repository);
  const declaration = await api.getFileBlob(repository, '.sutura.json', packet.policyBaseSha);
  const policy = loadRepositoryPolicy(declaration.content);
  const profiles = policy.policy.reproductionProfiles?.filter(profile => sha(canonicalJson(profile)) === packet.profileSha256) ?? [];
  if (profiles.length !== 1) throw new Error('Packet requires one exact protected profile');
  const jobs = await api.getJobs(repository, input.callerRunId, 1);
  if (!jobs.complete || jobs.jobs.length !== 1) throw new Error('Authenticated caller requires one complete job');
  const authority = await authenticateActionVerification({ packet, profile: profiles[0]!, callerRunId: input.callerRunId, callerJobId: jobs.jobs[0]!.id,
    packetInput: input.packetInput, packetDigestInput: input.packetDigestInput, api });
  return { packet, authority };
}
