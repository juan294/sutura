import { expect, test } from 'vitest';
import { loadProfile } from './profile.js';

test('propagates dependency failures', async () => {
  await expect(loadProfile(async () => { throw new Error('network unavailable'); })).rejects.toThrow('network unavailable');
});
