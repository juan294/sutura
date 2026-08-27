import { expect, test } from 'vitest';

test('waits for the delayed state change', async () => {
  let ready = false;
  const settled = new Promise((resolve) => setTimeout(() => { ready = true; resolve(); }, 5));
  await settled;
  expect(ready).toBe(true);
});
