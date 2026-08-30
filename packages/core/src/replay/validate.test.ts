import { createHash } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { REPLAY_BUNDLE_SCHEMA_VERSION, type RawBody, type ReplayBundle } from './bundle.js';
import { createCompleteReplayBundleForTest } from './complete-bundle.test-helper.js';
import { parseReplayBundle } from './validate.js';

const PARTIAL = {
  schemaVersion: REPLAY_BUNDLE_SCHEMA_VERSION,
  runId: '33239848825',
  repo: 'juan294/sutura',
  actionSha: 'a'.repeat(40),
  capturedAt: '2026-08-30T00:00:00.000Z',
  github: [], repository: [], executor: [], http: [],
  configuration: {
    triageN: 2, raceK: 3,
    models: { nano: 'nano', super: 'super', ultra: 'ultra' },
    routingProfileId: 'production', maxOps: 40,
  },
  completeness: {
    complete: false,
    overflowedBoundaries: [],
    pendingBoundaries: ['github', 'repository', 'executor', 'nebius', 'tavily', 'contree'],
  },
} satisfies ReplayBundle;

function clone(bundle: ReplayBundle): ReplayBundle {
  return structuredClone(bundle);
}

describe('parseReplayBundle', () => {
  let complete: ReplayBundle;

  beforeAll(async () => {
    complete = await createCompleteReplayBundleForTest();
  });

  it('accepts valid partial and complete bundles', () => {
    expect(parseReplayBundle(PARTIAL)).toEqual(PARTIAL);
    expect(parseReplayBundle(complete)).toEqual(complete);
  });

  it('rejects a complete bundle without an outcome', () => {
    const value = clone(complete);
    delete value.outcome;
    expect(() => parseReplayBundle(value)).toThrow(/outcome/u);
  });

  it.each(['github', 'repository', 'executor', 'nebius', 'tavily', 'contree'] as const)(
    'rejects a complete bundle without the %s stream',
    (boundary) => {
      const value = clone(complete);
      if (boundary === 'github' || boundary === 'repository' || boundary === 'executor') {
        value[boundary] = [];
      } else {
        value.http = value.http.filter((exchange) => exchange.boundary !== boundary);
      }
      expect(() => parseReplayBundle(value)).toThrow(new RegExp(boundary, 'u'));
    },
  );

  it('rejects duplicate sequences in each recorder reservation domain', () => {
    const ports = clone(complete);
    ports.repository[0]!.sequence = ports.github[0]!.sequence;
    expect(() => parseReplayBundle(ports)).toThrow(/duplicate.*port.*sequence/iu);

    const http = clone(complete);
    http.http[1]!.sequence = http.http[0]!.sequence;
    expect(() => parseReplayBundle(http)).toThrow(/duplicate.*http.*sequence/iu);

    const executor = clone(complete);
    executor.executor[1]!.sequence = executor.executor[0]!.sequence;
    expect(() => parseReplayBundle(executor)).toThrow(/duplicate.*executor.*sequence/iu);
  });

  it('rejects unknown GitHub and repository methods', () => {
    const github = clone(complete);
    github.github[0]!.method = 'unknown';
    expect(() => parseReplayBundle(github)).toThrow(/github.*method/iu);

    const repository = clone(complete);
    repository.repository[0]!.method = 'unknown' as 'readPolicyAtSha';
    expect(() => parseReplayBundle(repository)).toThrow(/repository.*method/iu);
  });

  it('rejects malformed method-specific results', () => {
    const github = clone(complete);
    github.github.find(({ method }) => method === 'getWorkflowRun')!.result = null;
    expect(() => parseReplayBundle(github)).toThrow(/getWorkflowRun.*result/iu);

    const repository = clone(complete);
    repository.repository.find(({ method }) => method === 'checkoutHead')!.result = '/tmp/live';
    expect(() => parseReplayBundle(repository)).toThrow(/checkoutHead.*result/iu);

    const executor = clone(complete);
    executor.executor.find(({ method }) => method === 'run')!.result = { exitCode: 'one' };
    expect(() => parseReplayBundle(executor)).toThrow(/executor.*result/iu);
  });

  it('rejects exact truncation markers in a complete bundle', () => {
    const value = clone(complete);
    value.http[0]!.response = {
      status: 200,
      headers: {},
      body: { truncated: true, bytes: 9, sha256: 'b'.repeat(64) },
    };
    expect(() => parseReplayBundle(value)).toThrow(/truncated/iu);
  });

  it('verifies raw body base64, byte count, and SHA-256', () => {
    const validBytes = Buffer.from('{"ok":true}', 'utf8');
    const valid: RawBody = {
      raw: true,
      encoding: 'base64',
      data: validBytes.toString('base64'),
      bytes: validBytes.byteLength,
      sha256: createHash('sha256').update(validBytes).digest('hex'),
    };
    const request = (body: RawBody): ReplayBundle => ({
      ...clone(PARTIAL),
      http: [{
        boundary: 'nebius',
        sequence: 1,
        request: { method: 'POST', url: 'https://example.test', headers: {}, body },
        response: { status: 200, headers: {}, body: '{}' },
        latencyMs: 0,
      }],
    });

    expect(parseReplayBundle(request(valid))).toBeDefined();
    expect(() => parseReplayBundle(request({ ...valid, data: 'AA=A' }))).toThrow(/base64/iu);
    expect(() => parseReplayBundle(request({ ...valid, bytes: valid.bytes + 1 }))).toThrow(/bytes/iu);
    expect(() => parseReplayBundle(request({ ...valid, sha256: '0'.repeat(64) }))).toThrow(/sha256/iu);
  });

  it('rejects unknown schema versions and malformed records', () => {
    expect(() => parseReplayBundle({ ...PARTIAL, schemaVersion: 'future' }))
      .toThrow(/schemaVersion/u);
    expect(() => parseReplayBundle({ ...PARTIAL, github: [{ sequence: 0 }] }))
      .toThrow(/github/u);
  });
});
