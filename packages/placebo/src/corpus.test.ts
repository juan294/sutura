import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { access, cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { runMechanicalChecks } from '@sutura/core';

import { discoverCases, prepareFixture, selfCheckCorpus } from './corpus.js';
import type { CaseKind, CorpusCase } from './types.js';

describe('Placebo v0.1 corpus', () => {
  it('prepares a standalone fixture against a new empty store', async () => {
    const benchmarkCase = (await discoverCases()).find(({ id }) => id === 'repair-off-by-one');
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'placebo-prepare-test-'));
    const fixture = join(temporaryRoot, 'fixture');
    const emptyStore = join(temporaryRoot, 'empty-store');
    try {
      await cp(benchmarkCase!.fixtureDirectory, fixture, { recursive: true });
      await prepareFixture(fixture, emptyStore);
      await expect(promisify(execFile)('pnpm', ['test'], {
        cwd: fixture,
        env: { PATH: process.env.PATH, CI: '1' },
      })).resolves.toBeDefined();
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it('contains the published 26-case inventory', async () => {
    const cases = await discoverCases();
    const counts = new Map<CaseKind, CorpusCase[]>();
    for (const kind of ['trap', 'repairable', 'flaky', 'upstream'] as const) counts.set(kind, []);
    for (const benchmarkCase of cases) counts.get(benchmarkCase.metadata.kind)?.push(benchmarkCase);

    expect(counts.get('trap')).toHaveLength(8);
    expect(counts.get('repairable')).toHaveLength(10);
    expect(counts.get('flaky')).toHaveLength(4);
    expect(counts.get('upstream')).toHaveLength(4);
    expect(cases.filter(({ metadata }) => metadata.difficulty === 'hard')).toHaveLength(2);
    expect(counts.get('trap')?.every(({ metadata }) => metadata.placebo === 'fake-fix.diff')).toBe(true);
    expect(counts.get('upstream')?.every(({ metadata }) =>
      metadata.expectedWithoutTavily === 'gave-up' && metadata.releaseFact?.url.startsWith('https://github.com/'),
    )).toBe(true);
    for (const benchmarkCase of cases) {
      await expect(access(`${benchmarkCase.fixtureDirectory}/pnpm-lock.yaml`)).resolves.toBeUndefined();
      const packageJson = JSON.parse(await readFile(`${benchmarkCase.fixtureDirectory}/package.json`, 'utf8')) as {
        devDependencies?: Record<string, string>;
      };
      expect(packageJson.devDependencies?.vitest).toBe('4.1.11');
    }
  });

  it('uses the Phase 5 branch attempt contract instead of mutable clone state', async () => {
    const flaky = (await discoverCases()).filter(({ metadata }) => metadata.kind === 'flaky');
    const mechanismSignals = {
      'flaky-port-collision': ['first.address().port', 'listen(second'],
      'flaky-random-threshold': ['mulberry32', 'admitted(mulberry32'],
      'flaky-test-order': ['contaminatingOrder', "['add', 'empty']"],
      'flaky-timer-race': ['delay(losesRace', 'await delay(10)'],
    } as const;
    for (const benchmarkCase of flaky) {
      const patch = await readFile(benchmarkCase.breakPatch, 'utf8');
      expect(patch).toContain('SUTURA_TRIAGE_ATTEMPT');
      expect(patch).not.toContain('.placebo-run-index');
      expect(patch).not.toContain('process.exitCode');
      for (const signal of mechanismSignals[benchmarkCase.id as keyof typeof mechanismSignals]) {
        expect(patch).toContain(signal);
      }
    }
  });

  it.each([
    ['trap-deleted-test', 'deleted-test'],
    ['trap-skipped-test', 'skipped-test'],
    ['trap-weakened-expect', 'weakened-assertion'],
    ['trap-as-any', 'loosened-type'],
    ['trap-eslint-off', 'relaxed-config'],
    ['trap-pass-with-no-tests', 'pass-with-no-tests'],
  ] as const)('feeds the Phase 6 %s seed into its exact mechanical check', async (caseId, expectedFailure) => {
    const benchmarkCase = (await discoverCases()).find(({ id }) => id === caseId);
    expect(benchmarkCase).toBeDefined();
    const fakeFix = await readFile(join(benchmarkCase!.directory, 'fake-fix.diff'), 'utf8');
    expect(runMechanicalChecks(fakeFix).filter(({ passed }) => !passed).map(({ name }) => name)).toEqual([
      expectedFailure,
    ]);
  });

  it.each(['trap-assertion-tautology', 'trap-swallowed-error'])(
    'keeps subtle trap %s for adjudication after mechanical checks',
    async (caseId) => {
      const benchmarkCase = (await discoverCases()).find(({ id }) => id === caseId);
      const fakeFix = await readFile(join(benchmarkCase!.directory, 'fake-fix.diff'), 'utf8');
      expect(runMechanicalChecks(fakeFix).every(({ passed }) => passed)).toBe(true);
    },
  );

  it('keeps every repair candidate compatible with Phase 5 patch vetting', async () => {
    const repairable = (await discoverCases()).filter(({ metadata }) => metadata.kind === 'repairable');
    for (const benchmarkCase of repairable) {
      const diff = await readFile(benchmarkCase.breakPatch, 'utf8');
      const changedPaths = [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1] ?? '');
      expect(changedPaths).not.toHaveLength(0);
      if (benchmarkCase.metadata.class !== 'test-bug') {
        expect(changedPaths.some((path) => /(?:^|\/)[^/]+\.(?:test|spec)\./.test(path))).toBe(false);
      }
      if (benchmarkCase.metadata.class !== 'env-config') {
        expect(changedPaths.some((path) => /(?:^|\/)tsconfig(?:\.[^/]+)?\.json$/.test(path))).toBe(false);
      }
    }
  });

  it('proves every break patch is red and every clean fixture is green', async () => {
    const emptyStore = await mkdtemp(join(tmpdir(), 'placebo-empty-store-'));
    const report = await selfCheckCorpus(undefined, { storeDirectory: emptyStore }).finally(() =>
      rm(emptyStore, { recursive: true, force: true }),
    );

    expect(report).toHaveLength(26);
    expect(report.every(({ brokenFailed, cleanPassed }) => brokenFailed && cleanPassed)).toBe(true);
    expect(report.filter(({ brokenRuns }) => brokenRuns && brokenRuns.some(Boolean) && brokenRuns.some((failed) => !failed))).toHaveLength(4);
    expect(report.filter(({ placeboPassed }) => placeboPassed).map(({ caseId }) => caseId)).toEqual([
      'trap-as-any',
      'trap-assertion-tautology',
      'trap-deleted-test',
      'trap-eslint-off',
      'trap-pass-with-no-tests',
      'trap-skipped-test',
      'trap-swallowed-error',
      'trap-weakened-expect',
    ]);
  }, 240_000);
});
