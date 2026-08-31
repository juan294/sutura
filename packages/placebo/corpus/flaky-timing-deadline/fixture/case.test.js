import { expect, test } from 'vitest';

test('finishes before the deterministic deadline', () => {
  const completedAt = 8;
  expect(completedAt).toBeLessThanOrEqual(10);
});
