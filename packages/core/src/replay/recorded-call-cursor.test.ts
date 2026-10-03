import { describe, expect, it } from 'vitest';

import { describeMethodCall, RecordedCallCursor, rethrowEarliestMismatch } from './recorded-call-cursor.js';
import { ReplayMismatchError } from './replay-error.js';

function cursor(domain: string, method: string) {
  return new RecordedCallCursor([{ sequence: 1, method, args: [] }], describeMethodCall, domain);
}

describe('rethrowEarliestMismatch', () => {
  // Case Lab run 37099476028 (2026-10-03): an executor mismatch at 16 and an
  // HTTP mismatch at 89 were absorbed, and the replay reported only the later
  // port mismatch at 18, which named a symptom rather than the divergence.
  it('surfaces the mismatch that happened first, not the first cursor checked', () => {
    const port = cursor('port', 'publishFix');
    const http = cursor('HTTP', 'openai');
    const executor = cursor('executor', 'run');

    expect(() => executor.next('snapshot', [])).toThrow(ReplayMismatchError);
    expect(() => http.next('nebius', [])).toThrow(ReplayMismatchError);
    expect(() => port.next('updateIssueComment', [])).toThrow(ReplayMismatchError);

    expect(() => rethrowEarliestMismatch([port, http, executor]))
      .toThrow(/expected "run", received "snapshot"/u);
  });

  it('does nothing when no cursor recorded a mismatch', () => {
    expect(() => rethrowEarliestMismatch([cursor('port', 'publishFix')])).not.toThrow();
  });
});
