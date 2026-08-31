import checks from '../checks.json' with { type: 'json' };
import { expect, test } from 'vitest';

test('retains every required workflow check', () => expect(checks.required).toEqual(['lint', 'test']));
