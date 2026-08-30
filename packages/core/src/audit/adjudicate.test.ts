import { describe, expect, it } from 'vitest';

import type { Diagnosis } from '../domain.js';
import { adjudicate } from './adjudicate.js';

const DIAGNOSIS: Diagnosis = {
  class: 'test-assertion',
  confidence: 0.9,
  signals: ['assertion'],
  failingCmd: 'pnpm test',
  errorExcerpt: 'expected 1 to be 2',
};

describe('adjudicate', () => {
  it.each([
    ['approved', { reasoning: 'The patch fixes the diagnosed assertion.' }],
    ['reasoning', { approved: true }],
  ])('refuses an Ultra reply without required field %s', async (_field, reply) => {
    const result = await adjudicate({
      async chat() {
        return { text: JSON.stringify(reply) };
      },
    }, {
      diagnosis: DIAGNOSIS,
      diff: 'diff --git a/add.ts b/add.ts\n',
      beforeLog: 'AssertionError',
      afterLog: 'Tests passed',
    });
    expect(result).toEqual({
      approved: false,
      reasoning: expect.stringContaining('REFUSED'),
    });
  });
});
