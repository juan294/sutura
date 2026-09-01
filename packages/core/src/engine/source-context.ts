import { posix } from 'node:path';

import type { RuntimeId } from '../runtime/types.js';
import type { RepairSourceExcerpt } from './repair.js';

const MAX_DEPENDENCY_GROUPS = 24;
const NODE_STATIC_SPECIFIER = /(?:\b(?:import|export)\s(?:[^'"\n]*\bfrom\s)?\s*|\b(?:import|require)\s*\(\s*)['"](?<specifier>\.{1,2}\/[^'"\n]+)['"]/gu;
const PYTHON_RELATIVE_IMPORT = /^\s*from\s+(?<dots>\.+)(?<module>[A-Za-z_][A-Za-z0-9_.]*)?\s+import\s+(?<imports>[A-Za-z_][A-Za-z0-9_]*(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?)*)/gmu;
const SAFE_DEPENDENCY_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_@./-]+$/u;

export interface SourceDependencyGroup {
  sourcePath: string;
  specifier: string;
  candidates: readonly string[];
}

function safeNormalizedPath(path: string): string | undefined {
  const normalized = posix.normalize(path);
  if (
    normalized === '.' ||
    normalized.startsWith('../') ||
    !SAFE_DEPENDENCY_PATH.test(normalized) ||
    normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) return undefined;
  return normalized;
}

export function typescriptSourceVariants(path: string): string[] {
  if (!path.endsWith('.js')) return [];
  const stem = path.slice(0, -3);
  return [`${stem}.ts`, `${stem}.tsx`];
}

function nodeCandidates(sourcePath: string, specifier: string): string[] {
  const resolved = safeNormalizedPath(posix.join(posix.dirname(sourcePath), specifier));
  if (resolved === undefined) return [];
  const extension = posix.extname(resolved);
  const variants = extension
      ? [
        resolved,
        ...typescriptSourceVariants(resolved),
        ...(extension === '.mjs' ? [`${resolved.slice(0, -4)}.mts`] : []),
        ...(extension === '.cjs' ? [`${resolved.slice(0, -4)}.cts`] : []),
      ]
    : [
        ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].map((suffix) => `${resolved}${suffix}`),
        ...['index.ts', 'index.tsx', 'index.mts', 'index.cts', 'index.js', 'index.jsx', 'index.mjs', 'index.cjs']
          .map((name) => `${resolved}/${name}`),
      ];
  return [...new Set(variants)].filter((path) => safeNormalizedPath(path) !== undefined);
}

function pythonCandidates(sourcePath: string, dots: string, moduleName: string): string[] {
  let directory = posix.dirname(sourcePath);
  for (let index = 1; index < dots.length; index += 1) directory = posix.dirname(directory);
  const modulePath = moduleName ? moduleName.replaceAll('.', '/') : '';
  const resolved = safeNormalizedPath(posix.join(directory, modulePath));
  if (resolved === undefined) return [];
  return [...new Set([
    ...(modulePath ? [`${resolved}.py`, `${resolved}.pyi`] : []),
    `${resolved}/__init__.py`,
    `${resolved}/__init__.pyi`,
  ])].filter((path) => safeNormalizedPath(path) !== undefined);
}

function* dependencySpecifiers(
  source: RepairSourceExcerpt,
  runtimeId: RuntimeId,
): Generator<{ specifier: string; candidates: string[] }> {
  if (runtimeId === 'node') {
    for (const match of source.content.matchAll(NODE_STATIC_SPECIFIER)) {
      const specifier = match.groups?.specifier;
      if (specifier !== undefined) yield { specifier, candidates: nodeCandidates(source.path, specifier) };
    }
    return;
  }
  for (const match of source.content.matchAll(PYTHON_RELATIVE_IMPORT)) {
    const dots = match.groups?.dots;
    if (dots === undefined) continue;
    const moduleName = match.groups?.module ?? '';
    if (!moduleName) {
      for (const imported of (match.groups?.imports ?? '').split(',')) {
        const importedName = imported.trim().split(/\s/u)[0] ?? '';
        if (importedName) {
          yield {
            specifier: `${dots}${importedName}`,
            candidates: pythonCandidates(source.path, dots, importedName),
          };
        }
      }
      continue;
    }
    yield {
      specifier: `${dots}${moduleName}`,
      candidates: pythonCandidates(source.path, dots, moduleName),
    };
  }
}

export function sourceDependencyGroups(
  sources: readonly RepairSourceExcerpt[],
  runtimeId: RuntimeId,
  knownPaths: ReadonlySet<string> = new Set(),
): SourceDependencyGroup[] {
  const groups: SourceDependencyGroup[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const dependency of dependencySpecifiers(source, runtimeId)) {
      const key = `${source.path}\0${dependency.specifier}`;
      if (
        dependency.candidates.length === 0 ||
        dependency.candidates.some((path) => knownPaths.has(path)) ||
        seen.has(key)
      ) continue;
      seen.add(key);
      groups.push({
        sourcePath: source.path,
        specifier: dependency.specifier,
        candidates: dependency.candidates,
      });
      if (groups.length >= MAX_DEPENDENCY_GROUPS) return groups;
    }
  }
  return groups;
}
