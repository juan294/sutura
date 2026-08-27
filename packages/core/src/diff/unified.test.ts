import { describe, expect, it } from 'vitest';

import {
  isConventionalTestPath,
  normalizeUnifiedDiffHunks,
  parseUnifiedDiff,
} from './unified.js';

describe('parseUnifiedDiff', () => {
  it('models quoted paths, hunks, additions, and removals once', () => {
    const parsed = parseUnifiedDiff(`diff --git "a/src/foo test.test.ts" "b/src/foo test.test.ts"
index 1111111..2222222 100644
--- "a/src/foo test.test.ts"
+++ "b/src/foo test.test.ts"
@@ -1 +1 @@
-expect(value).toBe(1);
+expect(value).toBe(2);
`);

    expect(parsed.valid).toBe(true);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0]).toMatchObject({
      oldPath: 'src/foo test.test.ts',
      newPath: 'src/foo test.test.ts',
      deleted: false,
      renamed: false,
    });
    expect(parsed.files[0]?.hunks[0]).toMatchObject({
      header: '@@ -1 +1 @@',
      additions: ['expect(value).toBe(2);'],
      removals: ['expect(value).toBe(1);'],
    });
  });

  it('models a pure rename as deletion of the old path', () => {
    const parsed = parseUnifiedDiff(`diff --git a/tests/foo.ts b/src/foo.ts
similarity index 100%
rename from tests/foo.ts
rename to src/foo.ts
`);

    expect(parsed).toMatchObject({
      valid: true,
      files: [
        {
          oldPath: 'tests/foo.ts',
          newPath: 'src/foo.ts',
          deleted: false,
          renamed: true,
          hunks: [],
        },
      ],
    });
  });

  it('models /dev/null and a deleted file without losing its old path', () => {
    const parsed = parseUnifiedDiff(`diff --git a/tests/foo.ts b/tests/foo.ts
deleted file mode 100644
--- a/tests/foo.ts
+++ /dev/null
@@ -1 +0,0 @@
-test('works', () => undefined);
`);

    expect(parsed).toMatchObject({
      valid: true,
      files: [
        {
          oldPath: 'tests/foo.ts',
          newPath: null,
          deleted: true,
          renamed: false,
          headerLines: expect.arrayContaining(['deleted file mode 100644']),
        },
      ],
    });
  });

  it.each([
    `diff --git a/src/foo.ts b/src/foo.ts
--- "a/src/foo.ts
+++ b/src/foo.ts
@@ -1 +1 @@
-old
+new
`,
    `diff --git "a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1 +1 @@
-old
+new
`,
    `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
@@ -1 +1 @@
-old
+new
`,
  ])('fails closed for malformed or incomplete headers', (diff) => {
    const parsed = parseUnifiedDiff(diff);

    expect(parsed.valid).toBe(false);
    expect(parsed.errors.length).toBeGreaterThan(0);
  });

  it('fails closed when hunk context lacks its required prefix', () => {
    const parsed = parseUnifiedDiff(`diff --git a/src/page-count.js b/src/page-count.js
--- a/src/page-count.js
+++ b/src/page-count.js
@@ -6,2 +6,2 @@
export function pageCount(items, size) {
-  return Math.floor(items / size) + 1;
+  return Math.ceil(items / size);
}
`);

    expect(parsed.valid).toBe(false);
    expect(parsed.errors).toContain('unrecognized or incomplete file change');
  });

  it('fails closed when numbered hunk counts do not match the body', () => {
    const parsed = parseUnifiedDiff(`diff --git a/src/value.ts b/src/value.ts
--- a/src/value.ts
+++ b/src/value.ts
@@ -1,2 +1,2 @@
-old
+new
`);

    expect(parsed.valid).toBe(false);
    expect(parsed.errors).toContain('unrecognized or incomplete file change');
  });

  it('accepts exact no-newline markers after their hunk body lines', () => {
    const parsed = parseUnifiedDiff(`diff --git a/src/value.ts b/src/value.ts
--- a/src/value.ts
+++ b/src/value.ts
@@ -1 +1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file
`);

    expect(parsed.valid).toBe(true);
  });

  it.each([
    `@@ -0,0 +0,0 @@
\\ No newline at end of file`,
    `@@ -1 +1 @@
-old
\\ No newline at end of file explanatory text
+new`,
    `@@ -1 +1 @@
-old
\\ No newline at end of file
\\ No newline at end of file
+new`,
  ])('fails closed for an orphaned or malformed no-newline marker', (hunk) => {
    const parsed = parseUnifiedDiff(`diff --git a/src/value.ts b/src/value.ts
--- a/src/value.ts
+++ b/src/value.ts
${hunk}
`);

    expect(parsed.valid).toBe(false);
    expect(parsed.errors).toContain('unrecognized or incomplete file change');
  });
});

describe('normalizeUnifiedDiffHunks', () => {
  it('prefixes omitted context markers and derives exact hunk counts', () => {
    const normalized = normalizeUnifiedDiffHunks(`diff --git a/src/page-count.js b/src/page-count.js
--- a/src/page-count.js
+++ b/src/page-count.js
@@ -6,2 +6,2 @@
export function pageCount(items, size) {
-  return Math.floor(items / size) + 1;
+  return Math.ceil(items / size);
}
`);

    expect(normalized).toContain(`@@ -6,3 +6,3 @@
 export function pageCount(items, size) {
-  return Math.floor(items / size) + 1;
+  return Math.ceil(items / size);
 }`);
    expect(parseUnifiedDiff(normalized).valid).toBe(true);
  });

  it('does not rewrite an already valid hunk', () => {
    const diff = `diff --git a/src/value.ts b/src/value.ts
--- a/src/value.ts
+++ b/src/value.ts
@@ -1 +1 @@
-old
+new
`;

    expect(normalizeUnifiedDiffHunks(diff)).toBe(diff);
  });

  it('preserves applicable terminal and inter-file blank separators', () => {
    const diff = `diff --git a/src/one.ts b/src/one.ts
--- a/src/one.ts
+++ b/src/one.ts
@@ -1 +1 @@
-one
+one fixed

diff --git a/src/two.ts b/src/two.ts
--- a/src/two.ts
+++ b/src/two.ts
@@ -1 +1 @@
-two
+two fixed

`;

    expect(normalizeUnifiedDiffHunks(diff)).toBe(diff);
    expect(parseUnifiedDiff(diff)).toMatchObject({ valid: true, files: [{}, {}] });
  });

  it('preserves valid multi-hunk and no-newline forms without a trailing newline', () => {
    const diff = `diff --git a/src/value.ts b/src/value.ts
--- a/src/value.ts
+++ b/src/value.ts
@@ -1 +1 @@
-old
+new
@@ -4 +4 @@
-last old
\\ No newline at end of file
+last new
\\ No newline at end of file`;

    expect(normalizeUnifiedDiffHunks(diff)).toBe(diff);
    expect(parseUnifiedDiff(diff).valid).toBe(true);
  });
});

describe('isConventionalTestPath', () => {
  it.each([
    'src/foo.test.ts',
    'src/foo.spec.tsx',
    'tests/foo.ts',
    '__tests__/foo.ts',
    'e2e/checkout.ts',
    'cypress/checkout.cy.ts',
  ])('recognizes %s', (path) => {
    expect(isConventionalTestPath(path)).toBe(true);
  });

  it('does not classify a production source file as a test', () => {
    expect(isConventionalTestPath('src/contest.ts')).toBe(false);
  });
});
