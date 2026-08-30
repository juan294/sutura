import { describe, expect, it } from 'vitest';

import { capturedFailingRun } from '../__fixtures__/captured/captured-live-run.test-helper.js';
import { GitHubAdapterError } from './adapter.js';

function preFixRunEventGuard(event: string): void {
  if (!new Set(['pull_request', 'workflow_dispatch']).has(event)) {
    throw new GitHubAdapterError('Workflow run metadata does not match the action event');
  }
}

describe('captured GitHub adapter regressions', () => {
  it('replays A1 push metadata as a direct run while the pre-fix guard rejects it', async () => {
    const captured = await capturedFailingRun('A1', '33169026068');
    const metadata = captured.runMetadata.result as { event: string };

    expect(() => preFixRunEventGuard(metadata.event)).toThrow(
      'Workflow run metadata does not match the action event',
    );
    expect(metadata.event).toBe('push');
    expect(captured.run).toMatchObject({
      runId: '33169026068',
      repo: 'juan294/sutura',
      headRef: 'develop',
      baseRef: 'develop',
    });
    expect(captured.run.prNumber).toBeUndefined();
  });

  it('replays A3 with the current command retention and reproduces pre-fix slicing', async () => {
    const captured = await capturedFailingRun('A3', '33239848825');
    const currentLog = captured.run.failedSteps.map(({ log }) => log).join('\n');
    const preFixLog = currentLog.split(/\r?\n/u).slice(1).join('\n');

    expect(currentLog).toContain('##[group]Run pnpm run test');
    expect(currentLog).toContain('Hook timed out in 10000ms');
    expect(preFixLog).not.toContain('##[group]Run pnpm run test');
    expect(preFixLog).toContain('Hook timed out in 10000ms');
  });
});
