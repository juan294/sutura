import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { notRunTriageVerdict, type CaseFile, type ReplayBundle } from '@sutura/core';

import type { ReplayArguments } from './args.js';
import {
  MAX_REPLAY_BUNDLE_BYTES,
  replayFromFile,
  type ReplayFileDependencies,
} from './replay.js';

const REQUEST = {
  command: 'replay', bundle: '/tmp/replay.json', format: 'json', runtime: 'python',
} satisfies ReplayArguments;

function caseFile(outcome: CaseFile['outcome'] = 'gave-up'): CaseFile {
  return {
    runId: '33239848825', repo: 'juan294/sutura', runtime: 'python',
    diagnosis: {
      class: 'test-assertion', confidence: 1, signals: [],
      failingCmd: 'pnpm test', errorExcerpt: 'failed',
    },
    triage: notRunTriageVerdict(),
    race: [], outcome,
    cost: { entries: [], totalUsd: () => 0 },
    policy: { baseRef: 'develop', baseSha: 'a'.repeat(40), policySha: 'default' },
    stages: [],
  };
}

function partialBundle(): ReplayBundle {
  return {
    schemaVersion: 'sutura-replay-v1', runId: '33239848825', repo: 'juan294/sutura',
    actionSha: 'a'.repeat(40), capturedAt: '2026-08-30T00:00:00.000Z',
    github: [], repository: [], executor: [], http: [],
    configuration: {
      triageN: 1, raceK: 1,
      models: { nano: 'nano', super: 'super', ultra: 'ultra' },
      routingProfileId: 'test', maxOps: 1,
    },
    completeness: {
      complete: false, overflowedBoundaries: [],
      pendingBoundaries: ['executor', 'nebius', 'repository'],
    },
  };
}

describe('replayFromFile', () => {
  it('validates, replays, and forwards the explicit runtime override', async () => {
    const bundle = { ...partialBundle(), outcome: 'gave-up' } satisfies ReplayBundle;
    const parse = vi.fn(() => bundle);
    const replay = vi.fn(async () => ({ caseFile: caseFile(), mutations: [] }));
    const dependencies = {
      readFile: vi.fn(async () => Buffer.from('{}')),
      parseReplayBundle: parse,
      replayBundle: replay,
    } satisfies ReplayFileDependencies;

    await expect(replayFromFile(REQUEST, dependencies)).resolves.toMatchObject({
      outcome: 'gave-up',
    });
    expect(parse).toHaveBeenCalledWith({});
    expect(replay).toHaveBeenCalledWith(bundle, { runtimeId: 'python' });
  });

  it('rejects files above 16 MiB before parsing or replaying', async () => {
    const parse = vi.fn();
    const replay = vi.fn();
    const dependencies = {
      readFile: vi.fn(async () => Buffer.alloc(MAX_REPLAY_BUNDLE_BYTES + 1)),
      parseReplayBundle: parse,
      replayBundle: replay,
    } satisfies ReplayFileDependencies;

    await expect(replayFromFile(REQUEST, dependencies)).rejects.toThrow(/16 MiB/u);
    expect(parse).not.toHaveBeenCalled();
    expect(replay).not.toHaveBeenCalled();
  });

  it('rejects an oversized on-disk bundle before reading its JSON', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-large-replay-'));
    const bundlePath = join(directory, 'bundle.json');
    try {
      await writeFile(bundlePath, Buffer.alloc(MAX_REPLAY_BUNDLE_BYTES + 1));
      await expect(replayFromFile({
        command: 'replay', bundle: bundlePath, format: 'json',
      })).rejects.toThrow(/16 MiB/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fails a partial bundle before any network work', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-partial-replay-'));
    const bundlePath = join(directory, 'bundle.json');
    const network = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', network);
    try {
      await writeFile(bundlePath, JSON.stringify(partialBundle()));
      await expect(replayFromFile({
        command: 'replay', bundle: bundlePath, format: 'json',
      })).rejects.toThrow(
        'bundle is partial; complete provider, repository, and sandbox recordings are required',
      );
      expect(network).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('names both outcomes when replay does not match the recording', async () => {
    const bundle = { ...partialBundle(), outcome: 'gave-up' } satisfies ReplayBundle;
    await expect(replayFromFile(REQUEST, {
      readFile: vi.fn(async () => Buffer.from('{}')),
      parseReplayBundle: vi.fn(() => bundle),
      replayBundle: vi.fn(async () => ({ caseFile: caseFile('fixed'), mutations: [] })),
    })).rejects.toThrow('Replay outcome mismatch: recorded gave-up, replayed fixed');
  });
});
