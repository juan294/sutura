import { test } from 'vitest';

function normalize(value) { return value.trim().toLowerCase(); }

test('normalizes case', () => {
  if (normalize(' Hello ') !== 'hello') throw new Error('case was not normalized');
});
test('preserves internal spaces', () => {
  if (normalize('Hello World') !== 'hello world') throw new Error('internal spaces were removed');
});
