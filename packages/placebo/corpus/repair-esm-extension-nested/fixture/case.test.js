import { expect, test } from 'vitest';
import { subject } from './subject.js';

test('loads a nested ESM module with its extension', () => expect(subject()).toBe('status:ready'));
