import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { acceptance } from './acceptance.js';
import { CASE_LAB_CASES, CaseLabRequestError } from './cases.js';
import { canonicalJson } from './canonical.js';
import { deterministicResult, loadRelease, replayCatalog, PACKAGE_DIR, type ReplayCatalogOptions } from './replay.js';
import { createStaticServer, listen } from './serve.js';
import { buildSite } from './site.js';

export const USAGE = [
  'Usage:',
  '  case-lab catalog --out <dir>',
  '  case-lab replay <case-id> [--out <file>]',
  '  case-lab build-site [--out <dir>] [--api-base <origin or empty>] [--site-root </>]',
  '  case-lab serve [--dir <dir>] [--port <port>]',
  '  case-lab acceptance --base-url <url> [--check-links] [--live-result <request-id>] [--out <file>]',
].join('\n');

export const DEFAULT_SITE_DIR = resolve(PACKAGE_DIR, 'dist/site');

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
      case 'build-site': {
        const outDir = resolve(valueAfter(args, '--out') ?? DEFAULT_SITE_DIR);
        const apiBase = args.includes('--api-base') ? (valueAfter(args, '--api-base') ?? '') : undefined;
        const catalog = await replayCatalog(dependencies.catalog);
        const written = await buildSite({
          outDir,
          catalog,
          release: dependencies.catalog?.release ?? loadRelease(),
          siteRoot: valueAfter(args, '--site-root') ?? '/',
          ...(apiBase === undefined ? {} : { apiBase }),
        });
        io.write(`${written.length} files written to ${outDir}\n`);
        return 0;
      }
      case 'serve': {
        const dir = resolve(valueAfter(args, '--dir') ?? DEFAULT_SITE_DIR);
        const port = Number(valueAfter(args, '--port') ?? '4177');
        if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new CaseLabCliError('--port must be an integer from 0 to 65535');
        const bound = await listen(createStaticServer(dir), port);
        io.write(`Serving ${dir} at http://127.0.0.1:${bound}/\n`);
        await new Promise(() => undefined);
        return 0;
      }
      case 'acceptance': {
        const baseUrl = requireValue(args, '--base-url');
        const liveResultId = valueAfter(args, '--live-result');
        const record = await acceptance(baseUrl, {
          checkLinks: args.includes('--check-links'),
          ...(liveResultId === undefined ? {} : { liveResultId }),
        });
        const text = `${canonicalJson(record)}\n`;
        const out = valueAfter(args, '--out');
        if (out === undefined) io.write(text);
        else writeNew(resolve(out), text);
        for (const check of record.checks) io.writeError(`${check.passed ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}\n`);
        return record.passed ? 0 : 1;
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
