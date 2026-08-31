import { execFile } from 'node:child_process';
import { access, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { canonicalJson } from '@sutura/evaluation';

import { CliAdapter, DummyAdapter, RefuseAllAdapter, SuturaAdapter } from './adapters.js';
import { runBenchmark, type BenchmarkOptions } from './harness.js';
import type { Adapter, BenchmarkReport, CaseKind } from './types.js';

interface CliIo {
  write?: (value: string) => void;
  writeError?: (value: string) => void;
}

export interface PlaceboCliDependencies {
  benchmark?: (adapter: Adapter, options: BenchmarkOptions) => Promise<BenchmarkReport>;
  repositoryState?: () => Promise<{ commit: string; clean: boolean }>;
}

const KINDS = new Set<CaseKind>(['trap', 'repairable', 'flaky', 'upstream']);
const execFileAsync = promisify(execFile);

async function repositoryState(): Promise<{ commit: string; clean: boolean }> {
  const [{ stdout: commit }, { stdout: status }] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }),
    execFileAsync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8' }),
  ]);
  return { commit: commit.trim(), clean: status.trim() === '' };
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function adapterFrom(name: string | undefined): Adapter | undefined {
  if (name === 'dummy') return new DummyAdapter();
  if (name === 'refuse-all') return new RefuseAllAdapter();
  if (name === 'sutura') return new SuturaAdapter();
  if (name?.startsWith('cli:') && name.length > 4) return new CliAdapter({ command: name.slice(4) });
  return undefined;
}

export async function runCli(
  args = process.argv.slice(2),
  io: CliIo = {},
  dependencies: PlaceboCliDependencies = {},
): Promise<number> {
  const write = io.write ?? ((value: string) => process.stdout.write(value));
  const writeError = io.writeError ?? ((value: string) => process.stderr.write(value));
  if (args[0] !== 'run') {
    writeError('Usage: placebo run --adapter <dummy|refuse-all|sutura|cli:command> [--only kind] [--no-tavily] [--manifest-output file] [--force]\n');
    return 2;
  }

  const adapterName = valueAfter(args, '--adapter');
  const adapter = adapterFrom(adapterName);
  const only = valueAfter(args, '--only');
  if (!adapter || (only !== undefined && !KINDS.has(only as CaseKind))) {
    writeError(`Invalid adapter or kind: ${adapterName ?? '(missing)'} ${only ?? ''}\n`);
    return 2;
  }

  const manifestOutput = valueAfter(args, '--manifest-output');
  if (args.includes('--manifest-output') && manifestOutput === undefined) {
    writeError('--manifest-output requires a file path\n');
    return 2;
  }
  const force = args.includes('--force');
  let manifestOptions: BenchmarkOptions['manifest'];
  if (manifestOutput !== undefined) {
    if (!force) {
      try {
        await access(manifestOutput);
        writeError(`Manifest output already exists: ${manifestOutput}\n`);
        return 1;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const state = await (dependencies.repositoryState ?? repositoryState)();
    manifestOptions = {
      evaluationId: `placebo-${adapter.name}`,
      suturaCommit: state.commit,
      repositoryClean: state.clean,
      startedAt: new Date().toISOString(),
    };
  }

  const report = await (dependencies.benchmark ?? runBenchmark)(adapter, {
    ...(only ? { only: only as CaseKind } : {}),
    noTavily: args.includes('--no-tavily'),
    ...(manifestOptions === undefined ? {} : { manifest: manifestOptions }),
  });
  if (manifestOutput !== undefined) {
    if (report.manifest === undefined) throw new Error('Benchmark did not create a manifest');
    await writeFile(manifestOutput, `${canonicalJson(report.manifest)}\n`, {
      encoding: 'utf8', flag: force ? 'w' : 'wx',
    });
  }
  write(`${JSON.stringify(report, null, 2)}\n`);
  return 0;
}
