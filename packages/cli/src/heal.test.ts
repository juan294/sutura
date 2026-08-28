import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  InMemoryExecutor,
  SUTURA_SANDBOX_ENV,
  type Candidate,
  type Diagnosis,
  type InMemoryRunResult,
  type ModelTier,
  type TavilySearch,
} from '@sutura/core';
import { describe, expect, it, vi } from 'vitest';

import type { HealArguments } from './args.js';
import {
  CliConfigError,
  healWithRuntime,
  readDependencyHints,
  readLocalSourceContext,
  runtimeFromEnvironment,
} from './heal.js';

const CORPUS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'placebo', 'corpus');
const REPAIR_DIFF = [
  'diff --git a/page-count.js b/page-count.js',
  '--- a/page-count.js',
  '+++ b/page-count.js',
  '@@ -1 +1 @@',
  '-export function pageCount(items, size) { return Math.floor(items / size) + 1; }',
  '+export function pageCount(items, size) { return Math.ceil(items / size); }',
].join('\n');
const UPSTREAM_DIFF = [
  'diff --git a/app.cjs b/app.cjs',
  '--- a/app.cjs',
  '+++ b/app.cjs',
  '@@ -1,2 +1,2 @@',
  "-const fetch = require('node-fetch');",
  "-exports.fetchName = () => fetch('data:Juan').then((response) => response.text());",
  "+exports.fetchName = () => import('node-fetch').then(({default: fetch}) => fetch('data:Juan'))",
  "+  .then((response) => response.text());",
].join('\n');

function request(caseId: string, candidateDiff?: string, tavilyEnabled = true): HealArguments {
  return {
    command: 'heal',
    caseDir: join(CORPUS, caseId, 'fixture'),
    format: 'json',
    tavilyEnabled,
    ...(candidateDiff === undefined ? {} : { candidateDiff }),
  };
}

function runResult(exitCode: number, error = 'case.test.js: assertion failed'): InMemoryRunResult {
  return { exitCode, stdout: exitCode === 0 ? 'passed' : '', stderr: exitCode === 0 ? '' : error, truncated: false, metrics: {} };
}

function runtime(
  exits: number[],
  failureClass: Diagnosis['class'],
  candidate: Candidate = { id: 'repair', rationale: 'repair the source', diff: REPAIR_DIFF },
  tavily?: TavilySearch,
  reproductionError = 'case.test.js: assertion failed',
): {
  executor: InMemoryExecutor;
  chat: ReturnType<typeof vi.fn>;
  value: import('./heal.js').HealRuntime;
} {
  let scenarioIndex = 0;
  const executor = new InMemoryExecutor((command) => {
    if (command.includes('install --frozen-lockfile')) return runResult(0);
    const index = scenarioIndex++;
    return runResult(exits[index] ?? 1, index === 0 ? reproductionError : 'case.test.js: assertion failed');
  });
  const chat = vi.fn(async (tier: ModelTier) => {
    if (tier === 'nano') {
      return { text: JSON.stringify({
        class: failureClass, confidence: 0.95, signals: ['scripted'],
        failingCmd: 'pnpm test', errorExcerpt: reproductionError,
      }) };
    }
    if (tier === 'super') return { text: JSON.stringify({ candidates: [candidate] }) };
    return { text: JSON.stringify({ approved: true, reasoning: 'The source repair holds.' }) };
  });
  return {
    executor,
    chat,
    value: {
      executor,
      llm: { chat },
      cost: { entries: [], totalUsd: () => 0 },
      triageN: 5,
      raceK: 1,
      ...(tavily ? { tavily } : {}),
    },
  };
}

describe('healWithRuntime Placebo integration', () => {
  it('repairs a real repairable fixture with source-aware model input', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-cli-repair-'));
    try {
      await writeFile(
        join(directory, 'page-count.js'),
        'export function pageCount(items, size) { return Math.floor(items / size) + 1; }\n',
      );
      const scripted = runtime(
        [1, 1, 1, 1, 1, 1, 0, 0],
        'test-assertion',
        undefined,
        undefined,
        'page-count.js:1: assertion failed',
      );

      const result = await healWithRuntime(
        { ...request('repair-off-by-one'), caseDir: directory },
        scripted.value,
      );

      expect(result.outcome).toBe('fixed');
      const superCall = scripted.chat.mock.calls.find(([tier]) => tier === 'super');
      expect(JSON.stringify(superCall)).toContain('page-count.js');
      expect(scripted.executor.calls.filter(({ kind }) => kind === 'snapshot')).toHaveLength(1);
      expect(scripted.executor.calls.filter(({ kind }) => kind === 'run').every((call) =>
        call.kind !== 'run' || call.opts?.env === SUTURA_SANDBOX_ENV,
      )).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('labels the real flaky fixture with its scripted two-of-five ratio', async () => {
    const scripted = runtime([1, 1, 0, 1, 0, 0], 'flaky-timing');
    await expect(healWithRuntime(request('flaky-timer-race'), scripted.value)).resolves.toMatchObject({
      outcome: 'flaky-no-patch',
      triage: { status: 'intermittent', reproduced: 2, of: 5 },
    });
    expect(scripted.chat.mock.calls.map(([tier]) => tier)).toEqual(['nano']);
  });

  it('refuses a real trap at the vet gate without racing the known greenwash', async () => {
    const diff = await readFile(join(CORPUS, 'trap-skipped-test', 'fake-fix.diff'), 'utf8');
    const scripted = runtime([1, 1, 1, 1, 1, 1], 'test-assertion');
    const result = await healWithRuntime(request('trap-skipped-test', diff), scripted.value);
    expect(result).toMatchObject({ outcome: 'refused', audit: { approved: false } });
    expect(scripted.executor.calls.filter(({ kind }) => kind === 'run')).toHaveLength(7);
    expect(scripted.chat.mock.calls.map(([tier]) => tier)).toEqual(['nano']);
  });

  it('grounds and repairs a real upstream fixture with Tavily enabled', async () => {
    const search = vi.fn(async (query: string) => {
      expect(query).toContain('node-fetch');
      return [{
        title: 'node-fetch v3 upgrade guide',
        url: 'https://github.com/node-fetch/node-fetch/blob/main/docs/v3-UPGRADE-GUIDE.md',
        snippet: 'node-fetch v3 is ESM-only.',
      }];
    });
    const scripted = runtime(
      [1, 1, 1, 1, 1, 1, 0, 0],
      'dep-upstream-breaking',
      { id: 'esm', rationale: 'load ESM dynamically', diff: UPSTREAM_DIFF },
      { search },
      'app.cjs:1: Error [ERR_REQUIRE_ESM]: require() of ES Module node-fetch',
    );
    const result = await healWithRuntime(request('upstream-parser-release'), scripted.value);
    expect(result).toMatchObject({ outcome: 'fixed', diagnosis: { grounding: { skipped: false } } });
    expect(search).toHaveBeenCalledOnce();
  });
});

describe('CLI runtime configuration and source boundaries', () => {
  it('reads exact dependency versions from bounded local and file manifests', async () => {
    const fixture = join(CORPUS, 'upstream-formatter-release', 'fixture');
    await expect(readDependencyHints(fixture)).resolves.toEqual(expect.arrayContaining([
      'chalk@4.1.2',
      'eslint@10.9.1',
      'typescript@6.0.3',
      'vitest@4.1.11',
    ]));
  });

  it('does not read dependency metadata through a symlinked file package', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-dependency-link-'));
    const outside = await mkdtemp(join(tmpdir(), 'sutura-dependency-outside-'));
    try {
      await writeFile(
        join(directory, 'package.json'),
        JSON.stringify({ dependencies: { privatePackage: 'file:linked' } }),
      );
      await writeFile(
        join(outside, 'package.json'),
        JSON.stringify({ name: 'privatePackage', version: '9.9.9' }),
      );
      await symlink(outside, join(directory, 'linked'));

      await expect(readDependencyHints(directory)).resolves.toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('does not present dependency ranges as exact installed versions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-dependency-ranges-'));
    try {
      await writeFile(
        join(directory, 'package.json'),
        JSON.stringify({
          dependencies: {
            exact: '1.2.3',
            caret: '^2.0.0',
            tilde: '~3.0.0',
            workspace: 'workspace:4.0.0',
          },
        }),
      );

      await expect(readDependencyHints(directory)).resolves.toEqual(['exact@1.2.3']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('requires ConTree and Tavily configuration before constructing clients', () => {
    expect(() => runtimeFromEnvironment(request('repair-off-by-one'), {
      NEBIUS_API_KEY: 'nebius',
    })).toThrow(CliConfigError);
    expect(() => runtimeFromEnvironment(request('repair-off-by-one'), {
      NEBIUS_API_KEY: 'nebius', CONTREE_TOKEN: 'token', CONTREE_PROJECT: 'project',
    })).toThrow(/TAVILY_API_KEY/);
    expect(() => runtimeFromEnvironment(request('repair-off-by-one', undefined, false), {
      NEBIUS_API_KEY: 'nebius', CONTREE_TOKEN: 'token', CONTREE_PROJECT: 'project',
    })).not.toThrow();
  });

  it('reads bounded source files but excludes dependencies and secret-shaped paths', async () => {
    const fixture = join(CORPUS, 'repair-off-by-one', 'fixture');
    const context = await readLocalSourceContext(
      fixture,
      'Run pnpm test\npage-count.js:1\n.env:1\nnode_modules/vitest/index.js:1',
      { class: 'test-assertion', confidence: 1, signals: [], failingCmd: 'pnpm test', errorExcerpt: 'failed' },
    );
    expect(context.sources.map(({ path }) => path)).toContain('page-count.js');
    expect(context.sources.every(({ path }) => !path.includes('node_modules') && !path.startsWith('.env'))).toBe(true);
  });

  it('centers a bounded source window on a far observed line', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-source-window-'));
    try {
      await mkdir(join(directory, 'src'));
      await writeFile(
        join(directory, 'src', 'far.ts'),
        `${Array.from({ length: 320 }, (_, index) => `export const line${index + 1} = ${index + 1};`).join('\n')}\n`,
      );
      const context = await readLocalSourceContext(
        directory,
        'Run pnpm test\nsrc/far.ts:250: failure',
        { class: 'test-assertion', confidence: 1, signals: [], failingCmd: 'pnpm test', errorExcerpt: 'failed' },
      );
      expect(context.sources[0]).toMatchObject({ path: 'src/far.ts', startLine: 190, truncated: true });
      expect(context.sources[0]?.content).toContain('line250');
      expect(context.sources[0]?.content).not.toContain('line1 =');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves CRLF and no-final-newline state in source context', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-source-endings-'));
    try {
      await writeFile(join(directory, 'endings.ts'), 'one\r\ntwo');
      const context = await readLocalSourceContext(
        directory,
        'Run pnpm test\nendings.ts:1: failure',
        { class: 'test-assertion', confidence: 1, signals: [], failingCmd: 'pnpm test', errorExcerpt: 'failed' },
      );

      expect(context.sources[0]?.content).toBe('one\r\ntwo');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects an observed path with an intermediate symlink', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-source-link-'));
    const outside = await mkdtemp(join(tmpdir(), 'sutura-source-outside-'));
    try {
      await writeFile(join(outside, 'secret.ts'), 'export const secret = "never-read";\n');
      await symlink(outside, join(directory, 'linked'));
      const context = await readLocalSourceContext(
        directory,
        'Run pnpm test\nlinked/secret.ts:1: failure',
        { class: 'test-assertion', confidence: 1, signals: [], failingCmd: 'pnpm test', errorExcerpt: 'failed' },
      );
      expect(context.sources).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
