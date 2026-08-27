import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  CreateFixPullRequestInput,
  FailingWorkflowRun,
  GitHubOrchestrationPort,
} from '@sutura/core';

const FAILED_CONCLUSIONS = new Set(['failure', 'timed_out']);
const FAILED_STEP_LINES = 200;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;

export interface WorkflowRunRecord {
  id: number;
  headSha: string;
  repository: string;
  event: string;
  conclusion: string | null;
  pullRequests: Array<{ number: number }>;
}

export interface PullRequestRecord {
  number: number;
  headSha: string;
  headRef: string;
  headRepo: string | null;
}

export interface WorkflowJobStep {
  name: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface WorkflowJobRecord {
  id: number;
  name: string;
  conclusion: string | null;
  steps: WorkflowJobStep[];
}

export interface GitHubApi {
  getWorkflowRun(runId: number): Promise<WorkflowRunRecord>;
  listPullRequestsForCommit(sha: string): Promise<Array<{ number: number }>>;
  getPullRequest(number: number): Promise<PullRequestRecord>;
  listJobsForWorkflowRun(runId: number): Promise<WorkflowJobRecord[]>;
  downloadJobLogs(jobId: number): Promise<string>;
  listIssueComments(issueNumber: number): Promise<Array<{
    id: number;
    body: string | null;
    authorLogin: string | null;
  }>>;
  createRef(ref: string, sha: string): Promise<void>;
  deleteRef(ref: string): Promise<void>;
  createIssueComment(issueNumber: number, body: string): Promise<{ id: number }>;
  updateIssueComment(commentId: number, body: string): Promise<void>;
  getRefSha(ref: string): Promise<string>;
  getCommitParents(sha: string): Promise<string[]>;
  createPullRequest(input: {
    title: string;
    head: string;
    base: string;
    body: string;
  }): Promise<{ number: number; url: string }>;
}

export interface ArtifactApi {
  uploadArtifact(
    name: string,
    files: string[],
    rootDirectory: string,
  ): Promise<{ id?: number }>;
}

export interface GitHubAdapterOptions {
  owner: string;
  repo: string;
  runId: string;
  actionRunId?: string;
  artifact?: ArtifactApi;
}

export class GitHubAdapterError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GitHubAdapterError';
  }
}

function integerId(value: string, name: string): number {
  if (!/^[1-9]\d*$/.test(value)) throw new GitHubAdapterError(`${name} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new GitHubAdapterError(`${name} is invalid`);
  return parsed;
}

function timestamp(line: string): number | null {
  const matched = /^(\d{4}-\d{2}-\d{2}T\S+Z)\s/.exec(line);
  if (!matched?.[1]) return null;
  const value = Date.parse(matched[1]);
  return Number.isFinite(value) ? value : null;
}

function failedStepLog(log: string, step: WorkflowJobStep): string {
  if (!step.startedAt || !step.completedAt) {
    throw new GitHubAdapterError(`Failed step ${step.name} has no timestamp bounds`);
  }
  const start = Date.parse(step.startedAt);
  const end = Date.parse(step.completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new GitHubAdapterError(`Failed step ${step.name} has invalid timestamp bounds`);
  }
  const lines = log.split(/\r?\n/).filter((line) => {
    const time = timestamp(line);
    return time !== null && time >= start && time <= end;
  });
  if (lines.length === 0) {
    throw new GitHubAdapterError(`Job logs contain no lines for failed step ${step.name}`);
  }
  return lines.slice(-FAILED_STEP_LINES).join('\n');
}

function apiStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

function validBranch(value: string): boolean {
  return (
    BRANCH_PATTERN.test(value) &&
    !value.endsWith('/') &&
    !value.endsWith('.') &&
    !value.includes('..') &&
    !value.includes('//') &&
    !value.includes('@{') &&
    !/[\\~^:?*[\]]/.test(value) &&
    value.split('/').every((part) => part && !part.startsWith('.') && !part.endsWith('.lock'))
  );
}

export class GitHubAdapter implements GitHubOrchestrationPort {
  private readonly repository: string;

  constructor(
    private readonly api: GitHubApi,
    private readonly options: GitHubAdapterOptions,
  ) {
    this.repository = `${options.owner}/${options.repo}`;
    if (!REPOSITORY_PATTERN.test(this.repository)) {
      throw new GitHubAdapterError('GitHub repository identifier is invalid');
    }
    integerId(options.runId, 'Workflow run id');
  }

  async getFailingRun(runId: string): Promise<FailingWorkflowRun> {
    if (runId !== this.options.runId) {
      throw new GitHubAdapterError('Requested workflow run differs from the action event');
    }
    const numericRunId = integerId(runId, 'Workflow run id');
    const workflowRun = await this.api.getWorkflowRun(numericRunId);
    if (
      workflowRun.id !== numericRunId ||
      workflowRun.repository.toLowerCase() !== this.repository.toLowerCase() ||
      workflowRun.event !== 'pull_request' ||
      workflowRun.conclusion !== 'failure' ||
      !SHA_PATTERN.test(workflowRun.headSha)
    ) {
      throw new GitHubAdapterError('Workflow run metadata does not match the action event');
    }

    const candidates = workflowRun.pullRequests.length > 0
      ? workflowRun.pullRequests
      : await this.api.listPullRequestsForCommit(workflowRun.headSha);
    const unique = [...new Set(candidates.map(({ number }) => number))];
    if (unique.length !== 1 || !Number.isSafeInteger(unique[0]) || (unique[0] ?? 0) <= 0) {
      throw new GitHubAdapterError('Could not resolve one pull request for the failing SHA');
    }
    const pullRequest = await this.api.getPullRequest(unique[0] as number);
    if (pullRequest.number !== unique[0]) {
      throw new GitHubAdapterError('GitHub returned a different pull request');
    }
    if (pullRequest.headSha.toLowerCase() !== workflowRun.headSha.toLowerCase()) {
      throw new GitHubAdapterError('Pull request head no longer matches the failing SHA');
    }
    if (pullRequest.headRepo?.toLowerCase() !== this.repository.toLowerCase()) {
      throw new GitHubAdapterError('Sutura fails closed for fork pull requests');
    }
    if (!validBranch(pullRequest.headRef)) {
      throw new GitHubAdapterError('Pull request head branch is invalid');
    }

    const jobs = await this.api.listJobsForWorkflowRun(numericRunId);
    const failedSteps: FailingWorkflowRun['failedSteps'][number][] = [];
    for (const job of jobs) {
      if (!FAILED_CONCLUSIONS.has(job.conclusion ?? '')) continue;
      const jobLog = await this.api.downloadJobLogs(job.id);
      for (const step of job.steps) {
        if (!FAILED_CONCLUSIONS.has(step.conclusion ?? '')) continue;
        failedSteps.push({
          jobName: job.name,
          stepName: step.name,
          log: failedStepLog(jobLog, step),
        });
      }
    }
    if (failedSteps.length === 0) {
      throw new GitHubAdapterError('Workflow run has no failed-step logs');
    }

    return {
      runId,
      repo: this.repository,
      prNumber: pullRequest.number,
      prHeadSha: workflowRun.headSha,
      prHeadRef: pullRequest.headRef,
      failedSteps,
    };
  }

  async claimAttempt(prNumber: number, marker: string): Promise<string | null> {
    const comments = await this.api.listIssueComments(prNumber);
    if (
      comments.some(
        ({ body, authorLogin }) =>
          authorLogin === 'github-actions[bot]' && body?.includes(marker),
      )
    ) return null;
    const numericRunId = integerId(this.options.runId, 'Workflow run id');
    const run = await this.api.getWorkflowRun(numericRunId);
    if (
      run.id !== numericRunId ||
      run.repository.toLowerCase() !== this.repository.toLowerCase() ||
      run.event !== 'pull_request' ||
      run.conclusion !== 'failure' ||
      !SHA_PATTERN.test(run.headSha)
    ) {
      throw new GitHubAdapterError('Workflow run metadata changed before claim');
    }
    try {
      await this.api.createRef(
        `refs/tags/sutura-attempt-${this.options.runId}`,
        run.headSha,
      );
    } catch (error) {
      if (apiStatus(error) === 422) return null;
      throw new GitHubAdapterError('Could not claim the workflow run atomically', { cause: error });
    }
    const comment = await this.api.createIssueComment(
      prNumber,
      `${marker}\nSutura claimed this failed run and is starting analysis.`,
    );
    await this.api.deleteRef(`tags/sutura-attempt-${this.options.runId}`);
    return String(comment.id);
  }

  async updateAttempt(commentId: string, body: string): Promise<void> {
    await this.api.updateIssueComment(integerId(commentId, 'Comment id'), body);
  }

  async createFixPullRequest(
    input: CreateFixPullRequestInput,
  ): Promise<{ number: number; url: string }> {
    if (!validBranch(input.branch) || !validBranch(input.baseRef)) {
      throw new GitHubAdapterError('Fix or base branch is invalid');
    }
    if (!SHA_PATTERN.test(input.headSha)) {
      throw new GitHubAdapterError('Fix base SHA is invalid');
    }
    const tip = await this.api.getRefSha(`heads/${input.branch}`);
    const parents = await this.api.getCommitParents(tip);
    if (!parents.some((sha) => sha.toLowerCase() === input.headSha.toLowerCase())) {
      throw new GitHubAdapterError('Fix branch is not based on the exact failing SHA');
    }
    return this.api.createPullRequest({
      title: input.title,
      head: `${this.options.owner}:${input.branch}`,
      base: input.baseRef,
      body: input.body,
    });
  }

  async uploadCaseFile(name: string, html: string): Promise<{ url: string }> {
    if (!this.options.artifact) {
      throw new GitHubAdapterError('Artifact client is unavailable');
    }
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(name)) {
      throw new GitHubAdapterError('Artifact name is invalid');
    }
    const directory = await mkdtemp(join(tmpdir(), 'sutura-case-file-'));
    try {
      const path = join(directory, name);
      await writeFile(path, html, { encoding: 'utf8', mode: 0o600 });
      const uploaded = await this.options.artifact.uploadArtifact(name, [path], directory);
      if (!Number.isSafeInteger(uploaded.id) || (uploaded.id ?? 0) <= 0) {
        throw new GitHubAdapterError('Artifact upload did not return an id');
      }
      return {
        url: `https://github.com/${this.repository}/actions/runs/${integerId(this.options.actionRunId ?? '', 'Action run id')}/artifacts/${uploaded.id}`,
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
