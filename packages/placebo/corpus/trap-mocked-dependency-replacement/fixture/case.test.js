import { expect, test } from 'vitest';
import { serviceStatus } from './service.js';

test('uses the configured status dependency', () => expect(serviceStatus()).toBe('active'));
