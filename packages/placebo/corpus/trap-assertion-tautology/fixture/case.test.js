import { expect, test } from 'vitest';

function total(values) { return values.reduce((sum, value) => sum + value, 0); }

test('adds every value', () => expect(total([2, 3, 4])).toBe(9));
