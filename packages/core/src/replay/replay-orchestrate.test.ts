import { describe, expect, it } from 'vitest';

import { capturedDogfoodReplayBundle } from '../__fixtures__/captured/live-dogfood-replay.test-helper.js';
import { DEFAULT_MODELS } from '../config.js';
import { DEFAULT_ROUTING_PROFILE_ID } from '../llm/router.js';
import { REPLAY_BUNDLE_SCHEMA_VERSION, type ReplayBundle } from './bundle.js';
import { createCompleteReplayBundleForTest } from './complete-bundle.test-helper.js';
import { ReplayMismatchError } from './replay-fetch.js';
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

  it('replays live run 33321172589: source-limit gave-up with seven search nodes', async () => {
    const bundle = await capturedDogfoodReplayBundle();

    const result = await replayBundle(bundle);

    expect(result.caseFile).toMatchObject({
      runId: '33321106629',
      outcome: 'gave-up',
      diagnosis: { class: 'test-assertion' },
    });
    expect(result.caseFile.search).toHaveLength(7);
    expect(result.caseFile.stages.filter(({ stage }) => stage === 'search').at(-1)?.note)
      .toBe('invalid failure: Repair proposal must be valid JSON');
    expect(result.caseFile.outcome).toBe(bundle.outcome);
  });

  it.each(['github', 'repository', 'executor', 'nebius', 'tavily'] as const)(
    'fails closed when a recorded %s tail is not consumed',
    async (boundary) => {
      const bundle = await createCompleteReplayBundleForTest();
      if (boundary === 'github' || boundary === 'repository') {
        const sequence = Math.max(
          ...bundle.github.map((call) => call.sequence),
          ...bundle.repository.map((call) => call.sequence),
        ) + 1;
        const calls = bundle[boundary];
        calls.push({ ...structuredClone(calls.at(-1)!), sequence } as never);
      } else if (boundary === 'executor') {
        const sequence = Math.max(...bundle.executor.map((call) => call.sequence)) + 1;
        bundle.executor.push({ ...structuredClone(bundle.executor.at(-1)!), sequence });
      } else {
        const sequence = Math.max(...bundle.http.map((exchange) => exchange.sequence)) + 1;
        const exchange = bundle.http.findLast((item) => item.boundary === boundary)!;
        bundle.http.push({ ...structuredClone(exchange), sequence });
      }

      await expect(replayBundle(bundle)).rejects.toBeInstanceOf(ReplayMismatchError);
    },
  );

  it('fails closed when shared port boundaries are reordered', async () => {
    const bundle = await createCompleteReplayBundleForTest();
    const github = bundle.github[0]!;
    const repository = bundle.repository[0]!;
    [github.sequence, repository.sequence] = [repository.sequence, github.sequence];

    await expect(replayBundle(bundle)).rejects.toBeInstanceOf(ReplayMismatchError);
  });

  it('fails closed when shared provider HTTP boundaries are reordered', async () => {
    const bundle = await createCompleteReplayBundleForTest();
    const nebius = bundle.http.find((exchange) => exchange.boundary === 'nebius')!;
    const tavily = bundle.http.find((exchange) => exchange.boundary === 'tavily')!;
    [nebius.sequence, tavily.sequence] = [tavily.sequence, nebius.sequence];

    await expect(replayBundle(bundle)).rejects.toBeInstanceOf(ReplayMismatchError);
  });

  it('does not require diagnostic ConTree HTTP records to be consumed', async () => {
    const bundle = await createCompleteReplayBundleForTest();
    const sequence = Math.max(...bundle.http.map((exchange) => exchange.sequence)) + 1;
    const contree = bundle.http.findLast((exchange) => exchange.boundary === 'contree')!;
    bundle.http.push({ ...structuredClone(contree), sequence });

    await expect(replayBundle(bundle)).resolves.toMatchObject({
      caseFile: { outcome: bundle.outcome },
    });
  });
});
