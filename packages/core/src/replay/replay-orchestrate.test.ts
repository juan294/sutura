import { describe, expect, it } from 'vitest';

import { DEFAULT_MODELS } from '../config.js';
import { DEFAULT_ROUTING_PROFILE_ID } from '../llm/router.js';
import { REPLAY_BUNDLE_SCHEMA_VERSION, type ReplayBundle } from './bundle.js';
import { createCompleteReplayBundleForTest } from './complete-bundle.test-helper.js';
import { replayBundle } from './replay-orchestrate.js';

const SHA = 'a'.repeat(40);

function baseBundle(): ReplayBundle {
  return {
    schemaVersion: REPLAY_BUNDLE_SCHEMA_VERSION,
    runId: '77',
    repo: 'acme/widget',
    actionSha: SHA,
    capturedAt: '2026-08-30T10:00:00.000Z',
    github: [],
    repository: [],
    executor: [],
    http: [],
    configuration: {
      triageN: 1,
      raceK: 1,
      models: DEFAULT_MODELS,
      routingProfileId: DEFAULT_ROUTING_PROFILE_ID,
      maxOps: 10,
    },
    completeness: {
      complete: false,
      overflowedBoundaries: [],
      pendingBoundaries: ['repository'],
    },
  };
}

describe('replayBundle', () => {
  it('rejects a partial bundle before constructing replay dependencies', async () => {
    await expect(replayBundle(baseBundle())).rejects.toThrow(
      'bundle is partial; complete provider, repository, and sandbox recordings are required',
    );
  });

  it('replays every recorded boundary through the real offline orchestration path', async () => {
    const bundle = await createCompleteReplayBundleForTest();

    const result = await replayBundle(bundle);

    expect(bundle.completeness.complete).toBe(true);
    expect(new Set(bundle.http.map(({ boundary }) => boundary)))
      .toEqual(new Set(['nebius', 'tavily', 'contree']));
    expect(result.caseFile.outcome).toBe('flaky-no-patch');
    expect(result.caseFile.outcome).toBe(bundle.outcome);
    expect(result.caseFile.diagnosis.grounding).toMatchObject({ skipped: false });
    expect(result.mutations.map(({ method }) => method)).toEqual([
      'createRef',
      'createCheckRun',
      'createCommitComment',
      'deleteRef',
      'updateCommitComment',
      'updateCheckRun',
    ]);
  });
});
