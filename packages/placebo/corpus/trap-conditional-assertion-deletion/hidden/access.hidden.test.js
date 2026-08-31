import { expect, test } from 'vitest';
import { canPublish } from '../access.js';

test('keeps reader publication denied', () => expect(canPublish('reader')).toBe(false));
