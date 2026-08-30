import { describe, expect, it } from 'vitest';

import type { ReplayBundle } from './bundle.js';
import { ReplayMismatchError } from './replay-fetch.js';
import { replayingGitHubApi } from './replay-github.js';

const BUNDLE = {
  github: [
    { sequence: 1, method: 'getRefSha', args: ['heads/main'], result: 'a'.repeat(40) },
    { sequence: 2, method: 'createIssueComment', args: [7, 'body'], result: { id: 91 } },
    { sequence: 3, method: 'updateIssueComment', args: [91, 'done'], result: null },
  ],
} as ReplayBundle;

describe('replayingGitHubApi', () => {
  it('returns recorded reads and records requested mutations', async () => {
    const replay = replayingGitHubApi(BUNDLE);

    await expect(replay.api.getRefSha('heads/main')).resolves.toBe('a'.repeat(40));
    await expect(replay.api.createIssueComment(7, 'body')).resolves.toEqual({ id: 91 });
    await expect(replay.api.updateIssueComment(91, 'done')).resolves.toBeUndefined();

    expect(replay.mutations).toEqual([
      { sequence: 2, method: 'createIssueComment', args: [7, 'body'] },
      { sequence: 3, method: 'updateIssueComment', args: [91, 'done'] },
    ]);
  });

  it('fails closed at the first different argument', async () => {
    const { api } = replayingGitHubApi(BUNDLE);

    await expect(api.getRefSha('heads/develop')).rejects.toEqual(
      expect.objectContaining<Partial<ReplayMismatchError>>({
        sequence: 1,
        path: '$[0]',
        expected: 'heads/main',
        actual: 'heads/develop',
      }),
    );
  });

  it('replays recorded errors without recording a mutation', async () => {
    const bundle = {
      ...BUNDLE,
      github: [{ sequence: 4, method: 'getCommitSha', args: ['bad'], result: { error: 'missing' } }],
    } as ReplayBundle;
    const replay = replayingGitHubApi(bundle);

    await expect(replay.api.getCommitSha('bad')).rejects.toThrow('missing');
    expect(replay.mutations).toEqual([]);
  });
});
