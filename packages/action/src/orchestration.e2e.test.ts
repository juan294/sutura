import { readFile } from 'node:fs/promises';

import {
  AlreadyAttemptedError,
  DEFAULT_MODELS,
  DEFAULT_MODEL_PRICES,
  DEFAULT_ROUTING_PROFILE_ID,
  InMemoryExecutor,
  SUTURA_SANDBOX_ENV,
  attemptMarker,
  orchestrate,
  type CostLedger,
  type FunctionToolCall,
  type OrchestrationContext,
  type OrchestratorLlm,
  type PublishFixInput,
  type RepositoryPort,
  type RepositorySourceExcerpt,
  type SourceReadLimits,
  type SourceReference,
} from '@sutura/core';
import { describe, expect, it } from 'vitest';

import {
  GitHubAdapter,
  type ArtifactApi,
  type GitHubApi,
  type PullRequestRecord,
  type WorkflowJobRecord,
  type WorkflowRunRecord,
} from './github.js';

const RUN_ID = '77001';
const ACTION_RUN_ID = '88001';
const HEAD_SHA = '0123456789abcdef0123456789abcdef01234567';
const CHECKOUT_DIR = '/tmp/sutura-recorded-checkout';
const FIX_TIP_SHA = 'fedcba9876543210fedcba9876543210fedcba98';
const ARTIFACT_URL =
  'https://github.com/acme/widget/actions/runs/88001/artifacts/9001';

const HONEST_DIFF = [
  'diff --git a/src/value.ts b/src/value.ts',
  '--- a/src/value.ts',
  '+++ b/src/value.ts',
  '@@ -1 +1 @@',
  '-export const value: string = 1;',
  '+export const value: string = "1";',
].join('\n') + '\n';

interface RawWorkflowRun {
  id: number;
  head_sha: string;
  repository: { full_name: string };
  event: string;
  conclusion: string | null;
  pull_requests: Array<{ number: number }>;
}

interface RawPullRequest {
  number: number;
  head: {
    sha: string;
    ref: string;
    repo: { full_name: string } | null;
  };
  base: {
    sha: string;
    ref: string;
  };
}

interface RawJobs {
  total_count: number;
  jobs: Array<{
    id: number;
    name: string;
    conclusion: string | null;
    steps: Array<{
      name: string;
      conclusion: string | null;
      started_at: string | null;
      completed_at: string | null;
    }>;
  }>;
}

interface RecordedFixtures {
  workflowRun: RawWorkflowRun;
  pullRequest: RawPullRequest;
  jobs: RawJobs;
  jobLog: string;
}

interface RecordedComment {
  id: number;
  body: string;
  authorLogin: string;
}

interface RecordedPullRequestCreation {
  title: string;
  head: string;
  base: string;
  body: string;
}

async function fixtureJson<T>(name: string): Promise<T> {
  const text = await readFile(
    new URL(`./__fixtures__/github-api/${name}`, import.meta.url),
    'utf8',
  );
  return JSON.parse(text) as T;
}

async function loadFixtures(): Promise<RecordedFixtures> {
  const [workflowRun, pullRequest, jobs, jobLog] = await Promise.all([
    fixtureJson<RawWorkflowRun>('workflow-run.json'),
    fixtureJson<RawPullRequest>('pull-request.json'),
    fixtureJson<RawJobs>('jobs.json'),
    readFile(
      new URL('./__fixtures__/github-api/job-501.log', import.meta.url),
      'utf8',
    ),
  ]);
  return { workflowRun, pullRequest, jobs, jobLog };
}

class RecordedGitHubApi implements GitHubApi {
  readonly comments: RecordedComment[] = [];
  readonly createdPullRequests: RecordedPullRequestCreation[] = [];
  readonly downloadedJobIds: number[] = [];
  readonly fixBranches = new Map<string, string>();
  private readonly commitParents = new Map<string, string[]>();
  private readonly claimRefs = new Set<string>();
  private nextCommentId = 7001;
  readonly checks: Array<{ id: number; headSha: string; externalId: string; name: string; status: string; conclusion: string | null; detailsUrl?: string }> = [];

  constructor(private readonly fixtures: RecordedFixtures) {}

  async getWorkflowRun(runId: number): Promise<WorkflowRunRecord> {
    const run = this.fixtures.workflowRun;
    if (runId !== run.id) throw new Error(`Unexpected run ${runId}`);
    return {
      id: run.id,
      headSha: run.head_sha,
      repository: run.repository.full_name,
      event: run.event,
      conclusion: run.conclusion,
      pullRequests: run.pull_requests,
    };
  }

  async listPullRequestsForCommit(): Promise<Array<{ number: number }>> {
    throw new Error('The recorded workflow run must resolve its exact PR directly');
  }

  async getPullRequest(number: number): Promise<PullRequestRecord> {
    const pull = this.fixtures.pullRequest;
    if (number !== pull.number) throw new Error(`Unexpected PR ${number}`);
    return {
      number: pull.number,
      headSha: pull.head.sha,
      headRef: pull.head.ref,
      headRepo: pull.head.repo?.full_name ?? null,
      baseSha: pull.base.sha,
      baseRef: pull.base.ref,
    };
  }

  async listJobsForWorkflowRun(runId: number): Promise<WorkflowJobRecord[]> {
    if (runId !== this.fixtures.workflowRun.id) {
      throw new Error(`Unexpected jobs request for ${runId}`);
    }
    return this.fixtures.jobs.jobs.map((job) => ({
      id: job.id,
      name: job.name,
      conclusion: job.conclusion,
      steps: job.steps.map((step) => ({
        name: step.name,
        conclusion: step.conclusion,
        startedAt: step.started_at,
        completedAt: step.completed_at,
      })),
    }));
  }

  async downloadJobLogs(jobId: number): Promise<string> {
    if (jobId !== 501) throw new Error(`Unexpected job log ${jobId}`);
    this.downloadedJobIds.push(jobId);
    return this.fixtures.jobLog;
  }

  async listIssueComments(): Promise<RecordedComment[]> {
    return this.comments.map((comment) => ({ ...comment }));
  }

  async listCommitComments(): Promise<RecordedComment[]> {
    return this.comments.map((comment) => ({ ...comment }));
  }

  async createRef(ref: string, sha: string): Promise<void> {
    if (sha !== HEAD_SHA) throw new Error('Attempt tag did not use the exact PR head');
    if (this.claimRefs.has(ref)) {
      throw Object.assign(new Error('Reference exists'), { status: 422 });
    }
    this.claimRefs.add(ref);
  }

  async deleteRef(ref: string): Promise<void> {
    this.claimRefs.delete(`refs/${ref}`);
  }

  async createIssueComment(issueNumber: number, body: string): Promise<{ id: number }> {
    if (issueNumber !== 42) throw new Error(`Unexpected issue ${issueNumber}`);
    const id = this.nextCommentId;
    this.nextCommentId += 1;
    this.comments.push({ id, body, authorLogin: 'github-actions[bot]' });
    return { id };
  }

  async createCommitComment(_sha: string, body: string): Promise<{ id: number }> {
    const id = this.nextCommentId;
    this.nextCommentId += 1;
    this.comments.push({ id, body, authorLogin: 'github-actions[bot]' });
    return { id };
  }

  async updateIssueComment(commentId: number, body: string): Promise<void> {
    const comment = this.comments.find(({ id }) => id === commentId);
    if (!comment) throw new Error(`Unknown comment ${commentId}`);
    comment.body = body;
  }

  async updateCommitComment(commentId: number, body: string): Promise<void> {
    await this.updateIssueComment(commentId, body);
  }

  async getRefSha(ref: string): Promise<string> {
    const sha = this.fixBranches.get(ref);
    if (!sha) throw new Error(`Unknown branch ${ref}`);
    return sha;
  }

  async getCommitParents(sha: string): Promise<string[]> {
    return this.commitParents.get(sha) ?? [];
  }

  async getCommitSha(sha: string): Promise<string> {
    return sha;
  }

  async createPullRequest(
    input: RecordedPullRequestCreation,
  ): Promise<{ number: number; url: string }> {
    this.createdPullRequests.push(input);
    return { number: 43, url: 'https://github.test/acme/widget/pull/43' };
  }

  async listCheckRunsForRef(ref: string) {
    return this.checks.filter(({ headSha }) => headSha === ref).map((check) => ({ ...check }));
  }

  async createCheckRun(input: { name: string; headSha: string; externalId: string; status: 'in_progress'; title: string; summary: string }): Promise<{ id: number }> {
    const id = 8001;
    this.checks.push({ id, headSha: input.headSha, externalId: input.externalId, name: input.name, status: input.status, conclusion: null });
    return { id };
  }

  async updateCheckRun(input: { checkRunId: number; status: 'completed'; conclusion: 'neutral' | 'action_required'; detailsUrl?: string }): Promise<void> {
    const check = this.checks.find(({ id }) => id === input.checkRunId);
    if (!check) throw new Error(`Unknown check ${input.checkRunId}`);
    check.status = input.status;
    check.conclusion = input.conclusion;
    if (input.detailsUrl !== undefined) check.detailsUrl = input.detailsUrl;
  }

  publishBranch(branch: string, parentSha: string): void {
    this.fixBranches.set(`heads/${branch}`, FIX_TIP_SHA);
    this.commitParents.set(FIX_TIP_SHA, [parentSha]);
  }
}

class CapturingGitHubAdapter extends GitHubAdapter {
  readonly resolvedRuns: Awaited<ReturnType<GitHubAdapter['getFailingRun']>>[] = [];

  override async getFailingRun(
    runId: string,
  ): Promise<Awaited<ReturnType<GitHubAdapter['getFailingRun']>>> {
    const run = await super.getFailingRun(runId);
    this.resolvedRuns.push(run);
    return run;
  }
}

class RecordedArtifactApi implements ArtifactApi {
  readonly uploads: Array<{
    name: string;
    files: string[];
    rootDirectory: string;
    html: string;
  }> = [];

  async uploadArtifact(
    name: string,
    files: string[],
    rootDirectory: string,
  ): Promise<{ id: number }> {
    if (files.length !== 1) throw new Error('Expected one bounded case-file');
    const file = files[0];
    if (!file) throw new Error('Artifact file is missing');
    this.uploads.push({
      name,
      files,
      rootDirectory,
      html: await readFile(file, 'utf8'),
    });
    return { id: 9001 };
  }
}

class RecordedRepository implements RepositoryPort {
  readonly checkouts: Array<{
    repo: string;
    sha: string;
    headRef?: string;
    prNumber?: number;
  }> = [];
  readonly fixes: PublishFixInput[] = [];
  readonly sourceRequests: SourceReference[][] = [];

  constructor(private readonly api: RecordedGitHubApi) {}

  async readPolicyAtSha(): Promise<string | null> {
    return null;
  }

  async checkoutHead(
    repo: string,
    sha: string,
    headRef?: string,
    prNumber?: number,
  ): Promise<string> {
    this.checkouts.push({
      repo,
      sha,
      ...(headRef === undefined ? {} : { headRef }),
      ...(prNumber === undefined ? {} : { prNumber }),
    });
    return CHECKOUT_DIR;
  }

  async readSourceExcerpts(
    checkoutDir: string,
    references: readonly SourceReference[],
    limits: Readonly<SourceReadLimits>,
  ): Promise<RepositorySourceExcerpt[]> {
    if (checkoutDir !== CHECKOUT_DIR) throw new Error('Unexpected checkout directory');
    if (references.length > limits.maxFiles) throw new Error('Unbounded source request');
    this.sourceRequests.push([...references]);
    const sources = new Map([
      ['src/value.ts', 'export const value: string = 1;'],
      ['package.json', '{"scripts":{"test":"vitest run"}}'],
      ['tsconfig.json', '{"compilerOptions":{"strict":true}}'],
    ]);
    return references.flatMap(({ path }) => {
      const content = sources.get(path);
      return content === undefined
        ? []
        : [{ path, startLine: 1, content, truncated: false }];
    });
  }

  async publishFix(input: PublishFixInput): Promise<void> {
    this.fixes.push(input);
    this.api.publishBranch(input.branch, input.headSha);
  }
}

class ScriptedLlm implements OrchestratorLlm {
  readonly calls: Array<'nano' | 'super' | 'ultra'> = [];
  private superCall = 0;

  constructor(private readonly auditApproved: boolean) {}

  modelQuote(tier: 'nano' | 'super' | 'ultra') {
    return {
      role: tier,
      modelId: DEFAULT_MODELS[tier],
      price: DEFAULT_MODEL_PRICES[tier],
      profileId: DEFAULT_ROUTING_PROFILE_ID,
    };
  }

  async chat(
    tier: 'nano' | 'super' | 'ultra',
  ): Promise<{ text: string; toolCalls?: readonly FunctionToolCall[]; usd?: number }> {
    this.calls.push(tier);
    if (tier === 'nano') {
      return {
        text: JSON.stringify({
          class: 'typecheck',
          confidence: 0.99,
          signals: ['TS2322'],
          failingCmd: 'pnpm test',
          errorExcerpt: "TS2322: Type 'number' is not assignable to type 'string'",
        }),
      };
    }
    if (tier === 'super') {
      const steps = [
        ['apply_patch', { diff: HONEST_DIFF }],
        ['run_test', { commandId: 'diagnosed' }],
        ['submit_candidate', { id: 'source', rationale: 'Correct the source value.' }],
      ] as const;
      const [name, args] = steps[Math.min(this.superCall, steps.length - 1)]!;
      this.superCall += 1;
      return {
        text: '',
        usd: 0.001,
        toolCalls: [{
          id: `repair-${this.superCall}`,
          type: 'function',
          function: { name, arguments: JSON.stringify(args) },
        }],
      };
    }
    return {
      text: JSON.stringify({
        approved: this.auditApproved,
        reasoning: this.auditApproved
          ? 'The source repair is scoped to the observed type failure.'
          : 'REFUSED: the proposed repair does not preserve the source contract.',
      }),
    };
  }
}

function ledger(): CostLedger {
  return { entries: [], totalUsd: () => 0 };
}

function executorFor(exits: readonly number[], preparationFails = false): InMemoryExecutor {
  let scenarioIndex = 0;
  let agentPatched = false;
  return new InMemoryExecutor((command) => {
    if (command.includes('git apply - && git diff')) {
      agentPatched = true;
      return {
        exitCode: 0, stdout: HONEST_DIFF, stderr: '', truncated: false, metrics: {},
      };
    }
    if (agentPatched) {
      agentPatched = false;
      const exitCode = exits[scenarioIndex] ?? 1;
      scenarioIndex += 3;
      return {
        exitCode,
        stdout: exitCode === 0 ? 'Tests passed' : '',
        stderr: exitCode === 0 ? '' : 'TS2322',
        truncated: false,
        metrics: {},
      };
    }
    const exitCode = command.includes('install --frozen-lockfile')
      ? preparationFails ? 1 : 0
      : command.includes('git init --quiet')
      ? 0
      : exits[scenarioIndex++] ?? 1;
    return {
      exitCode,
      stdout: exitCode === 0 ? 'Tests passed' : '',
      stderr: exitCode === 0 ? '' : 'TS2322',
      truncated: false,
      metrics: {},
    };
  });
}

interface Storyline {
  name: string;
  exits: number[];
  auditApproved: boolean;
  outcome: 'fixed' | 'flaky-no-patch' | 'refused' | 'gave-up' | 'infra-stop';
  commentSignal: string;
  preparationFails?: boolean;
}

const STORYLINES: Storyline[] = [
  {
    name: 'fixed',
    exits: [1, 1, 1, 0, 1, 1, 0],
    auditApproved: true,
    outcome: 'fixed',
    commentSignal: 'PATCH CERTIFIED',
  },
  {
    name: 'flaky',
    exits: [1, 0, 0],
    auditApproved: true,
    outcome: 'flaky-no-patch',
    commentSignal: 'FLAKY',
  },
  {
    name: 'refused',
    exits: [1, 1, 1, 0, 1, 1, 0],
    auditApproved: false,
    outcome: 'refused',
    commentSignal: 'Pathology',
  },
  {
    name: 'gave-up',
    exits: [1, 1, 1, 1, 1, 1],
    auditApproved: true,
    outcome: 'gave-up',
    commentSignal: 'NO PATCH HELD',
  },
  {
    name: 'infra-stop',
    exits: [],
    auditApproved: true,
    outcome: 'infra-stop',
    commentSignal: 'INFRA — STOPPED',
    preparationFails: true,
  },
];

async function harnessFor(storyline: Storyline): Promise<{
  api: RecordedGitHubApi;
  artifact: RecordedArtifactApi;
  executor: InMemoryExecutor;
  github: CapturingGitHubAdapter;
  llm: ScriptedLlm;
  repository: RecordedRepository;
  ctx: OrchestrationContext;
}> {
  const api = new RecordedGitHubApi(await loadFixtures());
  const artifact = new RecordedArtifactApi();
  const github = new CapturingGitHubAdapter(api, {
    owner: 'acme',
    repo: 'widget',
    runId: RUN_ID,
    actionRunId: ACTION_RUN_ID,
    artifact,
  });
  const repository = new RecordedRepository(api);
  const executor = executorFor(storyline.exits, storyline.preparationFails);
  const llm = new ScriptedLlm(storyline.auditApproved);
  const ctx: OrchestrationContext = {
    runId: RUN_ID,
    github,
    repository,
    executor,
    llm,
    cost: ledger(),
    triageN: 2,
    raceK: 3,
    runtimeId: 'node',
  };
  return { api, artifact, executor, github, llm, repository, ctx };
}

describe('recorded GitHub API orchestration E2E', () => {
  it.each(STORYLINES)(
    'resolves the exact recorded PR and completes the $name storyline once',
    async (storyline) => {
      const previousSecret = process.env.RECORDED_GITHUB_SECRET;
      process.env.RECORDED_GITHUB_SECRET = 'must-not-reach-contree';
      try {
        const harness = await harnessFor(storyline);

        const caseFile = await orchestrate(harness.ctx);

        expect(caseFile.outcome).toBe(storyline.outcome);
        expect(harness.github.resolvedRuns[0]).toMatchObject({
          runId: RUN_ID,
          repo: 'acme/widget',
          prNumber: 42,
          headSha: HEAD_SHA,
          headRef: 'feature/broken-build',
        });
        const failedLog = harness.github.resolvedRuns[0]?.failedSteps[0]?.log;
        expect(failedLog?.split('\n')).toHaveLength(200);
        expect(failedLog).toContain('failure-005');
        expect(failedLog).toContain('failure-203');
        expect(failedLog).toContain('Run pnpm test');
        expect(failedLog).not.toContain('failure-004');
        expect(failedLog).not.toContain('setup-noise');
        expect(harness.api.downloadedJobIds).toEqual([501]);
        expect(harness.repository.checkouts).toEqual([{
          repo: 'acme/widget',
          sha: HEAD_SHA,
          headRef: 'feature/broken-build',
          prNumber: 42,
        }]);

        const runCalls = harness.executor.calls.filter(({ kind }) => kind === 'run');
        expect(runCalls.length).toBeGreaterThan(0);
        for (const call of runCalls) {
          if (call.kind !== 'run') continue;
          expect(call.opts?.env).toEqual(SUTURA_SANDBOX_ENV);
          expect(call.opts?.env).not.toHaveProperty('RECORDED_GITHUB_SECRET');
        }

        expect(harness.artifact.uploads).toHaveLength(1);
        expect(harness.artifact.uploads[0]?.name).toBe(
          `sutura-case-file-${RUN_ID}.html`,
        );
        expect(harness.artifact.uploads[0]?.html).toContain('<!doctype html>');
        expect(harness.api.comments).toHaveLength(1);
        expect(harness.api.comments[0]?.body).toContain(attemptMarker(RUN_ID));
        expect(harness.api.comments[0]?.body).toContain(storyline.commentSignal);
        expect(harness.api.comments[0]?.body).toContain(ARTIFACT_URL);
        expect(harness.api.checks).toEqual([
          expect.objectContaining({
            id: 8001,
            headSha: HEAD_SHA,
            externalId: `sutura:acme/widget:workflow-run:${RUN_ID}`,
            status: 'completed',
            conclusion: storyline.outcome === 'fixed' || storyline.outcome === 'flaky-no-patch'
              ? 'neutral'
              : 'action_required',
            detailsUrl: ARTIFACT_URL,
          }),
        ]);

        if (storyline.outcome === 'fixed') {
          expect(harness.repository.fixes).toEqual([
            expect.objectContaining({
              branch: `sutura/fix-${RUN_ID}`,
              checkoutDir: CHECKOUT_DIR,
              diff: HONEST_DIFF,
              headSha: HEAD_SHA,
            }),
          ]);
          expect(harness.api.fixBranches.get(`heads/sutura/fix-${RUN_ID}`)).toBe(
            FIX_TIP_SHA,
          );
          expect(harness.api.createdPullRequests).toEqual([
            expect.objectContaining({
              head: `acme:sutura/fix-${RUN_ID}`,
              base: 'feature/broken-build',
              body: expect.stringContaining(ARTIFACT_URL),
            }),
          ]);
        } else {
          expect(harness.repository.fixes).toEqual([]);
          expect(harness.api.fixBranches.size).toBe(0);
          expect(harness.api.createdPullRequests).toEqual([]);
        }
        if (storyline.outcome === 'gave-up') {
          expect(caseFile.race).toEqual([]);
        }

        const mutationCounts = {
          artifacts: harness.artifact.uploads.length,
          comments: harness.api.comments.length,
          executor: harness.executor.calls.length,
          fixes: harness.repository.fixes.length,
          llm: harness.llm.calls.length,
          pulls: harness.api.createdPullRequests.length,
          checks: JSON.stringify(harness.api.checks),
        };
        await expect(orchestrate(harness.ctx)).rejects.toBeInstanceOf(
          AlreadyAttemptedError,
        );
        expect({
          artifacts: harness.artifact.uploads.length,
          comments: harness.api.comments.length,
          executor: harness.executor.calls.length,
          fixes: harness.repository.fixes.length,
          llm: harness.llm.calls.length,
          pulls: harness.api.createdPullRequests.length,
          checks: JSON.stringify(harness.api.checks),
        }).toEqual(mutationCounts);
      } finally {
        if (previousSecret === undefined) {
          delete process.env.RECORDED_GITHUB_SECRET;
        } else {
          process.env.RECORDED_GITHUB_SECRET = previousSecret;
        }
      }
    },
  );
});
