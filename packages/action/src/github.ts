import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  AttemptTarget,
  CompleteCheckInput,
  CreateFixPullRequestInput,
  FailingWorkflowRun,
  GitHubOrchestrationPort,
} from '@sutura/core';
import { checkAnnotations, checkConclusion, checkExternalId, SUTURA_CHECK_NAME } from './checks.js';
import { checkOutput } from './evidence.js';

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
  headBranch?: string | null;
  pullRequests: Array<{ number: number }>;
}

export interface PullRequestRecord {
  number: number;
  headSha: string;
  headRef: string;
  headRepo: string | null;
  baseSha: string;
  baseRef: string;
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
  listCommitComments(sha: string): Promise<Array<{
    id: number;
    body: string | null;
    authorLogin: string | null;
  }>>;
  createRef(ref: string, sha: string): Promise<void>;
  deleteRef(ref: string): Promise<void>;
  createIssueComment(issueNumber: number, body: string): Promise<{ id: number }>;
  createCommitComment(sha: string, body: string): Promise<{ id: number }>;
  updateIssueComment(commentId: number, body: string): Promise<void>;
  updateCommitComment(commentId: number, body: string): Promise<void>;
  getRefSha(ref: string): Promise<string>;
  getCommitParents(sha: string): Promise<string[]>;
  getCommitSha(sha: string): Promise<string>;
  createPullRequest(input: {
    title: string;
    head: string;
    base: string;
    body: string;
  }): Promise<{ number: number; url: string }>;
  listCheckRunsForRef(ref: string): Promise<Array<{
    id: number;
    headSha: string;
    externalId: string | null;
    name: string;
    status: string;
    conclusion: string | null;
  }>>;
  createCheckRun(input: {
    name: string;
    headSha: string;
    externalId: string;
    status: 'in_progress';
    title: string;
    summary: string;
  }): Promise<{ id: number }>;
  updateCheckRun(input: {
    checkRunId: number;
    status: 'completed';
    conclusion: 'neutral' | 'action_required';
    detailsUrl?: string;
    title: string;
    summary: string;
    annotations: Array<{
      path: string;
      startLine: number;
      endLine: number;
      annotationLevel: 'notice' | 'warning' | 'failure';
      title: string;
      message: string;
    }>;
  }): Promise<void>;
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

interface TimestampedLogLine {
  line: string;
  time: number;
}

function parseTimestampedLog(log: string): TimestampedLogLine[] {
  return log.split(/\r?\n/).flatMap((line) => {
    const time = timestamp(line);
    return time === null ? [] : [{ line, time }];
  });
}

function failedStepLog(lines: readonly TimestampedLogLine[], step: WorkflowJobStep): string {
  if (!step.startedAt || !step.completedAt) {
    throw new GitHubAdapterError(`Failed step ${step.name} has no timestamp bounds`);
  }
  const start = Date.parse(step.startedAt);
  const end = Date.parse(step.completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new GitHubAdapterError(`Failed step ${step.name} has invalid timestamp bounds`);
  }
  const inclusiveEnd = /\.\d+Z$/u.test(step.completedAt) ? end : end + 999;
  let matching = lines.filter(({ time }) => time >= start && time <= inclusiveEnd);
  const groupMarker = `##[group]${step.name}`;
  const groupIndex = matching.findLastIndex(({ line }) => line.includes(groupMarker));
  if (groupIndex >= 0) matching = matching.slice(groupIndex);
  if (matching.length === 0) {
    throw new GitHubAdapterError(`Job logs contain no lines for failed step ${step.name}`);
  }
  const commandLine = matching[0];
  const retained = groupIndex >= 0 && commandLine && matching.length > FAILED_STEP_LINES
    ? [commandLine, ...matching.slice(-(FAILED_STEP_LINES - 1))]
    : matching.slice(-FAILED_STEP_LINES);
  return retained.map(({ line }) => line).join('\n');
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
  private activeCheck: { id: number; headSha: string } | undefined;

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
      !FAILED_CONCLUSIONS.has(workflowRun.conclusion ?? '') ||
      !SHA_PATTERN.test(workflowRun.headSha)
    ) {
      throw new GitHubAdapterError('Workflow run metadata does not match the action event');
    }

    let prNumber: number | undefined;
    let headRef: string | undefined;
    let baseSha: string | undefined;
    let baseRef: string | undefined;
    if (workflowRun.event === 'pull_request' || workflowRun.event === 'workflow_dispatch') {
      const candidates = workflowRun.pullRequests.length > 0
        ? workflowRun.pullRequests
        : await this.api.listPullRequestsForCommit(workflowRun.headSha);
      const unique = [...new Set(candidates.map(({ number }) => number))];
      if (
        workflowRun.event === 'pull_request' &&
        (unique.length !== 1 || !Number.isSafeInteger(unique[0]) || (unique[0] ?? 0) <= 0)
      ) {
        throw new GitHubAdapterError('Could not resolve one pull request for the failing SHA');
      }
      if (unique.length === 1 && Number.isSafeInteger(unique[0]) && (unique[0] ?? 0) > 0) {
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
        if (
          !SHA_PATTERN.test(pullRequest.baseSha) ||
          !validBranch(pullRequest.baseRef) ||
          (await this.api.getCommitSha(pullRequest.baseSha)).toLowerCase() !==
            pullRequest.baseSha.toLowerCase()
        ) {
          throw new GitHubAdapterError('Pull request base commit is invalid');
        }
        prNumber = pullRequest.number;
        headRef = pullRequest.headRef;
        baseSha = pullRequest.baseSha;
        baseRef = pullRequest.baseRef;
      }
    }
    if (headRef === undefined) {
      if (!workflowRun.headBranch || !validBranch(workflowRun.headBranch)) {
        throw new GitHubAdapterError('Workflow run head branch is invalid');
      }
      const branchTip = await this.api.getRefSha(`heads/${workflowRun.headBranch}`);
      if (
        !SHA_PATTERN.test(branchTip) ||
        branchTip.toLowerCase() !== workflowRun.headSha.toLowerCase()
      ) {
        throw new GitHubAdapterError('Workflow run head branch no longer matches the failing SHA');
      }
      headRef = workflowRun.headBranch;
      baseSha = workflowRun.headSha;
      baseRef = workflowRun.headBranch;
    }
    if (baseSha === undefined || baseRef === undefined) {
      throw new GitHubAdapterError('Workflow run base commit is unavailable');
    }

    const jobs = await this.api.listJobsForWorkflowRun(numericRunId);
    const failedSteps: FailingWorkflowRun['failedSteps'][number][] = [];
    for (const job of jobs) {
      if (!FAILED_CONCLUSIONS.has(job.conclusion ?? '')) continue;
      const jobLog = await this.api.downloadJobLogs(job.id);
      const timestampedLines = parseTimestampedLog(jobLog);
      for (const step of job.steps) {
        if (!FAILED_CONCLUSIONS.has(step.conclusion ?? '')) continue;
        failedSteps.push({
          jobName: job.name,
          stepName: step.name,
          log: failedStepLog(timestampedLines, step),
        });
      }
    }
    if (failedSteps.length === 0) {
      throw new GitHubAdapterError('Workflow run has no failed-step logs');
    }

    return {
      runId,
      repo: this.repository,
      ...(prNumber === undefined ? {} : { prNumber }),
      headSha: workflowRun.headSha,
      headRef,
      baseSha,
      baseRef,
      failedSteps,
    };
  }

  private async findCheck(headSha: string): Promise<{
    id: number;
    headSha: string;
    status: string;
  } | undefined> {
    const externalId = checkExternalId(this.repository, this.options.runId);
    const matches = (await this.api.listCheckRunsForRef(headSha)).filter((check) =>
      check.name === SUTURA_CHECK_NAME &&
      check.externalId === externalId &&
      check.headSha.toLowerCase() === headSha.toLowerCase(),
    );
    if (matches.length > 1) {
      throw new GitHubAdapterError('Multiple Sutura checks match this workflow run');
    }
    return matches[0];
  }

  async claimAttempt(
    prNumber: number | undefined,
    marker: string,
  ): Promise<AttemptTarget | null> {
    const numericRunId = integerId(this.options.runId, 'Workflow run id');
    const run = await this.api.getWorkflowRun(numericRunId);
    if (
      run.id !== numericRunId ||
      run.repository.toLowerCase() !== this.repository.toLowerCase() ||
      !FAILED_CONCLUSIONS.has(run.conclusion ?? '') ||
      !SHA_PATTERN.test(run.headSha)
    ) {
      throw new GitHubAdapterError('Workflow run metadata changed before claim');
    }
    const externalId = checkExternalId(this.repository, this.options.runId);
    try {
      await this.api.createRef(
        `refs/tags/sutura-attempt-${this.options.runId}`,
        run.headSha,
      );
    } catch (error) {
      if (apiStatus(error) === 422) {
        this.activeCheck = await this.findCheck(run.headSha);
        return null;
      }
      throw new GitHubAdapterError('Could not claim the workflow run atomically', { cause: error });
    }
    try {
      this.activeCheck = await this.findCheck(run.headSha);
      const recoveredExistingCheck = this.activeCheck !== undefined;
      const comments = prNumber === undefined
        ? await this.api.listCommitComments(run.headSha)
        : await this.api.listIssueComments(prNumber);
      const existingComment = comments.find(
        ({ body, authorLogin }) =>
          authorLogin === 'github-actions[bot]' && body?.includes(marker),
      );
      if (!this.activeCheck) {
        const created = await this.api.createCheckRun({
          name: SUTURA_CHECK_NAME,
          headSha: run.headSha,
          externalId,
          status: 'in_progress',
          title: 'Sutura repair audit in progress',
          summary: `Analyzing failed workflow run ${this.options.runId}.`,
        });
        if (!Number.isSafeInteger(created.id) || created.id <= 0) {
          throw new GitHubAdapterError('GitHub returned an invalid check-run id');
        }
        this.activeCheck = { id: created.id, headSha: run.headSha };
      }
      if (existingComment) return null;
      const body = `${marker}\n<!-- sutura-check-run:${this.activeCheck.id} -->\nSutura claimed this failed run and is starting analysis.`;
      const comment = prNumber === undefined
        ? await this.api.createCommitComment(run.headSha, body)
        : await this.api.createIssueComment(prNumber, body);
      if (recoveredExistingCheck) return null;
      return {
        kind: prNumber === undefined ? 'commit' : 'pull-request',
        commentId: comment.id,
        checkRunId: this.activeCheck.id,
        headSha: run.headSha,
      };
    } finally {
      await this.api.deleteRef(`tags/sutura-attempt-${this.options.runId}`);
    }
  }

  async updateAttempt(target: AttemptTarget, body: string): Promise<void> {
    if (target.kind === 'commit') {
      await this.api.updateCommitComment(target.commentId, body);
      return;
    }
    await this.api.updateIssueComment(target.commentId, body);
  }

  async completeCheck(target: AttemptTarget, input: CompleteCheckInput): Promise<void> {
    if (target.checkRunId !== this.activeCheck?.id || target.headSha !== this.activeCheck.headSha) {
      throw new GitHubAdapterError('Check target differs from the atomic attempt claim');
    }
    const output = checkOutput(input.caseFile);
    await this.api.updateCheckRun({
      checkRunId: target.checkRunId,
      status: 'completed',
      conclusion: checkConclusion(input.caseFile.outcome),
      detailsUrl: input.artifactUrl,
      ...output,
      annotations: await checkAnnotations(input.checkoutDir, target.headSha, input.caseFile),
    });
  }

  async completeUnexpectedFailure(reason: string): Promise<void> {
    void reason;
    const run = await this.api.getWorkflowRun(integerId(this.options.runId, 'Workflow run id'));
    const check = await this.findCheck(run.headSha);
    if (!check || check.status === 'completed') return;
    await this.api.updateCheckRun({
      checkRunId: check.id,
      status: 'completed',
      conclusion: 'action_required',
      title: 'Sutura stopped unexpectedly',
      summary: 'Sutura stopped after an unexpected provider, sandbox, artifact, or serialization error. Review the action log and rerun after the cause is resolved.',
      annotations: [],
    });
    this.activeCheck = { id: check.id, headSha: check.headSha };
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
