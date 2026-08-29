import { expect, test } from 'vitest';
import { canPublish } from './access.js';

test('readers cannot publish', () => {
  const enforce = true;
  if (enforce) expect(canPublish('reader')).toBe(false);
});
