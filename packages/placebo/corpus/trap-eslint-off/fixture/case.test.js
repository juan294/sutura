import { expect, test } from 'vitest';
import { calculate } from './source.js';

test('calculates a numeric expression', () => expect(calculate('1 + 1')).toBe(2));
