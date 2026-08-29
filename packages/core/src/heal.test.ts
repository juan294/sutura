import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { AuditVerdict, Candidate, CostLedger, Diagnosis } from './domain.js';
import { DEFAULT_MODELS } from './config.js';
import { InMemoryExecutor, type InMemoryRunResult } from './executor/memory.js';
import {
  buildSandboxRepositoryInitializationCommandForTest,
  healCase,
  sandboxExecutableCommand,
  sandboxPreparationCommand,
  sandboxTargetCommand,
  SUTURA_SANDBOX_ENV,
  type HealCaseContext,
} from './heal.js';
import type { TierLlm } from './llm/types.js';
import { DEFAULT_MODEL_PRICES } from './llm/cost.js';
import { DEFAULT_ROUTING_PROFILE_ID } from './llm/router.js';
import { parseRepositoryPolicy } from './policy/schema.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'placebo', 'corpus');
const HONEST_DIFF = [
  'diff --git a/page-count.js b/page-count.js',
  '--- a/page-count.js',
  '+++ b/page-count.js',
  '@@ -1 +1 @@',
  '-export function pageCount(items, size) { return Math.floor(items / size) + 1; }',
  '+export function pageCount(items, size) { return Math.ceil(items / size); }',
].join('\n') + '\n';

const UPSTREAM_DIFF = [
  'diff --git a/app.cjs b/app.cjs',
  '--- a/app.cjs',
  '+++ b/app.cjs',
  '@@ -1,2 +1,2 @@',
  "-const fetch = require('node-fetch');",
  "-exports.fetchName = () => fetch('data:Juan').then((response) => response.text());",
  "+const fetchClient = require('node-fetch');",
  "+exports.fetchName = () => fetchClient('data:Juan').then((response) => response.text());",
].join('\n') + '\n';

function result(exitCode: number, stderr = exitCode === 0 ? '' : 'case.test.js: assertion failed'): InMemoryRunResult {
  return { exitCode, stdout: exitCode === 0 ? 'Tests passed' : '', stderr, truncated: false, metrics: {} };
}

function ledger(): CostLedger {
  return { entries: [], totalUsd: () => 0 };
}

function diagnosis(failureClass: Diagnosis['class']): Diagnosis {
  return {
    class: failureClass,
    confidence: 0.95,
    signals: ['scripted'],
    failingCmd: 'pnpm test',
    errorExcerpt: 'case.test.js: assertion failed',
  };
}

function repairToolCall(
  candidate: Candidate,
  index: number,
): { text: string; toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>; usd: number } {
  const steps = [
    ['apply_patch', { diff: candidate.diff }],
    ['run_test', { commandId: 'diagnosed' }],
    ['submit_candidate', { id: candidate.id, rationale: candidate.rationale }],
  ] as const;
  const [name, args] = steps[Math.min(index, steps.length - 1)]!;
  return {
    text: '',
    toolCalls: [{ id: `repair-${index + 1}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
    usd: 0.001,
  };
}

function scriptedLlm(
  failureClass: Diagnosis['class'],
  candidates: Candidate[] = [{ id: 'repair', rationale: 'fix the source', diff: HONEST_DIFF }],
  auditApproved = true,
): { llm: TierLlm<'nano' | 'super' | 'ultra'>; chat: ReturnType<typeof vi.fn> } {
  let superCall = 0;
  const chat = vi.fn(async (tier: 'nano' | 'super' | 'ultra') => {
    if (tier === 'nano') return { text: JSON.stringify(diagnosis(failureClass)) };
    if (tier === 'super') return repairToolCall(candidates[0]!, superCall++);
    const verdict: Pick<AuditVerdict, 'approved' | 'reasoning'> = {
      approved: auditApproved,
      reasoning: auditApproved ? 'The source repair holds.' : 'REFUSED: wrong cause.',
    };
    return { text: JSON.stringify(verdict) };
  });
  const modelQuote = (tier: 'nano' | 'super' | 'ultra') => ({
    role: tier,
    modelId: DEFAULT_MODELS[tier],
    price: DEFAULT_MODEL_PRICES[tier],
    profileId: DEFAULT_ROUTING_PROFILE_ID,
  });
  return { llm: { chat, modelQuote }, chat };
}

function context(
  caseId: string,
  exits: number[],
  failureClass: Diagnosis['class'],
  extra: Partial<HealCaseContext> = {},
): { ctx: HealCaseContext; executor: InMemoryExecutor; chat: ReturnType<typeof vi.fn> } {
  let scenarioIndex = 0;
  const repairCandidates = caseId.startsWith('upstream-')
    ? [{ id: 'repair', rationale: 'rename the source binding', diff: UPSTREAM_DIFF }]
    : undefined;
  const repairDiff = repairCandidates?.[0]?.diff ?? HONEST_DIFF;
  const executor = new InMemoryExecutor((command) =>
    command.includes('git apply - && git diff')
      ? { ...result(0), stdout: repairDiff }
      : command.includes('corepack pnpm install --frozen-lockfile') ||
        command.includes('git init --quiet')
      ? result(0)
      : result(exits[scenarioIndex++] ?? 1),
  );
  const { llm, chat } = scriptedLlm(failureClass, repairCandidates);
  return {
    executor,
    chat,
    ctx: {
      runId: `placebo-${caseId}`,
      repo: `placebo/${caseId}`,
      caseDir: join(ROOT, caseId, 'fixture'),
      executor,
      llm,
      cost: ledger(),
      triageN: 5,
      raceK: 1,
      readSourceContext: async () => {
        const path = caseId.startsWith('upstream-') ? 'app.cjs' : 'page-count.js';
        return {
          sources: [{
            path,
            startLine: 1,
            content: caseId === 'repair-off-by-one'
              ? 'export function pageCount(items, size) { return Math.floor(items / size) + 1; }\n'
              : await readFile(join(ROOT, caseId, 'fixture', path), 'utf8'),
            truncated: false,
          }],
        };
      },
      ...extra,
    },
  };
}

describe('healCase', () => {
  it('uses raceK only as a direct-call compatibility width when search settings are absent', async () => {
    const legacy = context('repair-off-by-one', [1, 1, 1, 1, 1, 0, 0], 'test-assertion');
    const legacyCase = await healCase(legacy.ctx);
    expect(legacy.chat.mock.calls.filter(([tier]) => tier === 'super')).toHaveLength(1);
    expect(legacyCase.search?.[0]).toMatchObject({ nodeId: 'search-001', terminalReason: 'passed' });

    const adaptive = context('repair-off-by-one', [1, 1, 1, 1, 1, 0, 0, 1], 'test-assertion', {
      search: { initialBranches: 2, beamWidth: 1, maximumDepth: 1, maximumTotalBranches: 2 },
    });
    const adaptiveCase = await healCase(adaptive.ctx);
    expect(adaptiveCase.search?.[0]).toMatchObject({ nodeId: 'search-001' });
    expect(adaptive.executor.calls.some((call) =>
      call.kind === 'run' && call.opts?.operationId?.startsWith('search-'),
    )).toBe(true);
    expect(adaptiveCase.stages.some((entry) =>
      entry.operationId?.startsWith('search-') &&
      entry.operationTerminal === 'succeeded' &&
      entry.cancellationRequested === false,
    )).toBe(true);
  });

  it('reserves enough shared model turns for one complete initial repair branch', async () => {
    const value = context('repair-off-by-one', [1, 1, 1, 1, 1, 0, 0], 'test-assertion', {
      search: { initialBranches: 4, beamWidth: 2, maximumDepth: 4, maximumTotalBranches: 12 },
    });

    const caseFile = await healCase(value.ctx);

    expect(caseFile.outcome).toBe('fixed');
    expect(caseFile.search?.map(({ nodeId }) => nodeId)).toEqual(['search-001']);
  });

  it('refuses the first adaptive expansion when the current provider snapshot has no capacity', async () => {
    const value = context('repair-off-by-one', [1, 1, 1, 1, 1, 1], 'test-assertion', {
      search: { initialBranches: 4, beamWidth: 2, maximumDepth: 4, maximumTotalBranches: 12 },
    });
    value.ctx.llm = {
      ...value.ctx.llm,
      capacitySnapshot: () => ({
        remainingRequests: 0, remainingTokens: 1000,
        resetRequestsSec: 1, resetTokensSec: 1,
        dynamicRequestScale: null, dynamicTokenScale: null,
        windowUsageRequests: null, windowUsageTokens: null,
        retryAfterSec: null, requestId: 'capacity-zero',
      }),
    };
    const caseFile = await healCase(value.ctx);
    expect(caseFile.outcome).toBe('gave-up');
    expect(value.chat.mock.calls.filter(([tier]) => tier === 'super')).toHaveLength(0);
    expect(caseFile.search).toEqual([]);
  });
  it.each([
    [{ elapsedTimeSec: 12, maxRssKb: 120 }, 'fixed'],
    [{ elapsedTimeSec: 12.1, maxRssKb: 120 }, 'refused'],
    [{ maxRssKb: 120 }, 'refused'],
  ] as const)(
    'runs required commands on baseline and audited candidate with paired metrics: %j',
    async (candidateMetrics, outcome) => {
      const { ctx } = context(
        'repair-off-by-one',
        [],
        'test-assertion',
      );
      let scenarioIndex = 0;
      let policyCommandRuns = 0;
      const ordinaryExits = [1, 1, 1, 1, 1, 0, 0];
      const executor = new InMemoryExecutor((command) => {
        if (command.includes('git apply - && git diff')) {
          return { ...result(0), stdout: HONEST_DIFF };
        }
        if (
          command.includes('corepack pnpm install --frozen-lockfile') ||
          command.includes('git init --quiet')
        ) return result(0);
        if (command.includes('policy-check')) {
          policyCommandRuns += 1;
          return {
            ...result(policyCommandRuns === 1 ? 1 : 0),
            metrics: policyCommandRuns === 1
              ? { elapsedTimeSec: 10, maxRssKb: 100 }
              : { ...candidateMetrics },
          };
        }
        return result(ordinaryExits[scenarioIndex++] ?? 1);
      });
      ctx.executor = executor;
      ctx.policy = parseRepositoryPolicy(JSON.stringify({
        version: 1,
        allowedPaths: ['**'],
        requiredCommands: ['pnpm run policy-check'],
        resourceLimits: { elapsedTimePercent: 20, maxRssPercent: 20 },
      }));

      const caseFile = await healCase(ctx);

      expect(caseFile.outcome).toBe(outcome);
      expect(policyCommandRuns).toBe(2);
      expect(caseFile.audit?.checks).toContainEqual(expect.objectContaining({
        name: 'policy-resource-limit',
        passed: outcome === 'fixed',
      }));
      expect(caseFile.stages.filter(({ note }) => note?.includes('Required command')))
        .toHaveLength(2);
    },
  );

  it('repairs a real Placebo fixture after one snapshot and one pre-inference reproduction', async () => {
    const { ctx, executor, chat } = context(
      'repair-off-by-one',
      [1, 1, 1, 1, 1, 0, 0],
      'test-assertion',
    );

    const caseFile = await healCase(ctx);

    expect(caseFile.outcome).toBe('fixed');
    expect(caseFile.runtime).toBe('node');
    expect(executor.calls.filter(({ kind }) => kind === 'snapshot')).toHaveLength(2);
    expect(executor.calls.find((call) => call.kind === 'run')).toMatchObject({
      kind: 'run',
      cmd: expect.stringContaining('corepack pnpm install --frozen-lockfile'),
    });
    expect(executor.calls.filter(({ kind }) => kind === 'run').every((call) =>
      call.kind !== 'run' || call.opts?.env === SUTURA_SANDBOX_ENV,
    )).toBe(true);
    expect(chat.mock.calls.map(([tier]) => tier)).toEqual(['nano', 'super', 'ultra']);
    expect(caseFile.trace?.map(({ type }) => type)).toEqual(expect.arrayContaining([
      'run-start',
      'model-request',
      'model-response',
      'tool-request',
      'tool-result',
      'sandbox-operation',
      'search-decision',
      'candidate-submitted',
      'audit-result',
      'run-finish',
    ]));
    expect(caseFile.trace?.at(0)).toMatchObject({ sequence: 1, timestampMs: 0, type: 'run-start' });
    expect(caseFile.trace?.at(-1)).toMatchObject({ type: 'run-finish', outcome: 'fixed' });
    const serializedTrace = JSON.stringify(caseFile.trace);
    expect(serializedTrace).not.toContain('export function pageCount');
    expect(serializedTrace).not.toContain('-export function');
    expect(caseFile.trace?.find(({ type }) => type === 'model-request')).toMatchObject({
      promptHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      promptExcerpt: expect.any(String),
    });
  });

  it('labels the real Placebo flaky fixture without generating a patch', async () => {
    const { ctx, chat } = context(
      'flaky-timer-race',
      [1, 1, 0, 1, 0, 0],
      'flaky-timing',
    );

    await expect(healCase(ctx)).resolves.toMatchObject({
      outcome: 'flaky-no-patch',
      runtime: 'node',
      triage: { status: 'intermittent', reproduced: 2, of: 5 },
    });
    expect(chat.mock.calls.map(([tier]) => tier)).toEqual(['nano']);
  });

  it('administers and refuses the real Placebo trap candidate without a repair-model call', async () => {
    const candidateDiff = await readFile(join(ROOT, 'trap-skipped-test', 'fake-fix.diff'), 'utf8');
    const { ctx, executor, chat } = context(
      'trap-skipped-test',
      [1, 1, 1, 1, 1, 0],
      'test-assertion',
      { candidateDiff },
    );

    const caseFile = await healCase(ctx);

    expect(caseFile.outcome).toBe('refused');
    expect(caseFile.runtime).toBe('node');
    expect(caseFile.audit?.approved).toBe(false);
    expect(caseFile.audit?.checks).toContainEqual(expect.objectContaining({ name: 'skipped-test', passed: false }));
    expect(executor.calls.filter(({ kind }) => kind === 'run')).toHaveLength(7);
    expect(chat.mock.calls.map(([tier]) => tier)).toEqual(['nano']);
  });

  it('refuses a pass-with-no-tests package-script bypass before the candidate race', async () => {
    const candidateDiff = await readFile(
      join(ROOT, 'trap-pass-with-no-tests', 'fake-fix.diff'),
      'utf8',
    );
    const { ctx, executor, chat } = context(
      'trap-pass-with-no-tests',
      [1, 1, 1, 1, 1],
      'test-assertion',
      { candidateDiff },
    );

    const caseFile = await healCase(ctx);

    expect(caseFile).toMatchObject({
      outcome: 'refused',
      audit: {
        approved: false,
        reasoning: expect.stringContaining('adds pass-with-no-tests bypass'),
      },
    });
    expect(executor.calls.filter(({ kind }) => kind === 'run')).toHaveLength(7);
    expect(chat.mock.calls.map(([tier]) => tier)).toEqual(['nano']);
  });

  it('grounds an upstream Placebo fixture only when Tavily is enabled', async () => {
    const search = vi.fn().mockResolvedValue([{
      title: 'node-fetch v3 upgrade guide',
      url: 'https://github.com/node-fetch/node-fetch/blob/main/docs/v3-UPGRADE-GUIDE.md',
      snippet: 'node-fetch v3 is ESM-only.',
    }]);
    const { ctx } = context(
      'upstream-parser-release',
      [1, 1, 1, 1, 1, 0, 0],
      'dep-upstream-breaking',
      { tavily: { search } },
    );

    const caseFile = await healCase(ctx);

    expect(caseFile.outcome).toBe('fixed');
    expect(caseFile.diagnosis.grounding).toMatchObject({ skipped: false });
    expect(search).toHaveBeenCalledOnce();
  });

  it('gives up on a real upstream break when release grounding is unavailable', async () => {
    const { ctx, chat } = context(
      'upstream-parser-release',
      [1, 1, 1, 1, 1, 1],
      'dep-upstream-breaking',
    );

    await expect(healCase(ctx)).resolves.toMatchObject({
      outcome: 'gave-up',
      runtime: 'node',
      diagnosis: {
        class: 'dep-upstream-breaking',
        grounding: { skipped: true, reason: 'disabled', citations: [] },
      },
      race: [],
    });
    expect(chat.mock.calls.map(([tier]) => tier)).toEqual(['nano']);
  });

  it('stops before paid inference when the clean sandbox does not reproduce', async () => {
    const { ctx, chat } = context('python-repair-missing-await', [0, 0], 'test-assertion', {
      runtimeId: 'python',
      failureCommand: 'pytest -q',
    });

    await expect(healCase(ctx)).resolves.toMatchObject({
      outcome: 'infra-stop',
      runtime: 'python',
      triage: { status: 'not-run', reproduced: 0, of: 0 },
    });
    expect(chat).not.toHaveBeenCalled();
  });

  it('stops before reproduction and paid inference when sandbox preparation fails', async () => {
    const { ctx, chat } = context('python-repair-missing-await', [1], 'test-assertion', {
      runtimeId: 'python',
      failureCommand: 'pytest -q',
    });
    const executor = new InMemoryExecutor(() => result(1, 'pnpm install failed'));
    ctx.executor = executor;

    await expect(healCase(ctx)).resolves.toMatchObject({
      outcome: 'infra-stop',
      runtime: 'python',
      diagnosis: {
        class: 'infra',
        signals: ['sandbox-preparation:failed'],
        errorExcerpt: 'pnpm install failed',
      },
    });
    expect(executor.calls.filter(({ kind }) => kind === 'run')).toHaveLength(1);
    expect(chat).not.toHaveBeenCalled();
  });

  it('does not let an explicit Python selector replace the verified image digest', async () => {
    const { ctx, executor } = context('python-repair-missing-await', [], 'test-assertion', {
      runtimeId: 'python',
      failureCommand: 'pytest -q',
      imageRef: 'python:latest',
    });

    await expect(healCase(ctx)).rejects.toThrow('Python runtime image must use the verified exact digest');
    expect(executor.calls).toEqual([]);
  });

  it('reproduces an observed dependency-install command from manifest-only preparation', async () => {
    const { ctx, chat } = context('repair-off-by-one', [0], 'infra', {
      failureCommand: 'pnpm install --frozen-lockfile',
    });

    const caseFile = await healCase(ctx);

    expect(caseFile.outcome).toBe('infra-stop');
    const commands = ctx.executor instanceof InMemoryExecutor
      ? ctx.executor.calls.filter((call) => call.kind === 'run').map(({ cmd }) => cmd)
      : [];
    expect(commands[0]).toContain('pnpm install --frozen-lockfile --ignore-scripts');
    const runs = ctx.executor instanceof InMemoryExecutor
      ? ctx.executor.calls.filter((call) => call.kind === 'run')
      : [];
    expect(runs[0]?.opts?.network).toBe('enabled');
    expect(runs.slice(1).every((call) => call.opts?.network === 'disabled')).toBe(true);
    expect(chat).not.toHaveBeenCalled();
  });
});

describe('sandbox command resolution', () => {
  it('creates an exact hook-disabled Git baseline from only manifest members', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-git-baseline-'));
    const marker = join(directory, 'hook-ran');
    const manifest = join(directory, 'overlay.manifest');
    const template = join(directory, 'empty-template');
    try {
      await mkdir(join(directory, 'src'), { recursive: true });
      await mkdir(join(directory, 'node_modules', 'dependency'), { recursive: true });
      await writeFile(join(directory, 'package.json'), '{"name":"fixture"}\n');
      await writeFile(join(directory, 'src', 'index.ts'), 'export const ready = true;\n');
      await writeFile(join(directory, 'node_modules', 'dependency', 'output.js'), 'prepared\n');
      await writeFile(manifest, Buffer.from('package.json\0src/index.ts\0'));
      await mkdir(template);
      expect(spawnSync('git', ['init', '--quiet'], { cwd: directory }).status).toBe(0);
      const hook = join(directory, '.git', 'hooks', 'pre-commit');
      await writeFile(hook, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`);
      await chmod(hook, 0o755);

      const command = buildSandboxRepositoryInitializationCommandForTest({
        manifestPath: manifest,
        templatePath: template,
      });
      const initialized = spawnSync('sh', ['-c', command], {
        cwd: directory,
        encoding: 'utf8',
      });

      expect(initialized.status, initialized.stderr).toBe(0);
      const listed = spawnSync('git', ['ls-files', '-z'], {
        cwd: directory,
        encoding: 'utf8',
      });
      expect(listed.stdout.split('\0').filter(Boolean).sort()).toEqual([
        'package.json',
        'src/index.ts',
      ]);
      await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('uses verified lifecycle-blocking installer modes', () => {
    const command = sandboxPreparationCommand();

    expect(command).toContain('pnpm install --frozen-lockfile --ignore-scripts');
    expect(command).toContain('npm ci --ignore-scripts');
    expect(command).toContain('yarn install --frozen-lockfile --ignore-scripts');
    expect(command).toContain('yarn install --immutable --mode=skip-build');
    expect(command).toContain('unsupported Yarn version');
  });

  it('uses one resolved command for reproduction, triage, race, and audit', async () => {
    const observed = 'vitest run;';
    const { ctx, executor, chat } = context(
      'repair-off-by-one',
      [1, 1, 1, 1, 1, 0, 0],
      'test-assertion',
      { failureCommand: observed },
    );
    let superCall = 0;
    chat.mockImplementation(async (tier: 'nano' | 'super' | 'ultra') => {
      if (tier === 'nano') {
        return {
          text: JSON.stringify({
            ...diagnosis('test-assertion'),
            failingCmd: observed,
          }),
        };
      }
      if (tier === 'super') {
        return repairToolCall(
          { id: 'repair', rationale: 'fix the source', diff: HONEST_DIFF },
          superCall++,
        );
      }
      return {
        text: JSON.stringify({ approved: true, reasoning: 'The source repair holds.' }),
      };
    });

    const caseFile = await healCase(ctx);
    const stageCommands = executor.calls.flatMap((call) =>
      call.kind === 'run' &&
        !call.cmd.includes('corepack pnpm install --frozen-lockfile') &&
        !call.cmd.includes('git init --quiet') &&
        call.cmd.includes('vitest run;')
        ? [call.cmd]
        : [],
    );

    expect(caseFile).toMatchObject({
      outcome: 'fixed',
      diagnosis: { failingCmd: observed },
    });
    expect(stageCommands).toHaveLength(7);
    expect(stageCommands.every((command) =>
      command.includes('corepack pnpm exec sh -c') && command.includes('vitest run;'),
    )).toBe(true);
  });

  it('runs an observed package binary through the repository package manager', () => {
    const command = sandboxExecutableCommand('vitest run');

    expect(command).toContain("corepack pnpm exec sh -c 'vitest run'");
    expect(command).toContain("corepack yarn exec sh -c 'vitest run'");
    expect(command).toContain("PATH=\"./node_modules/.bin:$PATH\" sh -c 'vitest run'");
    expect(sandboxTargetCommand('vitest run')).toContain('corepack pnpm exec sh -c');
  });

  it.each([
    ['pnpm', 'pnpm-lock.yaml'],
    ['yarn', 'yarn.lock'],
    ['npm', null],
  ] as const)('resolves a local package binary in a %s repository', async (_manager, lockfile) => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-package-command-'));
    try {
      const binDirectory = join(directory, 'node_modules', '.bin');
      const toolDirectory = join(directory, 'tools');
      await mkdir(binDirectory, { recursive: true });
      await mkdir(toolDirectory, { recursive: true });
      await writeFile(
        join(binDirectory, 'vitest'),
        '#!/bin/sh\nprintf "local-vitest:%s\\n" "$1"\n',
      );
      await chmod(join(binDirectory, 'vitest'), 0o755);
      await writeFile(
        join(toolDirectory, 'corepack'),
        [
          '#!/bin/sh',
          'case "$1:$2" in pnpm:exec|yarn:exec) shift 2 ;; *) exit 90 ;; esac',
          'PATH="$PWD/node_modules/.bin:$PATH" exec "$@"',
          '',
        ].join('\n'),
      );
      await chmod(join(toolDirectory, 'corepack'), 0o755);
      if (lockfile) await writeFile(join(directory, lockfile), '');

      const execution = spawnSync(
        '/bin/sh',
        ['-c', sandboxExecutableCommand('vitest local;')],
        {
          cwd: directory,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${toolDirectory}:${process.env['PATH'] ?? ''}`,
          },
        },
      );

      expect(execution.status, execution.stderr).toBe(0);
      expect(execution.stdout).toBe('local-vitest:local\n');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    'vitest run;',
    'vitest run &',
    String.raw`vitest run --testNamePattern 'quotes; pipes | and dollars $HOME' && echo done`,
  ])('produces valid shell for package command %s', (observed) => {
    const command = sandboxExecutableCommand(observed);

    expect(spawnSync('sh', ['-n'], { input: command }).status).toBe(0);
    expect(command).toContain(observed.replaceAll("'", `'\"'\"'`));
  });

  it.each([
    'vitest-evil',
    'vitest.config.ts',
    'vitest/run',
  ])('does not resolve package-binary lookalike %s', (observed) => {
    expect(sandboxExecutableCommand(observed)).toBe(observed);
  });

  it('places Corepack package-manager shims on PATH for the whole command', () => {
    const command = sandboxExecutableCommand(
      'cd packages/core && CI=true pnpm test && yarn lint',
    );

    expect(command).toContain('corepack enable --install-directory');
    expect(command).toContain('PATH="$sutura_corepack_bin:$PATH" sh -c');
    expect(command).toContain('cd packages/core && CI=true pnpm test && yarn lint');
    expect(sandboxExecutableCommand('corepack pnpm test && pnpm lint'))
      .toContain('corepack enable --install-directory');
  });

  it('executes compound and redirected package-manager commands through Corepack', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-corepack-command-'));
    try {
      const toolDirectory = join(directory, 'tools');
      await mkdir(toolDirectory, { recursive: true });
      await writeFile(
        join(toolDirectory, 'corepack'),
        [
          '#!/bin/sh',
          'if [ "$1" = "pnpm" ]; then shift; printf "corepack-pnpm:%s\\n" "$*"; exit 0; fi',
          '[ "$1:$2" = "enable:--install-directory" ] || exit 90',
          'directory=$3',
          `printf '#!/bin/sh\nprintf "pnpm:%%s\\n" "$*"\n' > "$directory/pnpm"`,
          `printf '#!/bin/sh\nprintf "yarn:%%s\\n" "$*"\n' > "$directory/yarn"`,
          'chmod +x "$directory/pnpm" "$directory/yarn"',
          '',
        ].join('\n'),
      );
      await chmod(join(toolDirectory, 'corepack'), 0o755);
      await mkdir(join(directory, 'packages', 'core'), { recursive: true });

      const execution = spawnSync(
        '/bin/sh',
        ['-c', sandboxExecutableCommand(
          'corepack pnpm install --frozen-lockfile && cd packages/core && CI=true pnpm test && yarn lint && pnpm>result.txt',
        )],
        {
          cwd: directory,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${toolDirectory}:${process.env['PATH'] ?? ''}`,
            TMPDIR: directory,
          },
        },
      );

      expect(execution.status, execution.stderr).toBe(0);
      expect(execution.stdout).toBe(
        'corepack-pnpm:install --frozen-lockfile\npnpm:test\nyarn:lint\n',
      );
      await expect(readFile(join(directory, 'packages', 'core', 'result.txt'), 'utf8'))
        .resolves.toBe('pnpm:\n');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    'pnpm-evil test',
    'yarn.lock',
    'echo /usr/bin/pnpm',
  ])('does not resolve package-manager lookalike %s', (observed) => {
    expect(sandboxExecutableCommand(observed)).toBe(observed);
  });

  it('preserves npm package scripts and system commands', () => {
    expect(sandboxExecutableCommand('npm test')).toBe('npm test');
    expect(sandboxExecutableCommand('node --test')).toBe('node --test');
  });
});
