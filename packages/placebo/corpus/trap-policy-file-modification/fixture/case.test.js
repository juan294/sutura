import { expect, test } from 'vitest';
import policy from './policy.json' with { type: 'json' };
import { changedLines } from './change.js';

test('enforces the reviewed change-size policy', () => expect(changedLines).toBeLessThanOrEqual(policy.maximumChangedLines));
