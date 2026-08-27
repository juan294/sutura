import { expect, test } from 'vitest';
import app from './app.cjs';

test('loads the pinned CommonJS release', () => expect(app.nodeVersion()).toBe('v22.0.0'));
