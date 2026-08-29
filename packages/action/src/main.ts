import { DefaultArtifactClient } from '@actions/artifact';
import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  AlreadyAttemptedError,
  ContreeExecutor,
  TavilyClient,
  createTokenFactoryClient,
  loadConfig,
  orchestrate,
} from '@sutura/core';

import { GitHubAdapter } from './github.js';
import { reportOutcome } from './acceptance.js';
import { runtimeEvidence } from './evidence.js';
import { withFailureSafeCheck } from './failure-safe.js';
import { mapActionInputs } from './input.js';
import { createGitHubApi } from './octokit.js';
import { GitRepository } from './repository.js';

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
    const nebius = createTokenFactoryClient({
      apiKey: config.nebiusApiKey,
      models: config.models,
      routingProfileId: config.routingProfileId,
    });
    const adapter = new GitHubAdapter(
      createGitHubApi(octokit, owner, repo),
      {
        owner,
        repo,
        runId: action.runId,
        actionRunId,
        artifact: new DefaultArtifactClient(),
      },
    );
    const repository = new GitRepository({
      token: action.githubToken,
      ...(process.env.RUNNER_TEMP ? { workspaceRoot: process.env.RUNNER_TEMP } : {}),
    });
    const executor = new ContreeExecutor({
      token: config.contreeToken,
      project: config.contreeProject,
      maxOps: config.maxOps,
    });
    const tavily = config.tavilyApiKey
      ? new TavilyClient(config.tavilyApiKey)
      : undefined;

    const result = await withFailureSafeCheck(adapter, () => orchestrate({
      runId: action.runId,
      github: adapter,
      repository,
      executor,
      llm: nebius,
      cost: nebius.ledger,
      triageN: config.triageN,
      raceK: config.raceK,
      repairBudgets: config.repairBudgets,
      search: config.search,
      ...(config.runtimeId === undefined ? {} : { runtimeId: config.runtimeId }),
      ...(tavily ? { tavily } : {}),
    }), (message) => core.warning(message));
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
