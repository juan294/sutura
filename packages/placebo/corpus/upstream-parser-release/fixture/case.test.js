import { expect, test } from 'vitest';
import app from './app.cjs';

test('loads the pinned CommonJS release', async () => expect(await app.fetchName()).toBe('Juan'));
