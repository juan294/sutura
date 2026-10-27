import { prepareActionVerificationAuthorization } from './verification-authorization.js';
import { runActionVerification, type ActionVerificationContext, type ActionVerificationOutcome } from './verify-execution.js';
import { mapVerifyInputs, type ActionVerifyInputs } from './verify.js';
import { DefaultArtifactClient } from '@actions/artifact';
import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  authorizeActionVerification,
  AlreadyAttemptedError,
  describeTerminalRecovery,
  ContreeExecutor,
  RepairBranchRunError,
  OpenAiClient,
  ReplayRecorder,
  TavilyClient,
  TypeSafeClient,
  createTokenFactoryClient,
  loadConfig,
  orchestrate,
  recordingContreeFetch,
  recordingExecutor,
  recordingNebiusFetch,
  recordingOpenAiFetch,
  recordingTavilyFetch,
  recordingTypeSafeFetch,
  type Config,
  type ConfigEnvironment,
  type OrchestrationContext,
} from '@sutura/core';

import { ActionTextArtifactPort, GitHubAdapter } from './github.js';
import { caseTerminalDetail, expectedActionStop, reportOutcome } from './acceptance.js';
import { inspectAction, inspectionFetch, type InspectionContext } from './inspect-github.js';
import { reportInspection, type ActionInspection } from './inspect.js';
import { buildPublicationReceipt, type AuthenticatedSourceRun } from './publication.js';
import { runtimeEvidence } from './evidence.js';
import { withFailureSafeCheck } from './failure-safe.js';
import { ActionInputError, mapActionInputs, type ActionConfiguration } from './input.js';
import { createGitHubApi } from './octokit.js';
import { GitRepository } from './repository.js';
import { recordingGitHubApi } from './replay-github.js';
import { recordingRepositoryPort } from './replay-repository.js';
import { createTerminalFailureEvidence, resolveActionIdentity } from './terminal-failure.js';

export interface RunActionDependencies {
  readAction(): ActionConfiguration;
  inspect(action: ActionConfiguration, context: InspectionContext): Promise<ActionInspection>;
  publishInspection(result: ActionInspection): void;
  publishTerminal(evidence: Record<string, unknown>): Promise<void>;
  readVerification(): ActionVerifyInputs;
  verify(inputs: ActionVerifyInputs, context: ActionVerificationContext): Promise<ActionVerificationOutcome>;
  loadConfiguration(environment: ConfigEnvironment): Config;
  repository(): { owner: string; repo: string };
  environment: Readonly<Record<string, string | undefined>>;
  setFailed(message: string): void;
}

const DEFAULT_DEPENDENCIES: RunActionDependencies = {
  readAction: () => mapActionInputs((name) => core.getInput(name)),
  inspect: inspectAction,
  publishInspection: result => reportInspection(result, core),
  publishTerminal: async evidence => {
    const identity = evidence.fixtureIdentity as { repository: string; targetRunId: string };
    if (!/^[1-9]\d*$/u.test(identity.targetRunId) || !/^[1-9]\d*$/u.test(String(evidence.actionRunId))) throw new Error('Terminal artifact identity unavailable');
    const port = new ActionTextArtifactPort(identity.repository, String(evidence.actionRunId), new DefaultArtifactClient());
    const artifact = await port.uploadTextArtifact(`sutura-terminal-outcome-${identity.targetRunId}.json`, JSON.stringify(evidence));
    core.setOutput('terminal-artifact-url', artifact.url);
  },
  readVerification: () => mapVerifyInputs((name) => core.getInput(name)),
  verify: runActionVerification,
  loadConfiguration: loadConfig,
  repository: () => github.context.repo,
  environment: process.env,
  setFailed: (message) => core.setFailed(message),
};

export async function runAction(
  overrides: Partial<RunActionDependencies> = {},
): Promise<void> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  const controllerStartedAt = Date.now();
  let requireFixed = false;
  let actionMode: 'heal' | 'verify' | 'inspect' = 'heal';
  let selectedRunId: string | undefined;
  let recorder: ReplayRecorder | undefined;
  try {
    const action = dependencies.readAction();
    requireFixed = action.requireFixed;
    actionMode = action.mode ?? 'heal'; selectedRunId = action.runId;
    if (action.mode === 'inspect') {
      const { owner, repo } = dependencies.repository();
      dependencies.publishInspection(await dependencies.inspect(action, { owner, repo, environment: dependencies.environment }));
      return;
    }
    const config = dependencies.loadConfiguration(action.environment);
    if (!config.contreeToken || !config.contreeProject) {
      throw new Error('ConTree token and project are required by the GitHub Action');
    }
    const { owner, repo } = dependencies.repository();
    const actionRunId = dependencies.environment.GITHUB_RUN_ID;
    if (!actionRunId || !/^[1-9]\d*$/.test(actionRunId)) {
      throw new Error('GITHUB_RUN_ID must be a positive decimal id');
    }
    if (action.mode === 'verify') {
      const result = await dependencies.verify(dependencies.readVerification(), {
        owner, repo, runId: action.runId, githubToken: action.githubToken, config, controllerStartedAt, engineSha: resolveActionIdentity(dependencies.environment).sha ?? '',
        ...(action.verificationPacket ? { verificationPacket: action.verificationPacket, authorizeLongVerification: action.authorizeLongVerification!, callerRunId: Number(actionRunId) } : {}),
      });
      if (result.status !== 'verified-supplied-patch') {
        dependencies.setFailed(`Sutura verification: ${result.status}`);
      }
      return;
    }
    const actionIdentity = resolveActionIdentity(dependencies.environment);
    if (action.captureReplay && actionIdentity.sha === null) {
      throw new Error('capture-replay requires Sutura to be pinned to an exact Action commit SHA');
    }
    const octokit = github.getOctokit(action.githubToken);
    const longVerification = action.verificationPacket ? await prepareActionVerificationAuthorization({ octokit, owner, repo, callerRunId: Number(actionRunId), packetInput: action.verificationPacket, packetDigestInput: action.authorizeLongVerification! }) : undefined;
    if (longVerification && (longVerification.packet.runId !== action.runId || longVerification.packet.engineSha !== actionIdentity.sha)) throw new Error('Selected source or engine differs from authenticated dispatch packet');
    const orchestrationOptions = {
      triageN: config.triageN,
      raceK: config.raceK,
      repairBudgets: config.repairBudgets,
      search: config.search,
      sourceReferenceOrder: 'latest',
      repairVerificationScope: 'failing-workspace',
      triagePolicy: { scope: 'focused', sandboxBudgetSec: config.triageSandboxBudgetSec },
      ...(config.runtimeId === undefined ? {} : { runtimeId: config.runtimeId }),
    } satisfies Pick<
      OrchestrationContext,
      'triageN' | 'raceK' | 'repairBudgets' | 'search' | 'runtimeId' |
      'sourceReferenceOrder'
      | 'repairVerificationScope' | 'triagePolicy'
    >;
    recorder = action.captureReplay
      ? new ReplayRecorder(
          action.runId,
          `${owner}/${repo}`,
          actionIdentity.sha ?? '',
          {
            ...orchestrationOptions,
            operationDeadlines: 'sutura-operation-deadlines-v1',
            ...(longVerification ? { longVerification: { packet: longVerification.packet, provenance: longVerification.authority.provenance, admitted: false } } : {}),
            models: config.models,
            routingProfileId: config.routingProfileId,
            maxOps: config.maxOps,
          },
          [
            action.githubToken,
            config.nebiusApiKey,
            config.tavilyApiKey ?? '',
            config.openaiApiKey ?? '',
            config.typesafeApiKey ?? '',
            config.contreeToken,
            config.contreeProject,
          ],
        )
      : undefined;
    const nebius = createTokenFactoryClient({
      apiKey: config.nebiusApiKey,
      models: config.models,
      routingProfileId: config.routingProfileId,
    }, recorder ? {
      fetch: recordingNebiusFetch(
        recorder,
        globalThis.fetch as Parameters<typeof recordingNebiusFetch>[1],
      ),
    } : {});
    const secondOpinion = config.openaiApiKey
      ? new OpenAiClient({ apiKey: config.openaiApiKey, ledger: nebius.ledger }, recorder ? {
          fetch: recordingOpenAiFetch(
            recorder,
            globalThis.fetch as Parameters<typeof recordingOpenAiFetch>[1],
          ),
        } : {})
      : undefined;
    const typesafeAudit = config.typesafeApiKey
      ? new TypeSafeClient({ apiKey: config.typesafeApiKey, ledger: nebius.ledger }, recorder ? {
          fetch: recordingTypeSafeFetch(
            recorder,
            globalThis.fetch as Parameters<typeof recordingTypeSafeFetch>[1],
          ),
        } : {})
      : undefined;
    let publicationSource: AuthenticatedSourceRun | undefined;
    let publishedPrNumber: number | undefined;
    const baseGithubApi = createGitHubApi(octokit, owner, repo, { ...(longVerification ? { sourceAttempt: longVerification.authority.actual.attempt } : {}), onSourceRun: source => {
      if (source.runId !== Number(action.runId) || source.repository.toLowerCase() !== `${owner}/${repo}`.toLowerCase() ||
        !Number.isSafeInteger(source.attempt) || source.attempt < 1 || !Number.isSafeInteger(source.repositoryId) || source.repositoryId < 1 ||
        !Number.isSafeInteger(source.workflowId) || source.workflowId < 1 || !/^[a-f0-9]{40}$/u.test(source.sha) || !source.branch) throw new Error('Publication source identity unavailable');
      if (dependencies.environment.GITHUB_EVENT_NAME === 'workflow_run') {
        const event = github.context.payload.workflow_run as { id?: number; run_attempt?: number; head_sha?: string; workflow_id?: number } | undefined;
        if (!event || event.id !== source.runId || event.run_attempt !== source.attempt || event.head_sha !== source.sha || event.workflow_id !== source.workflowId) throw new Error('Authenticated source event attempt differs from selected run');
      }
      if (publicationSource && JSON.stringify(publicationSource) !== JSON.stringify(source)) throw new Error('Selected source run changed during repair');
      publicationSource = { ...source };
    } });
    const githubApi = { ...baseGithubApi, async createPullRequest(input: Parameters<typeof baseGithubApi.createPullRequest>[0]) {
      const created = await baseGithubApi.createPullRequest(input); publishedPrNumber = created.number; return created;
    } };
    const adapter = new GitHubAdapter(
      recorder ? recordingGitHubApi(githubApi, recorder) : githubApi,
      {
        owner,
        repo,
        runId: action.runId,
        ...(longVerification ? { explicitAuthority: longVerification.authority } : {}),
        actionRunId,
        artifact: new DefaultArtifactClient(),
      },
    );
    const baseRepository = new GitRepository({
      token: action.githubToken,
      ...(dependencies.environment.RUNNER_TEMP
        ? { workspaceRoot: dependencies.environment.RUNNER_TEMP }
        : {}),
    });
    const repository = recorder
      ? recordingRepositoryPort(baseRepository, recorder)
      : baseRepository;
    const baseExecutor = new ContreeExecutor({
      token: config.contreeToken,
      project: config.contreeProject,
      maxOps: config.maxOps,
      ...(recorder
        ? { fetch: recordingContreeFetch(recorder, globalThis.fetch) }
        : {}),
    });
    const executor = recorder
      ? recordingExecutor(baseExecutor, recorder)
      : baseExecutor;
    const tavily = config.tavilyApiKey
      ? new TavilyClient(config.tavilyApiKey, recorder ? {
          fetch: recordingTavilyFetch(
            recorder,
            globalThis.fetch as Parameters<typeof recordingTavilyFetch>[1],
          ),
        } : {})
      : undefined;

    const result = await withFailureSafeCheck(adapter, () => orchestrate({
      evidenceMode: 'live',
      controllerStartedAt,
      ...(longVerification ? { explicitAuthority: longVerification.authority, authorizeVerification: async plan => { await baseExecutor.verifyDeadlineSupport(plan.profile.providerTimeoutLimitKey, longVerification.packet.providerMaxTimeoutSec); const capability = await authorizeActionVerification({ packet: longVerification.packet, plan, authority: longVerification.authority, ...(recorder ? { now: () => recorder!.clockNow('verification') } : {}) }); recorder?.recordVerificationAdmission(capability); return capability; } } : {}),
      runId: action.runId,
      github: adapter,
      repository,
      executor,
      llm: nebius,
      ...(secondOpinion ? { secondOpinion } : {}),
      ...(typesafeAudit ? { typesafeAudit } : {}),
      cost: nebius.ledger,
      ...orchestrationOptions,
      ...(tavily ? { tavily } : {}),
      ...(recorder ? { replay: recorder } : {}),
    }), (message) => core.warning(message), recorder, {
      actionRunId,
      targetRunId: action.runId,
      repository: `${owner}/${repo}`,
      actionSha: actionIdentity.sha ?? '',
      actionShaSource: actionIdentity.source,
    });
    if (result.outcome === 'fixed') {
      if (!publicationSource || publishedPrNumber === undefined || actionIdentity.sha === null) throw new Error('Fixed publication lacks authenticated receipt inputs');
      const monitorAttempt = Number(dependencies.environment.GITHUB_RUN_ATTEMPT);
      const receipt = await buildPublicationReceipt({ octokit: github.getOctokit(action.githubToken, { request: { fetch: inspectionFetch() } }), source: publicationSource, monitorRunId: Number(actionRunId), monitorAttempt,
        actionSha: actionIdentity.sha, prNumber: publishedPrNumber, ...(longVerification ? { explicitAuthority: longVerification.authority } : {}) });
      const artifact = await new ActionTextArtifactPort(`${owner}/${repo}`, actionRunId, new DefaultArtifactClient()).uploadTextArtifact(
        `sutura-publication-v1-${actionRunId}-${monitorAttempt}`, JSON.stringify(receipt), 'json');
      core.setOutput('publication-receipt-url', artifact.url);
    }
    reportOutcome(result.outcome, action.requireFixed, { setOutput: core.setOutput, setFailed: dependencies.setFailed }, caseTerminalDetail(result));
    for (const evidence of runtimeEvidence(result)) core.info(evidence);
    core.info(`Sutura outcome: ${result.outcome}`);
  } catch (error) {
    if (error instanceof AlreadyAttemptedError) {
      core.info(error.message);
      reportOutcome('already-attempted', requireFixed, core);
      return;
    }
    if (error instanceof RepairBranchRunError) {
      core.info(error.message);
      reportOutcome('repair-branch-skipped', requireFixed, core);
      return;
    }
    const mode = error instanceof ActionInputError ? error.actionMode : actionMode;
    const expected = mode === 'heal' ? expectedActionStop(error) : undefined;
    if (expected) {
      if (error instanceof ActionInputError) requireFixed ||= error.admittedStrict;
      const { owner, repo } = dependencies.repository();
      const actionIdentity = resolveActionIdentity(dependencies.environment);
      const replay = recorder?.finish('infra-stop');
      const evidence = { ...createTerminalFailureEvidence(error, {
        repository: `${owner}/${repo}`, actionRunId: dependencies.environment.GITHUB_RUN_ID ?? '',
        targetRunId: selectedRunId ?? (error instanceof ActionInputError ? error.runId : undefined) ?? '',
        actionSha: actionIdentity.sha ?? '', actionShaSource: actionIdentity.source, ...(replay ? { replay } : {}),
      }), terminal: expected };
      core.setOutput('terminal-evidence', JSON.stringify(evidence));
      try { await dependencies.publishTerminal(evidence); }
      catch { dependencies.setFailed('Sutura could not persist typed terminal evidence; outcome remains incomplete.'); return; }
      reportOutcome('infra-stop', requireFixed, { setOutput: core.setOutput, setFailed: dependencies.setFailed }, expected);
      core.info(`${expected.reason}: ${expected.nextAction} Consumed resources remain in existing case or terminal receipts; unavailable accounting is not zero.`);
      return;
    }
    core.setOutput('outcome', 'monitor-failed');
    const recovery = describeTerminalRecovery(error);
    core.setOutput('terminal-reason', recovery?.code ?? 'unexpected-exception');
    if (recovery) core.setOutput('failing-stage', recovery.stage);
    core.setOutput('next-action', recovery?.nextAction ?? 'Inspect the exact failed Action run and retained terminal diagnostics before a new authorized event.');
    dependencies.setFailed(error instanceof Error ? error.message : String(error));
  }
}
