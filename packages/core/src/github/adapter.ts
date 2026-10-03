import type {
  AttemptTarget,
  CompleteCheckInput,
  CompleteRepairCheckInput,
  CreateFixPullRequestInput,
  FailingWorkflowRun,
  FixPullRequest,
  GitHubOrchestrationPort,
} from '../orchestrate.js';
import { REPAIR_BRANCH_PREFIX, RepairBranchRunError } from '../orchestrate.js';
import { HEADER_BLOCK_LINES } from '../text/bounded-tail.js';
import {
  checkAnnotations, checkConclusion, checkExternalId, checkOutput, repairCheckOutput,
  SUTURA_CHECK_NAME, SUTURA_REPAIR_CHECK_NAME,
} from './checks.js';
import type { GitHubAdapterOptions, GitHubApi } from './types.js';

const FAILED_CONCLUSIONS = new Set(['failure', 'timed_out']);
const FAILED_STEP_LINES = 200;
const FAILURE_BLOCKS = 2;
const FAILURE_BLOCK_LINES = 40;
const GROUP_RUN_MARKER = /^\S+Z ##\[group\]Run\s/;
const TAP_FAILURE = /^\s*not ok \d+\b/u;
const TAP_DIRECTIVE = /\s#\s*(?:TODO|SKIP)\b/iu;
const TAP_PARENT_SUMMARY = /^\s*failureType: 'subtestsFailed'$/u;
const VITEST_RUN_LINE = /(?:^|\s)RUN\s+v\d[\w.+-]*\s+\S+\s*$/u;
const RUN_CONTEXT_LINES = 8;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;

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

interface TimestampedLogLine { line: string; time: number }

function parseTimestampedLog(log: string): TimestampedLogLine[] {
  const lines: TimestampedLogLine[] = [];
  let lastTime: number | null = null;
  const rawLines = log.split(/\r?\n/);
  if (log.endsWith('\n')) rawLines.pop();
  for (const line of rawLines) {
    const time = timestamp(line);
    if (time !== null) lastTime = time;
    // GitHub emits multiline errors with a timestamp only on their first line.
    // Keep the continuation in that step so assertion locations reach repair.
    if (lastTime !== null) lines.push({ line, time: lastTime });
  }
  return lines;
}

function failedStepLog(
  lines: readonly TimestampedLogLine[],
  step: { name: string; startedAt: string | null; completedAt: string | null },
): string {
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
  let groupIndex = matching.findIndex(({ line }) => line.includes(groupMarker));
  if (groupIndex < 0) {
    // GitHub timestamps step bounds to whole seconds, while log lines have
    // subsecond precision. A later `if: always()` action can therefore start
    // inside the failed step's inclusive end second. Select the Run group
    // containing the error, rather than that later action's Run group.
    const errorIndex = matching.findIndex(({ line }) => line.includes('##[error]'));
    groupIndex = errorIndex < 0
      ? matching.findIndex(({ line }) => GROUP_RUN_MARKER.test(line))
      : matching.findLastIndex(({ line }, index) =>
        index <= errorIndex && GROUP_RUN_MARKER.test(line));
  }
  if (groupIndex >= 0) {
    const nextGroup = matching.findIndex(({ line }, index) =>
      index > groupIndex && GROUP_RUN_MARKER.test(line));
    matching = matching.slice(groupIndex, nextGroup < 0 ? undefined : nextGroup);
  }
  if (matching.length === 0) {
    throw new GitHubAdapterError(`Job logs contain no lines for failed step ${step.name}`);
  }
  if (matching.length <= FAILED_STEP_LINES) return matching.map(({ line }) => line).join('\n');
  const kept = new Set<number>();
  if (groupIndex >= 0) {
    for (let index = 0; index <= scriptBlockEnd(matching); index += 1) kept.add(index);
  }
  for (const [start, end] of tapFailureBlocks(matching, kept.size)) {
    for (let index = start; index <= end; index += 1) kept.add(index);
  }
  // Each vitest run line names the package its later file paths are relative to.
  for (const index of runContextLines(matching)) kept.add(index);
  for (let index = matching.length - 1; index >= 0 && kept.size < FAILED_STEP_LINES; index -= 1) {
    kept.add(index);
  }
  return [...kept].sort((left, right) => left - right).map((index) => matching[index]?.line).join('\n');
}

function runContextLines(lines: readonly TimestampedLogLine[]): number[] {
  const indexes = lines.flatMap(({ line }, index) => VITEST_RUN_LINE.test(logPayload(line).replace(/\x1b\[[0-9;]*m/gu, '').trimEnd()) ? [index] : []);
  return indexes.slice(-RUN_CONTEXT_LINES);
}

function logPayload(line: string): string {
  return line.replace(/^\S+Z ?/u, '');
}

/**
 * Last index of a `Run` group's script echo. GitHub prints a multi-line
 * script between the header and its `shell:` line; the header alone holds
 * only the first script line, which is not the command.
 */
function scriptBlockEnd(lines: readonly TimestampedLogLine[]): number {
  const limit = Math.min(lines.length, HEADER_BLOCK_LINES + 1);
  for (let index = 1; index < limit; index += 1) {
    const payload = logPayload(lines[index]?.line ?? '');
    if (payload.startsWith('##[endgroup]')) return 0;
    if (payload.startsWith('shell:')) return index;
  }
  return 0;
}

/**
 * Inclusive ranges of the first TAP failures and their YAML diagnostics.
 * `node --test` reports TAP outside a terminal and prints no failure summary,
 * so in a long step the only failure can sit far above the retained tail.
 * TODO/SKIP directives and a parent's summary of its failed subtests (which
 * follows the subtest's own block) are not failures of their own.
 */
function tapFailureBlocks(lines: readonly TimestampedLogLine[], from: number): Array<[number, number]> {
  const blocks: Array<[number, number]> = [];
  for (let index = from; index < lines.length && blocks.length < FAILURE_BLOCKS; index += 1) {
    const payload = logPayload(lines[index]?.line ?? '');
    if (!TAP_FAILURE.test(payload)) continue;
    let end = index;
    let parentSummary = false;
    const limit = Math.min(lines.length - 1, index + FAILURE_BLOCK_LINES - 1);
    while (end < limit) {
      end += 1;
      const yaml = logPayload(lines[end]?.line ?? '');
      if (TAP_PARENT_SUMMARY.test(yaml)) parentSummary = true;
      if (yaml.trim() === '...') break;
    }
    if (!TAP_DIRECTIVE.test(payload) && !parentSummary) blocks.push([index, end]);
    index = end;
  }
  return blocks;
}

function apiStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * A claim comment is Sutura's own when the workflow token wrote it, or when a
 * GitHub App token (`<app>[bot]`) wrote it and it names the claimed check run.
 * User logins cannot contain brackets, and the check-run id keeps another
 * installed app that echoes the marker from passing for Sutura.
 */
function isClaimComment(
  comment: { body: string | null; authorLogin: string | null },
  marker: string,
  checkRunId: number,
): boolean {
  if (!comment.body?.includes(marker)) return false;
  if (comment.authorLogin === 'github-actions[bot]') return true;
  return comment.authorLogin !== null &&
    /^[A-Za-z0-9][A-Za-z0-9-]*\[bot\]$/u.test(comment.authorLogin) &&
    comment.body.includes(`<!-- sutura-check-run:${checkRunId} -->`);
}

function validBranch(value: string): boolean {
  return BRANCH_PATTERN.test(value) && !value.endsWith('/') && !value.endsWith('.') &&
    !value.includes('..') && !value.includes('//') && !value.includes('@{') &&
    !/[\\~^:?*[\]]/.test(value) &&
    value.split('/').every((part) => part && !part.startsWith('.') && !part.endsWith('.lock'));
}

export class GitHubAdapter implements GitHubOrchestrationPort {
  private readonly repository: string;
  private activeCheck: { id: number; headSha: string } | undefined;
  private activeAttempt: { target: AttemptTarget; marker: string } | undefined;

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
    if (workflowRun.id !== numericRunId ||
      workflowRun.repository.toLowerCase() !== this.repository.toLowerCase() ||
      !FAILED_CONCLUSIONS.has(workflowRun.conclusion ?? '') ||
      !SHA_PATTERN.test(workflowRun.headSha)) {
      throw new GitHubAdapterError('Workflow run metadata does not match the action event');
    }
    if (workflowRun.headBranch?.startsWith(REPAIR_BRANCH_PREFIX)) {
      throw new RepairBranchRunError(runId, workflowRun.headBranch);
    }

    let prNumber: number | undefined;
    let targetBranch: { headRef: string; baseSha: string; baseRef: string } | undefined;
    if (workflowRun.event === 'pull_request' || workflowRun.event === 'workflow_dispatch') {
      const candidates = workflowRun.pullRequests.length > 0
        ? workflowRun.pullRequests
        : await this.api.listPullRequestsForCommit(workflowRun.headSha);
      const unique = [...new Set(candidates.map(({ number }) => number))];
      if (workflowRun.event === 'pull_request' &&
        (unique.length !== 1 || !Number.isSafeInteger(unique[0]) || (unique[0] ?? 0) <= 0)) {
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
        if (!SHA_PATTERN.test(pullRequest.baseSha) || !validBranch(pullRequest.baseRef) ||
          (await this.api.getCommitSha(pullRequest.baseSha)).toLowerCase() !==
            pullRequest.baseSha.toLowerCase()) {
          throw new GitHubAdapterError('Pull request base commit is invalid');
        }
        prNumber = pullRequest.number;
        targetBranch = {
          headRef: pullRequest.headRef,
          baseSha: pullRequest.baseSha,
          baseRef: pullRequest.baseRef,
        };
      }
    }
    if (targetBranch === undefined) {
      if (!workflowRun.headBranch || !validBranch(workflowRun.headBranch)) {
        throw new GitHubAdapterError('Workflow run head branch is invalid');
      }
      const branchTip = await this.api.getRefSha(`heads/${workflowRun.headBranch}`);
      if (!SHA_PATTERN.test(branchTip) ||
        branchTip.toLowerCase() !== workflowRun.headSha.toLowerCase()) {
        throw new GitHubAdapterError('Workflow run head branch no longer matches the failing SHA');
      }
      targetBranch = {
        headRef: workflowRun.headBranch,
        baseSha: workflowRun.headSha,
        baseRef: workflowRun.headBranch,
      };
    }
    const { headRef, baseSha, baseRef } = targetBranch;
    const jobs = await this.api.listJobsForWorkflowRun(numericRunId);
    const failedSteps: FailingWorkflowRun['failedSteps'] = [];
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
          ...(step.completedAt ? { completedAt: step.completedAt } : {}),
        });
      }
    }
    if (failedSteps.length === 0) {
      throw new GitHubAdapterError('Workflow run has no failed-step logs');
    }
    return {
      runId, repo: this.repository,
      ...(prNumber === undefined ? {} : { prNumber }),
      headSha: workflowRun.headSha, headRef, baseSha, baseRef, failedSteps,
    };
  }

  private async findCheck(headSha: string): Promise<{ id: number; headSha: string; status: string } | undefined> {
    const externalId = checkExternalId(this.repository, this.options.runId);
    const matches = (await this.api.listCheckRunsForRef(headSha)).filter((check) =>
      check.name === SUTURA_CHECK_NAME && check.externalId === externalId &&
      check.headSha.toLowerCase() === headSha.toLowerCase(),
    );
    if (matches.length > 1) throw new GitHubAdapterError('Multiple Sutura checks match this workflow run');
    return matches[0];
  }

  async claimAttempt(prNumber: number | undefined, marker: string): Promise<AttemptTarget | null> {
    const numericRunId = integerId(this.options.runId, 'Workflow run id');
    const run = await this.api.getWorkflowRun(numericRunId);
    if (run.id !== numericRunId || run.repository.toLowerCase() !== this.repository.toLowerCase() ||
      !FAILED_CONCLUSIONS.has(run.conclusion ?? '') || !SHA_PATTERN.test(run.headSha)) {
      throw new GitHubAdapterError('Workflow run metadata changed before claim');
    }
    try {
      await this.api.createRef(`refs/tags/sutura-attempt-${this.options.runId}`, run.headSha);
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
      if (!this.activeCheck) {
        const created = await this.api.createCheckRun({
          name: SUTURA_CHECK_NAME, headSha: run.headSha,
          externalId: checkExternalId(this.repository, this.options.runId),
          status: 'in_progress', title: 'Sutura repair audit in progress',
          summary: `Analyzing failed workflow run ${this.options.runId}.`,
        });
        if (!Number.isSafeInteger(created.id) || created.id <= 0) {
          throw new GitHubAdapterError('GitHub returned an invalid check-run id');
        }
        this.activeCheck = { id: created.id, headSha: run.headSha };
      }
      const checkRunId = this.activeCheck.id;
      const existingComment = comments.find((comment) => isClaimComment(comment, marker, checkRunId));
      if (existingComment) {
        this.activeAttempt = {
          marker,
          target: {
            kind: prNumber === undefined ? 'commit' : 'pull-request',
            commentId: existingComment.id,
            checkRunId: this.activeCheck.id,
            headSha: run.headSha,
          },
        };
        return null;
      }
      const body = `${marker}\n<!-- sutura-check-run:${this.activeCheck.id} -->\nSutura claimed this failed run and is starting analysis.`;
      const comment = prNumber === undefined
        ? await this.api.createCommitComment(run.headSha, body)
        : await this.api.createIssueComment(prNumber, body);
      const target: AttemptTarget = {
        kind: prNumber === undefined ? 'commit' : 'pull-request',
        commentId: comment.id, checkRunId: this.activeCheck.id, headSha: run.headSha,
      };
      this.activeAttempt = { target, marker };
      if (recoveredExistingCheck) return null;
      return target;
    } finally {
      await this.api.deleteRef(`tags/sutura-attempt-${this.options.runId}`);
    }
  }

  async updateAttempt(target: AttemptTarget, body: string): Promise<void> {
    if (target.kind === 'commit') {
      await this.api.updateCommitComment(target.commentId, body);
    } else {
      await this.api.updateIssueComment(target.commentId, body);
    }
  }

  async completeCheck(target: AttemptTarget, input: CompleteCheckInput): Promise<void> {
    if (target.checkRunId !== this.activeCheck?.id || target.headSha !== this.activeCheck.headSha) {
      throw new GitHubAdapterError('Check target differs from the atomic attempt claim');
    }
    await this.api.updateCheckRun({
      checkRunId: target.checkRunId, status: 'completed',
      conclusion: checkConclusion(input.caseFile.outcome), detailsUrl: input.artifactUrl,
      ...checkOutput(input.caseFile),
      annotations: await checkAnnotations(input.checkoutDir, target.headSha, input.caseFile),
    });
  }

  async completeUnexpectedFailure(reason: string): Promise<void> {
    void reason;
    const run = await this.api.getWorkflowRun(integerId(this.options.runId, 'Workflow run id'));
    const check = await this.findCheck(run.headSha);
    if (!check || check.status === 'completed') return;
    await this.api.updateCheckRun({
      checkRunId: check.id, status: 'completed', conclusion: 'action_required',
      title: 'Sutura stopped unexpectedly',
      summary: 'Sutura stopped after an unexpected provider, sandbox, artifact, or serialization error. Review the action log and rerun after the cause is resolved.',
      annotations: [],
    });
    this.activeCheck = { id: check.id, headSha: check.headSha };
    if (this.activeAttempt) {
      const body = `${this.activeAttempt.marker}\n<!-- sutura-check-run:${check.id} -->\nSutura stopped unexpectedly. Review the completed check and action log before retrying.`;
      await this.updateAttempt(this.activeAttempt.target, body);
    }
  }

  async createFixPullRequest(input: CreateFixPullRequestInput): Promise<FixPullRequest> {
    if (!validBranch(input.branch) || !validBranch(input.baseRef)) {
      throw new GitHubAdapterError('Fix or base branch is invalid');
    }
    if (!SHA_PATTERN.test(input.headSha)) throw new GitHubAdapterError('Fix base SHA is invalid');
    const tip = await this.api.getRefSha(`heads/${input.branch}`);
    const parents = await this.api.getCommitParents(tip);
    if (!parents.some((sha) => sha.toLowerCase() === input.headSha.toLowerCase())) {
      throw new GitHubAdapterError('Fix branch is not based on the exact failing SHA');
    }
    const pullRequest = await this.api.createPullRequest({
      title: input.title, head: `${this.options.owner}:${input.branch}`,
      base: input.baseRef, body: input.body,
    });
    return { ...pullRequest, headSha: tip };
  }

  async completeRepairCheck(input: CompleteRepairCheckInput): Promise<void> {
    if (input.caseFile.outcome !== 'fixed') {
      throw new GitHubAdapterError('Only a fixed outcome has a repair commit to check');
    }
    if (!SHA_PATTERN.test(input.pullRequest.headSha)) {
      throw new GitHubAdapterError('Repair commit SHA is invalid');
    }
    const created = await this.api.createCheckRun({
      name: SUTURA_REPAIR_CHECK_NAME, headSha: input.pullRequest.headSha,
      externalId: `${checkExternalId(this.repository, this.options.runId)}:repair`,
      status: 'in_progress', title: 'Sutura repair verification in progress',
      summary: `Recording the sandbox verification for workflow run ${this.options.runId}.`,
    });
    if (!Number.isSafeInteger(created.id) || created.id <= 0) {
      throw new GitHubAdapterError('GitHub returned an invalid check-run id');
    }
    await this.api.updateCheckRun({
      checkRunId: created.id, status: 'completed', conclusion: 'neutral',
      detailsUrl: input.artifactUrl,
      ...repairCheckOutput(input.caseFile, this.options.runId, input.pullRequest.url),
      annotations: [],
    });
  }

  uploadCaseFile(name: string, html: string): Promise<{ url: string }> {
    return this.uploadTextArtifact(name, html, 'html');
  }

  uploadReplayBundle(name: string, json: string): Promise<{ url: string }> {
    return this.uploadTextArtifact(name, json, 'json');
  }

  private uploadTextArtifact(
    name: string,
    content: string,
    extension: 'html' | 'json',
  ): Promise<{ url: string }> {
    if (!this.options.artifact) throw new GitHubAdapterError('Artifact client is unavailable');
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(name) || !name.endsWith(`.${extension}`)) {
      throw new GitHubAdapterError('Artifact name is invalid');
    }
    return this.options.artifact.uploadTextArtifact(name, content, extension);
  }
}
