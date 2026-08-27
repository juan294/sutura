import { describe, expect, it } from 'vitest';

import {
  isConventionalTestPath,
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
