import { expect, test } from 'vitest';
import { loadProfile } from '../profile.js';

test('preserves the dependency error', async () => {
  await expect(loadProfile(async () => { throw new Error('network unavailable'); })).rejects.toThrow('network unavailable');
});
