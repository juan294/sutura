import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import type {
  AuditVerdict,
  Candidate,
  CostLedger,
  Diagnosis,
} from './domain.js';
import { InMemoryExecutor } from './executor/memory.js';
import type { InMemoryCall, InMemoryRunResult } from './executor/memory.js';
import type { TierLlm } from './llm/types.js';
import {
  AlreadyAttemptedError,
  SUTURA_SANDBOX_ENV,
  attemptMarker,
  collectFailedLogs,
  extractSourceReferences,
  orchestrate,
  readRepairSourceContext,
  type FailingWorkflowRun,
  type GitHubOrchestrationPort,
  type OrchestrationContext,
  type RepositoryPort,
} from './orchestrate.js';

const HONEST_DIFF = [
  'diff --git a/src/value.ts b/src/value.ts',
  '--- a/src/value.ts',
  '+++ b/src/value.ts',
  '@@ -1 +1 @@',
  '-export const value: string = 1;',
  '+export const value: string = "1";',
].join('\n');

const SECOND_DIFF = HONEST_DIFF.replace('value: string', 'value: number');
const THIRD_DIFF = HONEST_DIFF.replace('const value', 'const result');

const RUN: FailingWorkflowRun = {
  runId: '98765',
  repo: 'acme/widget',
  prNumber: 42,
  prHeadSha: '0123456789abcdef0123456789abcdef01234567',
  prHeadRef: 'feature/broken-build',
  failedSteps: [
    {
      jobName: 'test',
      stepName: 'Run tests',
      log: 'Run pnpm test\nsrc/value.ts(1,14): error TS2322: Type number is not assignable to type string',
    },
  ],
};

class FakeGitHub implements GitHubOrchestrationPort {
  readonly comments: Array<{ id: string; prNumber: number; body: string }> = [];
  readonly pullRequests: Array<{
    baseRef: string;
    branch: string;
    body: string;
    headSha: string;
    title: string;
  }> = [];
  readonly artifacts: Array<{ name: string; html: string }> = [];

  constructor(readonly run = RUN) {}

  async getFailingRun(runId: string): Promise<FailingWorkflowRun> {
    expect(runId).toBe(this.run.runId);
    return this.run;
  }

  async claimAttempt(prNumber: number, marker: string): Promise<string | null> {
    if (this.comments.some(
      (comment) => comment.prNumber === prNumber && comment.body.includes(marker),
    )) return null;
    const id = `comment-${this.comments.length + 1}`;
    this.comments.push({ id, prNumber, body: marker });
    return id;
  }

  async updateAttempt(commentId: string, body: string): Promise<void> {
    const comment = this.comments.find(({ id }) => id === commentId);
    if (!comment) throw new Error(`Unknown comment ${commentId}`);
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
    ['src/value.ts', 'export const value: string = 1;'],
  ]);

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

function scriptedLlm(auditVerdict: AuditVerdict['approved'] = true): {
  llm: TierLlm<'nano' | 'super' | 'ultra'>;
  chat: ReturnType<typeof vi.fn>;
} {
  const chat = vi.fn(async (tier: 'nano' | 'super' | 'ultra') => {
    if (tier === 'nano') return { text: JSON.stringify(diagnosisReply()) };
    if (tier === 'super') {
      return { text: JSON.stringify({ candidates: candidates() }) };
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
  return { llm: { chat }, chat };
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
  const executor = new InMemoryExecutor((command) =>
    command.includes('if [ ! -d node_modules ]')
      ? runResult(0)
      : runResult(exits[scenarioIndex++] ?? 1),
  );
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
    },
  };
}

function runCalls(executor: InMemoryExecutor): Extract<InMemoryCall, { kind: 'run' }>[] {
  return executor.calls.filter(
    (call): call is Extract<InMemoryCall, { kind: 'run' }> => call.kind === 'run',
  );
}

describe('orchestrate', () => {
  it('opens one fix PR from the exact failing head after reproduction, triage, race, and audit', async () => {
    // reproduction, triage x2, race x3, audit rerun
    const { ctx, executor, github, repository, chat } = context([
      1, 1, 1, 0, 1, 1, 0,
    ]);

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('fixed');
    expect(repository.checkouts).toEqual([
      { repo: RUN.repo, sha: RUN.prHeadSha },
    ]);
    expect(repository.fixes).toEqual([
      expect.objectContaining({
        branch: 'sutura/fix-98765',
        checkoutDir: '/tmp/exact-pr-head',
        diff: HONEST_DIFF,
        headSha: RUN.prHeadSha,
        message: expect.stringMatching(
          /^fix: repair CI failure with Sutura[\s\S]*Co-Authored-By:/,
        ),
      }),
    ]);
    expect(github.pullRequests).toEqual([
      expect.objectContaining({
        baseRef: RUN.prHeadRef,
        branch: 'sutura/fix-98765',
        headSha: RUN.prHeadSha,
      }),
    ]);
    expect(github.comments).toHaveLength(1);
    expect(github.comments[0]?.body).toContain(attemptMarker(RUN.runId));
    expect(github.comments[0]?.body).toContain('Open case-file artifact');
    expect(github.artifacts).toHaveLength(1);
    expect(chat.mock.calls.map(([tier]) => tier)).toEqual([
      'nano',
      'super',
      'ultra',
    ]);
    expect(runCalls(executor)).toHaveLength(8);
  });

  it('publishes the same smallest held candidate that the audit approved', async () => {
    const { ctx, repository, chat } = context([1, 1, 1, 0, 0, 1, 0]);
    const largerDiff = HONEST_DIFF.replaceAll(
      'src/value.ts',
      'src/a-very-long-value-module.ts',
    );
    chat.mockImplementation(async (tier: 'nano' | 'super' | 'ultra') => {
      if (tier === 'nano') return { text: JSON.stringify(diagnosisReply()) };
      if (tier === 'super') {
        return { text: JSON.stringify({ candidates: [
          { id: 'larger', rationale: 'repair a longer module path', diff: largerDiff },
          { id: 'smallest', rationale: 'repair the observed source', diff: HONEST_DIFF },
          { id: 'third', rationale: 'try a different binding', diff: THIRD_DIFF },
        ] }) };
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
    expect(caseFile.triage).toEqual({ status: 'flaky', reproduced: 0, of: 2 });
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
    expect(caseFile.race.map(({ candidate }) => candidate.id)).toEqual([
      'source',
      'alternate',
      'rename',
    ]);
    expect(repository.fixes).toEqual([]);
    expect(github.pullRequests).toEqual([]);
    expect(github.comments[0]?.body).toContain('NO PATCH HELD');
    expect(chat.mock.calls.map(([tier]) => tier)).toEqual(['nano', 'super']);
  });

  it('vets every candidate before race and reports deterministic refusals', async () => {
    const { ctx, executor, github, chat } = context([1, 1, 1]);
    const invalidCandidates = candidates().map((candidate, index) => ({
      ...candidate,
      diff: candidate.diff.replaceAll(
        'src/value.ts',
        `src/value-${index}.test.ts`,
      ),
    }));
    chat.mockImplementationOnce(async () => ({
      text: JSON.stringify(diagnosisReply()),
    }));
    chat.mockImplementationOnce(async () => ({
      text: JSON.stringify({ candidates: invalidCandidates }),
    }));

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('gave-up');
    expect(caseFile.race).toHaveLength(3);
    expect(caseFile.race.every(({ note }) => note?.startsWith('Patch vet refused:')))
      .toBe(true);
    expect(github.comments[0]?.body).toContain('Patch vet refused');
    expect(runCalls(executor)).toHaveLength(4);
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
        id: 'comment-1',
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
    expect(caseFile.triage).toEqual({ status: 'not-run', reproduced: 0, of: 0 });
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
      expect(runCalls(executor)).toHaveLength(2);
      return { text: JSON.stringify(diagnosisReply()) };
    });

    await orchestrate(ctx);
  });

  it('installs in a clean image before reproduction and forks triage from that prepared image', async () => {
    const { ctx, executor } = context([1, 0, 0]);

    await orchestrate(ctx);

    const calls = runCalls(executor);
    expect(calls[0]?.cmd).toContain('corepack pnpm install --frozen-lockfile');
    expect(calls[1]?.parent).toBe(calls[0]?.imageId);
    expect(calls.slice(2).every(({ parent }) => parent === calls[0]?.imageId)).toBe(true);
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
    ].join('\n');
    chat.mockImplementationOnce(async () => ({
      text: JSON.stringify({
        class: 'typecheck',
        confidence: 0.99,
        signals: ['TS2322'],
        failingCmd: 'pnpm test',
        errorExcerpt: 'parse-port.ts(2,3): TS2322',
      }),
    }));
    chat.mockImplementationOnce(async (
      _tier,
      messages: readonly { role: string; content: string }[],
    ) => {
      const user = messages.find(({ role }) => role === 'user');
      const request = JSON.parse(user?.content ?? '') as {
        sourceContext: { sources: Array<{ path: string; content: string }> };
      };
      expect(request.sourceContext.sources).toEqual([
        expect.objectContaining({ path: 'parse-port.ts', content: brokenSource }),
      ]);
      return {
        text: JSON.stringify({
          candidates: [
            { id: 'placebo-fix', rationale: 'restore numeric conversion', diff: repairDiff },
            { id: 'alternate-a', rationale: 'alternate source repair', diff: SECOND_DIFF },
            { id: 'alternate-b', rationale: 'second source repair', diff: THIRD_DIFF },
          ],
        }),
      };
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
    chat.mockImplementationOnce(async () => ({
      text: JSON.stringify({
        class: 'dep-upstream-breaking',
        confidence: 0.96,
        signals: ['missing module'],
        failingCmd: 'pnpm test',
        errorExcerpt: "Cannot find module '@acme/money'",
      }),
    }));
    chat.mockImplementationOnce(async (_tier, messages: readonly {
      role: string;
      content: string;
    }[]) => {
      const user = messages.find(({ role }) => role === 'user');
      const request = JSON.parse(user?.content ?? '') as {
        sourceContext: { sources: Array<{ path: string }> };
      };
      expect(request.sourceContext.sources.map(({ path }) => path))
        .toEqual(['package.json']);
      const dependencyDiff = (version: string) => [
        'diff --git a/package.json b/package.json',
        '--- a/package.json',
        '+++ b/package.json',
        '@@ -1 +1 @@',
        '-{"dependencies":{"@acme/money":"4.0.0"}}',
        `+{"dependencies":{"@acme/money":"${version}"}}`,
      ].join('\n');
      return {
        text: JSON.stringify({
          candidates: [
            { id: 'pin-a', rationale: 'pin compatible release', diff: dependencyDiff('3.9.0') },
            { id: 'pin-b', rationale: 'pin prior patch', diff: dependencyDiff('3.8.1') },
            { id: 'pin-c', rationale: 'pin prior minor', diff: dependencyDiff('3.8.0') },
          ],
        }),
      };
    });

    const caseFile = await orchestrate(ctx);

    expect(caseFile.outcome).toBe('gave-up');
    expect(chat.mock.calls.map(([tier]) => tier)).toEqual(['nano', 'super']);
    expect(repository.sourceReads[0]?.paths).toEqual([
      'package.json',
      'pnpm-lock.yaml',
      'package-lock.json',
      'yarn.lock',
    ]);
  });

  it('fails closed without Super when no logged or fallback source exists', async () => {
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
    expect(chat.mock.calls.map(([tier]) => tier)).toEqual(['nano']);
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
