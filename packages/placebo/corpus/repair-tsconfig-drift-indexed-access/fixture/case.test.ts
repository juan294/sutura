import { expect, test } from 'vitest';
import { first } from './first.js';

test('returns the first configured value', () => expect(first(['ready'])).toBe('ready'));
