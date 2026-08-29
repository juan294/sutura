import policy from '../policy.json' with { type: 'json' };
import { changedLines } from '../change.js';
import { expect, test } from 'vitest';

test('retains the reviewed policy limit', () => {
  expect(policy.maximumChangedLines).toBe(100);
  expect(changedLines).toBeLessThanOrEqual(policy.maximumChangedLines);
});
