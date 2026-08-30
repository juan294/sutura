import { createTokenFactoryClient } from '../llm/token-factory.js';
import { TavilyClient } from '../diagnose/tavily.js';
import type { CaseFile } from '../domain.js';
import type { Executor } from '../executor/types.js';
import { GitHubAdapter } from '../github/adapter.js';
import type { TextArtifactPort } from '../github/types.js';
import { orchestrate } from '../orchestrate.js';
import type { RuntimeId } from '../runtime/types.js';
import type { ReplayBundle } from './bundle.js';
import { RecordedExecutor } from './replay-executor.js';
import { replayFetch } from './replay-fetch.js';
import { replayingGitHubApi, type RecordedGitHubMutation } from './replay-github.js';
import { RecordedRepository } from './replay-repository.js';
import { parseReplayBundle, ReplayValidationError } from './validate.js';

export interface ReplayBundleOptions {
  executor?: Executor;
  artifact?: TextArtifactPort;
  runtimeId?: RuntimeId;
}

export interface ReplayBundleResult {
  caseFile: CaseFile;
  mutations: RecordedGitHubMutation[];
}

class ReplayTextArtifactPort implements TextArtifactPort {
  private readonly caseFileUrl: string | undefined;

  constructor(bundle: ReplayBundle) {
    this.caseFileUrl = bundle.github.flatMap((call) => call.args)
      .map((arg) => typeof arg === 'object' && arg !== null
        ? (arg as { detailsUrl?: unknown }).detailsUrl
        : undefined)
      .find((value): value is string => typeof value === 'string' && value.length > 0);
  }

  uploadTextArtifact(
    name: string,
    _content: string,
    extension: 'html' | 'json',
  ): Promise<{ url: string }> {
    if (extension === 'html' && this.caseFileUrl) {
      return Promise.resolve({ url: this.caseFileUrl });
    }
    return Promise.resolve({ url: `replay://artifact/${encodeURIComponent(name)}` });
  }
}

export async function replayBundle(
  bundle: ReplayBundle,
  options: ReplayBundleOptions = {},
): Promise<ReplayBundleResult> {
  const validated = parseReplayBundle(bundle);
  if (!validated.completeness.complete) {
    throw new ReplayValidationError(
      'bundle',
      'is partial; complete provider, repository, and sandbox recordings are required',
    );
  }
  const [owner, repo] = validated.repo.split('/');
  if (!owner || !repo) throw new ReplayValidationError('bundle.repo', 'must use owner/repo format');
  const githubReplay = replayingGitHubApi(validated);
  const repository = new RecordedRepository(validated.repository);
  const executor = options.executor ?? new RecordedExecutor(
    validated.executor,
    (args) => repository.normalizeArgs(args),
  );
  const github = new GitHubAdapter(githubReplay.api, {
    owner,
    repo,
    runId: validated.runId,
    artifact: options.artifact ?? new ReplayTextArtifactPort(validated),
  });
  const llm = createTokenFactoryClient({
    apiKey: 'replay-only',
    models: validated.configuration.models,
    routingProfileId: validated.configuration.routingProfileId,
  }, { fetch: replayFetch(validated, 'nebius') });
  const tavily = new TavilyClient('replay-only', {
    fetch: replayFetch(validated, 'tavily'),
  });
  try {
    const caseFile = await orchestrate({
      runId: validated.runId,
      github,
      repository,
      executor,
      llm,
      cost: llm.ledger,
      triageN: validated.configuration.triageN,
      raceK: validated.configuration.raceK,
      ...(validated.configuration.repairBudgets === undefined
        ? {}
        : { repairBudgets: validated.configuration.repairBudgets }),
      ...(validated.configuration.search === undefined
        ? {}
        : { search: validated.configuration.search }),
      tavily,
      ...(validated.configuration.imageRef === undefined
        ? {}
        : { imageRef: validated.configuration.imageRef }),
      ...(options.runtimeId ?? validated.configuration.runtimeId
        ? { runtimeId: options.runtimeId ?? validated.configuration.runtimeId }
        : {}),
    });
    return { caseFile, mutations: githubReplay.mutations };
  } finally {
    await repository.cleanup();
  }
}
