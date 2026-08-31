import { createServer } from 'node:net';
import { expect, test } from 'vitest';

function listen(server, port) { return new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolve)); }

test('lets each worker request a free local port', async () => {
  const first = createServer();
  const second = createServer();
  try {
    await listen(first, 0);
    await listen(second, 0);
    expect(second.address()).not.toBeNull();
  } finally { first.close(); second.close(); }
});
