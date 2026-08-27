import { describe, expect, it } from 'vitest';

import type { Diagnosis } from '../domain.js';
import { vetPatch } from './patch-rules.js';

const sourceDiff = `diff --git a/src/add.ts b/src/add.ts
index 1111111..2222222 100644
--- a/src/add.ts
+++ b/src/add.ts
@@ -1 +1 @@
-export const add = () => 1;
+export const add = () => 2;
`;

function diagnosis(failureClass: Diagnosis['class']): Diagnosis {
  return {
    class: failureClass,
    confidence: 0.9,
    signals: [],
    failingCmd: 'pnpm test',
    errorExcerpt: 'failure',
  };
}

describe('vetPatch', () => {
  it('rejects deletion of a test file even for a test bug', () => {
    const diff = `diff --git a/src/foo.test.ts b/src/foo.test.ts
deleted file mode 100644
index 1111111..0000000
--- a/src/foo.test.ts
+++ /dev/null
@@ -1 +0,0 @@
-throw new Error('expected');
`;

    expect(vetPatch(diff, diagnosis('test-bug'))).toEqual({
      ok: false,
      violations: ['deletes test file: src/foo.test.ts'],
    });
  });

  it.each(['tests/foo.ts', '__tests__/foo.ts', 'e2e/checkout.ts'])(
    'rejects deletion of conventional test path %s',
    (path) => {
      const diff = `diff --git a/${path} b/${path}
deleted file mode 100644
index 1111111..0000000
--- a/${path}
+++ /dev/null
@@ -1 +0,0 @@
-throw new Error('expected');
`;

      expect(vetPatch(diff, diagnosis('test-bug')).violations).toEqual([
        `deletes test file: ${path}`,
      ]);
    },
  );

  it('rejects test edits unless the diagnosis is test-bug', () => {
    const diff = `diff --git a/src/foo.spec.ts b/src/foo.spec.ts
index 1111111..2222222 100644
--- a/src/foo.spec.ts
+++ b/src/foo.spec.ts
@@ -1 +1 @@
-expect(value).toBe(1);
+expect(value).toBe(2);
`;

    expect(vetPatch(diff, diagnosis('test-assertion')).violations).toEqual([
      'touches test file: src/foo.spec.ts',
    ]);
    expect(vetPatch(diff, diagnosis('test-bug'))).toEqual({
      ok: true,
      violations: [],
    });
  });

  it('rejects tool configuration edits unless the diagnosis is env-config', () => {
    const diff = `diff --git a/vitest.config.ts b/vitest.config.ts
index 1111111..2222222 100644
--- a/vitest.config.ts
+++ b/vitest.config.ts
@@ -1 +1 @@
-export default {};
+export default { test: {} };
`;

    expect(vetPatch(diff, diagnosis('test-assertion')).violations).toEqual([
      'touches tool config: vitest.config.ts',
    ]);
    expect(vetPatch(diff, diagnosis('env-config'))).toEqual({
      ok: true,
      violations: [],
    });
  });

  it.each(['.eslintignore', 'vitest.workspace.ts', 'vite.config.ts'])(
    'rejects control-file edit %s outside env-config',
    (path) => {
      const diff = `diff --git a/${path} b/${path}
index 1111111..2222222 100644
--- a/${path}
+++ b/${path}
@@ -1 +1 @@
-src/generated.ts
+src/failing.ts
`;

      expect(vetPatch(diff, diagnosis('build')).violations).toEqual([
        `touches tool config: ${path}`,
      ]);
    },
  );

  it('accepts a source-only diff', () => {
    expect(vetPatch(sourceDiff, diagnosis('test-assertion'))).toEqual({
      ok: true,
      violations: [],
    });
  });

  it('cannot hide a test edit behind a quoted path or a safe source edit', () => {
    const quotedTestDiff = `${sourceDiff}diff --git "a/src/foo test.test.ts" "b/src/foo test.test.ts"
index 1111111..2222222 100644
--- "a/src/foo test.test.ts"
+++ "b/src/foo test.test.ts"
@@ -1 +1 @@
-expect(value).toBe(1);
+expect(value).toBe(2);
`;

    expect(vetPatch(quotedTestDiff, diagnosis('build')).violations).toEqual([
      'touches test file: src/foo test.test.ts',
    ]);
  });

  it('checks both sides of a rename', () => {
    const renameDiff = `diff --git a/src/foo.test.ts b/src/foo.ts
similarity index 100%
rename from src/foo.test.ts
rename to src/foo.ts
`;

    expect(vetPatch(renameDiff, diagnosis('build')).violations).toEqual([
      'deletes test file: src/foo.test.ts',
    ]);
  });

  it('does not let hunk content overwrite protected file headers', () => {
    const spoofedHeaders = `diff --git a/src/foo.test.ts b/src/foo.test.ts
index 1111111..2222222 100644
--- a/src/foo.test.ts
+++ b/src/foo.test.ts
@@ -1 +1 @@
--- a/src/safe.ts
+++ b/src/safe.ts
`;

    expect(vetPatch(spoofedHeaders, diagnosis('build')).violations).toEqual([
      'touches test file: src/foo.test.ts',
    ]);
  });

  it.each([
    {
      label: 'unquoted',
      from: 'src/foo.test.ts',
      to: 'src/foo.ts',
      expected: 'src/foo.test.ts',
    },
    {
      label: 'quoted',
      from: '"src/foo test.test.ts"',
      to: '"src/foo test.ts"',
      expected: 'src/foo test.test.ts',
    },
  ])('treats a $label test-path rename as a test deletion', ({
    from,
    to,
    expected,
  }) => {
    const renameDiff = `diff --git a/src/foo.test.ts b/src/foo.ts
similarity index 100%
rename from ${from}
rename to ${to}
`;

    expect(vetPatch(renameDiff, diagnosis('test-bug')).violations).toEqual([
      `deletes test file: ${expected}`,
    ]);
  });

  it('fails closed when the reply is not a unified diff', () => {
    expect(vetPatch('Looks good to me.', diagnosis('build')).violations).toEqual([
      'patch has no recognized file changes',
    ]);
  });

  it('fails closed when a file change has incomplete headers', () => {
    const incomplete = `diff --git a/src/add.ts b/src/add.ts
--- a/src/add.ts
@@ -1 +1 @@
-export const add = () => 1;
+export const add = () => 2;
`;

    expect(vetPatch(incomplete, diagnosis('build')).violations).toEqual([
      'patch contains an unrecognized or incomplete file change',
    ]);
  });
});
