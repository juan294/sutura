import { DefaultArtifactClient } from '@actions/artifact';
import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  AlreadyAttemptedError,
  ContreeExecutor,
  ReplayRecorder,
  TavilyClient,
  createTokenFactoryClient,
  loadConfig,
  orchestrate,
  recordingContreeFetch,
  recordingExecutor,
  recordingNebiusFetch,
  recordingTavilyFetch,
  type OrchestrationContext,
} from '@sutura/core';

import { GitHubAdapter } from './github.js';
import { reportOutcome } from './acceptance.js';
import { runtimeEvidence } from './evidence.js';
import { withFailureSafeCheck } from './failure-safe.js';
import { mapActionInputs } from './input.js';
import { createGitHubApi } from './octokit.js';
import { GitRepository } from './repository.js';
import { recordingGitHubApi } from './replay-github.js';
import { recordingRepositoryPort } from './replay-repository.js';

export async function runAction(): Promise<void> {
  let requireFixed = false;
  try {
    const action = mapActionInputs((name) => core.getInput(name));
    requireFixed = action.requireFixed;
    const config = loadConfig(action.environment);
    if (!config.contreeToken || !config.contreeProject) {
      throw new Error('ConTree token and project are required by the GitHub Action');
    }
    const { owner, repo } = github.context.repo;
    const actionRunId = process.env.GITHUB_RUN_ID;
    if (!actionRunId || !/^[1-9]\d*$/.test(actionRunId)) {
      throw new Error('GITHUB_RUN_ID must be a positive decimal id');
    }
    const octokit = github.getOctokit(action.githubToken);
    const orchestrationOptions = {
      triageN: config.triageN,
      raceK: config.raceK,
      repairBudgets: config.repairBudgets,
      search: config.search,
      ...(config.runtimeId === undefined ? {} : { runtimeId: config.runtimeId }),
    } satisfies Pick<
      OrchestrationContext,
      'triageN' | 'raceK' | 'repairBudgets' | 'search' | 'runtimeId'
    >;
    const recorder = action.captureReplay
      ? new ReplayRecorder(
          action.runId,
          `${owner}/${repo}`,
          process.env.GITHUB_SHA ?? '',
          {
            ...orchestrationOptions,
            models: config.models,
            routingProfileId: config.routingProfileId,
            maxOps: config.maxOps,
          },
          [
            action.githubToken,
            config.nebiusApiKey,
            config.tavilyApiKey ?? '',
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
    const githubApi = createGitHubApi(octokit, owner, repo);
    const adapter = new GitHubAdapter(
      recorder ? recordingGitHubApi(githubApi, recorder) : githubApi,
      {
        owner,
        repo,
        runId: action.runId,
        actionRunId,
        artifact: new DefaultArtifactClient(),
      },
    );
    const baseRepository = new GitRepository({
      token: action.githubToken,
      ...(process.env.RUNNER_TEMP ? { workspaceRoot: process.env.RUNNER_TEMP } : {}),
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
      runId: action.runId,
      github: adapter,
      repository,
      executor,
      llm: nebius,
      cost: nebius.ledger,
      ...orchestrationOptions,
      ...(tavily ? { tavily } : {}),
      ...(recorder ? { replay: recorder } : {}),
    }), (message) => core.warning(message), recorder);
    reportOutcome(result.outcome, action.requireFixed, core);
    for (const evidence of runtimeEvidence(result)) core.info(evidence);
    core.info(`Sutura outcome: ${result.outcome}`);
  } catch (error) {
    if (error instanceof AlreadyAttemptedError) {
      core.info(error.message);
      reportOutcome('already-attempted', requireFixed, core);
      return;
    }
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

void runAction();
