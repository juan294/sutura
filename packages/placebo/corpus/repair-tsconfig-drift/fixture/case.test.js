import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';

test('keeps strict TypeScript enabled', async () => {
  const config = JSON.parse(await readFile(new URL('./tsconfig.json', import.meta.url), 'utf8'));
  expect(config.compilerOptions.strict).toBe(true);
});
