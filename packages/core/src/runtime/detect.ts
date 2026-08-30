import { NODE_RUNTIME } from './node.js';
import { PYTHON_RUNTIME } from './python.js';
import type { RuntimeAdapter, RuntimeEvidence } from './types.js';
import { lstat, readdir, realpath } from 'node:fs/promises';
import type { Dirent, Stats } from 'node:fs';
import { join, sep } from 'node:path';

export interface RuntimeEvidenceFileSystem {
  lstat(path: string): Promise<Stats>;
  readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  realpath(path: string): Promise<string>;
}

const RUNTIME_EVIDENCE_FILE_SYSTEM: RuntimeEvidenceFileSystem = {
  lstat: async (path) => lstat(path),
  readdir: async (path, options) => readdir(path, options),
  realpath: async (path) => realpath(path),
};

const RUNTIME_BY_ID = Object.freeze({ node: NODE_RUNTIME, python: PYTHON_RUNTIME });
const RUNTIMES = Object.freeze(Object.values(RUNTIME_BY_ID));

export class RuntimeDetectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeDetectionError';
  }
}

export function runtimeById(id: RuntimeAdapter['id']): RuntimeAdapter {
  return RUNTIME_BY_ID[id];
}

export function detectRuntime(evidence: RuntimeEvidence): RuntimeAdapter {
  if (evidence.configuredRuntime !== undefined) return runtimeById(evidence.configuredRuntime);
  const scores = RUNTIMES.map((runtime) => ({ runtime, score: runtime.detect(evidence) }));
  const best = Math.max(...scores.map(({ score }) => score));
  const selected = scores.filter(({ score }) => score === best);
  if (best === 0) {
    throw new RuntimeDetectionError('Runtime could not be detected; set runtime in .sutura.json');
  }
  if (selected.length !== 1) {
    throw new RuntimeDetectionError('Runtime evidence is ambiguous; set .sutura.json runtime to "node" or "python"');
  }
  return selected[0]!.runtime;
}

export const MAX_RUNTIME_EVIDENCE_ENTRIES = 500;
const MAX_EVIDENCE_DEPTH = 4;
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', '.venv', 'venv', 'dist', 'build']);

export async function runtimeEvidencePaths(
  caseDir: string,
  overrides: Partial<RuntimeEvidenceFileSystem> = {},
): Promise<string[]> {
  const fileSystem = { ...RUNTIME_EVIDENCE_FILE_SYSTEM, ...overrides };
  const root = await fileSystem.realpath(caseDir);
  const paths: string[] = [];
  const directories: Array<{ relative: string; depth: number }> = [{ relative: '', depth: 0 }];
  let visitedEntries = 0;
  for (let index = 0; index < directories.length; index += 1) {
    const current = directories[index]!;
    const directory = join(root, current.relative);
    const metadata = await fileSystem.lstat(directory);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new RuntimeDetectionError('Runtime evidence directory changed during bounded detection');
    }
    const canonical = await fileSystem.realpath(directory);
    if (canonical !== root && !canonical.startsWith(`${root}${sep}`)) {
      throw new RuntimeDetectionError('Runtime evidence directory escapes the repository');
    }
    const entries = await fileSystem.readdir(canonical, { withFileTypes: true });
    visitedEntries += entries.length;
    if (visitedEntries > MAX_RUNTIME_EVIDENCE_ENTRIES) {
      throw new RuntimeDetectionError(
        `Runtime evidence exceeds ${MAX_RUNTIME_EVIDENCE_ENTRIES} entries; set runtime in .sutura.json`,
      );
    }
    for (const entry of entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      const metadata = await fileSystem.lstat(join(root, relative));
      if (metadata.isSymbolicLink()) continue;
      if (metadata.isFile()) paths.push(relative);
      else if (
        metadata.isDirectory() &&
        current.depth < MAX_EVIDENCE_DEPTH &&
        !SKIPPED_DIRECTORIES.has(entry.name)
      ) directories.push({ relative, depth: current.depth + 1 });
    }
  }
  return paths;
}

export async function detectRuntimeAtPath(
  caseDir: string,
  failingCommand: string,
  configuredRuntime?: RuntimeAdapter['id'],
  failedLog?: string,
): Promise<RuntimeAdapter> {
  if (configuredRuntime !== undefined) return runtimeById(configuredRuntime);
  return detectRuntime({
    paths: await runtimeEvidencePaths(caseDir),
    failingCommand,
    ...(failedLog === undefined ? {} : { failedLog }),
  });
}
