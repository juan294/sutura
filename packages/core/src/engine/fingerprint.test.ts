import { describe, expect, it } from 'vitest';

import { diffFingerprint, errorFingerprint, failureSignatureCount } from './fingerprint.js';

describe('search fingerprints', () => {
  it('normalizes line endings and trailing whitespace in equivalent diffs', () => {
    expect(diffFingerprint('diff --git a/a.ts b/a.ts\r\n+fixed   \r\n')).toBe(
      diffFingerprint('diff --git a/a.ts b/a.ts\n+fixed\n'),
    );
  });

  it('removes volatile paths, times, and numbers from failure signatures', () => {
    expect(errorFingerprint('/workspace/a.test.ts:42 failed after 18.2ms')).toBe(
      errorFingerprint('/workspace/a.test.ts:91 failed after 37.8ms'),
    );
  });

  it('keeps distinct errors distinct', () => {
    expect(errorFingerprint('expected true to be false')).not.toBe(
      errorFingerprint('module not found'),
    );
  });

  it('counts unique normalized failure signatures', () => {
    expect(failureSignatureCount('a.test.ts:10 failed\na.test.ts:20 failed\nmodule not found')).toBe(2);
  });
});
