import type { Diagnosis } from '../domain.js';

export interface PatchVerdict {
  ok: boolean;
  violations: string[];
}

interface FileChange {
  path: string;
  deleted: boolean;
}

interface ParsedPath {
  path: string | null;
  valid: boolean;
}

const TEST_FILE =
  /(?:^|\/)(?:(?:__)?tests?(?:__)?|specs?|e2e|cypress)(?:\/|$)|(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$/;
const TOOL_CONFIG =
  /(?:^|\/)(?:tsconfig(?:\.[^/]+)?\.json|eslint\.config\.[^/]+|\.eslintrc(?:\.[^/]+)?|\.eslintignore|vitest\.(?:config|workspace)\.[^/]+|vite\.config\.[^/]+)$/;

function normalizeHeaderPath(value: string): ParsedPath {
  const withoutTimestamp = value.split('\t', 1)[0]?.trim() ?? '';
  if (!withoutTimestamp) {
    return { path: null, valid: false };
  }
  if (withoutTimestamp === '/dev/null') {
    return { path: null, valid: true };
  }

  let decoded = withoutTimestamp;
  if (decoded.startsWith('"')) {
    try {
      const parsed = JSON.parse(decoded) as unknown;
      if (typeof parsed !== 'string') {
        return { path: null, valid: false };
      }
      decoded = parsed;
    } catch {
      return { path: null, valid: false };
    }
  }

  return { path: decoded.replace(/^[ab]\//, ''), valid: true };
}

function parseChanges(diff: string): { changes: FileChange[]; valid: boolean } {
  const changes = new Map<string, FileChange>();
  let oldPath: string | null = null;
  let newPath: string | null = null;
  let deletedMode = false;
  let sawOldPath = false;
  let sawNewPath = false;
  let fileHeaderOpen = false;
  let valid = true;

  const addChange = (path: string | null, deleted: boolean): void => {
    if (!path) {
      return;
    }
    const existing = changes.get(path);
    changes.set(path, { path, deleted: deleted || existing?.deleted === true });
  };

  const flush = (): void => {
    if (sawOldPath !== sawNewPath) {
      valid = false;
    }
    const deleted = deletedMode || (sawNewPath && newPath === null);
    const renamed =
      sawOldPath && sawNewPath && oldPath !== null && oldPath !== newPath;
    if (deleted) {
      addChange(oldPath, true);
    } else if (renamed) {
      addChange(oldPath, true);
      addChange(newPath, false);
    } else {
      addChange(oldPath, false);
      addChange(newPath, false);
    }
    oldPath = null;
    newPath = null;
    deletedMode = false;
    sawOldPath = false;
    sawNewPath = false;
  };

  const assignPath = (side: 'old' | 'new', value: string): void => {
    const parsed = normalizeHeaderPath(value);
    valid &&= parsed.valid;
    if (side === 'old') {
      oldPath = parsed.path;
      sawOldPath = true;
    } else {
      newPath = parsed.path;
      sawNewPath = true;
    }
  };

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      flush();
      fileHeaderOpen = true;
      continue;
    }
    if (line.startsWith('@@ ')) {
      fileHeaderOpen = false;
      continue;
    }
    if (!fileHeaderOpen) {
      continue;
    }
    if (line.startsWith('deleted file mode ')) {
      deletedMode = true;
      continue;
    }
    if (line.startsWith('rename from ')) {
      assignPath('old', line.slice('rename from '.length));
      continue;
    }
    if (line.startsWith('rename to ')) {
      assignPath('new', line.slice('rename to '.length));
      continue;
    }
    if (line.startsWith('--- ')) {
      assignPath('old', line.slice(4));
      continue;
    }
    if (line.startsWith('+++ ')) {
      assignPath('new', line.slice(4));
    }
  }
  flush();

  return { changes: [...changes.values()], valid };
}

export function vetPatch(diff: string, diagnosis: Diagnosis): PatchVerdict {
  const parsed = parseChanges(diff);
  if (!parsed.valid) {
    return {
      ok: false,
      violations: ['patch contains an unrecognized or incomplete file change'],
    };
  }
  if (parsed.changes.length === 0) {
    return { ok: false, violations: ['patch has no recognized file changes'] };
  }

  const violations: string[] = [];
  for (const change of parsed.changes) {
    if (change.deleted && TEST_FILE.test(change.path)) {
      violations.push(`deletes test file: ${change.path}`);
    } else if (diagnosis.class !== 'test-bug' && TEST_FILE.test(change.path)) {
      violations.push(`touches test file: ${change.path}`);
    }

    if (diagnosis.class !== 'env-config' && TOOL_CONFIG.test(change.path)) {
      violations.push(`touches tool config: ${change.path}`);
    }
  }

  return { ok: violations.length === 0, violations };
}
