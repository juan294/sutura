import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { ReplayBundle } from './bundle.js';
import { replayBundle } from './replay-orchestrate.js';

// Live Case Lab python-repair smoke on v0.3.7 (sutura-demo run 37099476028,
// failed CI run 37099513192, 2026-10-03). search-002 and search-003 both
// passed their tests; search-002's result came first live, so it took the
// recovery audit and was published, and search-003 ended verification-refused.
// Served from memory, search-003's result used to resolve first, the replay
// audited the wrong branch and reported only a later port mismatch.
const BUNDLE = JSON.parse(readFileSync(
  new URL('../__fixtures__/case-lab/live-37099513192-python-repair-replay.json', import.meta.url),
  'utf8',
)) as ReplayBundle;

describe('a live Case Lab bundle whose search race had two passing branches', () => {
  it('replays to the live outcome with the live winner', async () => {
    const { caseFile, mutations } = await replayBundle(BUNDLE, { runtimeId: 'python' });
    const terminals = Object.fromEntries((caseFile.search ?? []).map(({ nodeId, terminalReason }) => [nodeId, terminalReason]));

    expect(caseFile.outcome).toBe('fixed');
    expect(terminals).toMatchObject({
      'search-002': 'passed',
      'search-003': 'verification-refused',
    });
    expect(mutations.map(({ method }) => method)).toContain('createPullRequest');
  }, 60_000);
});
