import { describe, expect, it } from 'vitest';

import { parseReplayBundle } from './validate.js';
import { REPLAY_BUNDLE_SCHEMA_VERSION, type ReplayBundle } from './bundle.js';

const COMPLETE = {
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
  completeness: { complete: true, overflowedBoundaries: [], pendingBoundaries: [] },
  outcome: 'gave-up',
} satisfies ReplayBundle;

describe('parseReplayBundle', () => {
  it('accepts a valid complete bundle', () => {
    expect(parseReplayBundle(COMPLETE)).toEqual(COMPLETE);
  });

  it('rejects a complete bundle without an outcome', () => {
    const value: ReplayBundle = { ...COMPLETE };
    delete value.outcome;
    expect(() => parseReplayBundle(value)).toThrow(/outcome/u);
  });

  it('rejects unknown schema versions and malformed records', () => {
    expect(() => parseReplayBundle({ ...COMPLETE, schemaVersion: 'future' }))
      .toThrow(/schemaVersion/u);
    expect(() => parseReplayBundle({ ...COMPLETE, github: [{ sequence: 0 }] }))
      .toThrow(/github/u);
  });
});
