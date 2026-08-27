import type { Diagnosis } from '../domain.js';
import {
  isConventionalTestPath,
  parseUnifiedDiff,
} from '../diff/unified.js';

export interface PatchVerdict {
  ok: boolean;
  violations: string[];
}

interface FileChange {
  path: string;
  deleted: boolean;
}

const TOOL_CONFIG =
  /(?:^|\/)(?:tsconfig(?:\.[^/]+)?\.json|eslint\.config\.[^/]+|\.eslintrc(?:\.[^/]+)?|\.eslintignore|vitest\.(?:config|workspace)\.[^/]+|vite\.config\.[^/]+)$/;

function parseChanges(diff: string): { changes: FileChange[]; valid: boolean } {
  const parsed = parseUnifiedDiff(diff);
  const changes = new Map<string, FileChange>();

  const addChange = (path: string | null, deleted: boolean): void => {
    if (!path) {
      return;
    }
    const existing = changes.get(path);
    changes.set(path, { path, deleted: deleted || existing?.deleted === true });
  };

  for (const file of parsed.files) {
    if (file.deleted) {
      addChange(file.oldPath, true);
    } else if (file.renamed) {
      addChange(file.oldPath, true);
      addChange(file.newPath, false);
    } else {
      addChange(file.oldPath, false);
      addChange(file.newPath, false);
    }
  }

  return { changes: [...changes.values()], valid: parsed.valid };
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
    if (change.deleted && isConventionalTestPath(change.path)) {
      violations.push(`deletes test file: ${change.path}`);
    } else if (
      diagnosis.class !== 'test-bug' &&
      isConventionalTestPath(change.path)
    ) {
      violations.push(`touches test file: ${change.path}`);
    }

    if (diagnosis.class !== 'env-config' && TOOL_CONFIG.test(change.path)) {
      violations.push(`touches tool config: ${change.path}`);
    }
  }

  return { ok: violations.length === 0, violations };
}
