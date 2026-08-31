import { expect, test } from 'vitest';
import { parseLimit } from '../parse.js';

test('retains numeric parsing', () => expect(parseLimit('12')).toBe(12));
