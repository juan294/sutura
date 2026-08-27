import type { CaseFile, CostLedger } from '@sutura/core';

import { CliUsageError, parseArgs, USAGE, type HealArguments } from './args.js';
import { healFromEnvironment } from './heal.js';

export interface CliIo {
  write?: (value: string) => void;
  writeError?: (value: string) => void;
}

export interface CliDependencies {
  heal?: (request: HealArguments) => Promise<CaseFile>;
}

function emptyLedger(): CostLedger {
  return { entries: [], totalUsd: () => 0 };
}

function publicError(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return reason
    .replace(/\bBearer\s+\S+/giu, 'Bearer [redacted]')
    .replace(
      /\b(?:[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)|api[_-]?key|token|secret|password)\s*[=:]\s*[^\s,;]+/giu,
      '[redacted credential]',
    );
}

function infraStop(caseDir: string, error: unknown): CaseFile {
  const reason = publicError(error);
  const caseName = caseDir.split(/[\\/]/u).filter(Boolean).at(-1) ?? 'case';
  return {
    runId: `local-${caseName}`,
    repo: `local/${caseName}`,
    diagnosis: {
      class: 'infra',
      confidence: 1,
      signals: ['cli-runtime-failure'],
      failingCmd: 'pnpm test',
      errorExcerpt: reason.slice(0, 2_000),
    },
    triage: { status: 'not-run', reproduced: 0, of: 0 },
    race: [],
    outcome: 'infra-stop',
    cost: emptyLedger(),
  };
}

export async function runCli(
  args = process.argv.slice(2),
  io: CliIo = {},
  dependencies: CliDependencies = {},
): Promise<number> {
  const write = io.write ?? ((value: string) => process.stdout.write(value));
  const writeError = io.writeError ?? ((value: string) => process.stderr.write(value));
  let request: HealArguments;
  try {
    request = parseArgs(args);
  } catch (error) {
    const detail = error instanceof CliUsageError ? error.message : 'Invalid arguments';
    writeError(`${detail}\n${USAGE}\n`);
    return 2;
  }

  let caseFile: CaseFile;
  try {
    caseFile = await (dependencies.heal ?? healFromEnvironment)(request);
  } catch (error) {
    caseFile = infraStop(request.caseDir, error);
  }
  write(`${JSON.stringify(caseFile)}\n`);
  return 0;
}
