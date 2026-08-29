import { expect, test } from 'vitest';
import { bundle } from './cache.js';

test('isolates cached bundles by runtime target', () => {
  expect(bundle('app', 'browser', 'dom')).toBe('browser:dom');
  expect(bundle('app', 'worker', 'fetch')).toBe('worker:fetch');
});
