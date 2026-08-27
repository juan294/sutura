import { expect, test } from 'vitest';
import { calculate } from './calculate.js';

test('loads the local module', () => expect(calculate()).toBe(5));
