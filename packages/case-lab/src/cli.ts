import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CASE_LAB_CASES, CaseLabRequestError } from './cases.js';
import { canonicalJson } from './canonical.js';
import { deterministicResult, replayCatalog, type ReplayCatalogOptions } from './replay.js';

export const USAGE = [
  'Usage:',
  '  case-lab catalog --out <dir>',
  '  case-lab replay <case-id> [--out <file>]',
].join('\n');

export interface CliIo {
  readonly write: (text: string) => void;
  readonly writeError: (text: string) => void;
}

export interface CliDependencies {
  readonly io?: CliIo;
  readonly catalog?: ReplayCatalogOptions;
}

export class CaseLabCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaseLabCliError';
  }
}

export function valueAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new CaseLabCliError(`${flag} requires a value`);
  return value;
}

function requireValue(args: readonly string[], flag: string): string {
  const value = valueAfter(args, flag);
  if (value === undefined) throw new CaseLabCliError(`${flag} is required`);
  return value;
}

/** Write a public document without ever overwriting an existing file. */
export function writeNew(path: string, content: string): void {
  writeFileSync(path, content, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
}

export async function runCaseLabCli(argv: readonly string[], dependencies: CliDependencies = {}): Promise<number> {
  const io = dependencies.io ?? {
    write: (text) => process.stdout.write(text),
    writeError: (text) => process.stderr.write(text),
  };
  const [command, ...args] = argv;
  try {
    switch (command) {
      case 'catalog': {
        const outDir = resolve(requireValue(args, '--out'));
        mkdirSync(outDir, { recursive: true, mode: 0o755 });
        const results = await replayCatalog(dependencies.catalog);
        for (const result of results) {
          writeNew(resolve(outDir, `${result.caseId}.json`), `${canonicalJson(result)}\n`);
          io.write(`${result.caseId}\t${result.mode}\t${result.outcome}\n`);
        }
        return 0;
      }
      case 'replay': {
        const caseId = args[0];
        if (caseId === undefined || caseId.startsWith('--')) {
          throw new CaseLabCliError(`replay requires a case id: ${CASE_LAB_CASES.map((item) => item.id).join(', ')}`);
        }
        const result = await deterministicResult(caseId, dependencies.catalog);
        const out = valueAfter(args, '--out');
        const text = `${canonicalJson(result)}\n`;
        if (out === undefined) io.write(text);
        else writeNew(resolve(out), text);
        return 0;
      }
      default:
        io.writeError(`${USAGE}\n`);
        return 2;
    }
  } catch (error) {
    if (error instanceof CaseLabCliError || error instanceof CaseLabRequestError) {
      io.writeError(`${error.message}\n`);
      return 2;
    }
    io.writeError(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
