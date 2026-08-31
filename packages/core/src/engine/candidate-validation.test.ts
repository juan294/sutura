import { describe, expect, it } from 'vitest';

import type { Diagnosis } from '../domain.js';
import { createDefaultRepositoryPolicy } from '../policy/load.js';
import { validateCandidateDiff } from './candidate-validation.js';

const diagnosis: Diagnosis = {
  class: 'test-assertion', confidence: 1, signals: [], failingCmd: 'pnpm test', errorExcerpt: 'failed',
};
const diff = [
  'diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts',
  '@@ -1 +1 @@', '-export const a = 1;', '+export const a = 2;', '',
].join('\n');

describe('validateCandidateDiff', () => {
  it('applies built-in and repository policy to the complete candidate', () => {
    expect(validateCandidateDiff(diff, diagnosis, createDefaultRepositoryPolicy())).toMatchObject({
      ok: true, changedFiles: ['src/a.ts'],
    });
    expect(validateCandidateDiff(diff, diagnosis, {
      ...createDefaultRepositoryPolicy(), protectedPaths: ['src/**'],
    })).toMatchObject({ ok: false, violations: ['touches protected path: src/a.ts'] });
  });

  it('enforces the lower run diff limit', () => {
    expect(validateCandidateDiff(diff, diagnosis, createDefaultRepositoryPolicy(), 10))
      .toMatchObject({ ok: false, violations: [expect.stringContaining('run permits at most 10')] });
  });
});
