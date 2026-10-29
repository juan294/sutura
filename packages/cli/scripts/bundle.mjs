import { chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../../', import.meta.url));
function cleanEngineSha() {
 try {
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 15_000 }).trim();
  // Product changes invalidate engine identity; reports and generated bundles do not.
  const inputs = ['packages/core/src', 'packages/core/package.json', 'packages/core/tsconfig.json', 'packages/cli/src', 'packages/cli/scripts', 'packages/cli/package.json', 'packages/cli/tsconfig.json', 'packages/evaluation/src', 'packages/evaluation/package.json', 'packages/evaluation/tsconfig.json', 'scripts/verification-packet-spend.mjs', 'scripts/live-process-lock.mjs', 'pnpm-lock.yaml', 'package.json', 'tsconfig.json'];
  const candidate = git(['rev-parse', 'HEAD']);
  if (/^[a-f0-9]{40}$/u.test(candidate) && !git(['status', '--porcelain', '--untracked-files=all', '--', ...inputs])) return candidate;
 } catch { /* Unknown or dirty builds cannot authorize long verification. */ }
 return null;
}
const engineSha = cleanEngineSha();

await build({
  entryPoints: ['src/bin.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // Bundle the named engine's source, never stale generated workspace packages.
  alias: {
    '@sutura/core': fileURLToPath(new URL('../../core/src/index.ts', import.meta.url)),
    '@sutura/evaluation': fileURLToPath(new URL('../../evaluation/src/index.ts', import.meta.url)),
  },
  // Bundled CommonJS dependencies still need Node's built-in module loader.
  banner: {
    js: 'import { createRequire as __suturaCreateRequire } from "node:module"; const require = __suturaCreateRequire(import.meta.url);',
  },
  outfile: 'dist/bin.js',
  sourcemap: false,
  legalComments: 'eof',
  define: { __SUTURA_ENGINE_SHA__: JSON.stringify(engineSha) },
});

if (engineSha !== null && cleanEngineSha() !== engineSha) throw new Error('Engine source changed during bundling; discard this build and rebuild the exact clean candidate');

await chmod('dist/bin.js', 0o755);
