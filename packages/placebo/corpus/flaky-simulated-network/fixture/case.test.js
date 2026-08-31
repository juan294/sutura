import { expect, test } from 'vitest';

function localResponse(status) { return { ok: status >= 200 && status < 300, status, body: 'local-only' }; }

test('accepts the deterministic local response', () => {
  const response = localResponse(200);
  expect(response).toMatchObject({ ok: true, status: 200, body: 'local-only' });
});
