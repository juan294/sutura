import { shellQuote } from '../engine/shell.js';
import type { DependencyPreparation, RuntimeAdapter, RuntimeEvidence } from './types.js';

export const NODE_IMAGE_REF = 'node:22';

const COREPACK_PACKAGE_MANAGER_COMMAND = /(?:^|[\s;&|()])(?:pnpm|yarn)(?=$|[\s;&|()<>])/u;
const PACKAGE_BINARY_COMMAND = /^(?:ava|eslint|jest|mocha|tap|ts-node|tsc|tsx|vite|vitest)(?=$|[\s;&|])/u;

export function nodePreparationCommand(): string {
  const prepare = [
    'command -v git >/dev/null 2>&1 || { echo "required sandbox tool is unavailable: git" >&2; exit 69; }',
    'if [ -f pnpm-lock.yaml ]; then corepack pnpm install --frozen-lockfile --ignore-scripts;',
    'elif [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then npm ci --ignore-scripts;',
    'elif [ -f yarn.lock ]; then sutura_yarn_version="$(corepack yarn --version)"; case "$sutura_yarn_version" in 0.*|1.*) corepack yarn install --frozen-lockfile --ignore-scripts ;; 2.*|3.*|4.*) corepack yarn install --immutable --mode=skip-build ;; *) echo "unsupported Yarn version: $sutura_yarn_version" >&2; exit 69 ;; esac;',
    'else true; fi',
  ].join('\n');
  return `sh -lc ${shellQuote(prepare)}`;
}

export function normalizeNodeCommand(command: string): string {
  const trimmed = command.trim();
  if (COREPACK_PACKAGE_MANAGER_COMMAND.test(trimmed)) {
    return [
      'sutura_corepack_bin="$(mktemp -d /tmp/sutura-corepack.XXXXXX)"',
      'corepack enable --install-directory "$sutura_corepack_bin"',
      `PATH="$sutura_corepack_bin:$PATH" sh -c ${shellQuote(trimmed)}`,
    ].join(' && ');
  }
  if (!PACKAGE_BINARY_COMMAND.test(trimmed)) return command;
  const nestedCommand = shellQuote(trimmed);
  return [
    `if [ -f pnpm-lock.yaml ]; then corepack pnpm exec sh -c ${nestedCommand};`,
    `elif [ -f yarn.lock ]; then corepack yarn exec sh -c ${nestedCommand};`,
    `else PATH="./node_modules/.bin:$PATH" sh -c ${nestedCommand}; fi`,
  ].join(' ');
}

function detectNode(evidence: RuntimeEvidence): number {
  const paths = new Set(evidence.paths.map((path) => path.replace(/^\.\//u, '')));
  let score = 0;
  if (paths.has('package.json')) score += 2;
  if (['pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock']
    .some((path) => paths.has(path))) score += 2;
  if (evidence.paths.some((path) => /\.[cm]?[jt]sx?$/u.test(path))) score += 1;
  if (/\b(?:node|npm|pnpm|yarn|vitest|jest|eslint|tsc)\b/u.test(evidence.failingCommand)) score += 2;
  return score;
}

async function nodeDependencyInputs(): Promise<DependencyPreparation> {
  return { paths: ['package.json', 'pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock'], command: nodePreparationCommand() };
}

export const NODE_RUNTIME: RuntimeAdapter = Object.freeze({
  id: 'node',
  imageRef: NODE_IMAGE_REF,
  requiredTools: Object.freeze(['node', 'git', 'tar']),
  detect: detectNode,
  dependencyInputs: nodeDependencyInputs,
  preparationCommand: nodePreparationCommand(),
  normalizeCommand: normalizeNodeCommand,
  sourceExtensions: Object.freeze(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.json', '.yaml', '.yml', '.toml']),
  policyRules: Object.freeze(['lifecycle-scripts-disabled']),
});
