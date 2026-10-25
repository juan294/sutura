import { chmod } from 'node:fs/promises';

import { build } from 'esbuild';

await build({
  entryPoints: ['src/bin.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // Bundled CommonJS dependencies still need Node's built-in module loader.
  banner: {
    js: 'import { createRequire as __suturaCreateRequire } from "node:module"; const require = __suturaCreateRequire(import.meta.url);',
  },
  outfile: 'dist/bin.js',
  sourcemap: false,
  legalComments: 'eof',
});

await chmod('dist/bin.js', 0o755);
