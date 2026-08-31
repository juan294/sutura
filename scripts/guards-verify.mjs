#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

const MARKER = 'guards-verify: not-a-guard';
const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOTS = ['packages/action/src', 'packages/core/src'];

const ACTION_SCOPE = new Set([
  'packages/core/src/github/adapter.ts',
  'packages/action/src/github.ts',
  'packages/action/src/octokit.ts',
  'packages/action/src/repository.ts',
]);
const ORCHESTRATION_SCOPE = new Set([
  'packages/core/src/orchestrate.ts',
  'packages/core/src/heal.ts',
  'packages/core/src/source-window.ts',
]);
const PROVIDER_SCOPE = new Set([
  'packages/core/src/llm/nebius.ts',
  'packages/core/src/llm/json.ts',
  'packages/core/src/llm/token-factory.ts',
  'packages/core/src/llm/router.ts',
  'packages/core/src/llm/cost.ts',
  'packages/core/src/llm/provider-contract-canary.ts',
  'packages/core/src/diagnose/tavily.ts',
  'packages/core/src/executor/contree.ts',
  'packages/core/src/executor/memory.ts',
  'packages/core/src/executor/live-diagnostics.ts',
]);
const PHASE_3C_EXCLUSIONS = new Set([
  ...ACTION_SCOPE,
  ...ORCHESTRATION_SCOPE,
  ...PROVIDER_SCOPE,
]);

function portable(path) {
  return path.split(sep).join('/');
}

function excludedSource(path) {
  const normalized = portable(path);
  return !normalized.endsWith('.ts') || normalized.endsWith('.d.ts') ||
    /(?:^|\/)(?:__fixtures__|__tests__|test|tests|testing)(?:\/|$)/u.test(normalized) ||
    /(?:\.test|\.spec|\.live\.test|\.test-helper)\.ts$/u.test(normalized);
}

async function sourceFiles(root) {
  const files = [];
  for (const sourceRoot of SOURCE_ROOTS) {
    const absoluteRoot = resolve(root, sourceRoot);
    let entries;
    try {
      entries = await readdir(absoluteRoot, { recursive: true, withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const absolute = resolve(entry.parentPath, entry.name);
      const file = portable(relative(root, absolute));
      if (!excludedSource(file)) files.push({ absolute, file });
    }
  }
  return files.toSorted((left, right) => left.file.localeCompare(right.file));
}

function markerApplies(lines, line) {
  const current = lines[line - 1] ?? '';
  if (current.includes(MARKER)) return true;
  for (let previous = line - 2; previous >= 0; previous -= 1) {
    const text = lines[previous] ?? '';
    if (text.trim().length === 0) continue;
    return text.includes(MARKER);
  }
  return false;
}

function guardCall(node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return undefined;
  const owner = node.expression.expression;
  const method = node.expression.name.text;
  if (ts.isIdentifier(owner) && owner.text === 'process' && method === 'exit') return 'process.exit';
  if (ts.isIdentifier(owner) && owner.text === 'core' && method === 'setFailed') return 'core.setFailed';
  return undefined;
}

function guardsInSource(file, source) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lines = source.split(/\r?\n/u);
  const guards = [];
  const visit = (node) => {
    const kind = ts.isThrowStatement(node) && ts.isNewExpression(node.expression)
      ? 'throw'
      : guardCall(node);
    if (kind) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      if (!markerApplies(lines, line)) guards.push({ file, line, kind });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return guards;
}

function inScope(file, scope) {
  if (scope === 'all') return true;
  if (scope === 'action') return ACTION_SCOPE.has(file);
  if (scope === 'orchestration') return ORCHESTRATION_SCOPE.has(file);
  if (scope === 'provider') return PROVIDER_SCOPE.has(file);
  if (scope === 'phase-3c') return !PHASE_3C_EXCLUSIONS.has(file);
  throw new Error(`Unknown guard scope: ${scope}`);
}

function scopes(value) {
  const selected = (value ?? 'all').split(',').map((item) => item.trim()).filter(Boolean);
  if (selected.includes('all') && selected.length > 1) {
    throw new Error('Guard scope all cannot be combined with another scope');
  }
  return selected;
}

export async function scanProductGuards({ root = SCRIPT_ROOT, scope = 'all' } = {}) {
  const selected = scopes(scope);
  const guards = [];
  for (const { absolute, file } of await sourceFiles(root)) {
    if (!selected.some((item) => inScope(file, item))) continue;
    guards.push(...guardsInSource(file, await readFile(absolute, 'utf8')));
  }
  const unique = new Map();
  for (const guard of guards) unique.set(`${guard.file}:${guard.line}`, guard);
  return [...unique.values()].toSorted((left, right) =>
    left.file.localeCompare(right.file) || left.line - right.line);
}

function coverageFilePath(root, value) {
  if (value.startsWith('file:')) return portable(relative(root, fileURLToPath(value)));
  const absolute = isAbsolute(value) ? value : resolve(root, value);
  return portable(relative(root, absolute));
}

export function uncoveredGuards(guards, reports, root = SCRIPT_ROOT) {
  const coverage = new Map();
  for (const report of reports) {
    for (const [key, entry] of Object.entries(report)) {
      const file = coverageFilePath(root, typeof entry?.path === 'string' ? entry.path : key);
      coverage.set(file, entry);
    }
  }
  return guards.filter(({ file, line }) => {
    const entry = coverage.get(file);
    if (!entry || typeof entry.statementMap !== 'object' || entry.statementMap === null ||
        typeof entry.s !== 'object' || entry.s === null) return true;
    const covering = Object.entries(entry.statementMap)
      .filter(([, statement]) => statement?.start?.line <= line && statement?.end?.line >= line)
      .map(([id]) => entry.s[id]);
    return covering.length === 0 || covering.every((hits) => typeof hits !== 'number' || hits === 0);
  });
}

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function parseArguments(arguments_) {
  const options = { root: SCRIPT_ROOT, scopes: [], coverageFiles: [], scanOnly: false, list: false };
  for (let index = 0; index < arguments_.length; index += 1) {
    const option = arguments_[index];
    if (option === '--') continue;
    if (option === '--root') options.root = resolve(arguments_[++index] ?? '');
    else if (option === '--scope') options.scopes.push(arguments_[++index] ?? '');
    else if (option === '--coverage-file') options.coverageFiles.push(resolve(arguments_[++index] ?? ''));
    else if (option === '--scan-only') options.scanOnly = true;
    else if (option === '--list') options.list = true;
    else throw new Error(`Unknown guards-verify option: ${option}`);
  }
  return { ...options, scope: options.scopes.length === 0 ? 'all' : options.scopes.join(',') };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const guards = await scanProductGuards({ root: options.root, scope: options.scope });
  if (options.scanOnly) {
    process.stdout.write(`guards: ${guards.length} scanned (scope: ${options.scope})\n`);
    if (options.list) {
      process.stdout.write(guards.map(({ file, line }) => `${file}:${line}`).join('\n') + '\n');
    }
    return;
  }
  const coverageFiles = options.coverageFiles.length > 0
    ? options.coverageFiles
    : [
        resolve(options.root, 'coverage/core/coverage-final.json'),
        resolve(options.root, 'coverage/action/coverage-final.json'),
      ];
  if (options.coverageFiles.length === 0) {
    execFileSync('pnpm', [
      '--filter', '@sutura/core',
      '--filter', '@sutura/action',
      'run', 'test:coverage',
    ], { cwd: options.root, stdio: 'inherit' });
  }
  const reports = await Promise.all(coverageFiles.map(json));
  const unhit = uncoveredGuards(guards, reports, options.root);
  process.stdout.write(`guards: ${guards.length - unhit.length}/${guards.length}\n`);
  if (unhit.length > 0) {
    process.stdout.write(unhit.map(({ file, line }) => `${file}:${line}\n`).join(''));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
