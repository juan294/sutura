import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  GitHubAdapter as CoreGitHubAdapter,
  GitHubAdapterError,
  type GitHubApi,
  type TextArtifactPort,
} from '@sutura/core';

export { GitHubAdapterError } from '@sutura/core';
export type {
  GitHubApi,
  PullRequestRecord,
  WorkflowJobRecord,
  WorkflowJobStep,
  WorkflowRunRecord,
} from '@sutura/core';

export interface ArtifactApi {
  uploadArtifact(
    name: string,
    files: string[],
    rootDirectory: string,
  ): Promise<{ id?: number }>;
}

export interface GitHubAdapterOptions {
  owner: string;
  repo: string;
  runId: string;
  actionRunId?: string;
  artifact?: ArtifactApi;
}

function positiveId(value: string, name: string): number {
  if (!/^[1-9]\d*$/u.test(value)) throw new GitHubAdapterError(`${name} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new GitHubAdapterError(`${name} is invalid`);
  return parsed;
}

class ActionTextArtifactPort implements TextArtifactPort {
  constructor(
    private readonly repository: string,
    private readonly actionRunId: string,
    private readonly artifact: ArtifactApi,
  ) {}

  async uploadTextArtifact(
    name: string,
    content: string,
  ): Promise<{ url: string }> {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-artifact-'));
    try {
      const path = join(directory, name);
      await writeFile(path, content, { encoding: 'utf8', mode: 0o600 });
      const uploaded = await this.artifact.uploadArtifact(name, [path], directory);
      if (!Number.isSafeInteger(uploaded.id) || (uploaded.id ?? 0) <= 0) {
        throw new GitHubAdapterError('Artifact upload did not return an id');
      }
      return {
        url: `https://github.com/${this.repository}/actions/runs/${positiveId(this.actionRunId, 'Action run id')}/artifacts/${uploaded.id}`,
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export class GitHubAdapter extends CoreGitHubAdapter {
  constructor(api: GitHubApi, options: GitHubAdapterOptions) {
    const artifactPort = options.artifact
      ? new ActionTextArtifactPort(
          `${options.owner}/${options.repo}`,
          options.actionRunId ?? '',
          options.artifact,
        )
      : undefined;
    super(api, {
      owner: options.owner,
      repo: options.repo,
      runId: options.runId,
      ...(artifactPort ? { artifact: artifactPort } : {}),
    });
  }
}
