import { readFileSync } from 'node:fs';

import type { RecordedGitHubCall, ReplayBundle } from '../../replay/bundle.js';
import { GitHubAdapter } from '../../github/adapter.js';
import {
  parseCapturedFixturesManifest,
  type CapturedFixtureEntry,
} from '../../replay/manifest.js';
import { parseReplayBundle } from '../../replay/validate.js';
import { replayingGitHubApi } from '../../replay/replay-github.js';
import type { FailingWorkflowRun } from '../../orchestrate.js';

const CAPTURED_FIXTURES = new URL(
  '../../../../action/src/__fixtures__/captured/',
  import.meta.url,
);

interface CapturedLiveRun {
  entry: CapturedFixtureEntry;
  bundle: ReplayBundle;
  runMetadata: RecordedGitHubCall;
  jobLog: RecordedGitHubCall;
  jobLogText: string;
}

function readJson(url: URL): unknown {
  return JSON.parse(readFileSync(url, 'utf8')) as unknown;
}

export function capturedRun(
  caseName: string,
  targetRunId: string,
): CapturedLiveRun {
  const manifest = parseCapturedFixturesManifest(readJson(new URL('manifest.json', CAPTURED_FIXTURES)));
  const entry = manifest.entries.find((candidate) => candidate.targetRunId === targetRunId);
  if (entry === undefined) {
    throw new Error(`${caseName} does not reference a captured target run`);
  }
  if (!entry.boundaries.includes('github')) {
    throw new Error(`${caseName} does not have a captured GitHub boundary`);
  }
  const bundle = parseReplayBundle(readJson(new URL(
    `${entry.workflowRunId}/bundle.json`,
    CAPTURED_FIXTURES,
  )));
  if (bundle.runId !== targetRunId) {
    throw new Error(`${caseName} bundle identity does not match its target run`);
  }
  const runMetadata = bundle.github.find(({ method }) => method === 'getWorkflowRun');
  const jobLog = bundle.github.find(({ method }) => method === 'downloadJobLogs');
  if (runMetadata === undefined || jobLog === undefined) {
    throw new Error(`${caseName} lacks run metadata or a job log`);
  }
  if (typeof runMetadata.result !== 'object' || runMetadata.result === null) {
    throw new Error(`${caseName} has invalid run metadata`);
  }
  if (typeof jobLog.result !== 'string') {
    throw new Error(`${caseName} has an invalid job log`);
  }
  return { entry, bundle, runMetadata, jobLog, jobLogText: jobLog.result };
}

export function capturedLiveRun(
  liveRunNumber: number,
  targetRunId: string,
): CapturedLiveRun {
  return capturedRun(`Live run ${liveRunNumber}`, targetRunId);
}

export async function capturedFailingRun(
  caseName: string,
  targetRunId: string,
): Promise<CapturedLiveRun & { run: FailingWorkflowRun }> {
  const captured = capturedRun(caseName, targetRunId);
  const [owner, repo, ...extra] = captured.bundle.repo.split('/');
  if (!owner || !repo || extra.length > 0) {
    throw new Error(`${caseName} has an invalid repository identifier`);
  }
  const { api } = replayingGitHubApi(captured.bundle);
  const adapter = new GitHubAdapter(api, {
    owner,
    repo,
    runId: captured.bundle.runId,
  });
  return {
    ...captured,
    run: await adapter.getFailingRun(captured.bundle.runId),
  };
}
