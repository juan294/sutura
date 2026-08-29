import { notRunTriageVerdict, type AuditFile, type CaseFile, type CostLedger } from '@sutura/core';

import {
  CliUsageError,
  parseArgs,
  USAGE,
  VERSION,
  type DoctorArguments,
  type AuditArguments,
  type HealArguments,
  type InitArguments,
} from './args.js';
import { doctorSutura, type DoctorResult } from './doctor.js';
import { healFromEnvironment } from './heal.js';
import { auditFromEnvironment } from './heal.js';
import { installSutura, type SetupResult } from './setup.js';
import { runEvaluationCommand } from './eval.js';

export interface CliIo {
  write?: (value: string) => void;
  writeError?: (value: string) => void;
}

export interface CliDependencies {
  heal?: (request: HealArguments) => Promise<CaseFile>;
  init?: (request: InitArguments) => Promise<SetupResult>;
  doctor?: (request: DoctorArguments) => Promise<DoctorResult>;
  audit?: (request: AuditArguments) => Promise<AuditFile>;
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
    triage: notRunTriageVerdict(),
    race: [],
    outcome: 'infra-stop',
    cost: emptyLedger(),
    policy: { baseRef: 'local', baseSha: 'local', policySha: 'unavailable' },
    stages: [{
      stage: 'policy',
      attempt: 1,
      nodeId: 'node-001',
      metrics: {},
      network: 'disabled',
      note: 'CLI stopped before provider execution',
    }],
  };
}

export async function runCli(
  args = process.argv.slice(2),
  io: CliIo = {},
  dependencies: CliDependencies = {},
): Promise<number> {
  const write = io.write ?? ((value: string) => process.stdout.write(value));
  const writeError = io.writeError ?? ((value: string) => process.stderr.write(value));
  let request;
  try {
    request = parseArgs(args);
  } catch (error) {
    const detail = error instanceof CliUsageError ? error.message : 'Invalid arguments';
    writeError(`${detail}\n${USAGE}\n`);
    return 2;
  }

  if (request.command === 'help') {
    write(`${USAGE}\n`);
    return 0;
  }
  if (request.command === 'version') {
    write(`${VERSION}\n`);
    return 0;
  }
  if (request.command === 'init' || request.command === 'doctor') {
    try {
      const result = request.command === 'init'
        ? await (dependencies.init ?? installSutura)(request)
        : await (dependencies.doctor ?? doctorSutura)(request);
      write(`${result.lines.join('\n')}\n`);
      return 'exitCode' in result ? result.exitCode : 0;
    } catch (error) {
      writeError(`${publicError(error)}\n`);
      return 1;
    }
  }
  if (request.command === 'eval-validate' || request.command === 'eval-export') {
    try {
      const lines = await runEvaluationCommand(request);
      write(`${lines.join('\n')}\n`);
      return 0;
    } catch (error) {
      writeError(`${publicError(error)}\n`);
      return 1;
    }
  }
  if (request.command === 'audit') {
    try {
      const auditFile = await (dependencies.audit ?? auditFromEnvironment)(request);
      write(`${JSON.stringify(auditFile)}\n`);
      return 0;
    } catch (error) {
      writeError(`${publicError(error)}\n`);
      return 1;
    }
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
