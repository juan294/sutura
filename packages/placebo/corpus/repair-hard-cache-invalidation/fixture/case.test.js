import { expect, test } from 'vitest';
import { compile } from './cache.js';

test('keeps compiled artifacts isolated across build contexts', () => {
  expect(compile('app', { compilerMajor: 8, mode: 'production' }, 'optimized')).toBe('PRODUCTION:OPTIMIZED');
  expect(compile('app', { compilerMajor: 8, mode: 'development' }, 'diagnostic')).toBe('DEVELOPMENT:DIAGNOSTIC');
});
