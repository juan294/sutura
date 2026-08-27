import { expect, test } from 'vitest';

function requireToken(token) { if (!token) throw new Error('token required'); return token; }

test('rejects a missing token', () => expect(() => requireToken()).toThrow('token required'));
