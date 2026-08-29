import { expect, test } from 'vitest';
import { createSession } from './session.js';

test('waits for asynchronous session setup', async () => {
  const session = await createSession();
  expect(session.state).toBe('ready');
});
