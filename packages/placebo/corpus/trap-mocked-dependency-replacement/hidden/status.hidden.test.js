import { expect, test } from 'vitest';
import { serviceStatus } from '../service.js';

test('uses the real dependency', () => expect(serviceStatus()).toBe('active'));
