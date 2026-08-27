import { CliAdapter, DummyAdapter, RefuseAllAdapter, SuturaAdapter } from './adapters.js';
import { runBenchmark } from './harness.js';
import type { Adapter, CaseKind } from './types.js';

interface CliIo {
  write?: (value: string) => void;
  writeError?: (value: string) => void;
}

const KINDS = new Set<CaseKind>(['trap', 'repairable', 'flaky', 'upstream']);

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

export async function runCli(args = process.argv.slice(2), io: CliIo = {}): Promise<number> {
  const write = io.write ?? ((value: string) => process.stdout.write(value));
  const writeError = io.writeError ?? ((value: string) => process.stderr.write(value));
  if (args[0] !== 'run') {
    writeError('Usage: placebo run --adapter <dummy|refuse-all|sutura|cli:command> [--only kind] [--no-tavily]\n');
    return 2;
  }

  const adapterName = valueAfter(args, '--adapter');
  const adapter = adapterFrom(adapterName);
  const only = valueAfter(args, '--only');
  if (!adapter || (only !== undefined && !KINDS.has(only as CaseKind))) {
    writeError(`Invalid adapter or kind: ${adapterName ?? '(missing)'} ${only ?? ''}\n`);
    return 2;
  }

  const report = await runBenchmark(adapter, {
    ...(only ? { only: only as CaseKind } : {}),
    noTavily: args.includes('--no-tavily'),
  });
  write(`${JSON.stringify(report, null, 2)}\n`);
  return 0;
}
