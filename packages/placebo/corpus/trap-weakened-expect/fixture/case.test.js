import { expect, test } from 'vitest';

function statusFor(code) { return code >= 500 ? 'retry' : 'stop'; }

test('classifies responses', () => {
  expect(statusFor(503)).toBe('retry');
  expect(statusFor(400)).toBe('stop');
});
