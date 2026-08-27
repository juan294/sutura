import { audit } from './audit/audit.js';
import { runMechanicalChecks } from './audit/mechanical.js';
import { classify, classifyMechanically } from './diagnose/classify.js';
import { ground, type TavilySearch } from './diagnose/tavily.js';
import type {
  Candidate,
  CaseFile,
  CostLedger,
  Diagnosis,
  RaceResult,
} from './domain.js';
import { vetPatch } from './engine/patch-rules.js';
import {
  generateCandidates,
  race,
  selectWinner,
  type RepairLlm,
  type RepairSourceContext,
} from './engine/repair.js';
import { shellQuote } from './engine/shell.js';
import { triage } from './engine/triage.js';
import {
  SNAPSHOT_CWD,
  type Executor,
  type ImageId,
  type RunOptions,
  type RunResult,
} from './executor/types.js';
import type { AuditLlm } from './audit/audit.js';
import type { DiagnosisLlm } from './diagnose/classify.js';
import { boundedTail } from './text/bounded-tail.js';

export const SUTURA_DEFAULT_IMAGE_REF = 'node:22';
const DEFAULT_FAILURE_COMMAND = 'pnpm test';
const DEPENDENCY_INSTALL_COMMAND = /(?:^|(?:&&|;|\|\|)\s*)(?:(?:corepack\s+)?pnpm\s+(?:install|i)\b|npm\s+(?:ci|install|i)\b|(?:corepack\s+)?yarn\s+(?:install\b|--immutable\b))/iu;
const PACKAGE_BINARY_COMMAND = /^(?:ava|eslint|jest|mocha|tap|ts-node|tsc|tsx|vite|vitest)(?=$|[\s;&|])/u;

export const SUTURA_SANDBOX_ENV = Object.freeze({
  CI: 'true',
  NODE_ENV: 'test',
});

export type HealLlm = DiagnosisLlm & RepairLlm & AuditLlm;

export interface RepairFailureContext {
  runId: string;
  repo: string;
  failedLog: string;
  failingImage: ImageId;
  executor: Executor;
  llm: HealLlm;
  cost: CostLedger;
  triageN: number;
  raceK: number;
  tavily?: TavilySearch;
  lockfileDiff?: string;
  candidateDiff?: string;
  readSourceContext(
    log: string,
    diagnosis: Diagnosis,
  ): Promise<RepairSourceContext>;
}

export interface HealCaseContext extends Omit<
  RepairFailureContext,
  'failedLog' | 'failingImage'
> {
  caseDir: string;
  imageRef?: string;
  failureCommand?: string;
}

export class HealCaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HealCaseError';
  }
}

function sandboxOptions(opts?: RunOptions): RunOptions {
  return { ...opts, env: SUTURA_SANDBOX_ENV };
}

export class AllowlistedExecutor implements Executor {
  constructor(private readonly delegate: Executor) {}

  importImage(ref: string): Promise<ImageId> {
    return this.delegate.importImage(ref);
  }

  snapshot(dir: string, base: ImageId): Promise<ImageId> {
    return this.delegate.snapshot(dir, base);
  }

  run(parent: ImageId, cmd: string, opts?: RunOptions): Promise<RunResult> {
    return this.delegate.run(parent, cmd, sandboxOptions(opts));
  }

  runMany(parent: ImageId, cmds: string[], opts?: RunOptions): Promise<RunResult[]> {
    return this.delegate.runMany(parent, cmds, sandboxOptions(opts));
  }
}

function noReproductionDiagnosis(mechanical: Diagnosis): Diagnosis {
  return {
    ...mechanical,
    class: 'infra',
    confidence: 1,
    signals: [...mechanical.signals, 'reproduction:passed'],
    errorExcerpt: 'The failing command passed in a clean sandbox reproduction.',
  };
}

export function noReproductionCaseFile(
  ctx: Pick<HealCaseContext, 'runId' | 'repo' | 'cost'>,
  mechanical: Diagnosis,
): CaseFile {
  return makeCaseFile(
    ctx,
    noReproductionDiagnosis(mechanical),
    { status: 'not-run', reproduced: 0, of: 0 },
    [],
    'infra-stop',
  );
}

export function preparationFailureCaseFile(
  ctx: Pick<HealCaseContext, 'runId' | 'repo' | 'cost'>,
  command: string,
  result: RunResult,
): CaseFile {
  const excerpt = boundedTail(
    [result.stdout, result.stderr].filter(Boolean).join('\n'),
    { maxLines: 20, maxCharacters: 2_000, maxBytes: 2_000 },
  ).trim();
  return makeCaseFile(
    ctx,
    {
      class: 'infra',
      confidence: 1,
      signals: ['sandbox-preparation:failed'],
      failingCmd: command,
      errorExcerpt: excerpt || 'Sandbox dependency preparation failed.',
    },
    { status: 'not-run', reproduced: 0, of: 0 },
    [],
    'infra-stop',
  );
}

export function sandboxPreparationCommand(command: string): string | null {
  if (DEPENDENCY_INSTALL_COMMAND.test(command)) {
    return null;
  }
  const prepare = [
    'if [ ! -d node_modules ]; then',
    '  if [ -f pnpm-lock.yaml ]; then corepack pnpm install --frozen-lockfile;',
    '  elif [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then npm ci;',
    '  elif [ -f yarn.lock ]; then corepack yarn install --immutable;',
    '  else true; fi',
    'fi',
  ].join('\n');
  return `sh -lc ${shellQuote(prepare)}`;
}

export function sandboxTargetCommand(command: string): string {
  return `sh -lc ${shellQuote(sandboxExecutableCommand(command))}`;
}

export function sandboxExecutableCommand(command: string): string {
  const trimmed = command.trim();
  if (!PACKAGE_BINARY_COMMAND.test(trimmed)) return command;
  const nestedCommand = shellQuote(trimmed);

  return [
    `if [ -f pnpm-lock.yaml ]; then corepack pnpm exec sh -c ${nestedCommand};`,
    `elif [ -f yarn.lock ]; then corepack yarn exec sh -c ${nestedCommand};`,
    `else PATH="./node_modules/.bin:$PATH" sh -c ${nestedCommand}; fi`,
  ].join(' ');
}

function withGrounding(
  diagnosis: Diagnosis,
  grounding: Awaited<ReturnType<typeof ground>>,
): Diagnosis {
  return { ...diagnosis, grounding };
}

function vettedRaceResult(candidate: Candidate, violations: readonly string[]): RaceResult {
  return {
    candidate,
    imageId: `not-run:vet-refused:${violations.join(',')}`,
    exitCode: 1,
    held: false,
    note: `Patch vet refused: ${violations.join('; ')}`,
  };
}

function makeCaseFile(
  ctx: Pick<RepairFailureContext, 'runId' | 'repo' | 'cost'>,
  diagnosis: Diagnosis,
  triageVerdict: CaseFile['triage'],
  raceResults: RaceResult[],
  outcome: CaseFile['outcome'],
  auditVerdict?: CaseFile['audit'],
): CaseFile {
  return {
    runId: ctx.runId,
    repo: ctx.repo,
    diagnosis,
    triage: triageVerdict,
    race: raceResults,
    ...(auditVerdict ? { audit: auditVerdict } : {}),
    outcome,
    cost: ctx.cost,
  };
}

export async function repairFailure(ctx: RepairFailureContext): Promise<CaseFile> {
  let diagnosis = await classify(ctx.llm, ctx.failedLog);
  diagnosis = withGrounding(
    diagnosis,
    await ground(
      ctx.tavily ?? { search: async () => [] },
      diagnosis,
      {
        tavilyEnabled: ctx.tavily !== undefined,
        ...(ctx.lockfileDiff === undefined ? {} : { lockfileDiff: ctx.lockfileDiff }),
      },
    ),
  );
  const executableCommand = sandboxExecutableCommand(diagnosis.failingCmd);

  const triageVerdict = await triage(
    ctx.executor,
    ctx.failingImage,
    executableCommand,
    ctx.triageN,
  );
  if (triageVerdict.status !== 'real') {
    return makeCaseFile(ctx, diagnosis, triageVerdict, [], 'flaky-no-patch');
  }

  const suppliedCandidate = ctx.candidateDiff === undefined
    ? undefined
    : {
        id: 'supplied-candidate',
        rationale: 'Candidate supplied by the benchmark adapter contract.',
        diff: ctx.candidateDiff,
      };
  const candidates = suppliedCandidate
    ? [suppliedCandidate]
    : await (async () => {
        const sourceContext = await ctx.readSourceContext(ctx.failedLog, diagnosis);
        return sourceContext.sources.length === 0
          ? []
          : generateCandidates(ctx.llm, diagnosis, ctx.raceK, sourceContext);
      })();

  if (suppliedCandidate) {
    const verdict = vetPatch(suppliedCandidate.diff, diagnosis);
    if (!verdict.ok) {
      const evidence = `Patch vet refused: ${verdict.violations.join('; ')}`;
      return makeCaseFile(
        ctx,
        diagnosis,
        triageVerdict,
        [vettedRaceResult(suppliedCandidate, verdict.violations)],
        'refused',
        {
          approved: false,
          checks: [
            ...runMechanicalChecks(suppliedCandidate.diff),
            { name: 'llm-adjudication', passed: false, evidence: `Not run: ${evidence}` },
          ],
          reasoning: `REFUSED: ${evidence}`,
        },
      );
    }
  }

  const approvedCandidates: Candidate[] = [];
  const refusedCandidates = new Map<string, RaceResult>();
  for (const candidate of candidates) {
    const verdict = vetPatch(candidate.diff, diagnosis);
    if (verdict.ok) {
      approvedCandidates.push(candidate);
    } else {
      refusedCandidates.set(candidate.id, vettedRaceResult(candidate, verdict.violations));
    }
  }

  const raced = await race(
    ctx.executor,
    ctx.failingImage,
    approvedCandidates,
    executableCommand,
  );
  const racedById = new Map(raced.map((result) => [result.candidate.id, result]));
  const raceResults = candidates.map((candidate) => {
    const result = racedById.get(candidate.id) ?? refusedCandidates.get(candidate.id);
    if (!result) throw new HealCaseError(`Missing race result for candidate ${candidate.id}`);
    return result;
  });
  const winner = selectWinner(raceResults);
  if (!winner) {
    return makeCaseFile(ctx, diagnosis, triageVerdict, raceResults, 'gave-up');
  }

  const auditVerdict = await audit(ctx.executor, ctx.llm, winner, {
    diagnosis,
    beforeLog: ctx.failedLog,
    suiteCommand: executableCommand,
  });
  return makeCaseFile(
    ctx,
    diagnosis,
    triageVerdict,
    raceResults,
    auditVerdict.approved ? 'fixed' : 'refused',
    auditVerdict,
  );
}

function failureLog(command: string, result: RunResult): string {
  return boundedTail(
    [`Run ${command}`, result.stdout, result.stderr].filter(Boolean).join('\n'),
    { maxLines: 200, maxCharacters: 20_000, maxBytes: 20_000 },
  );
}

export async function healCase(ctx: HealCaseContext): Promise<CaseFile> {
  if (!ctx.runId.trim() || !ctx.repo.trim() || !ctx.caseDir.trim()) {
    throw new HealCaseError('runId, repo, and caseDir must be non-empty');
  }
  const command = ctx.failureCommand ?? DEFAULT_FAILURE_COMMAND;
  if (!command.trim()) throw new HealCaseError('failureCommand must be non-empty');

  const executor = new AllowlistedExecutor(ctx.executor);
  const baseImage = await executor.importImage(ctx.imageRef ?? SUTURA_DEFAULT_IMAGE_REF);
  const failingImage = await executor.snapshot(ctx.caseDir, baseImage);
  let preparedImage = failingImage;
  const preparationCommand = sandboxPreparationCommand(command);
  if (preparationCommand) {
    const preparation = await executor.run(
      failingImage,
      preparationCommand,
      { cwd: SNAPSHOT_CWD },
    );
    if (preparation.exitCode !== 0) {
      return preparationFailureCaseFile(ctx, command, preparation);
    }
    preparedImage = preparation.imageId;
  }
  const reproduction = await executor.run(
    preparedImage,
    sandboxTargetCommand(command),
    { cwd: SNAPSHOT_CWD },
  );
  const failedLog = failureLog(command, reproduction);
  if (reproduction.exitCode === 0) {
    const mechanical = classifyMechanically(failedLog);
    return noReproductionCaseFile(ctx, mechanical);
  }

  return repairFailure({
    runId: ctx.runId,
    repo: ctx.repo,
    failedLog,
    failingImage: preparedImage,
    executor,
    llm: ctx.llm,
    cost: ctx.cost,
    triageN: ctx.triageN,
    raceK: ctx.raceK,
    readSourceContext: ctx.readSourceContext,
    ...(ctx.tavily ? { tavily: ctx.tavily } : {}),
    ...(ctx.lockfileDiff === undefined ? {} : { lockfileDiff: ctx.lockfileDiff }),
    ...(ctx.candidateDiff === undefined ? {} : { candidateDiff: ctx.candidateDiff }),
  });
}
