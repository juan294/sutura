import { Buffer } from 'node:buffer';

import { audit, type AuditLlm } from './audit/audit.js';
import { classify, classifyMechanically, type DiagnosisLlm } from './diagnose/classify.js';
import { ground, type TavilySearch } from './diagnose/tavily.js';
import type {
  Candidate,
  CaseFile,
  CostLedger,
  Diagnosis,
  RaceResult,
  FailureClass,
} from './domain.js';
import { vetPatch } from './engine/patch-rules.js';
import {
  generateCandidates,
  race,
  selectWinner,
  type RepairSourceContext,
  type RepairLlm,
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
import { renderCaseFile } from './report/casefile.js';
import { renderComment } from './report/markdown.js';

const DEFAULT_IMAGE_REF = 'node:22';
const FAILED_STEP_LINES = 200;
const MAX_SOURCE_FILES = 8;
const MAX_SOURCE_LINES = 120;
const MAX_SOURCE_CHARACTERS = 12_000;
const MAX_SOURCE_BYTES = 12_000;
const SOURCE_PATH_PATTERN = /(?:^|[\s("'`])(?<path>(?:\.\/)?(?:[A-Za-z0-9_@.-]+\/)*[A-Za-z0-9_@.-]+\.(?:[cm]?[jt]sx?|json|ya?ml|toml))(?:(?:\(|:)(?<line>\d+))?/g;
const FALLBACK_SOURCE_PATHS: Readonly<Partial<Record<FailureClass, readonly string[]>>> = {
  typecheck: ['tsconfig.json', 'package.json'],
  lint: ['eslint.config.js', 'package.json'],
  build: ['package.json', 'tsconfig.json', 'pnpm-lock.yaml'],
  'dep-upstream-breaking': [
    'package.json',
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock',
  ],
  'env-config': ['package.json', 'tsconfig.json'],
};
const FIX_COMMIT_MESSAGE = [
  'fix: repair CI failure with Sutura',
  '',
  'Co-Authored-By: Sutura <sutura@users.noreply.github.com>',
].join('\n');

export const SUTURA_SANDBOX_ENV = Object.freeze({
  CI: 'true',
  NODE_ENV: 'test',
});

export interface FailedStepLog {
  jobName: string;
  stepName: string;
  log: string;
}

export interface FailingWorkflowRun {
  runId: string;
  repo: string;
  prNumber: number;
  prHeadSha: string;
  prHeadRef: string;
  failedSteps: FailedStepLog[];
}

export interface CreateFixPullRequestInput {
  baseRef: string;
  branch: string;
  body: string;
  headSha: string;
  title: string;
}

export interface GitHubOrchestrationPort {
  getFailingRun(runId: string): Promise<FailingWorkflowRun>;
  /** Atomically persists marker and returns its comment id, or null if claimed. */
  claimAttempt(prNumber: number, marker: string): Promise<string | null>;
  updateAttempt(commentId: string, body: string): Promise<void>;
  createFixPullRequest(
    input: CreateFixPullRequestInput,
  ): Promise<{ number: number; url: string }>;
  uploadCaseFile(name: string, html: string): Promise<{ url: string }>;
}

export interface PublishFixInput {
  branch: string;
  checkoutDir: string;
  diff: string;
  headSha: string;
  message: string;
}

export interface SourceReference {
  path: string;
  line?: number;
}

export interface SourceReadLimits {
  maxFiles: number;
  maxLinesPerFile: number;
  maxCharactersPerFile: number;
  maxBytesPerFile: number;
}

export interface RepositorySourceExcerpt {
  path: string;
  startLine: number;
  content: string;
  truncated: boolean;
}

export const REPAIR_SOURCE_LIMITS: Readonly<SourceReadLimits> = Object.freeze({
  maxFiles: MAX_SOURCE_FILES,
  maxLinesPerFile: MAX_SOURCE_LINES,
  maxCharactersPerFile: MAX_SOURCE_CHARACTERS,
  maxBytesPerFile: MAX_SOURCE_BYTES,
});

export interface RepositoryPort {
  checkoutHead(repo: string, sha: string): Promise<string>;
  /**
   * Reads bounded excerpts without following symlinks. Every path component
   * must resolve inside the real checkoutDir. The implementation must stop
   * reading at limits instead of loading a whole file and truncating later.
   */
  readSourceExcerpts(
    checkoutDir: string,
    references: readonly SourceReference[],
    limits: Readonly<SourceReadLimits>,
  ): Promise<RepositorySourceExcerpt[]>;
  publishFix(input: PublishFixInput): Promise<void>;
}

export type OrchestratorLlm = DiagnosisLlm & RepairLlm & AuditLlm;

export interface OrchestrationContext {
  runId: string;
  github: GitHubOrchestrationPort;
  repository: RepositoryPort;
  executor: Executor;
  llm: OrchestratorLlm;
  cost: CostLedger;
  triageN: number;
  raceK: number;
  tavily?: TavilySearch;
  imageRef?: string;
  lockfileDiff?: string;
}

export class AlreadyAttemptedError extends Error {
  constructor(runId: string) {
    super(`Sutura already attempted workflow run ${runId}`);
    this.name = 'AlreadyAttemptedError';
  }
}

export class OrchestrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrchestrationError';
  }
}

function validateRun(run: FailingWorkflowRun, expectedRunId: string): void {
  if (run.runId !== expectedRunId) {
    throw new OrchestrationError('GitHub returned a different workflow run id');
  }
  if (!/^[1-9]\d*$/.test(run.runId)) {
    throw new OrchestrationError('Workflow run id must be a positive decimal id');
  }
  if (!run.repo.trim() || !Number.isSafeInteger(run.prNumber) || run.prNumber <= 0) {
    throw new OrchestrationError('Failing workflow run has invalid repository metadata');
  }
  if (!/^[0-9a-f]{40}$/i.test(run.prHeadSha)) {
    throw new OrchestrationError('Failing workflow run has an invalid PR head SHA');
  }
  if (!run.prHeadRef.trim()) {
    throw new OrchestrationError('Failing workflow run has an empty PR head ref');
  }
  if (run.failedSteps.length === 0) {
    throw new OrchestrationError('Failing workflow run has no failed-step logs');
  }
}

export function attemptMarker(runId: string): string {
  const encoded = Buffer.from(runId, 'utf8').toString('base64url');
  return `<!-- sutura-run:${encoded} -->`;
}

export function collectFailedLogs(steps: readonly FailedStepLog[]): string {
  return steps
    .map(({ jobName, stepName, log }) => {
      let start = 0;
      let lines = log.endsWith('\n') ? 0 : 1;
      for (let index = log.length - 1; index >= 0; index -= 1) {
        if (log[index] === '\n' && ++lines > FAILED_STEP_LINES) {
          start = index + 1;
          break;
        }
      }
      const tail = log.slice(start);
      return `[${jobName} / ${stepName}]\n${tail}`;
    })
    .join('\n\n');
}

function safeSourcePath(path: string): string | null {
  const normalized = path.replace(/^\.\//, '');
  const segments = normalized.split('/');
  if (
    normalized.length === 0 ||
    normalized.length > 240 ||
    normalized.includes('\\') ||
    normalized.includes('//') ||
    !/^[A-Za-z0-9_@./-]+$/.test(normalized) ||
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        segment === '.git' ||
        segment === 'node_modules',
    )
  ) {
    return null;
  }
  return normalized;
}

export function extractSourceReferences(log: string): SourceReference[] {
  const normalizedLog = log
    .replaceAll('file:///workspace/', '')
    .replaceAll('/workspace/', '');
  const references = new Map<string, SourceReference>();

  for (const match of normalizedLog.matchAll(SOURCE_PATH_PATTERN)) {
    const path = safeSourcePath(match.groups?.path ?? '');
    if (!path) continue;
    const lineValue = Number(match.groups?.line);
    const line = Number.isSafeInteger(lineValue) && lineValue > 0
      ? lineValue
      : undefined;
    const existing = references.get(path);
    if (existing) {
      if (existing.line === undefined && line !== undefined) {
        references.set(path, { path, line });
      }
    } else if (references.size < MAX_SOURCE_FILES) {
      references.set(path, line === undefined ? { path } : { path, line });
    }
  }

  return [...references.values()];
}

export async function readRepairSourceContext(
  repository: RepositoryPort,
  checkoutDir: string,
  log: string,
  diagnosis?: Pick<Diagnosis, 'class'>,
): Promise<RepairSourceContext> {
  const references = extractSourceReferences(log);
  for (const path of diagnosis ? FALLBACK_SOURCE_PATHS[diagnosis.class] ?? [] : []) {
    if (
      references.length < REPAIR_SOURCE_LIMITS.maxFiles &&
      !references.some((reference) => reference.path === path)
    ) {
      references.push({ path });
    }
  }
  if (references.length === 0) return { sources: [] };
  const requested = new Map(references.map((reference) => [reference.path, reference]));
  const sources = await repository.readSourceExcerpts(
    checkoutDir,
    references,
    REPAIR_SOURCE_LIMITS,
  );
  if (sources.length > REPAIR_SOURCE_LIMITS.maxFiles) {
    throw new OrchestrationError('Repository source port exceeded the file limit');
  }
  const accepted = new Set<string>();
  return {
    sources: sources.map((source) => {
      const path = safeSourcePath(source.path);
      const reference = path ? requested.get(path) : undefined;
      const lineCount = source.content === ''
        ? 0
        : source.content.split(/\r?\n/).length;
      if (
        !path ||
        !reference ||
        accepted.has(path) ||
        !Number.isSafeInteger(source.startLine) ||
        source.startLine <= 0 ||
        typeof source.truncated !== 'boolean' ||
        lineCount > REPAIR_SOURCE_LIMITS.maxLinesPerFile ||
        source.content.length > REPAIR_SOURCE_LIMITS.maxCharactersPerFile ||
        Buffer.byteLength(source.content, 'utf8') >
          REPAIR_SOURCE_LIMITS.maxBytesPerFile
      ) {
        throw new OrchestrationError(
          'Repository source port returned an unsafe or unbounded excerpt',
        );
      }
      accepted.add(path);
      return {
        path,
        startLine: source.startLine,
        content: source.content,
        truncated: source.truncated,
      };
    }),
  };
}

function sandboxOptions(opts?: RunOptions): RunOptions {
  return { ...opts, env: SUTURA_SANDBOX_ENV };
}

class AllowlistedExecutor implements Executor {
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

  runMany(
    parent: ImageId,
    cmds: string[],
    opts?: RunOptions,
  ): Promise<RunResult[]> {
    return this.delegate.runMany(parent, cmds, sandboxOptions(opts));
  }
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

async function prepareReport(
  github: GitHubOrchestrationPort,
  run: FailingWorkflowRun,
  caseFile: CaseFile,
  marker: string,
): Promise<{ body: string; artifactUrl: string }> {
  const artifactName = `sutura-case-file-${run.runId}.html`;
  const artifact = await github.uploadCaseFile(
    artifactName,
    renderCaseFile(caseFile),
  );
  const body = `${marker}\n${renderComment(caseFile, artifact.url)}`;
  return { body, artifactUrl: artifact.url };
}

async function publishReport(
  github: GitHubOrchestrationPort,
  run: FailingWorkflowRun,
  caseFile: CaseFile,
  marker: string,
  claimId: string,
): Promise<void> {
  const report = await prepareReport(github, run, caseFile, marker);
  await github.updateAttempt(claimId, report.body);
}

function noReproductionDiagnosis(
  mechanical: Diagnosis,
): Diagnosis {
  return {
    ...mechanical,
    class: 'infra',
    confidence: 1,
    signals: [...mechanical.signals, 'reproduction:passed'],
    errorExcerpt: 'The failing command passed in a clean sandbox reproduction.',
  };
}

function withGrounding(
  diagnosis: Diagnosis,
  grounding: Awaited<ReturnType<typeof ground>>,
): Diagnosis {
  return { ...diagnosis, grounding };
}

export async function orchestrate(ctx: OrchestrationContext): Promise<CaseFile> {
  const run = await ctx.github.getFailingRun(ctx.runId);
  validateRun(run, ctx.runId);
  const marker = attemptMarker(run.runId);
  const failedLog = collectFailedLogs(run.failedSteps);
  const mechanical = classifyMechanically(failedLog);
  if (mechanical.failingCmd === 'unknown') {
    throw new OrchestrationError(
      'Failed-step logs do not contain an observed failing command',
    );
  }
  const claimId = await ctx.github.claimAttempt(run.prNumber, marker);
  if (claimId === null) {
    throw new AlreadyAttemptedError(run.runId);
  }

  const checkoutDir = await ctx.repository.checkoutHead(run.repo, run.prHeadSha);
  const executor = new AllowlistedExecutor(ctx.executor);
  const baseImage = await executor.importImage(ctx.imageRef ?? DEFAULT_IMAGE_REF);
  const failingImage = await executor.snapshot(checkoutDir, baseImage);
  const reproduction = await executor.run(
    failingImage,
    `sh -lc ${shellQuote(mechanical.failingCmd)}`,
    { cwd: SNAPSHOT_CWD },
  );

  if (reproduction.exitCode === 0) {
    const caseFile: CaseFile = {
      runId: run.runId,
      repo: run.repo,
      diagnosis: noReproductionDiagnosis(mechanical),
      triage: { status: 'not-run', reproduced: 0, of: 0 },
      race: [],
      outcome: 'infra-stop',
      cost: ctx.cost,
    };
    await publishReport(ctx.github, run, caseFile, marker, claimId);
    return caseFile;
  }

  let diagnosis = await classify(ctx.llm, failedLog);
  const grounding = await ground(
    ctx.tavily ?? { search: async () => [] },
    diagnosis,
    {
      tavilyEnabled: ctx.tavily !== undefined,
      ...(ctx.lockfileDiff === undefined
        ? {}
        : { lockfileDiff: ctx.lockfileDiff }),
    },
  );
  diagnosis = withGrounding(diagnosis, grounding);

  const triageVerdict = await triage(
    executor,
    failingImage,
    diagnosis.failingCmd,
    ctx.triageN,
  );

  if (triageVerdict.status !== 'real') {
    const caseFile: CaseFile = {
      runId: run.runId,
      repo: run.repo,
      diagnosis,
      triage: triageVerdict,
      race: [],
      outcome: 'flaky-no-patch',
      cost: ctx.cost,
    };
    await publishReport(ctx.github, run, caseFile, marker, claimId);
    return caseFile;
  }

  const sourceContext = await readRepairSourceContext(
    ctx.repository,
    checkoutDir,
    failedLog,
    diagnosis,
  );
  const candidates = sourceContext.sources.length === 0
    ? []
    : await generateCandidates(
        ctx.llm,
        diagnosis,
        ctx.raceK,
        sourceContext,
      );

  const approvedCandidates: Candidate[] = [];
  const refusedCandidates = new Map<string, RaceResult>();
  for (const candidate of candidates) {
    const verdict = vetPatch(candidate.diff, diagnosis);
    if (verdict.ok) {
      approvedCandidates.push(candidate);
    } else {
      refusedCandidates.set(
        candidate.id,
        vettedRaceResult(candidate, verdict.violations),
      );
    }
  }

  const raced = await race(
    executor,
    failingImage,
    approvedCandidates,
    diagnosis.failingCmd,
  );
  const racedById = new Map(raced.map((result) => [result.candidate.id, result]));
  const raceResults = candidates.map((candidate) => {
    const result = racedById.get(candidate.id) ?? refusedCandidates.get(candidate.id);
    if (!result) {
      throw new OrchestrationError(`Missing race result for candidate ${candidate.id}`);
    }
    return result;
  });
  const winner = selectWinner(raceResults);

  if (!winner) {
    const caseFile: CaseFile = {
      runId: run.runId,
      repo: run.repo,
      diagnosis,
      triage: triageVerdict,
      race: raceResults,
      outcome: 'gave-up',
      cost: ctx.cost,
    };
    await publishReport(ctx.github, run, caseFile, marker, claimId);
    return caseFile;
  }

  const auditVerdict = await audit(executor, ctx.llm, winner, {
    diagnosis,
    beforeLog: failedLog,
    suiteCommand: diagnosis.failingCmd,
  });
  if (!auditVerdict.approved) {
    const caseFile: CaseFile = {
      runId: run.runId,
      repo: run.repo,
      diagnosis,
      triage: triageVerdict,
      race: raceResults,
      audit: auditVerdict,
      outcome: 'refused',
      cost: ctx.cost,
    };
    await publishReport(ctx.github, run, caseFile, marker, claimId);
    return caseFile;
  }

  const caseFile: CaseFile = {
    runId: run.runId,
    repo: run.repo,
    diagnosis,
    triage: triageVerdict,
    race: raceResults,
    audit: auditVerdict,
    outcome: 'fixed',
    cost: ctx.cost,
  };
  const branch = `sutura/fix-${run.runId}`;
  const report = await prepareReport(ctx.github, run, caseFile, marker);
  await ctx.repository.publishFix({
    branch,
    checkoutDir,
    diff: winner.candidate.diff,
    headSha: run.prHeadSha,
    message: FIX_COMMIT_MESSAGE,
  });
  await ctx.github.createFixPullRequest({
    baseRef: run.prHeadRef,
    branch,
    body: report.body,
    headSha: run.prHeadSha,
    title: 'fix: repair CI failure with Sutura',
  });
  await ctx.github.updateAttempt(claimId, report.body);
  return caseFile;
}
