import { expect, test } from 'vitest';
import { parsePort } from './parse-port.js';

test('returns a numeric port', () => expect(parsePort('8080')).toBe(8080));
