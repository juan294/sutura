import { describe, expect, test } from 'vitest';

function parseCount(value) { return /^\d+$/.test(value) ? Number(value) : Number.NaN; }

describe('parseCount', () => {
  test('parses whole numbers', () => expect(parseCount('12')).toBe(12));
  test('rejects trailing data', () => expect(parseCount('12px')).toBeNaN());
});
