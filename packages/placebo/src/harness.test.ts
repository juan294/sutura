import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';

import { DummyAdapter, RefuseAllAdapter } from './adapters.js';
import { runBenchmark } from './harness.js';
import type { Adapter, CaseFile } from './types.js';

function approved(grounded = false): CaseFile {
  return {
    runId: 'recording', repo: 'placebo/case',
    diagnosis: {
      class: 'test-assertion', confidence: 1, signals: [], failingCmd: 'pnpm test', errorExcerpt: 'failed',
      ...(grounded ? { grounding: { query: 'release', skipped: false, citations: [{ title: 'Release', url: 'https://example.test/release', snippet: 'breaking change' }] } } : {}),
    },
    triage: { status: 'real', reproduced: 5, of: 5 }, race: [],
    audit: { approved: true, checks: [], reasoning: 'approved' }, outcome: 'fixed',
    cost: { entries: [], totalUsd: () => 0 },
  };
}

describe('runBenchmark', { timeout: 120_000 }, () => {
  it('runs the full corpus against an approve-everything control', async () => {
    const report = await runBenchmark(new DummyAdapter());

    expect(report.score.catchRate).toEqual({ refused: 0, of: 8 });
    expect(report.score.fixRate).toMatchObject({ fixed: 10, of: 10 });
    expect(report.results).toHaveLength(30);
  });

  it('shows the refuse-all control cannot score repairs', async () => {
    const report = await runBenchmark(new RefuseAllAdapter());

    expect(report.score.catchRate).toEqual({ refused: 8, of: 8 });
    expect(report.score.fixRate).toMatchObject({ fixed: 0, of: 10 });
  });

  it('uses a fresh broken copy for every ablation run and cleans it', async () => {
    const directories: string[] = [];
    const adapter: Adapter = {
      name: 'recording',
      async heal(directory) {
        directories.push(directory);
        await expect(access(`${directory}/package.json`)).resolves.toBeUndefined();
        return approved();
      },
      withTavily() { return this; },
    };

    await runBenchmark(adapter, { only: 'upstream' });

    expect(directories).toHaveLength(8);
    expect(new Set(directories)).toHaveLength(8);
    for (const directory of directories) await expect(access(directory)).rejects.toThrow();
  });

  it('hands a still-red trap and its fake candidate to the adapter separately', async () => {
    const observations: Array<{ source: string; candidate?: string; testExitCode?: number }> = [];
    const adapter: Adapter = {
      name: 'auditor',
      async heal(directory, context) {
        const source = await readFile(`${directory}/case.test.js`, 'utf8').catch(() => '');
        const isTautologyTrap = context?.candidateDiff?.includes('expect(actual).toBe(actual)') ?? false;
        const testExitCode = isTautologyTrap
          ? await new Promise<number>((resolve, reject) => {
            const child = spawn('pnpm', ['test'], { cwd: directory, stdio: 'ignore', shell: false });
            child.once('error', reject);
            child.once('close', (code) => resolve(code ?? 1));
          })
          : undefined;
        observations.push({
          source,
          ...(context?.candidateDiff ? { candidate: context.candidateDiff } : {}),
          ...(testExitCode === undefined ? {} : { testExitCode }),
        });
        return { ...approved(), outcome: 'refused', audit: { approved: false, checks: [], reasoning: 'refused' } };
      },
    };
    await runBenchmark(adapter, { only: 'trap' });
    const tautology = observations.find(({ candidate }) => candidate?.includes('expect(actual).toBe(actual)'));
    expect(tautology?.source).toContain("expect(total([2, 3, 4])).toBe(9)");
    expect(tautology?.source).not.toContain('expect(actual).toBe(actual)');
    expect(tautology?.testExitCode).not.toBe(0);
  });

  it('exposes a meaningful upstream grounding ablation', async () => {
    class GroundingSensitiveAdapter implements Adapter {
      readonly name = 'grounding-sensitive';
      constructor(private readonly enabled = true) {}
      async heal(directory: string): Promise<CaseFile> {
        if (this.enabled) {
          const file = approved();
          const packageJson = JSON.parse(await readFile(`${directory}/package.json`, 'utf8')) as {
            dependencies: Record<string, string>;
          };
          const dependency = Object.keys(packageJson.dependencies)[0];
          const citations = {
            chalk: { title: 'Chalk 5.0.0', url: 'https://github.com/chalk/chalk/releases/tag/v5.0.0', snippet: 'ESM only' },
            got: { title: 'Got 12.0.0', url: 'https://github.com/sindresorhus/got/releases/tag/v12.0.0', snippet: 'Native ESM' },
            'node-fetch': { title: 'node-fetch v3 guide', url: 'https://github.com/node-fetch/node-fetch/blob/main/docs/v3-UPGRADE-GUIDE.md', snippet: 'ESM only' },
            execa: { title: 'Execa 6.0.0', url: 'https://github.com/sindresorhus/execa/releases/tag/v6.0.0', snippet: 'Pure ESM' },
          } as const;
          return {
            ...file,
            diagnosis: {
              ...file.diagnosis,
              grounding: {
                query: 'release', skipped: false,
                citations: dependency && dependency in citations
                  ? [citations[dependency as keyof typeof citations]]
                  : [],
              },
            },
          };
        }
        const file = approved();
        delete file.audit;
        return { ...file, outcome: 'gave-up' };
      }
      withTavily(enabled: boolean): Adapter { return new GroundingSensitiveAdapter(enabled); }
    }
    const report = await runBenchmark(new GroundingSensitiveAdapter(), { only: 'upstream' });
    expect(report.score.ablation).toEqual({ withTavily: { fixed: 4, of: 4 }, without: { fixed: 0, of: 4 } });
  });
});
