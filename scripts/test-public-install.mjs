import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { verifyInstall } from './install-test-lib.mjs';

export async function runPublicInstall(dependencies) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  return verifyInstall({ mode: 'public', root, dependencies });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runPublicInstall();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
