import { expect, test } from 'vitest';
import { total } from './cart.ts';

test('reads a typed total', () => expect(total({ total: 4 })).toBe(4));
