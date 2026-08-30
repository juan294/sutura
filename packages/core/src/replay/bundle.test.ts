import { describe, expect, it } from 'vitest';

import {
  REPLAY_BUNDLE_SCHEMA_VERSION,
  ReplayRecorder,
} from './bundle.js';

const CONFIG = {
  triageN: 5,
  raceK: 3,
  models: { nano: 'nano', super: 'super', ultra: 'ultra' },
  routingProfileId: 'production-baseline-v1',
  maxOps: 40,
} as const;

describe('ReplayRecorder', () => {
  it('bounds bodies, strips sensitive headers, and redacts injected secrets', () => {
    const recorder = new ReplayRecorder(
      '77001',
      'acme/widget',
      'a'.repeat(40),
      CONFIG,
      ['nb-secret'],
    );
    recorder.recordHttp({
      boundary: 'nebius',
      request: {
        method: 'POST',
        url: 'https://example.test/chat',
        headers: {
          Authorization: 'Bearer nb-secret',
          'Content-Type': 'application/json',
          Cookie: 'session=nb-secret',
          'X-Api-Key': 'nb-secret',
        },
        body: `Authorization: Bearer nb-secret\n${'x'.repeat(1_048_576)}`,
      },
      response: {
        status: 200,
        headers: {
          'Set-Cookie': 'session=nb-secret',
          'Content-Type': 'application/json',
        },
        body: '{"token":"nb-secret"}',
      },
      latencyMs: 4,
    });

    const bundle = recorder.finish('fixed');
    const serialized = JSON.stringify(bundle);

    expect(bundle.schemaVersion).toBe(REPLAY_BUNDLE_SCHEMA_VERSION);
    expect(bundle.http[0]?.request.headers).toEqual({
      'content-type': 'application/json',
    });
    expect(bundle.http[0]?.response).toMatchObject({
      headers: { 'content-type': 'application/json' },
    });
    expect(bundle.http[0]?.request.body).toMatchObject({
      truncated: true,
      bytes: expect.any(Number),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(serialized).not.toContain('nb-secret');
    expect(serialized).not.toContain('Authorization: Bearer nb-secret');
    expect(bundle.completeness).toMatchObject({
      complete: false,
      overflowedBoundaries: ['http'],
    });
  });

  it('enforces call bounds without throwing', () => {
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);

    expect(() => {
      for (let index = 0; index < 600; index += 1) {
        recorder.recordHttp({
          boundary: 'tavily',
          request: { method: 'GET', url: `https://example.test/${index}`, headers: {}, body: null },
          response: { status: 200, headers: {}, body: '' },
          latencyMs: 0,
        });
      }
      for (let index = 0; index < 200; index += 1) {
        recorder.recordGitHub({ method: 'getWorkflowRun', args: [index], result: index });
        recorder.recordRepository({ method: 'checkoutHead', args: [index], result: index });
      }
    }).not.toThrow();

    const bundle = recorder.finish('gave-up');
    expect(bundle.http).toHaveLength(512);
    expect(bundle.github.length + bundle.repository.length).toBe(256);
    expect(bundle.http.map(({ sequence }) => sequence)).toEqual(
      Array.from({ length: 512 }, (_, index) => index + 1),
    );
    expect([...bundle.github, ...bundle.repository]
      .map(({ sequence }) => sequence)
      .sort((left, right) => left - right)).toEqual(
      Array.from({ length: 256 }, (_, index) => index + 1),
    );
    expect(bundle.completeness).toEqual({
      complete: false,
      overflowedBoundaries: ['github', 'http', 'repository'],
    });
  });

  it('captures deterministic orchestration configuration and executor calls', () => {
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), {
      triageN: 5,
      raceK: 3,
      repairBudgets: {
        modelTurns: 8,
        toolCalls: 24,
        branches: 12,
        sandboxOperations: 32,
        elapsedTimeSec: 600,
        inferenceCostUsd: 0.25,
        diffBytes: 65_536,
      },
      search: {
        initialBranches: 4,
        beamWidth: 2,
        maximumDepth: 4,
        maximumTotalBranches: 12,
      },
      runtimeId: 'node',
      imageRef: 'node@sha256:abc',
      models: { nano: 'nano', super: 'super', ultra: 'ultra' },
      routingProfileId: 'production-baseline-v1',
      maxOps: 40,
    });
    recorder.recordExecutor({ method: 'importImage', args: ['node:22'], result: 'image-1' });

    expect(recorder.finish('fixed')).toMatchObject({
      configuration: {
        triageN: 5,
        raceK: 3,
        runtimeId: 'node',
        imageRef: 'node@sha256:abc',
        models: { nano: 'nano', super: 'super', ultra: 'ultra' },
        routingProfileId: 'production-baseline-v1',
        maxOps: 40,
      },
      executor: [{ sequence: 1, method: 'importImage', args: ['node:22'], result: 'image-1' }],
    });
  });

  it('marks a reserved but unfinished call as incomplete', () => {
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);

    recorder.reserveHttpSequence();

    expect(recorder.finish('infra-stop').completeness).toEqual({
      complete: false,
      overflowedBoundaries: [],
    });
  });
});
