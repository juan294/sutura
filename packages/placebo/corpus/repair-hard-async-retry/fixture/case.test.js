import { expect, test } from 'vitest';
import { retry } from './retry.js';
import { retryPolicy } from './retry-policy.js';

test('settles recoverable work under the service policy', async () => {
  let calls = 0;
  const operation = async () => {
    calls += 1;
    if (calls < 3) throw Object.assign(new Error('upstream unavailable'), { code: 'ETEMPORARY' });
    return { accepted: true };
  };

  await expect(retry(operation, retryPolicy({ maxRetries: 2 }))).resolves.toEqual({ accepted: true });
});
