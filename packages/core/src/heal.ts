import { audit } from './audit/audit.js';
import { runMechanicalChecks } from './audit/mechanical.js';
import { classify, classifyMechanically } from './diagnose/classify.js';
import {
  ground,
  promoteUpstreamDependencyDiagnosis,
  type TavilySearch,
} from './diagnose/tavily.js';
import type {
  Candidate,
  CaseFile,
  CostLedger,
  Diagnosis,
  PolicyEvidence,
  RaceResult,
  SearchEvidence,
  StageEvidence,
  StageName,
} from './domain.js';
import { MAX_STAGE_EVIDENCE_ENTRIES } from './config.js';
import { vetPatch } from './engine/patch-rules.js';
import {
  race,
  selectWinner,
  type RepairLlm,
  type RepairSourceContext,
} from './engine/repair.js';
import { runRepairAgent } from './engine/repair-agent.js';
import { validateCandidateDiff } from './engine/candidate-validation.js';
import {
  RepairBudget,
  repairBudgetLimits,
  type RepairBudgetOverrides,
} from './engine/repair-budget.js';
import { adaptiveSearch, DEFAULT_SEARCH_LIMITS, type SearchNode } from './engine/search.js';
import type { SearchLimits } from './config.js';
import { shellQuote } from './engine/shell.js';
import { triage } from './engine/triage.js';
import { notRunTriageVerdict } from './engine/triage.js';
import {
  SNAPSHOT_CWD,
  type Executor,
  type CancellationResult,
  type ImageId,
  type OperationCapacity,
  type OperationTerminal,
  type RunOptions,
  type RunResult,
  type SnapshotOptions,
} from './executor/types.js';
import type { AuditLlm } from './audit/audit.js';
import type { DiagnosisLlm } from './diagnose/classify.js';
import type { CapacitySnapshot } from './llm/types.js';
import type { ChatMessage, ChatOptions, TierLlm } from './llm/types.js';
import type { ModelTier } from './llm/cost.js';
import { createHash } from 'node:crypto';
import {
  evaluatePatchPolicy,
  evaluateResourceThresholds,
  filterPolicyDeniedText,
} from './policy/evaluate.js';
import { createDefaultRepositoryPolicy } from './policy/load.js';
import type { RepositoryPolicy } from './policy/schema.js';
import { boundedTail } from './text/bounded-tail.js';
import { TraceRecorder } from './trace/recorder.js';
import { detectRuntimeAtPath } from './runtime/detect.js';
import { NODE_IMAGE_REF, NODE_RUNTIME, nodePreparationCommand } from './runtime/node.js';
import type { RuntimeAdapter, RuntimeId } from './runtime/types.js';

export const SUTURA_DEFAULT_IMAGE_REF = NODE_IMAGE_REF;
const DEFAULT_FAILURE_COMMAND = 'pnpm test';
const DEPENDENCY_INSTALL_COMMAND = /(?:^|(?:&&|;|\|\|)\s*)(?:(?:corepack\s+)?pnpm\s+(?:install|i)\b|npm\s+(?:ci|install|i)\b|(?:corepack\s+)?yarn\s+(?:install\b|--immutable\b))/iu;

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
  repairBudgets?: RepairBudgetOverrides;
  search?: SearchLimits;
  tavily?: TavilySearch;
  lockfileDiff?: string;
  dependencyHints?: readonly string[];
  candidateDiff?: string;
  policy?: RepositoryPolicy;
  policyEvidence?: PolicyEvidence;
  stageLedger?: StageLedger;
  traceRecorder?: TraceRecorder;
  runtime?: RuntimeAdapter;
  readSourceContext(
    log: string,
    diagnosis: Diagnosis,
    runtime?: RuntimeAdapter,
  ): Promise<RepairSourceContext>;
}

export interface HealCaseContext extends Omit<
  RepairFailureContext,
  'failedLog' | 'failingImage'
> {
  caseDir: string;
  imageRef?: string;
  failureCommand?: string;
  runtimeId?: RuntimeId;
}

export class HealCaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HealCaseError';
  }
}

interface StageRecord {
  stage: StageName;
  attempt: number;
  network: StageEvidence['network'];
  result?: RunResult;
  imageId?: ImageId;
  parentImageId?: ImageId;
  note?: string;
  operation?: {
    operationId: string;
    terminal?: OperationTerminal;
    cancellationRequested: boolean;
  };
}

function publicMetrics(metrics: RunResult['metrics'] | undefined): RunResult['metrics'] {
  if (!metrics) return {};
  return Object.fromEntries(
    Object.entries(metrics).filter(([, value]) =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0,
    ),
  );
}

export class StageLedger {
  private readonly evidence: StageEvidence[] = [];
  private readonly imageNodes = new Map<ImageId, string>();

  constructor(private readonly trace?: TraceRecorder) {}

  record(input: StageRecord): string {
    if (this.evidence.length >= MAX_STAGE_EVIDENCE_ENTRIES) {
      throw new HealCaseError('Stage evidence exceeds the bounded entry count');
    }
    const nodeId = `node-${String(this.evidence.length + 1).padStart(3, '0')}`;
    const imageId = input.result?.imageId ?? input.imageId;
    const parentNodeId = input.parentImageId === undefined
      ? undefined
      : this.imageNodes.get(input.parentImageId);
    if (imageId !== undefined) this.imageNodes.set(imageId, nodeId);
    const note = input.note
      ?.replace(/[\u0000-\u001f\u007f]/gu, ' ')
      .slice(0, 240);
    const operation = input.result?.operation ?? input.operation;
    this.evidence.push({
      stage: input.stage,
      attempt: input.attempt,
      nodeId,
      ...(parentNodeId === undefined ? {} : { parentNodeId }),
      ...(input.result === undefined ? {} : { exitCode: input.result.exitCode }),
      ...(operation === undefined ? {} : {
        operationId: operation.operationId,
        ...(operation.terminal === undefined ? {} : { operationTerminal: operation.terminal }),
        cancellationRequested: operation.cancellationRequested,
      }),
      metrics: publicMetrics(input.result?.metrics),
      network: input.network,
      ...(note === undefined || note === '' ? {} : { note }),
    });
    if (imageId !== undefined || input.result !== undefined || operation !== undefined) {
      this.trace?.record({
        type: 'sandbox-operation',
        stage: input.stage,
        operation: operation?.operationId ?? input.stage,
        resultSummary: note ?? `Sandbox ${input.stage} operation`,
        childNodeId: nodeId,
      });
    }
    return nodeId;
  }

  entries(): StageEvidence[] {
    return this.evidence.map((entry) => ({
      ...entry,
      metrics: { ...entry.metrics },
    }));
  }
}

function ensureTraceStarted(trace: TraceRecorder): void {
  if (trace.events().length === 0) {
    trace.record({ type: 'run-start', stage: 'run', summary: 'Sutura repair run started' });
  }
}

function tracedLlm(llm: HealLlm, trace: TraceRecorder): HealLlm {
  const delegate = llm as TierLlm<ModelTier>;
  return {
    capacitySnapshot: () => delegate.capacitySnapshot?.(),
    modelId: (tier: ModelTier) => delegate.modelId?.(tier) ?? tier,
    modelQuote: (tier: ModelTier, messages: readonly ChatMessage[], options?: ChatOptions) => {
      const quote = delegate.modelQuote?.(tier, messages, options);
      if (quote === undefined) throw new Error('Model routing quote is unavailable');
      return quote;
    },
    async chat(tier: ModelTier, messages: readonly ChatMessage[], options?: ChatOptions) {
      const model = delegate.modelQuote?.(tier, messages, options)?.modelId ??
        delegate.modelId?.(tier) ?? tier;
      const serializedPrompt = JSON.stringify(messages);
      const systemPrompt = messages.find(({ role }) => role === 'system');
      const promptExcerpt = typeof systemPrompt?.content === 'string'
        ? systemPrompt.content.slice(0, 160)
        : '[no public system prompt]';
      trace.record({
        type: 'model-request',
        stage: tier === 'nano' ? 'triage' : tier === 'ultra' ? 'audit' : 'candidate',
        role: 'user',
        model,
        summary: `Model request with ${messages.length} messages and ${Buffer.byteLength(serializedPrompt, 'utf8')} bytes`,
        promptHash: createHash('sha256').update(serializedPrompt).digest('hex'),
        promptExcerpt,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        latencyMs: 0,
        costUsd: 0,
        requestId: null,
      });
      const reply = await delegate.chat(tier, messages, options);
      const usage = reply.usage ?? { inTok: 0, outTok: 0, reasoningTok: 0 };
      trace.record({
        type: 'model-response',
        stage: tier === 'nano' ? 'triage' : tier === 'ultra' ? 'audit' : 'candidate',
        role: 'assistant',
        model: reply.model ?? model,
        summary: reply.text,
        inputTokens: usage.inTok,
        outputTokens: usage.outTok,
        reasoningTokens: usage.reasoningTok,
        latencyMs: reply.latencyMs ?? 0,
        costUsd: reply.usd ?? 0,
        requestId: reply.requestId ?? reply.capacity?.requestId ?? null,
      });
      return reply;
    },
  } as HealLlm;
}

function publicSearchEvidence(nodes: readonly SearchNode[]): SearchEvidence[] {
  return nodes.map((node) => ({
    nodeId: node.id,
    ...(node.parentId === undefined ? {} : { parentNodeId: node.parentId }),
    depth: node.depth,
    errorFingerprint: node.errorFingerprint,
    transcriptReference: node.transcriptReference,
    ...(node.terminalReason === undefined ? {} : { terminalReason: node.terminalReason }),
    testExitCode: node.testEvidence.exitCode,
    policyValid: node.policyEvidence.valid,
    changedFiles: node.policyEvidence.changedFiles.length,
    diffBytes: node.policyEvidence.diffBytes,
  }));
}

function providerCapacityAvailable(capacity: CapacitySnapshot | undefined): number {
  if (!capacity) return Number.MAX_SAFE_INTEGER;
  if (capacity.retryAfterSec !== null && capacity.retryAfterSec > 0) return 0;
  if (capacity.remainingRequests === 0 || capacity.remainingTokens === 0) return 0;
  return capacity.remainingRequests ?? Number.MAX_SAFE_INTEGER;
}

function policyFor(ctx: Pick<RepairFailureContext, 'policy'>): RepositoryPolicy {
  return ctx.policy ?? createDefaultRepositoryPolicy();
}

function policyEvidenceFor(
  ctx: Pick<RepairFailureContext, 'policyEvidence'>,
): PolicyEvidence {
  return ctx.policyEvidence ?? {
    baseRef: 'local',
    baseSha: 'local',
    policySha: 'default',
  };
}

function sandboxOptions(opts?: RunOptions): RunOptions {
  return {
    ...opts,
    env: SUTURA_SANDBOX_ENV,
    network: 'disabled',
  };
}

export class AllowlistedExecutor implements Executor {
  constructor(private readonly delegate: Executor) {}

  importImage(ref: string): Promise<ImageId> {
    return this.delegate.importImage(ref);
  }

  snapshot(
    dir: string,
    base: ImageId,
    options: SnapshotOptions,
  ): Promise<ImageId> {
    return this.delegate.snapshot(dir, base, options);
  }

  run(parent: ImageId, cmd: string, opts?: RunOptions): Promise<RunResult> {
    return this.delegate.run(parent, cmd, sandboxOptions(opts));
  }

  runMany(parent: ImageId, cmds: string[], opts?: RunOptions): Promise<RunResult[]> {
    return this.delegate.runMany(parent, cmds, sandboxOptions(opts));
  }

  operationCapacity(): OperationCapacity {
    return this.delegate.operationCapacity();
  }

  cancel(operationId: string): Promise<CancellationResult> {
    return this.delegate.cancel(operationId);
  }

  prepareDependencies(parent: ImageId, command = sandboxPreparationCommand()): Promise<RunResult> {
    return this.delegate.run(parent, command, {
      ...sandboxOptions({ cwd: SNAPSHOT_CWD }),
      network: 'enabled',
    });
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
  ctx: Pick<
    HealCaseContext,
    'runId' | 'repo' | 'cost' | 'policyEvidence' | 'stageLedger' | 'traceRecorder' | 'runtime'
  >,
  mechanical: Diagnosis,
): CaseFile {
  return makeCaseFile(
    ctx,
    noReproductionDiagnosis(mechanical),
    notRunTriageVerdict(),
    [],
    'infra-stop',
  );
}

export function preparationFailureCaseFile(
  ctx: Pick<
    HealCaseContext,
    'runId' | 'repo' | 'cost' | 'policyEvidence' | 'stageLedger' | 'traceRecorder' | 'runtime'
  >,
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
    notRunTriageVerdict(),
    [],
    'infra-stop',
  );
}

export function sandboxPreparationCommand(): string {
  return nodePreparationCommand();
}

const DEPENDENCY_SNAPSHOT = Object.freeze({
  profile: 'dependency-inputs' as const,
  mode: 'replace' as const,
});
const REPOSITORY_SNAPSHOT = Object.freeze({
  profile: 'repository' as const,
  mode: 'overlay' as const,
});

interface SandboxRepositoryInitializationPaths {
  manifestPath: string;
  templatePath: string;
}

const DEFAULT_REPOSITORY_INITIALIZATION_PATHS = {
  manifestPath: '/tmp/sutura-repository-overlay.manifest',
  templatePath: '/tmp/sutura-empty-git-template',
} satisfies SandboxRepositoryInitializationPaths;

function sandboxRepositoryInitializationCommand(
  paths: SandboxRepositoryInitializationPaths = DEFAULT_REPOSITORY_INITIALIZATION_PATHS,
  runtime: RuntimeAdapter = NODE_RUNTIME,
): string {
  const commands = [
    `mkdir -p ${shellQuote(paths.templatePath)}`,
    `git init --quiet --template=${shellQuote(paths.templatePath)}`,
    'git config core.hooksPath /dev/null',
    'git config user.email sutura@users.noreply.github.com',
    'git config user.name Sutura',
    `git --literal-pathspecs add --pathspec-from-file=${shellQuote(paths.manifestPath)} --pathspec-file-nul`,
    'git -c core.hooksPath=/dev/null commit --quiet --no-verify -m "chore: initialize Sutura sandbox baseline"',
    ...(runtime.id === 'node' ? ['if [ -f pnpm-lock.yaml ]; then corepack pnpm rebuild; elif [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then npm rebuild; elif [ -f yarn.lock ]; then sutura_yarn_version="$(corepack yarn --version)"; case "$sutura_yarn_version" in 0.*|1.*) npm rebuild ;; 2.*|3.*|4.*) corepack yarn rebuild ;; *) echo "unsupported Yarn version: $sutura_yarn_version" >&2; exit 69 ;; esac; else true; fi'] : []),
  ];
  return `sh -lc ${shellQuote(commands.join(' && '))}`;
}

const INITIALIZE_REPOSITORY_COMMAND = sandboxRepositoryInitializationCommand();

export function buildSandboxRepositoryInitializationCommandForTest(
  paths: SandboxRepositoryInitializationPaths,
): string {
  return sandboxRepositoryInitializationCommand(paths);
}

export type SandboxSetupResult =
  | { ok: true; imageId: ImageId }
  | { ok: false; command: string; result: RunResult };

export async function prepareSandbox(
  executor: AllowlistedExecutor,
  dir: string,
  baseImage: ImageId,
  observedCommand: string,
  stages?: StageLedger,
  runtime: RuntimeAdapter = NODE_RUNTIME,
): Promise<SandboxSetupResult> {
  let dependencyPreparation;
  try {
    dependencyPreparation = await runtime.dependencyInputs(dir);
  } catch (error) {
    return {
      ok: false,
      command: runtime.preparationCommand,
      result: {
        imageId: baseImage,
        exitCode: 69,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        truncated: false,
        metrics: {},
      },
    };
  }
  const dependencyImage = await executor.snapshot(
    dir,
    baseImage,
    runtime.id === 'node'
      ? DEPENDENCY_SNAPSHOT
      : { ...DEPENDENCY_SNAPSHOT, includePaths: dependencyPreparation.paths },
  );
  stages?.record({
    stage: 'preparation',
    attempt: 1,
    network: 'disabled',
    imageId: dependencyImage,
    parentImageId: baseImage,
    note: 'Dependency inputs snapshot created',
  });
  const preparationCommand = runtime.id === 'node'
    ? dependencyPreparation.command
    : `sh -lc ${shellQuote(dependencyPreparation.command)}`;
  const preparation = await executor.prepareDependencies(dependencyImage, preparationCommand);
  stages?.record({
    stage: 'preparation',
    attempt: 2,
    network: 'enabled',
    result: preparation,
    parentImageId: dependencyImage,
    note: `${runtime.id} dependencies prepared without repository hooks`,
  });
  if (preparation.exitCode !== 0) {
    return {
      ok: false,
      command: DEPENDENCY_INSTALL_COMMAND.test(observedCommand)
        ? observedCommand
        : preparationCommand,
      result: preparation,
    };
  }
  const sourceImage = await executor.snapshot(
    dir,
    preparation.imageId,
    REPOSITORY_SNAPSHOT,
  );
  stages?.record({
    stage: 'preparation',
    attempt: 3,
    network: 'disabled',
    imageId: sourceImage,
    parentImageId: preparation.imageId,
    note: 'Repository source overlay created',
  });
  const initialized = await executor.run(
    sourceImage,
    runtime.id === 'node'
      ? INITIALIZE_REPOSITORY_COMMAND
      : sandboxRepositoryInitializationCommand(DEFAULT_REPOSITORY_INITIALIZATION_PATHS, runtime),
    { cwd: SNAPSHOT_CWD },
  );
  stages?.record({
    stage: 'preparation',
    attempt: 4,
    network: 'disabled',
    result: initialized,
    parentImageId: sourceImage,
    note: 'Hook-disabled Git baseline initialized',
  });
  if (initialized.exitCode !== 0) {
    return { ok: false, command: INITIALIZE_REPOSITORY_COMMAND, result: initialized };
  }
  return { ok: true, imageId: initialized.imageId };
}

export function sandboxTargetCommand(command: string, runtime: RuntimeAdapter = NODE_RUNTIME): string {
  return `sh -lc ${shellQuote(sandboxExecutableCommand(command, runtime))}`;
}

export function sandboxExecutableCommand(command: string, runtime: RuntimeAdapter = NODE_RUNTIME): string {
  return runtime.normalizeCommand(command);
}

function withGrounding(
  diagnosis: Diagnosis,
  grounding: Awaited<ReturnType<typeof ground>>,
): Diagnosis {
  return { ...diagnosis, grounding };
}

function vettedRaceResult(
  candidate: Candidate,
  violations: readonly string[],
  nodeId: string,
): RaceResult {
  return {
    candidate,
    imageId: nodeId,
    nodeId,
    exitCode: 1,
    held: false,
    note: `Patch vet refused: ${violations.join('; ')}`,
  };
}

function makeCaseFile(
  ctx: Pick<
    RepairFailureContext,
    | 'runId'
    | 'repo'
    | 'cost'
    | 'policyEvidence'
    | 'stageLedger'
    | 'traceRecorder'
    | 'runtime'
  >,
  diagnosis: Diagnosis,
  triageVerdict: CaseFile['triage'],
  raceResults: RaceResult[],
  outcome: CaseFile['outcome'],
  auditVerdict?: CaseFile['audit'],
  search?: SearchEvidence[],
): CaseFile {
  const trace = ctx.traceRecorder;
  if (auditVerdict !== undefined) {
    trace?.record({
      type: 'audit-result',
      stage: 'audit',
      approved: auditVerdict.approved,
      summary: auditVerdict.reasoning,
      ...(raceResults[0]?.nodeId === undefined ? {} : { childNodeId: raceResults[0].nodeId }),
    });
  }
  if (trace !== undefined && trace.events().at(-1)?.type !== 'run-finish') {
    trace.record({ type: 'run-finish', stage: 'run', outcome });
  }
  return {
    runId: ctx.runId,
    repo: ctx.repo,
    runtime: (ctx.runtime ?? NODE_RUNTIME).id,
    diagnosis,
    triage: triageVerdict,
    race: raceResults.map((result) => ({
      ...result,
      imageId: result.nodeId,
    })),
    ...(auditVerdict ? { audit: auditVerdict } : {}),
    outcome,
    cost: ctx.cost,
    policy: policyEvidenceFor(ctx),
    stages: ctx.stageLedger?.entries() ?? [],
    ...(search === undefined ? {} : { search }),
    ...(trace === undefined ? {} : { trace: trace.events() }),
  };
}

function policyVerdict(
  candidate: Candidate,
  diagnosis: Diagnosis,
  policy: RepositoryPolicy,
): ReturnType<typeof vetPatch> {
  const builtIn = vetPatch(candidate.diff, diagnosis);
  return builtIn.ok ? evaluatePatchPolicy(candidate.diff, policy) : builtIn;
}

async function enforceWinnerPolicy(
  ctx: RepairFailureContext,
  winner: RaceResult,
  ledger: StageLedger,
  auditVerdict: NonNullable<CaseFile['audit']>,
): Promise<NonNullable<CaseFile['audit']>> {
  if (!auditVerdict.approved) return auditVerdict;
  const policy = policyFor(ctx);
  const checks = [...auditVerdict.checks];
  const commandFailures: string[] = [];
  const resourceFailures: string[] = [];
  for (const [index, command] of policy.requiredCommands.entries()) {
    const executable = sandboxTargetCommand(command, ctx.runtime ?? NODE_RUNTIME);
    const baseline = await ctx.executor.run(ctx.failingImage, executable, {
      cwd: SNAPSHOT_CWD,
    });
    ledger.record({
      stage: 'audit',
      attempt: index * 2 + 2,
      network: 'disabled',
      result: baseline,
      parentImageId: ctx.failingImage,
      note: `Required command ${index + 1} baseline`,
    });
    const candidate = await ctx.executor.run(winner.imageId, executable, {
      cwd: SNAPSHOT_CWD,
    });
    ledger.record({
      stage: 'audit',
      attempt: index * 2 + 3,
      network: 'disabled',
      result: candidate,
      parentImageId: winner.imageId,
      note: `Required command ${index + 1} candidate`,
    });
    if (candidate.exitCode !== 0) {
      commandFailures.push(`required command ${index + 1} exited ${candidate.exitCode}`);
    }
    resourceFailures.push(...evaluateResourceThresholds(
      `required command ${index + 1}`,
      baseline.metrics,
      candidate.metrics,
      policy.resourceLimits,
    ));
  }
  checks.push({
    name: 'policy-required-command',
    passed: commandFailures.length === 0,
    evidence: commandFailures.length === 0
      ? `Passed ${policy.requiredCommands.length} repository policy commands`
      : commandFailures.join('; '),
  });
  if (Object.keys(policy.resourceLimits).length > 0) {
    checks.push({
      name: 'policy-resource-limit',
      passed: resourceFailures.length === 0,
      evidence: resourceFailures.length === 0
        ? 'Paired resource thresholds passed'
        : resourceFailures.join('; '),
    });
  }
  const violations = [...commandFailures, ...resourceFailures];
  return violations.length === 0
    ? { ...auditVerdict, checks }
    : {
        approved: false,
        checks,
        reasoning: `REFUSED: repository policy failed (${violations.join('; ')})`,
      };
}

export async function repairFailure(ctx: RepairFailureContext): Promise<CaseFile> {
  const policy = policyFor(ctx);
  const trace = ctx.traceRecorder ?? new TraceRecorder(ctx.runId);
  ensureTraceStarted(trace);
  const ledger = ctx.stageLedger ?? new StageLedger(trace);
  const fullContext: RepairFailureContext = {
    ...ctx,
    policy,
    llm: tracedLlm(ctx.llm, trace),
    stageLedger: ledger,
    traceRecorder: trace,
  };
  const providerLog = filterPolicyDeniedText(ctx.failedLog, policy);
  let diagnosis = await classify(fullContext.llm, providerLog);
  diagnosis = promoteUpstreamDependencyDiagnosis(diagnosis, ctx.dependencyHints);
  diagnosis = withGrounding(
    diagnosis,
    await ground(
      ctx.tavily ?? { search: async () => [] },
      diagnosis,
      {
        tavilyEnabled: ctx.tavily !== undefined,
        ...(ctx.lockfileDiff === undefined ? {} : { lockfileDiff: ctx.lockfileDiff }),
        ...(ctx.dependencyHints === undefined
          ? {}
          : { dependencyHints: ctx.dependencyHints }),
      },
    ),
  );
  ledger.record({
    stage: 'search',
    attempt: 1,
    network: 'disabled',
    note: diagnosis.grounding?.skipped === false
      ? `Grounding returned ${diagnosis.grounding.citations.length} citations`
      : 'Grounding skipped',
  });
  const runtime = ctx.runtime ?? NODE_RUNTIME;
  const executableCommand = sandboxExecutableCommand(diagnosis.failingCmd, runtime);

  const triageVerdict = await triage(
    ctx.executor,
    ctx.failingImage,
    executableCommand,
    ctx.triageN,
    (result, attempt) => ledger.record({
      stage: 'triage',
      attempt,
      network: 'disabled',
      result,
      parentImageId: ctx.failingImage,
      note: 'Reproduction probe',
    }),
  );
  if (triageVerdict.status !== 'real') {
    return makeCaseFile(fullContext, diagnosis, triageVerdict, [], 'flaky-no-patch');
  }
  if (
    diagnosis.class === 'dep-upstream-breaking' &&
    (diagnosis.grounding?.skipped !== false || diagnosis.grounding.citations.length === 0)
  ) {
    return makeCaseFile(fullContext, diagnosis, triageVerdict, [], 'gave-up');
  }

  const suppliedCandidate = ctx.candidateDiff === undefined
    ? undefined
    : {
        id: 'supplied-candidate',
        rationale: 'Candidate supplied by the benchmark adapter contract.',
        diff: ctx.candidateDiff,
      };
  if (!suppliedCandidate) {
    const sourceContext = await ctx.readSourceContext(ctx.failedLog, diagnosis, runtime);
    const configuredBudgets = repairBudgetLimits(ctx.repairBudgets);
    const budget = new RepairBudget({
      ...configuredBudgets,
      diffBytes: Math.min(configuredBudgets.diffBytes, policy.maxDiffBytes),
    });
    let candidateAttempt = 0;
    const trustedCommands = Object.fromEntries([
      ['diagnosed', executableCommand],
      ...policy.requiredCommands.map((command, index) => [
        `policy-${index + 1}`,
        sandboxExecutableCommand(command, runtime),
      ]),
    ]);
    const searchLimits = ctx.search ?? {
      ...DEFAULT_SEARCH_LIMITS,
      initialBranches: Math.min(ctx.raceK, DEFAULT_SEARCH_LIMITS.initialBranches),
    };
    let providerCapacity: CapacitySnapshot | undefined = fullContext.llm.capacitySnapshot?.();
    const activeOperations = new Map<string, string>();
    const lastOperations = new Map<string, string>();
    const result = await adaptiveSearch({
      baselineImageId: ctx.failingImage,
      initialBranches: Math.min(searchLimits.initialBranches, budget.limits.branches),
      beamWidth: searchLimits.beamWidth,
      maximumDepth: searchLimits.maximumDepth,
      maximumTotalBranches: Math.min(searchLimits.maximumTotalBranches, budget.limits.branches),
      availableBranches: () => {
        const snapshot = budget.snapshot();
        return Math.min(
          budget.limits.branches - snapshot.branches,
          budget.limits.sandboxOperations - snapshot.sandboxOperations,
          Math.floor((budget.limits.modelTurns - snapshot.modelTurns) / 3),
          Math.floor((budget.limits.toolCalls - snapshot.toolCalls) / 3),
          providerCapacityAvailable(providerCapacity),
        );
      },
      concurrencyCapacity: () => ctx.search === undefined
        ? 1
        : Math.max(1, ctx.executor.operationCapacity().available),
      cancel: async (nodeId) => {
        const activeOperation = activeOperations.get(nodeId);
        if (!activeOperation) {
          ledger.record({
            stage: 'search', attempt: ++candidateAttempt, network: 'disabled',
            note: `Cancellation requested for ${nodeId} before a sandbox operation started`,
          });
          return;
        }
        const cancellation = await ctx.executor.cancel(activeOperation);
        ledger.record({
          stage: 'search', attempt: ++candidateAttempt, network: 'disabled',
          operation: {
            operationId: activeOperation,
            ...(cancellation.terminal === undefined ? {} : { terminal: cancellation.terminal }),
            cancellationRequested: cancellation.requested,
          },
          note: `Cancellation ${cancellation.requested ? 'requested' : 'observed'} for ${nodeId}`,
        });
      },
      onDecision: ({ summary, nodeId, parentNodeId }) => trace.record({
        type: 'search-decision',
        stage: 'search',
        summary,
        ...(nodeId === undefined ? {} : { childNodeId: nodeId }),
        ...(parentNodeId === undefined ? {} : { parentNodeId }),
      }),
      expand: async ({ parent, parentImageId, nodeId, operationId, signal }) => {
        const before = ledger.entries().length;
        const agent = await runRepairAgent({
          llm: fullContext.llm,
          executor: ctx.executor,
          initialImageId: parentImageId,
          diagnosis,
          policy,
          budget,
          trustedCommands,
          sourceContext,
          branchId: nodeId,
          operationIdPrefix: operationId,
          signal,
          trace,
          onOperationStart: (activeOperationId) => {
            activeOperations.set(nodeId, activeOperationId);
            lastOperations.set(nodeId, activeOperationId);
          },
          observeCapacity: (capacity) => { providerCapacity = capacity; },
          observe: ({ result, imageId, parentImageId, note }) => ledger.record({
            stage: 'search',
            attempt: ++candidateAttempt,
            network: 'disabled',
            ...(result === undefined ? {} : { result }),
            ...(imageId === undefined ? {} : { imageId }),
            parentImageId,
            note,
          }),
        });
        activeOperations.delete(nodeId);
        if (signal.aborted) {
          const lastOperation = lastOperations.get(nodeId);
          if (lastOperation !== undefined) {
            const completion = await ctx.executor.cancel(lastOperation);
            ledger.record({
              stage: 'search', attempt: ++candidateAttempt, network: 'disabled',
              operation: {
                operationId: lastOperation,
                ...(completion.terminal === undefined ? {} : { terminal: completion.terminal }),
                cancellationRequested: true,
              },
              note: `Cancellation terminal evidence for ${nodeId}`,
            });
          }
          const inheritedDiff = parent?.cumulativeDiff ?? '';
          return {
            imageId: parentImageId,
            cumulativeDiff: inheritedDiff,
            testEvidence: {
              commandId: 'diagnosed', imageId: parentImageId, exitCode: 1,
              output: 'Repair branch was cancelled',
            },
            policyEvidence: { valid: true, violations: [], changedFiles: [], diffBytes: Buffer.byteLength(inheritedDiff, 'utf8') },
            stageEvidence: ledger.entries().slice(before), transcriptReference: nodeId,
            terminalReason: 'cancelled',
          };
        }
        if (agent.status === 'submitted' || agent.status === 'checkpoint') {
          const validation = validateCandidateDiff(agent.candidate.diff, diagnosis, policy, budget.limits.diffBytes);
          return {
            imageId: agent.imageId,
            cumulativeDiff: agent.candidate.diff,
            testEvidence: agent.test,
            policyEvidence: {
              valid: validation.ok,
              violations: validation.violations,
              changedFiles: validation.changedFiles,
              diffBytes: validation.diffBytes,
            },
            stageEvidence: ledger.entries().slice(before),
            transcriptReference: nodeId,
            ...(agent.test.metrics === undefined ? {} : { metrics: agent.test.metrics }),
            ...(agent.status === 'submitted' ? { candidate: agent.candidate } : {}),
          };
        }
        ledger.record({
          stage: 'search', attempt: ++candidateAttempt, network: 'disabled',
          parentImageId, note: `${agent.failureKind} failure: ${agent.reason}`,
        });
        const inheritedDiff = parent?.cumulativeDiff ?? '';
        return {
          imageId: parentImageId,
          cumulativeDiff: inheritedDiff,
          testEvidence: {
            commandId: 'diagnosed', imageId: parentImageId, exitCode: 1,
            output: `${agent.failureKind}: ${agent.reason}`,
          },
          policyEvidence: { valid: true, violations: [], changedFiles: [], diffBytes: Buffer.byteLength(inheritedDiff, 'utf8') },
          stageEvidence: ledger.entries().slice(before), transcriptReference: nodeId,
          terminalReason: 'failed',
        };
      },
    });
    const searchEvidence = publicSearchEvidence(result.nodes);
    if (result.candidates.length === 0) {
      return makeCaseFile(fullContext, diagnosis, triageVerdict, [], 'gave-up', undefined, searchEvidence);
    }
    const raceResults: RaceResult[] = result.candidates.map((node) => ({
      candidate: node.candidate!, imageId: node.imageId, nodeId: node.id,
      exitCode: node.testEvidence.exitCode, held: true,
      note: `Adaptive search passed at depth ${node.depth}`,
    }));
    const winner = raceResults[0]!;
    let auditVerdict = await audit(ctx.executor, fullContext.llm, winner, {
      diagnosis,
      beforeLog: providerLog,
      suiteCommand: executableCommand,
    }, (result) => ledger.record({
      stage: 'audit',
      attempt: 1,
      network: 'disabled',
      result,
      parentImageId: winner.imageId,
      note: 'Fresh suite rerun',
    }));
    auditVerdict = await enforceWinnerPolicy(fullContext, winner, ledger, auditVerdict);
    return makeCaseFile(
      fullContext,
      diagnosis,
      triageVerdict,
      raceResults,
      auditVerdict.approved ? 'fixed' : 'refused',
      auditVerdict,
      searchEvidence,
    );
  }

  const candidates = [suppliedCandidate];

  if (suppliedCandidate) {
    const verdict = policyVerdict(suppliedCandidate, diagnosis, policy);
    if (!verdict.ok) {
      const evidence = `Patch vet refused: ${verdict.violations.join('; ')}`;
      const nodeId = ledger.record({
        stage: 'candidate',
        attempt: 1,
        network: 'disabled',
        note: `Candidate refused before execution: ${verdict.violations.join('; ')}`,
      });
      return makeCaseFile(
        fullContext,
        diagnosis,
        triageVerdict,
        [vettedRaceResult(suppliedCandidate, verdict.violations, nodeId)],
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
    const verdict = policyVerdict(candidate, diagnosis, policy);
    if (verdict.ok) {
      approvedCandidates.push(candidate);
    } else {
      const nodeId = ledger.record({
        stage: 'candidate',
        attempt: refusedCandidates.size + 1,
        network: 'disabled',
        note: `Candidate refused before execution: ${verdict.violations.join('; ')}`,
      });
      refusedCandidates.set(
        candidate.id,
        vettedRaceResult(candidate, verdict.violations, nodeId),
      );
    }
  }

  const raced = await race(
    ctx.executor,
    ctx.failingImage,
    approvedCandidates,
    executableCommand,
    (result, attempt) => ledger.record({
      stage: 'candidate',
      attempt,
      network: 'disabled',
      result,
      parentImageId: ctx.failingImage,
      note: 'Candidate verification race',
    }),
  );
  const racedById = new Map(raced.map((result) => [result.candidate.id, result]));
  const raceResults = candidates.map((candidate) => {
    const result = racedById.get(candidate.id) ?? refusedCandidates.get(candidate.id);
    if (!result) throw new HealCaseError(`Missing race result for candidate ${candidate.id}`);
    return result;
  });
  const winner = selectWinner(raceResults);
  if (!winner) {
    if (refusedCandidates.size > 0) {
      const evidence = raceResults
        .flatMap((result) => result.note ? [result.note] : [])
        .join('; ');
      return makeCaseFile(
        fullContext,
        diagnosis,
        triageVerdict,
        raceResults,
        'refused',
        {
          approved: false,
          checks: [{
            name: 'llm-adjudication',
            passed: false,
            evidence: 'Not run: repository or built-in policy refused all candidates',
          }],
          reasoning: `REFUSED: ${evidence}`,
        },
      );
    }
    return makeCaseFile(fullContext, diagnosis, triageVerdict, raceResults, 'gave-up');
  }

  let auditVerdict = await audit(ctx.executor, fullContext.llm, winner, {
    diagnosis,
    beforeLog: providerLog,
    suiteCommand: executableCommand,
  }, (result) => ledger.record({
    stage: 'audit',
    attempt: 1,
    network: 'disabled',
    result,
    parentImageId: winner.imageId,
    note: 'Fresh suite rerun',
  }));
  auditVerdict = await enforceWinnerPolicy(fullContext, winner, ledger, auditVerdict);
  return makeCaseFile(
    fullContext,
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

  const trace = ctx.traceRecorder ?? new TraceRecorder(ctx.runId);
  ensureTraceStarted(trace);
  const ledger = ctx.stageLedger ?? new StageLedger(trace);
  const fullContext: HealCaseContext = {
    ...ctx,
    stageLedger: ledger,
    traceRecorder: trace,
  };
  ledger.record({
    stage: 'policy',
    attempt: 1,
    network: 'disabled',
    note: 'Repository policy validated before provider execution',
  });
  const configuredRuntime = ctx.runtimeId ?? ctx.policy?.runtime;
  if (ctx.runtimeId !== undefined && ctx.policy?.runtime !== undefined && ctx.runtimeId !== ctx.policy.runtime) {
    throw new HealCaseError('Configured runtime conflicts with repository policy runtime');
  }
  const runtime = await detectRuntimeAtPath(ctx.caseDir, command, configuredRuntime);
  fullContext.runtime = runtime;
  if (runtime.id === 'python' && ctx.imageRef !== undefined && ctx.imageRef !== runtime.imageRef) {
    throw new HealCaseError('Python runtime image must use the verified exact digest');
  }
  const executor = new AllowlistedExecutor(ctx.executor);
  const baseImage = await executor.importImage(ctx.imageRef ?? runtime.imageRef);
  ledger.record({
    stage: 'preparation',
    attempt: 0,
    network: 'disabled',
    imageId: baseImage,
    note: 'Base image imported',
  });
  const setup = await prepareSandbox(
    executor,
    ctx.caseDir,
    baseImage,
    command,
    ledger,
    runtime,
  );
  if (!setup.ok) {
    return preparationFailureCaseFile(fullContext, setup.command, setup.result);
  }
  const reproduction = await executor.run(
    setup.imageId,
    sandboxTargetCommand(command, runtime),
    { cwd: SNAPSHOT_CWD },
  );
  ledger.record({
    stage: 'reproduction',
    attempt: 1,
    network: 'disabled',
    result: reproduction,
    parentImageId: setup.imageId,
    note: 'Observed failing command reproduction',
  });
  const failedLog = failureLog(command, reproduction);
  if (reproduction.exitCode === 0) {
    const mechanical = classifyMechanically(failedLog);
    return noReproductionCaseFile(fullContext, mechanical);
  }

  return repairFailure({
    runId: ctx.runId,
    repo: ctx.repo,
    failedLog,
    failingImage: setup.imageId,
    executor,
    llm: fullContext.llm,
    cost: ctx.cost,
    triageN: ctx.triageN,
    raceK: ctx.raceK,
    readSourceContext: ctx.readSourceContext,
    ...(ctx.tavily ? { tavily: ctx.tavily } : {}),
    ...(ctx.lockfileDiff === undefined ? {} : { lockfileDiff: ctx.lockfileDiff }),
    ...(ctx.dependencyHints === undefined ? {} : { dependencyHints: ctx.dependencyHints }),
    ...(ctx.candidateDiff === undefined ? {} : { candidateDiff: ctx.candidateDiff }),
    ...(ctx.policy === undefined ? {} : { policy: ctx.policy }),
    ...(ctx.policyEvidence === undefined ? {} : { policyEvidence: ctx.policyEvidence }),
    ...(ctx.repairBudgets === undefined ? {} : { repairBudgets: ctx.repairBudgets }),
    ...(ctx.search === undefined ? {} : { search: ctx.search }),
    stageLedger: ledger,
    traceRecorder: trace,
    runtime,
  });
}
