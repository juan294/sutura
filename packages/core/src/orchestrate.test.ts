import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_MODELS } from './config.js';
import type {
  AuditVerdict,
  Candidate,
  CostLedger,
  Diagnosis,
} from './domain.js';
import { InMemoryExecutor } from './executor/memory.js';
import type { InMemoryCall, InMemoryRunResult } from './executor/memory.js';
import { completedTriageVerdict, notRunTriageVerdict } from './engine/triage.js';
import type { TierLlm } from './llm/types.js';
import { DEFAULT_MODEL_PRICES } from './llm/cost.js';
import { DEFAULT_ROUTING_PROFILE_ID } from './llm/router.js';
import { parseRepositoryPolicy } from './policy/schema.js';
import {
  AlreadyAttemptedError,
  SUTURA_SANDBOX_ENV,
  attemptMarker,
  collectFailedLogs,
  extractSourceReferences,
  orchestrate,
  readRepairSourceContext,
  type AttemptTarget,
  type FailingWorkflowRun,
  type GitHubOrchestrationPort,
  type OrchestrationContext,
  type RepositoryPort,
} from './orchestrate.js';

const HONEST_DIFF = [
  'diff --git a/src/value.ts b/src/value.ts',
  '--- a/src/value.ts',
  '+++ b/src/value.ts',
  '@@ -1,1 +1,1 @@',
  '-export const value: string = 1;',
  '+export const value: string = "1";',
].join('\n') + '\n';

const SECOND_DIFF = HONEST_DIFF.replace(
  '+export const value: string = "1";',
  '+export const value: string = String(1);',
);
const THIRD_DIFF = HONEST_DIFF.replace(
  '+export const value: string = "1";',
  '+export const result: string = "1";',
);

const DOGFOOD_DIFF = [
  'diff --git a/packages/core/src/dogfood-add.ts b/packages/core/src/dogfood-add.ts',
  '--- a/packages/core/src/dogfood-add.ts',
  '+++ b/packages/core/src/dogfood-add.ts',
  '@@ -1,3 +1,3 @@',
  ' export function add(left: number, right: number): number {',
  '-  return left - right;',
  '+  return left + right;',
  ' }',
  '',
].join('\n');

const RUN: FailingWorkflowRun = {
  runId: '98765',
  repo: 'acme/widget',
  prNumber: 42,
  headSha: '0123456789abcdef0123456789abcdef01234567',
  headRef: 'feature/broken-build',
  baseSha: '89abcdef0123456789abcdef0123456789abcdef',
  baseRef: 'develop',
  failedSteps: [
    {
      jobName: 'test',
      stepName: 'Run tests',
      log: 'Run pnpm test\nsrc/value.ts(1,14): error TS2322: Type number is not assignable to type string',
    },
  ],
};

class FakeGitHub implements GitHubOrchestrationPort {
  readonly comments: Array<{ id: number; prNumber: number | undefined; body: string }> = [];
  readonly pullRequests: Array<{
    baseRef: string;
    branch: string;
    body: string;
    headSha: string;
    title: string;
  }> = [];
  readonly artifacts: Array<{ name: string; html: string }> = [];
  readonly checks: Array<{ target: AttemptTarget; input: import('./orchestrate.js').CompleteCheckInput }> = [];

  constructor(readonly run = RUN) {}

  async getFailingRun(runId: string): Promise<FailingWorkflowRun> {
    expect(runId).toBe(this.run.runId);
    return this.run;
  }

  async claimAttempt(
    prNumber: number | undefined,
    marker: string,
  ): Promise<AttemptTarget | null> {
    if (this.comments.some(
      (comment) => comment.prNumber === prNumber && comment.body.includes(marker),
    )) return null;
    const id = this.comments.length + 1;
    this.comments.push({ id, prNumber, body: marker });
    return {
      kind: prNumber === undefined ? 'commit' : 'pull-request',
      commentId: id,
      checkRunId: 700 + id,
      headSha: this.run.headSha,
    };
  }

  async updateAttempt(target: AttemptTarget, body: string): Promise<void> {
    const comment = this.comments.find(({ id }) => id === target.commentId);
    if (!comment) throw new Error(`Unknown comment ${String(target.commentId)}`);
    comment.body = body;
  }

  async createFixPullRequest(input: {
    baseRef: string;
    branch: string;
    body: string;
    headSha: string;
    title: string;
  }): Promise<{ number: number; url: string }> {
    this.pullRequests.push(input);
    return { number: 43, url: 'https://github.test/acme/widget/pull/43' };
  }

  async uploadCaseFile(name: string, html: string): Promise<{ url: string }> {
    this.artifacts.push({ name, html });
    return { url: `https://github.test/artifacts/${name}` };
  }

  async completeCheck(target: AttemptTarget, input: import('./orchestrate.js').CompleteCheckInput): Promise<void> {
    this.checks.push({ target, input });
  }
}

class FakeRepository implements RepositoryPort {
  readonly checkouts: Array<{ repo: string; sha: string }> = [];
  readonly fixes: Array<{
    branch: string;
    checkoutDir: string;
    diff: string;
    headSha: string;
    message: string;
  }> = [];
  readonly sourceReads: Array<{
    checkoutDir: string;
    paths: string[];
  }> = [];
  readonly sources = new Map([
    ['src/value.ts', 'export const value: string = 1;\n'],
  ]);
  policyContent: string | null = null;
  readonly policyReads: Array<{ repo: string; sha: string }> = [];

  async readPolicyAtSha(repo: string, sha: string): Promise<string | null> {
    this.policyReads.push({ repo, sha });
    return this.policyContent;
  }

  async checkoutHead(repo: string, sha: string): Promise<string> {
    this.checkouts.push({ repo, sha });
    return '/tmp/exact-pr-head';
  }

  async readSourceExcerpts(
    checkoutDir: string,
    references: readonly { path: string; line?: number }[],
    _limits: {
      maxFiles: number;
      maxLinesPerFile: number;
      maxCharactersPerFile: number;
      maxBytesPerFile: number;
    },
  ): Promise<Array<{
    path: string;
    startLine: number;
    content: string;
    truncated: boolean;
  }>> {
    expect(_limits).toEqual({
      maxFiles: 8,
      maxLinesPerFile: 120,
      maxCharactersPerFile: 12_000,
      maxBytesPerFile: 12_000,
    });
    this.sourceReads.push({
      checkoutDir,
      paths: references.map(({ path }) => path),
    });
    return references.flatMap(({ path }) => {
      const content = this.sources.get(path);
      return content === undefined
        ? []
        : [{
            path,
            startLine: 1,
            content,
            truncated: false,
          }];
    });
  }

  async publishFix(input: {
    branch: string;
    checkoutDir: string;
    diff: string;
    headSha: string;
    message: string;
  }): Promise<void> {
    this.fixes.push(input);
  }
}

function ledger(): CostLedger {
  return { entries: [], totalUsd: () => 0 };
}

function candidates(): Candidate[] {
  return [
    { id: 'source', rationale: 'correct the source type', diff: HONEST_DIFF },
    { id: 'alternate', rationale: 'use the declared number type', diff: SECOND_DIFF },
    { id: 'rename', rationale: 'rename the invalid binding', diff: THIRD_DIFF },
  ];
}

function diagnosisReply(): Diagnosis {
  return {
    class: 'typecheck',
    confidence: 0.98,
    signals: ['TS2322'],
    failingCmd: 'pnpm test',
    errorExcerpt: 'TS2322: Type number is not assignable to type string',
  };
}

function repairProposalReply(candidate: Candidate) {
  const lines = candidate.diff.split('\n');
  const path = lines.find((line) => line.startsWith('+++ b/'))?.slice(6) ?? '';
  const old = lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).map((line) => line.slice(1)).join('\n');
  const replacement = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).map((line) => line.slice(1)).join('\n');
  return { text: JSON.stringify({ id: candidate.id, rationale: candidate.rationale, edits: [{ path, old, new: replacement }] }), usd: 0.001 };
}

function scriptedLlm(auditVerdict: AuditVerdict['approved'] = true): {
  llm: TierLlm<'nano' | 'super' | 'ultra'>;
  chat: ReturnType<typeof vi.fn>;
} {
  const chat = vi.fn(async (tier: 'nano' | 'super' | 'ultra') => {
    if (tier === 'nano') return { text: JSON.stringify(diagnosisReply()) };
    if (tier === 'super') {
      return repairProposalReply(candidates()[0]!);
    }
    return {
      text: JSON.stringify({
        approved: auditVerdict,
        reasoning: auditVerdict
          ? 'The patch corrects the diagnosed source type.'
          : 'REFUSED: the patch changes a different contract.',
      }),
    };
  });
  const modelQuote = (tier: 'nano' | 'super' | 'ultra') => ({
    role: tier,
    modelId: DEFAULT_MODELS[tier],
    price: DEFAULT_MODEL_PRICES[tier],
    profileId: DEFAULT_ROUTING_PROFILE_ID,
  });
  return { llm: { chat, modelQuote }, chat };
}

function runResult(exitCode: number): InMemoryRunResult {
  return {
    exitCode,
    stdout: exitCode === 0 ? 'Tests passed' : '',
    stderr: exitCode === 0 ? '' : 'TS2322',
    truncated: false,
    metrics: {},
  };
}

function context(
  exits: number[],
  auditVerdict = true,
  run = RUN,
): {
  ctx: OrchestrationContext;
  executor: InMemoryExecutor;
  github: FakeGitHub;
  repository: FakeRepository;
  chat: ReturnType<typeof vi.fn>;
} {
  const github = new FakeGitHub(run);
  const repository = new FakeRepository();
  let scenarioIndex = 0;
  let agentPatched = false;
  const executor = new InMemoryExecutor((command) => {
    if (command.includes('git apply - && git diff')) {
      agentPatched = true;
      const encoded = command.match(/printf '%s' '?([A-Za-z0-9+/=]+)'? \|/u)?.[1] ?? '';
      return { ...runResult(0), stdout: Buffer.from(encoded, 'base64').toString('utf8') };
    }
    if (
      command.includes('corepack pnpm install --frozen-lockfile') ||
      command.includes('git init --quiet')
    ) return runResult(0);
    if (agentPatched) {
      agentPatched = false;
      const firstRaceExit = exits[scenarioIndex] ?? 1;
      scenarioIndex += 3;
      return runResult(firstRaceExit);
    }
    return runResult(exits[scenarioIndex++] ?? 1);
  });
  const { llm, chat } = scriptedLlm(auditVerdict);
  return {
    github,
    repository,
    executor,
    chat,
    ctx: {
      runId: run.runId,
      github,
      repository,
      executor,
      llm,
      cost: ledger(),
      triageN: 2,
      raceK: 3,
      runtimeId: 'node',
    },
  };
}

function runCalls(executor: InMemoryExecutor): Extract<InMemoryCall, { kind: 'run' }>[] {
  return executor.calls.filter(
    (call): call is Extract<InMemoryCall, { kind: 'run' }> => call.kind === 'run',
  );
}

describe('orchestrate', () => {
  it('rejects an invalid base policy before provider or sandbox calls', async () => {
    const { ctx, executor, github, repository, chat } = context([]);
    repository.policyContent = '{"version":2}';

    await expect(orchestrate(ctx)).rejects.toThrow(/unsupported policy version/iu);

    expect(repository.policyReads).toEqual([{ repo: RUN.repo, sha: RUN.baseSha }]);
    expect(executor.calls).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
    expect(github.comments).toEqual([]);
  });

  it('binds public evidence to the exact base policy without provider image ids', async () => {
    const { ctx, repository } = context([1, 1, 1, 0, 1, 1, 0]);
    repository.policyContent = JSON.stringify({
      version: 1,
      allowedPaths: ['src/**'],
    });

    const caseFile = await orchestrate(ctx);

    expect(caseFile.policy).toEqual({
      baseRef: RUN.baseRef,
      baseSha: RUN.baseSha,
      policySha: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(caseFile.stages[0]).toMatchObject({
      stage: 'policy',
      nodeId: 'node-001',
      network: 'disabled',
    });
    expect(caseFile.race.every(({ imageId, nodeId }) =>
      imageId === nodeId && /^search-\d{3}$/u.test(nodeId),
    )).toBe(true);
    expect(JSON.stringify(caseFile)).not.toContain('memory-image');
  });

  it('never sends denied paths or their log lines to readers or external providers', async () => {
    const deniedRun: FailingWorkflowRun = {
      ...RUN,
      failedSteps: [{
        ...RUN.failedSteps[0]!,
        log: [
          'Run pnpm test',
          'src/private/token.ts:1: supersecret failure detail',
          '/home/runner/work/acme/acme/src/private/token.ts:2: runner-secret',
          'file:///workspace/src/private/token.ts:3: workspace-secret',
          'a/src/private/token.ts:4: git-secret',
          '/workspace/src/private data/token.ts:5: spaced-secret',
          'private.ts:6: root-secret',
          './private.ts:7: dot-root-secret',
          'src/value.ts:1: Type number is not assignable to type string',
        ].join('\n'),
      }],
    };
    const { ctx, repository, chat } = context(
      [1, 1, 1, 0, 1, 1, 0],
      true,
      deniedRun,
    );
    const search = vi.fn().mockResolvedValue([{
      title: 'Release notes',
      url: 'https://example.test/release',
      snippet: 'Documented breaking release',
    }]);
    ctx.tavily = { search };
    chat.mockImplementation(async (tier: 'nano' | 'super' | 'ultra') => {
      if (tier === 'nano') return { text: JSON.stringify({
        ...diagnosisReply(),
        class: 'dep-upstream-breaking',
      }) };
      if (tier === 'super') return repairProposalReply(candidates()[0]!);
      return { text: JSON.stringify({
        approved: true,
        reasoning: 'The patch corrects the diagnosed source type.',
      }) };
    });
    repository.policyContent = JSON.stringify({
      version: 1,
      allowedPaths: ['**'],
      deniedReadPaths: ['src/private/**', 'src/private data/**', 'private.ts'],
    });

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('fixed');
    expect(repository.sourceReads.flatMap(({ paths }) => paths))
      .not.toContain('src/private/token.ts');
    const deniedEvidence = /src\/private|private\.ts|supersecret|runner-secret|workspace-secret|git-secret|spaced-secret|root-secret/u;
    expect(JSON.stringify(chat.mock.calls)).not.toMatch(deniedEvidence);
    expect(JSON.stringify(search.mock.calls)).not.toMatch(deniedEvidence);
    expect(chat.mock.calls.map(([tier]) => tier)).toEqual(['nano', 'super', 'ultra']);
    expect(search).toHaveBeenCalledOnce();
  });

  it('refuses protected candidate paths before sandbox execution', async () => {
    const { ctx, executor, repository } = context([1, 1, 1]);
    repository.policyContent = JSON.stringify({
      version: 1,
      allowedPaths: ['src/**'],
      protectedPaths: ['src/**'],
    });

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('gave-up');
    expect(caseFile.race).toEqual([]);
    expect(caseFile.stages.some(({ stage }) => stage === 'search')).toBe(true);
    expect(runCalls(executor).some(({ cmd }) => cmd.includes('git apply'))).toBe(false);
  });

  it('opens one fix PR from the exact failing head after reproduction, triage, race, and audit', async () => {
    // reproduction, triage x2, race x3, audit rerun
    const { ctx, executor, github, repository, chat } = context([
      1, 1, 1, 0, 1, 1, 0,
    ]);

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('fixed');
    expect(repository.checkouts).toEqual([
      { repo: RUN.repo, sha: RUN.headSha },
    ]);
    expect(repository.fixes).toEqual([
      expect.objectContaining({
        branch: 'sutura/fix-98765',
        checkoutDir: '/tmp/exact-pr-head',
        diff: HONEST_DIFF,
        headSha: RUN.headSha,
        message: expect.stringMatching(
          /^fix: repair CI failure with Sutura[\s\S]*Co-Authored-By:/,
        ),
      }),
    ]);
    expect(github.pullRequests).toEqual([
      expect.objectContaining({
        baseRef: RUN.headRef,
        branch: 'sutura/fix-98765',
        headSha: RUN.headSha,
      }),
    ]);
    expect(github.comments).toHaveLength(1);
    expect(github.comments[0]?.body).toContain(attemptMarker(RUN.runId));
    expect(github.comments[0]?.body).toContain('Open case-file artifact');
    expect(github.artifacts).toHaveLength(1);
    expect(chat.mock.calls.map(([tier]) => tier)).toEqual(['nano', 'super', 'ultra']);
    expect(runCalls(executor)).toHaveLength(8);
  });

  it('opens a fix PR against the exact branch for a direct push failure', async () => {
    const directRun: FailingWorkflowRun = {
      runId: RUN.runId,
      repo: RUN.repo,
      headSha: RUN.headSha,
      headRef: 'develop',
      baseSha: RUN.headSha,
      baseRef: 'develop',
      failedSteps: RUN.failedSteps,
    };
    const { ctx, github, repository } = context(
      [1, 1, 1, 0, 1, 1, 0],
      true,
      directRun,
    );
    const checkout = vi.spyOn(repository, 'checkoutHead');

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('fixed');
    expect(checkout).toHaveBeenCalledWith(
      directRun.repo,
      directRun.headSha,
      directRun.headRef,
      undefined,
    );
    expect(github.comments[0]?.prNumber).toBeUndefined();
    expect(github.pullRequests[0]).toEqual(expect.objectContaining({
      baseRef: 'develop',
      headSha: directRun.headSha,
    }));
  });

  it('repairs the realistic direct-run dogfood failure through the production path', async () => {
    const dogfoodRun: FailingWorkflowRun = {
      runId: RUN.runId,
      repo: RUN.repo,
      headSha: RUN.headSha,
      headRef: 'dogfood/sutura-v02-live-replay',
      baseSha: RUN.headSha,
      baseRef: 'dogfood/sutura-v02-live-replay',
      failedSteps: [{
        jobName: 'checks',
        stepName: 'Test core',
        log: [
          'Run pnpm --filter @sutura/core test',
          'packages/core test: \u001b[31m❯\u001b[39m src/dogfood-add.test.ts:7: expected -1 to be 5',
        ].join('\n'),
      }],
    };
    const { ctx, github, repository, chat } = context(
      [1, 1, 1, 0, 1, 1, 0], true, dogfoodRun,
    );
    repository.sources.clear();
    repository.sources.set(
      'packages/core/src/dogfood-add.test.ts',
      "import { add } from './dogfood-add.js';\n\nit('adds', () => { expect(add(2, 3)).toBe(5); });\n",
    );
    repository.sources.set(
      'packages/core/src/dogfood-add.ts',
      'export function add(left: number, right: number): number {\n  return left - right;\n}\n',
    );
    chat.mockImplementation(async (
      tier: 'nano' | 'super' | 'ultra',
      messages: readonly { role: string; content?: string | null }[],
      options?: Record<string, unknown>,
    ) => {
      if (tier === 'nano') return { text: JSON.stringify({
        class: 'test-assertion', confidence: 0.99, signals: ['expected -1 to be 5'],
        failingCmd: 'pnpm --filter @sutura/core test', errorExcerpt: 'expected -1 to be 5',
      }) };
      if (tier === 'super') {
        const request = JSON.parse(messages.find(({ role }) => role === 'user')?.content ?? '{}') as {
          sources?: Array<{ path: string; content: string }>;
        };
        expect(request.sources?.map(({ path }) => path)).toEqual([
          'packages/core/src/dogfood-add.test.ts',
          'packages/core/src/dogfood-add.ts',
        ]);
        expect(options).not.toHaveProperty('tools');
        expect(options).not.toHaveProperty('toolChoice');
        expect(options).not.toHaveProperty('parallelToolCalls');
        return { text: JSON.stringify({
          id: 'dogfood-addition', rationale: 'Use addition in the add function.',
          edits: [{
            path: 'packages/core/src/dogfood-add.ts',
            old: 'left - right',
            new: 'left + right',
          }],
        }), usd: 0.001 };
      }
      const auditRequest = JSON.parse(messages.find(({ role }) => role === 'user')?.content ?? '{}') as {
        candidateDiff?: string;
      };
      expect(auditRequest.candidateDiff).toBe(DOGFOOD_DIFF);
      return { text: JSON.stringify({ approved: true, reasoning: 'The addition repair holds.' }) };
    });

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('fixed');
    expect(repository.fixes).toEqual([expect.objectContaining({
      branch: `sutura/fix-${RUN.runId}`,
      headSha: dogfoodRun.headSha,
      diff: DOGFOOD_DIFF,
    })]);
    expect(repository.fixes[0]?.diff).not.toContain('dogfood-add.test.ts');
    expect(github.pullRequests).toEqual([expect.objectContaining({
      baseRef: dogfoodRun.headRef,
      headSha: dogfoodRun.headSha,
    })]);
    expect(caseFile.selectedCandidate).toEqual({
      id: 'dogfood-addition',
      diffHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it('publishes the same smallest held candidate that the audit approved', async () => {
    const { ctx, repository, chat } = context([1, 1, 1, 0, 0, 1, 0]);
    chat.mockImplementation(async (tier: 'nano' | 'super' | 'ultra') => {
      if (tier === 'nano') return { text: JSON.stringify(diagnosisReply()) };
      if (tier === 'super') {
        return repairProposalReply(
          { id: 'smallest', rationale: 'repair the observed source', diff: HONEST_DIFF },
        );
      }
      return { text: JSON.stringify({ approved: true, reasoning: 'The smallest held repair is correct.' }) };
    });

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('fixed');
    expect(repository.fixes[0]?.diff).toBe(HONEST_DIFF);
    const auditCall = chat.mock.calls.find(([tier]) => tier === 'ultra');
    const auditMessages = auditCall?.[1] as Array<{ content: string }> | undefined;
    const auditInput = JSON.parse(auditMessages?.[1]?.content ?? '{}') as {
      candidateDiff?: string;
    };
    expect(auditInput.candidateDiff).toBe(HONEST_DIFF);
  });

  it('comments only when triage finds a flaky failure', async () => {
    // reproduction, then two passing triage runs
    const { ctx, github, repository, chat } = context([1, 0, 0]);

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('flaky-no-patch');
    expect(caseFile.triage).toEqual(completedTriageVerdict([0, 0], 2));
    expect(repository.fixes).toEqual([]);
    expect(github.pullRequests).toEqual([]);
    expect(github.comments[0]?.body).toContain('FLAKY');
    expect(chat.mock.calls.map(([tier]) => tier)).toEqual(['nano']);
  });

  it('reports an adversarial refusal without creating a branch', async () => {
    const { ctx, github, repository } = context([1, 1, 1, 0, 1, 1, 0], false);

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('refused');
    expect(caseFile.audit?.approved).toBe(false);
    expect(repository.fixes).toEqual([]);
    expect(github.pullRequests).toEqual([]);
    expect(github.comments[0]?.body).toContain('REFUSED');
    expect(github.comments[0]?.body).toContain('Pathology');
  });

  it('reports every tried candidate when no repair holds', async () => {
    const { ctx, github, repository, chat } = context([1, 1, 1, 1, 1, 1]);

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('gave-up');
    expect(caseFile.race).toEqual([]);
    expect(repository.fixes).toEqual([]);
    expect(github.pullRequests).toEqual([]);
    expect(github.comments[0]?.body).toContain('NO PATCH HELD');
    expect(chat.mock.calls.map(([tier]) => tier).filter((tier) => tier === 'super').length)
      .toBeGreaterThan(1);
  });

  it('vets every candidate before race and reports deterministic refusals', async () => {
    const testPathRun: FailingWorkflowRun = {
      ...RUN,
      failedSteps: [{
        ...RUN.failedSteps[0]!,
        log: `${RUN.failedSteps[0]!.log}\nsrc/value-0.test.ts(1,1)\nsrc/value-1.test.ts(1,1)\nsrc/value-2.test.ts(1,1)`,
      }],
    };
    const { ctx, executor, github, repository, chat } = context(
      [1, 1, 1],
      true,
      testPathRun,
    );
    for (let index = 0; index < 3; index += 1) {
      repository.sources.set(`src/value-${index}.test.ts`, 'export const value: string = 1;');
    }
    const invalidCandidates = candidates().map((candidate, index) => ({
      ...candidate,
      diff: candidate.diff.replaceAll(
        'src/value.ts',
        `src/value-${index}.test.ts`,
      ),
    }));
    chat.mockImplementation(async (tier: 'nano' | 'super' | 'ultra') => {
      if (tier === 'nano') return { text: JSON.stringify(diagnosisReply()) };
      if (tier === 'super') return repairProposalReply(invalidCandidates[0]!);
      return { text: JSON.stringify({ approved: true, reasoning: 'not reached' }) };
    });

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('gave-up');
    expect(caseFile.race).toEqual([]);
    expect(github.comments[0]?.body).toContain('NO PATCH HELD');
    expect(runCalls(executor)).toHaveLength(5);
  });

  it('does not spend or mutate twice for the same failing run id', async () => {
    const { ctx, executor, github, repository, chat } = context([
      1, 1, 1, 0, 1, 1, 0,
    ]);
    await orchestrate(ctx);
    const before = {
      calls: executor.calls.length,
      comments: github.comments.length,
      fixes: repository.fixes.length,
      llm: chat.mock.calls.length,
    };

    await expect(orchestrate(ctx)).rejects.toBeInstanceOf(AlreadyAttemptedError);
    expect(executor.calls).toHaveLength(before.calls);
    expect(github.comments).toHaveLength(before.comments);
    expect(repository.fixes).toHaveLength(before.fixes);
    expect(chat).toHaveBeenCalledTimes(before.llm);
  });

  it('does not retry after a claimed attempt crashes before sandbox work', async () => {
    const { ctx, executor, github, repository, chat } = context([1]);
    vi.spyOn(repository, 'checkoutHead').mockRejectedValueOnce(
      new Error('checkout failed'),
    );

    await expect(orchestrate(ctx)).rejects.toThrow('checkout failed');
    expect(github.comments).toEqual([
      {
        id: 1,
        prNumber: RUN.prNumber,
        body: attemptMarker(RUN.runId),
      },
    ]);
    await expect(orchestrate(ctx)).rejects.toBeInstanceOf(AlreadyAttemptedError);
    expect(repository.checkouts).toHaveLength(0);
    expect(executor.calls).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
  });

  it('stops as infrastructure before inference when clean reproduction passes', async () => {
    const { ctx, github, repository, chat } = context([0]);

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('infra-stop');
    expect(caseFile.diagnosis.class).toBe('infra');
    expect(caseFile.diagnosis.signals).toContain('reproduction:passed');
    expect(caseFile.triage).toEqual(notRunTriageVerdict());
    expect(github.comments[0]?.body).toContain('INFRA — STOPPED');
    expect(github.comments[0]?.body).toContain('stopped before inference');
    expect(repository.fixes).toEqual([]);
    expect(github.pullRequests).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
  });

  it('passes only the strict CI allowlist to every sandbox run', async () => {
    const previous = process.env['REPOSITORY_SECRET'];
    process.env['REPOSITORY_SECRET'] = 'must-not-leak';
    try {
      const { ctx, executor } = context([1, 0, 0]);

      await orchestrate(ctx);

      expect(runCalls(executor)).not.toHaveLength(0);
      for (const call of runCalls(executor)) {
        expect(call.opts?.env).toEqual(SUTURA_SANDBOX_ENV);
        expect(call.opts?.env).not.toHaveProperty('REPOSITORY_SECRET');
      }
    } finally {
      if (previous === undefined) delete process.env['REPOSITORY_SECRET'];
      else process.env['REPOSITORY_SECRET'] = previous;
    }
  });

  it('reproduces before the first paid model call', async () => {
    const { ctx, executor, chat } = context([1, 0, 0]);
    chat.mockImplementationOnce(async () => {
      expect(runCalls(executor)).toHaveLength(3);
      return { text: JSON.stringify(diagnosisReply()) };
    });

    await orchestrate(ctx);
  });

  it('installs in a clean image before reproduction and forks triage from that prepared image', async () => {
    const { ctx, executor } = context([1, 0, 0]);

    await orchestrate(ctx);

    const calls = runCalls(executor);
    const snapshots = executor.calls.filter((call) => call.kind === 'snapshot');
    expect(snapshots.map(({ options }) => options)).toEqual([
      { profile: 'dependency-inputs', mode: 'replace' },
      { profile: 'repository', mode: 'overlay' },
    ]);
    expect(calls[0]?.cmd).toContain('corepack pnpm install --frozen-lockfile --ignore-scripts');
    expect(calls[0]?.opts?.network).toBe('enabled');
    expect(calls[1]?.cmd).toContain('git --literal-pathspecs add');
    expect(calls[1]?.cmd).toContain('--pathspec-file-nul');
    expect(calls[1]?.cmd).toContain('core.hooksPath /dev/null');
    expect(calls[1]?.cmd).toContain('--no-verify');
    expect(calls[1]?.opts?.network).toBe('disabled');
    expect(calls.slice(2).every(({ parent }) => parent === calls[1]?.imageId)).toBe(true);
    expect(calls.slice(2).every(({ opts }) => opts?.network === 'disabled')).toBe(true);
  });

  it('reports preparation failure before reproduction or paid inference', async () => {
    const { ctx, github, chat } = context([]);
    const executor = new InMemoryExecutor(() => runResult(1));
    ctx.executor = executor;

    const caseFile = await orchestrate(ctx);

    expect(caseFile).toMatchObject({
      outcome: 'infra-stop',
      diagnosis: { class: 'infra', signals: ['sandbox-preparation:failed'] },
    });
    expect(runCalls(executor)).toHaveLength(1);
    expect(github.comments[0]?.body).toContain('INFRA — STOPPED');
    expect(chat).not.toHaveBeenCalled();
  });

  it('grounds a web-helpful diagnosis between classification and triage', async () => {
    const buildRun: FailingWorkflowRun = {
      ...RUN,
      failedSteps: [
        {
          jobName: 'build',
          stepName: 'Build',
          log: "Run pnpm build\nError: Cannot find module '@acme/money'",
        },
      ],
    };
    const { ctx, chat } = context([1, 0, 0], true, buildRun);
    chat.mockImplementationOnce(async () => ({
      text: JSON.stringify({
        class: 'build',
        confidence: 0.91,
        signals: ['missing module'],
        failingCmd: 'pnpm build',
        errorExcerpt: "Cannot find module '@acme/money'",
      }),
    }));
    const search = vi.fn().mockResolvedValue([
      {
        title: 'Migration guide',
        url: 'https://docs.example.test/migration',
        snippet: 'The package export moved.',
      },
    ]);
    ctx.tavily = { search };

    const caseFile = await orchestrate(ctx);

    expect(search).toHaveBeenCalledTimes(1);
    expect(caseFile.diagnosis.grounding).toMatchObject({
      skipped: false,
      citations: [expect.objectContaining({ title: 'Migration guide' })],
    });
  });

  it('repairs an actual broken Placebo source using its bounded file context', async () => {
    const pristineSource = await readFile(
      new URL('../../placebo/corpus/repair-type-mismatch/fixture/parse-port.ts', import.meta.url),
      'utf8',
    );
    const brokenSource = pristineSource.replace('Number(value)', 'value');
    const placeboRun: FailingWorkflowRun = {
      ...RUN,
      failedSteps: [
        {
          jobName: 'typecheck',
          stepName: 'Typecheck',
          log: 'Run pnpm test\nparse-port.ts(2,3): error TS2322: Type string is not assignable to type number',
        },
      ],
    };
    const { ctx, chat, repository } = context(
      [1, 1, 1, 0, 1, 1, 0],
      true,
      placeboRun,
    );
    repository.sources.clear();
    repository.sources.set('parse-port.ts', brokenSource);
    const repairDiff = [
      'diff --git a/parse-port.ts b/parse-port.ts',
      '--- a/parse-port.ts',
      '+++ b/parse-port.ts',
      '@@ -1,3 +1,3 @@',
      ' export function parsePort(value: string): number {',
      '-  return value;',
      '+  return Number(value);',
      ' }',
    ].join('\n') + '\n';
    let placeboSuperCall = 0;
    chat.mockImplementation(async (
      tier: 'nano' | 'super' | 'ultra',
      messages: readonly { role: string; content?: string | null }[],
    ) => {
      if (tier === 'nano') return { text: JSON.stringify({
        class: 'typecheck', confidence: 0.99, signals: ['TS2322'],
        failingCmd: 'pnpm test', errorExcerpt: 'parse-port.ts(2,3): TS2322',
      }) };
      if (tier === 'super') {
        if (placeboSuperCall === 0) {
          const user = messages.find(({ role }) => role === 'user');
          const request = JSON.parse(user?.content ?? '') as {
            sources: Array<{ path: string; content: string }>;
          };
          expect(request.sources).toEqual([
            expect.objectContaining({ path: 'parse-port.ts', content: brokenSource }),
          ]);
        }
        placeboSuperCall += 1;
        return repairProposalReply(
          { id: 'placebo-fix', rationale: 'restore numeric conversion', diff: repairDiff },
        );
      }
      return { text: JSON.stringify({ approved: true, reasoning: 'The repair restores numeric conversion.' }) };
    });

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('fixed');
    expect(repository.sourceReads).toEqual([
      {
        checkoutDir: '/tmp/exact-pr-head',
        paths: ['parse-port.ts', 'tsconfig.json', 'package.json'],
      },
    ]);
    expect(repository.fixes[0]?.diff).toBe(repairDiff);
    expect(brokenSource.replace('return value;', 'return Number(value);'))
      .toBe(pristineSource);
  });

  it('uses safe manifest fallback context for a dependency failure with no logged path', async () => {
    const dependencyRun: FailingWorkflowRun = {
      ...RUN,
      failedSteps: [
        {
          jobName: 'test',
          stepName: 'Test',
          log: "Run pnpm test\nError: Cannot find module '@acme/money'",
        },
      ],
    };
    const { ctx, chat, repository } = context(
      [1, 1, 1, 1, 1, 1],
      true,
      dependencyRun,
    );
    repository.sources.clear();
    repository.sources.set(
      'package.json',
      '{"dependencies":{"@acme/money":"4.0.0"}}',
    );
    const dependencyDiff = (version: string) => [
      'diff --git a/package.json b/package.json',
      '--- a/package.json',
      '+++ b/package.json',
      '@@ -1 +1 @@',
      '-{"dependencies":{"@acme/money":"4.0.0"}}',
      `+{"dependencies":{"@acme/money":"${version}"}}`,
    ].join('\n');
    ctx.tavily = {
      search: vi.fn().mockResolvedValue([{
        title: 'Money 4 migration',
        url: 'https://docs.example.test/money-4',
        snippet: 'The package now requires an explicit compatibility migration.',
      }]),
    };
    let dependencySuperCall = 0;
    chat.mockImplementation(async (tier: 'nano' | 'super' | 'ultra', messages: readonly {
      role: string;
      content?: string | null;
    }[]) => {
      if (tier === 'nano') return { text: JSON.stringify({
        class: 'dep-upstream-breaking', confidence: 0.96, signals: ['missing module'],
        failingCmd: 'pnpm test', errorExcerpt: "Cannot find module '@acme/money'",
      }) };
      if (tier === 'super') {
        if (dependencySuperCall === 0) {
          const user = messages.find(({ role }) => role === 'user');
          const request = JSON.parse(user?.content ?? '') as { sources: Array<{ path: string }> };
          expect(request.sources.map(({ path }) => path)).toEqual(['package.json']);
        }
        dependencySuperCall += 1;
        return repairProposalReply(
          { id: 'pin-a', rationale: 'pin compatible release', diff: dependencyDiff('3.9.0') },
        );
      }
      return { text: JSON.stringify({ approved: true, reasoning: 'not reached' }) };
    });

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('gave-up');
    expect(chat.mock.calls.map(([tier]) => tier).filter((tier) => tier === 'super').length)
      .toBeGreaterThan(1);
    expect(repository.sourceReads[0]?.paths).toEqual([
      'package.json',
      'pnpm-lock.yaml',
      'package-lock.json',
      'yarn.lock',
    ]);
  });

  it('replays live run 6: absent editable source stops before a Super turn', async () => {
    const noPathRun: FailingWorkflowRun = {
      ...RUN,
      failedSteps: [
        {
          jobName: 'typecheck',
          stepName: 'Typecheck',
          log: 'Run pnpm test\nerror TS2322: Type string is not assignable to type number',
        },
      ],
    };
    const { ctx, chat, repository } = context([1, 1, 1], true, noPathRun);
    repository.sources.clear();

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('gave-up');
    expect(caseFile.race).toEqual([]);
    expect(chat.mock.calls.map(([tier]) => tier)).not.toContain('super');
  });

  it('rejects a non-numeric workflow run id before claiming an attempt', async () => {
    const hostileRun = { ...RUN, runId: '../unsafe' };
    const { ctx, github } = context([], true, hostileRun);

    await expect(orchestrate(ctx)).rejects.toThrow('positive decimal id');
    expect(github.comments).toEqual([]);
    expect(github.artifacts).toEqual([]);
  });
});

describe('failed log collection', () => {
  it('keeps only the final 200 lines from each failed step', () => {
    const longLog = Array.from({ length: 250 }, (_, index) => `line-${index}`).join('\n');
    const result = collectFailedLogs([
      { jobName: 'one', stepName: 'first', log: longLog },
      { jobName: 'two', stepName: 'second', log: longLog },
    ]);

    expect(result).not.toContain('line-49\n');
    expect(result.match(/line-50/g)).toHaveLength(2);
    expect(result.match(/line-249/g)).toHaveLength(2);
    expect(result).toContain('[one / first]');
    expect(result).toContain('[two / second]');
  });

  it('does not character-truncate any of the final 200 lines', () => {
    const longFinalLine = `FINAL-${'x'.repeat(120_000)}`;

    const result = collectFailedLogs([
      { jobName: 'one', stepName: 'large output', log: longFinalLine },
    ]);

    expect(result.endsWith(longFinalLine)).toBe(true);
  });

  it('counts 200 content lines when a failed-step log ends in a newline', () => {
    const longLog = `${Array.from(
      { length: 250 },
      (_, index) => `line-${index}`,
    ).join('\n')}\n`;

    const result = collectFailedLogs([
      { jobName: 'one', stepName: 'trailing newline', log: longLog },
    ]);

    expect(result).toContain('line-50\n');
    expect(result).not.toContain('line-49\n');
    expect(result.endsWith('line-249\n')).toBe(true);
  });
});

describe('repair source context', () => {
  it('replays live runs 4 and 5: monorepo ESM evidence reaches the TypeScript implementation', async () => {
    const repository = new FakeRepository();
    repository.sources.clear();
    repository.sources.set(
      'packages/core/src/dogfood-add.test.ts',
      "import { add } from './dogfood-add.js';\n\nexpect(add(2, 3)).toBe(5);\n",
    );
    repository.sources.set(
      'packages/core/src/dogfood-add.ts',
      'export function add(left: number, right: number): number {\n  return left - right;\n}\n',
    );

    const context = await readRepairSourceContext(
      repository,
      '/tmp/exact-pr-head',
      'packages/core test: src/dogfood-add.test.ts:3: expected -1 to be 5',
      { class: 'test-assertion' },
    );

    expect(context.sources.map(({ path }) => path)).toEqual([
      'packages/core/src/dogfood-add.test.ts',
      'packages/core/src/dogfood-add.ts',
    ]);
    expect(repository.sourceReads).toEqual([
      {
        checkoutDir: '/tmp/exact-pr-head',
        paths: [
          'packages/core/src/dogfood-add.test.ts',
          'src/dogfood-add.test.ts',
        ],
      },
      {
        checkoutDir: '/tmp/exact-pr-head',
        paths: [
          'packages/core/src/dogfood-add.js',
          'packages/core/src/dogfood-add.ts',
          'packages/core/src/dogfood-add.tsx',
        ],
      },
    ]);
  });

  it('omits ambiguous and credential-shaped dependency sources', async () => {
    const repository = new FakeRepository();
    repository.sources.clear();
    repository.sources.set('src/test.ts', "import './ambiguous.js';\nimport './secret.js';\n");
    repository.sources.set('src/ambiguous.js', 'export const value = 1;\n');
    repository.sources.set('src/ambiguous.ts', 'export const value = 2;\n');
    repository.sources.set('src/secret.ts', 'const TOKEN: string = "super-secret-value";\n');

    const context = await readRepairSourceContext(
      repository,
      '/tmp/exact-pr-head',
      'src/test.ts:1: assertion failed',
      { class: 'test-assertion' },
    );

    expect(context.sources.map(({ path }) => path)).toEqual(['src/test.ts']);
    expect(JSON.stringify(context)).not.toContain('super-secret-value');
  });

  it('does not add another dependency variant when the failed log already supplied one', async () => {
    const repository = new FakeRepository();
    repository.sources.clear();
    repository.sources.set('src/test.ts', "import './local.js';\n");
    repository.sources.set('src/local.ts', 'export const value = 1;\n');
    repository.sources.set('src/local.js', 'export const value = 2;\n');

    const context = await readRepairSourceContext(
      repository,
      '/tmp/exact-pr-head',
      'src/test.ts:1: assertion failed\nsrc/local.ts:1: related frame',
      { class: 'test-assertion' },
    );

    expect(context.sources.map(({ path }) => path)).toEqual(['src/test.ts', 'src/local.ts']);
    expect(repository.sourceReads).toHaveLength(1);
  });

  it('bounds dependency cycles, depth, policy, and total source count', async () => {
    const repository = new FakeRepository();
    repository.sources.clear();
    repository.sources.set('src/root.ts', "import './child.js';\nimport './denied.js';\n");
    repository.sources.set('src/child.ts', "import './root.js';\nimport './grand.js';\n");
    repository.sources.set('src/grand.ts', "import './too-deep.js';\n");
    repository.sources.set('src/too-deep.ts', 'export const value = 4;\n');
    repository.sources.set('src/denied.ts', 'export const secret = 1;\n');

    const bounded = await readRepairSourceContext(
      repository,
      '/tmp/exact-pr-head',
      'src/root.ts:1: assertion failed',
      { class: 'test-assertion' },
      parseRepositoryPolicy(JSON.stringify({
        version: 1, allowedPaths: ['src/**'], deniedReadPaths: ['src/denied.*'],
      })),
    );

    expect(bounded.sources.map(({ path }) => path)).toEqual([
      'src/root.ts', 'src/child.ts', 'src/grand.ts',
    ]);
    expect(JSON.stringify(repository.sourceReads)).not.toContain('src/denied.ts');
    expect(JSON.stringify(repository.sourceReads)).not.toContain('src/too-deep.ts');

    const cappedRepository = new FakeRepository();
    cappedRepository.sources.clear();
    cappedRepository.sources.set(
      'src/root.ts',
      Array.from({ length: 8 }, (_, index) => `import './d${index}.js';`).join('\n'),
    );
    for (let index = 0; index < 8; index += 1) {
      cappedRepository.sources.set(`src/d${index}.ts`, `export const d${index} = ${index};\n`);
    }

    const capped = await readRepairSourceContext(
      cappedRepository, '/tmp/exact-pr-head', 'src/root.ts:1: assertion failed',
      { class: 'test-assertion' },
    );

    expect(capped.sources.map(({ path }) => path)).toEqual([
      'src/root.ts', 'src/d0.ts', 'src/d1.ts', 'src/d2.ts',
      'src/d3.ts', 'src/d4.ts', 'src/d5.ts', 'src/d6.ts',
    ]);
  });

  it('caps dependency candidate probes without treating unprobed variants as unique', async () => {
    const repository = new FakeRepository();
    repository.sources.clear();
    repository.sources.set(
      'src/root.ts',
      Array.from({ length: 24 }, (_, index) => `import './missing-${index}';`).join('\n'),
    );
    repository.sources.set('src/missing-23.ts', 'export const tooLate = true;\n');

    const context = await readRepairSourceContext(
      repository, '/tmp/exact-pr-head', 'src/root.ts:1: assertion failed',
      { class: 'test-assertion' },
    );

    expect(context.sources.map(({ path }) => path)).toEqual(['src/root.ts']);
    expect(repository.sourceReads).toHaveLength(25);
    expect(repository.sourceReads.flatMap(({ paths }) => paths)).not.toContain('src/missing-23.ts');
  });

  it('extracts only safe, exact workspace-relative source paths', () => {
    const log = [
      '/workspace/src/value.ts:42:3 error TS2322',
      'file:///workspace/src/config.ts(7,2): error',
      '../../secret.ts:1:1',
      'node_modules/vendor/index.js:4:1',
      '/etc/host.ts:1:1',
      '/workspace/src/value.ts:99:1 duplicate',
    ].join('\n');

    expect(extractSourceReferences(log)).toEqual([
      { path: 'src/value.ts', line: 42 },
      { path: 'src/config.ts', line: 7 },
    ]);
  });

  it('upgrades a command path when a later diagnostic supplies its line', () => {
    expect(
      extractSourceReferences(
        'Run eslint src/large.ts\nsrc/large.ts:500:1 lint error',
      ),
    ).toEqual([{ path: 'src/large.ts', line: 500 }]);
  });

  it('resolves pnpm recursive package diagnostics to repository paths', async () => {
    const repository = new FakeRepository();
    repository.sources.clear();
    repository.sources.set(
      'packages/core/src/diagnose/tavily.ts',
      "const MAX_QUERY_CHARACTERS: number = '2_000';",
    );
    const log = [
      'Run pnpm -r typecheck',
      "##[error]packages/core typecheck: src/diagnose/tavily.ts(20,7): error TS2322: Type 'string' is not assignable to type 'number'.",
    ].join('\n');

    await expect(
      readRepairSourceContext(repository, '/tmp/exact-pr-head', log, {
        class: 'typecheck',
      }),
    ).resolves.toEqual({
      sources: [{
        path: 'packages/core/src/diagnose/tavily.ts',
        startLine: 1,
        content: "const MAX_QUERY_CHARACTERS: number = '2_000';",
        truncated: false,
      }],
    });
    expect(repository.sourceReads[0]?.paths).toEqual([
      'packages/core/src/diagnose/tavily.ts',
      'src/diagnose/tavily.ts',
      'tsconfig.json',
      'package.json',
    ]);
  });

  it('resolves ANSI-colored Vitest reporter paths to their pnpm workspace', async () => {
    const repository = new FakeRepository();
    repository.sources.clear();
    repository.sources.set(
      'packages/core/src/dogfood-add.test.ts',
      "import { add } from './dogfood-add.js';\nexpect(add(2, 3)).toBe(5);\n",
    );
    repository.sources.set(
      'packages/core/src/dogfood-add.ts',
      'export const add = (left: number, right: number) => left - right;\n',
    );
    const log = [
      'packages/core test: \u001b[31m❯\u001b[39m src/dogfood-add.test.ts \u001b[2m(1 test | 1 failed)\u001b[22m',
      'packages/core test: \u001b[36m ❯\u001b[39m src/dogfood-add.test.ts:\u001b[2m7:23\u001b[22m',
    ].join('\n');

    const context = await readRepairSourceContext(
      repository, '/tmp/exact-pr-head', log, { class: 'test-assertion' },
    );

    expect(context.sources.map(({ path }) => path)).toEqual([
      'packages/core/src/dogfood-add.test.ts',
      'packages/core/src/dogfood-add.ts',
    ]);
  });

  it('uses only Python fallback manifests for Python dependency failures', async () => {
    const repository = new FakeRepository();

    await readRepairSourceContext(
      repository,
      '/tmp/exact-pr-head',
      'Run pytest -q\nImportError: dependency failed',
      { class: 'dep-upstream-breaking' },
      undefined,
      'python',
    );

    expect(repository.sourceReads[0]?.paths).toEqual([
      'pyproject.toml',
      'uv.lock',
      'requirements.txt',
    ]);
  });

  it('upgrades an inferred workspace line after the source-file cap is full', () => {
    const log = [
      'Run pnpm -r typecheck',
      'packages/p0 typecheck: src/deep.ts error TS2322',
      ...Array.from(
        { length: 7 },
        (_, index) => `packages/p${index + 1} typecheck: src/value.ts error TS2322`,
      ),
      'packages/p0 typecheck: src/deep.ts(500,1): error TS2322',
      'packages/ignored typecheck: src/ninth.ts(9,1): error TS2322',
    ].join('\n');

    const references = extractSourceReferences(log);

    expect(references).toHaveLength(8);
    expect(references[0]).toEqual({
      path: 'packages/p0/src/deep.ts',
      line: 500,
    });
    expect(references).not.toContainEqual(
      expect.objectContaining({ path: 'packages/ignored/src/ninth.ts' }),
    );
  });

  it('extracts exact JSON paths without accepting partial extensions', () => {
    expect(
      extractSourceReferences([
        'package.json:14:2 invalid package metadata',
        'tsconfig.json(7,1): invalid compiler option',
        'archive.json.backup:2 must not be read',
        'module.jsonish:3 must not be read',
      ].join('\n')),
    ).toEqual([
      { path: 'package.json', line: 14 },
      { path: 'tsconfig.json', line: 7 },
    ]);
  });

  it('normalizes only validated duplicated GitHub workspace prefixes', () => {
    expect(
      extractSourceReferences([
        '/home/runner/work/widget/widget/src/linux.ts:12:3 error',
        'file:///home/runner/work/widget/widget/src/file-url.ts(8,2): error',
        '/__w/widget/widget/src/container.ts:4:1 error',
        '/home/runner/work/widget/other/src/mismatch.ts:1:1 rejected',
        'file:///home/runner/work/widget/other/src/file-mismatch.ts:1:1 rejected',
        'prefix/home/runner/work/widget/widget/src/embedded.ts:1:1 rejected',
        '/etc/private.ts:1:1 rejected',
      ].join('\n')),
    ).toEqual([
      { path: 'src/linux.ts', line: 12 },
      { path: 'src/file-url.ts', line: 8 },
      { path: 'src/container.ts', line: 4 },
      {
        path: 'prefix/home/runner/work/widget/widget/src/embedded.ts',
        line: 1,
      },
    ]);
  });

  it('never requests sensitive source files from the repository port', async () => {
    const repository = new FakeRepository();

    await readRepairSourceContext(
      repository,
      '/tmp/exact-pr-head',
      [
        'src/value.ts:1:1 error TS2322',
        'credentials.json:2:1 must remain private',
      ].join('\n'),
      { class: 'typecheck' },
    );

    expect(repository.sourceReads).toEqual([{
      checkoutDir: '/tmp/exact-pr-head',
      paths: ['src/value.ts', 'tsconfig.json', 'package.json'],
    }]);
  });

  it('rejects source-port responses that exceed bounds or return unrequested files', async () => {
    const repository = new FakeRepository();
    const largeSource = Array.from(
      { length: 300 },
      (_, index) => `line-${index}-${'🧵'.repeat(100)}`,
    ).join('\n');
    vi.spyOn(repository, 'readSourceExcerpts').mockResolvedValue([
      {
        path: 'src/value.ts',
        startLine: 100,
        content: largeSource,
        truncated: true,
      },
      {
        path: '../secret.ts',
        startLine: 1,
        content: 'SECRET',
        truncated: false,
      },
    ]);

    await expect(
      readRepairSourceContext(
        repository,
        '/tmp/exact-pr-head',
        'src/value.ts:150:2 error TS2322',
      ),
    ).rejects.toThrow('unsafe or unbounded excerpt');
    expect(Buffer.byteLength(largeSource, 'utf8')).toBeGreaterThan(12_000);
  });
});
