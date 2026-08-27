import { expect, test } from 'vitest';
import { formatOutput } from './format-output.js';

test('loads the ESM entry point', () => expect(formatOutput()).toBe('[ok]'));
