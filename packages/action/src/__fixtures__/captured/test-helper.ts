import { readFileSync } from 'node:fs';

import { parseReplayBundle, type ReplayBundle } from '@sutura/core';

export function capturedBundle(workflowRunId: string): ReplayBundle {
  return parseReplayBundle(JSON.parse(readFileSync(
    new URL(`./${workflowRunId}/bundle.json`, import.meta.url),
    'utf8',
  )) as unknown);
}

export function capturedJobLog(workflowRunId: string): string {
  const call = capturedBundle(workflowRunId).github.find(
    ({ method }) => method === 'downloadJobLogs',
  );
  if (typeof call?.result !== 'string') {
    throw new Error(`Captured workflow run ${workflowRunId} has no job log`);
  }
  return call.result;
}
