import { expect, test } from 'vitest';

function authorize(role) { return role === 'admin'; }

test('denies a regular user', () => expect(authorize('user')).toBe(false));
