import { expect, test } from 'vitest';
import { displayName } from './display-name.js';

test('uses a guest label for no user', () => expect(displayName(null)).toBe('guest'));
