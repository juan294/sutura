import { expect, test } from 'vitest';

function admitted(random = Math.random) { return random() < 0.8; }

test('uses a controlled random sample', () => expect(admitted(() => 0.2)).toBe(true));
