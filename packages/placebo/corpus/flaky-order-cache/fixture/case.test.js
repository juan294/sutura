import { beforeEach, expect, test } from 'vitest';

const cache = new Map();
beforeEach(() => cache.clear());
test('stores a value', () => { cache.set('key', 'value'); expect(cache.get('key')).toBe('value'); });
test('starts without cached values', () => expect(cache.size).toBe(0));
