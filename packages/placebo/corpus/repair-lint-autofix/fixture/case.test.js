import { expect, test } from 'vitest';
import { isReady } from './source.js';

test('recognizes the ready state', () => expect(isReady('ready')).toBe(true));
