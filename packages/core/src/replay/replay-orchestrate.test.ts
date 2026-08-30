import { describe, expect, it } from 'vitest';

import { DEFAULT_MODELS } from '../config.js';
import { DEFAULT_ROUTING_PROFILE_ID } from '../llm/router.js';
import { OrchestrationError } from '../orchestrate.js';
import { REPLAY_BUNDLE_SCHEMA_VERSION, type ReplayBundle } from './bundle.js';
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

  it('passes recorded GitHub logs through the real adapter and orchestrator', async () => {
    const bundle = baseBundle();
    bundle.completeness = { complete: true, overflowedBoundaries: [], pendingBoundaries: [] };
    bundle.outcome = 'gave-up';
    bundle.github = [
      {
        sequence: 1,
        method: 'getWorkflowRun',
        args: [77],
        result: {
          id: 77,
          headSha: SHA,
          repository: 'acme/widget',
          event: 'push',
          conclusion: 'failure',
          headBranch: 'main',
          pullRequests: [],
        },
      },
      { sequence: 2, method: 'getRefSha', args: ['heads/main'], result: SHA },
      {
        sequence: 3,
        method: 'listJobsForWorkflowRun',
        args: [77],
        result: [{
          id: 9,
          name: 'test',
          conclusion: 'failure',
          steps: [{
            name: 'Run tests',
            conclusion: 'failure',
            startedAt: '2026-08-30T10:00:00Z',
            completedAt: '2026-08-30T10:00:01Z',
          }],
        }],
      },
      {
        sequence: 4,
        method: 'downloadJobLogs',
        args: [9],
        result: '2026-08-30T10:00:00Z a failure without a command',
      },
    ];
    bundle.repository = [
      { sequence: 5, method: 'readPolicyAtSha', args: ['acme/widget', SHA], result: null },
    ];

    await expect(replayBundle(bundle)).rejects.toEqual(
      new OrchestrationError('Failed-step logs do not contain an observed failing command'),
    );
  });
});
