import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { shellQuote } from '../engine/shell.js';
import type { DependencyPreparation, RuntimeAdapter, RuntimeEvidence } from './types.js';

export const NODE_IMAGE_REF = 'node:22';

/** Choose a supported sandbox major from the repository's declared Node version. */
export async function nodeImageRefForRepository(dir: string): Promise<string> {
  let nvmMajor: number | undefined;
  try {
    const path = join(dir, '.nvmrc');
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.size > 64) throw new Error('Invalid .nvmrc');
    const version = (await readFile(path, 'utf8')).trim();
    const match = /^v?(\d+)(?:\.\d+(?:\.\d+)?)?$/u.exec(version);
    if (!match) throw new Error('Unsupported .nvmrc Node version');
    nvmMajor = Number(match[1]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  let engineMajor: number | undefined;
  try {
    const path = join(dir, 'package.json');
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.size > 1_048_576) throw new Error('Invalid package.json');
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && 'engines' in parsed) {
      const engines = parsed.engines;
      if (typeof engines === 'object' && engines !== null && 'node' in engines && typeof engines.node === 'string') {
        const match = /^(?:>=|\^|~)?\s*(22|24)(?:\.\d+)?(?:\.\d+)?(?:\s|$)/u.exec(engines.node);
        if (match) engineMajor = Number(match[1]);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (nvmMajor !== undefined && engineMajor !== undefined && nvmMajor !== engineMajor) {
    throw new Error('Node version declarations conflict between .nvmrc and package.json');
  }
  const major = nvmMajor ?? engineMajor ?? 22;
  if (major !== 22 && major !== 24) throw new Error(`Unsupported sandbox Node major: ${major}`);
  return `node:${major}`;
}

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
