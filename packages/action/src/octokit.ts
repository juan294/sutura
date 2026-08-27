import type { getOctokit } from '@actions/github';

import type {
  GitHubApi,
  PullRequestRecord,
  WorkflowJobRecord,
  WorkflowRunRecord,
} from './github.js';

type Octokit = ReturnType<typeof getOctokit>;

function responseText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString('utf8');
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('utf8');
  }
  throw new Error('GitHub returned job logs in an unsupported format');
}

export function createGitHubApi(
  octokit: Octokit,
  owner: string,
  repo: string,
): GitHubApi {
  return {
    async getWorkflowRun(runId): Promise<WorkflowRunRecord> {
      const { data } = await octokit.rest.actions.getWorkflowRun({
        owner,
        repo,
        run_id: runId,
      });
      return {
        id: data.id,
        headSha: data.head_sha,
        repository: data.repository.full_name,
        event: data.event,
        conclusion: data.conclusion,
        pullRequests: (data.pull_requests ?? []).map(({ number }) => ({ number })),
      };
    },

    async listPullRequestsForCommit(sha) {
      const pulls = await octokit.paginate(
        octokit.rest.repos.listPullRequestsAssociatedWithCommit,
        { owner, repo, commit_sha: sha, per_page: 100 },
      );
      return pulls.map(({ number }) => ({ number }));
    },

    async getPullRequest(number): Promise<PullRequestRecord> {
      const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: number });
      return {
        number: data.number,
        headSha: data.head.sha,
        headRef: data.head.ref,
        headRepo: data.head.repo?.full_name ?? null,
      };
    },

    async listJobsForWorkflowRun(runId): Promise<WorkflowJobRecord[]> {
      const jobs = await octokit.paginate(
        octokit.rest.actions.listJobsForWorkflowRun,
        { owner, repo, run_id: runId, filter: 'latest', per_page: 100 },
      );
      return jobs.map((job) => ({
        id: job.id,
        name: job.name,
        conclusion: job.conclusion,
        steps: (job.steps ?? []).map((step) => ({
          name: step.name,
          conclusion: step.conclusion,
          startedAt: step.started_at ?? null,
          completedAt: step.completed_at ?? null,
        })),
      }));
    },

    async downloadJobLogs(jobId) {
      const response = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
        owner,
        repo,
        job_id: jobId,
      });
      return responseText(response.data);
    },

    async listIssueComments(issueNumber) {
      const comments = await octokit.paginate(
        octokit.rest.issues.listComments,
        { owner, repo, issue_number: issueNumber, per_page: 100 },
      );
      return comments.map(({ id, body, user }) => ({
        id,
        body: body ?? null,
        authorLogin: user?.login ?? null,
      }));
    },

    async createRef(ref, sha) {
      await octokit.rest.git.createRef({ owner, repo, ref, sha });
    },

    async deleteRef(ref) {
      await octokit.rest.git.deleteRef({ owner, repo, ref });
    },

    async createIssueComment(issueNumber, body) {
      const { data } = await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body,
      });
      return { id: data.id };
    },

    async updateIssueComment(commentId, body) {
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: commentId,
        body,
      });
    },

    async getRefSha(ref) {
      const { data } = await octokit.rest.git.getRef({ owner, repo, ref });
      return data.object.sha;
    },

    async getCommitParents(sha) {
      const { data } = await octokit.rest.repos.getCommit({ owner, repo, ref: sha });
      return data.parents.map((parent) => parent.sha);
    },

    async createPullRequest(input) {
      const { data } = await octokit.rest.pulls.create({ owner, repo, ...input });
      return { number: data.number, url: data.html_url };
    },
  };
}
