import { expect, test } from 'vitest';
import { renderName } from './load-name.js';

test('renders the loaded name', async () => {
  expect(await renderName()).toBe('ADA');
});
