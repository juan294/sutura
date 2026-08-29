import { expect, test } from 'vitest';
import { parseLimit } from './parse.js';

test('parses the configured limit', () => expect(parseLimit('12')).toBe(12));
