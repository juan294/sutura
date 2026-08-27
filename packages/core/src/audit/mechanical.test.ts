import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import type { GreenwashCheck } from '../domain.js';
import {
  checkAssertionDrop,
  checkDeletedTests,
  checkLoosenedTypes,
  checkPassWithNoTests,
  checkRelaxedConfig,
  checkSkips,
  runMechanicalChecks,
} from './mechanical.js';

const CASES = [
  ['deleted-test', 'deleted-test', "-describe('cart'"],
  ['skipped-test', 'skipped-test', "+describe.skip('cart'"],
  ['weakened-assertion', 'weakened-assertion', '-    expect(total()).toBe(1);'],
  ['loosened-type', 'loosened-type', 'cart as any'],
  ['relaxed-config', 'relaxed-config', "'@typescript-eslint/no-explicit-any': 'off'"],
  ['pass-with-no-tests', 'pass-with-no-tests', '--passWithNoTests'],
] as const satisfies ReadonlyArray<readonly [string, GreenwashCheck, string]>;

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`./__fixtures__/${name}.diff`, import.meta.url), 'utf8');
}

describe('mechanical adversarial checks', () => {
  it.each(CASES)('refuses the %s fixture with exact hunk evidence', async (
    fixtureName,
    expectedCheck,
    offendingLine,
  ) => {
    const diff = await fixture(fixtureName);
    const checks = runMechanicalChecks(diff);
    const failed = checks.filter(({ passed }) => !passed);
    const expectedHunk = diff.slice(diff.indexOf('@@')).trimEnd();

    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ name: expectedCheck, passed: false });
    expect(failed[0]?.evidence?.trimEnd()).toBe(expectedHunk);
    expect(failed[0]?.evidence).toContain(offendingLine);
  });

  it('passes all deterministic checks for an honest source fix', async () => {
    expect(runMechanicalChecks(await fixture('honest-fix'))).toEqual([
      { name: 'deleted-test', passed: true },
      { name: 'skipped-test', passed: true },
      { name: 'pass-with-no-tests', passed: true },
      { name: 'weakened-assertion', passed: true },
      { name: 'loosened-type', passed: true },
      { name: 'relaxed-config', passed: true },
    ]);
  });

  it('detects describe or it removal without deleting the test file', () => {
    const diff = `diff --git a/src/cart.test.ts b/src/cart.test.ts
--- a/src/cart.test.ts
+++ b/src/cart.test.ts
@@ -1,2 +1 @@
-describe('cart', () => {
   it('works', () => undefined);
`;

    expect(checkDeletedTests(diff)).toMatchObject({
      name: 'deleted-test',
      passed: false,
      evidence: expect.stringContaining("-describe('cart'"),
    });
  });

  it.each(['+it.only(', '+test.skip(', '+xit(', '+xdescribe('])(
    'detects an added focused or skipped test marker: %s',
    (line) => {
      const diff = `diff --git a/src/cart.test.ts b/src/cart.test.ts
--- a/src/cart.test.ts
+++ b/src/cart.test.ts
@@ -1 +1 @@
-it('works', () => undefined);
${line}'works', () => undefined);
`;
      expect(checkSkips(diff).passed).toBe(false);
    },
  );

  it('treats an added todo test as skipped', () => {
    const diff = `diff --git a/src/cart.test.ts b/src/cart.test.ts
--- a/src/cart.test.ts
+++ b/src/cart.test.ts
@@ -1 +1 @@
-it('works', () => expect(value).toBe(1));
+it.todo('works');
`;

    expect(checkSkips(diff).passed).toBe(false);
  });

  it.each(['test', 'suite'])('detects removal of the %s structural alias', (alias) => {
    const diff = `diff --git a/src/cart.test.ts b/src/cart.test.ts
--- a/src/cart.test.ts
+++ b/src/cart.test.ts
@@ -1 +0,0 @@
-${alias}('works', () => undefined);
`;

    expect(checkDeletedTests(diff).passed).toBe(false);
  });

  it('fails conservatively when an active test is replaced by a placeholder', () => {
    const diff = `diff --git a/src/cart.test.ts b/src/cart.test.ts
--- a/src/cart.test.ts
+++ b/src/cart.test.ts
@@ -1 +1 @@
-it('charges the customer', () => expect(charges).toBe(3));
+it('charges the customer', () => expect(true).toBe(true));
`;

    expect(checkDeletedTests(diff).passed).toBe(true);
    expect(checkAssertionDrop(diff).passed).toBe(false);
    expect(
      runMechanicalChecks(diff)
        .filter(({ passed }) => !passed)
        .map(({ name }) => name),
    ).toEqual(['weakened-assertion']);
  });

  it('allows a same-title async test body correction', () => {
    const diff = `diff --git a/src/cart.test.ts b/src/cart.test.ts
--- a/src/cart.test.ts
+++ b/src/cart.test.ts
@@ -1 +1 @@
-it('charges the customer', async () => expect(await charge(2)).toBe(3));
+it('charges the customer', async () => expect(await charge(3)).toBe(3));
`;

    expect(checkDeletedTests(diff).passed).toBe(true);
  });

  it('allows a test title rename when the declaration body is unchanged', () => {
    const diff = `diff --git a/src/cart.test.ts b/src/cart.test.ts
--- a/src/cart.test.ts
+++ b/src/cart.test.ts
@@ -1 +1 @@
-it('charges the customer', () => expect(charges).toBe(3));
+it('charges three items', () => expect(charges).toBe(3));
`;

    expect(checkDeletedTests(diff).passed).toBe(true);
  });

  it('rejects an unrelated declaration replacement', () => {
    const diff = `diff --git a/src/cart.test.ts b/src/cart.test.ts
--- a/src/cart.test.ts
+++ b/src/cart.test.ts
@@ -1 +1 @@
-it('charges the customer', () => charge());
+it('renders the receipt', () => render());
`;

    expect(checkDeletedTests(diff).passed).toBe(false);
  });

  it.each([
    "+it.skip('works', () => undefined);",
    "+it.only('works', () => undefined);",
    "+it.todo('works');",
  ])('keeps deleted-test APIs aligned when a declaration becomes skipped: %s', (added) => {
    const diff = `diff --git a/src/cart.test.ts b/src/cart.test.ts
--- a/src/cart.test.ts
+++ b/src/cart.test.ts
@@ -1 +1 @@
-it('works', () => undefined);
${added}
`;

    expect(checkDeletedTests(diff).passed).toBe(true);
    expect(checkSkips(diff).passed).toBe(false);
    expect(runMechanicalChecks(diff)).toEqual([
      { name: 'deleted-test', passed: true },
      {
        name: 'skipped-test',
        passed: false,
        evidence: expect.stringContaining(added),
      },
      { name: 'pass-with-no-tests', passed: true },
      { name: 'weakened-assertion', passed: true },
      { name: 'loosened-type', passed: true },
      { name: 'relaxed-config', passed: true },
    ]);
  });

  it('reports both deletion and skip when only one removed declaration is preserved', () => {
    const diff = `diff --git a/src/cart.test.ts b/src/cart.test.ts
--- a/src/cart.test.ts
+++ b/src/cart.test.ts
@@ -1,2 +1 @@
-it('deleted', () => undefined);
-it('preserved', () => undefined);
+it.skip('preserved', () => undefined);
`;

    expect(
      runMechanicalChecks(diff)
        .filter(({ passed }) => !passed)
        .map(({ name }) => name),
    ).toEqual(['deleted-test', 'skipped-test']);
  });

  it('detects a widened testPathIgnorePatterns array', () => {
    const diff = `diff --git a/vitest.config.ts b/vitest.config.ts
--- a/vitest.config.ts
+++ b/vitest.config.ts
@@ -2,3 +2,4 @@ export default {
   testPathIgnorePatterns: [
     'generated',
+    'failing-suite',
   ],
`;
    expect(checkPassWithNoTests(diff)).toMatchObject({
      passed: false,
      evidence: expect.stringContaining("+    'failing-suite'"),
    });
  });

  it('counts assertion loss only in test files', () => {
    const sourceDiff = `diff --git a/src/assert.ts b/src/assert.ts
--- a/src/assert.ts
+++ b/src/assert.ts
@@ -1 +1 @@
-expect(value).toBe(true);
+return value;
`;
    expect(checkAssertionDrop(sourceDiff).passed).toBe(true);
  });

  it.each([
    '+const unsafe = value as unknown as Config;',
    '+// @ts-ignore legacy input',
    '+// @ts-expect-error legacy input',
    '+  "strictNullChecks": false',
  ])('detects a type-safety relaxation: %s', (line) => {
    const diff = `diff --git a/src/cart.ts b/src/cart.ts
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -1 +1 @@
-const safe = value;
${line}
`;
    expect(checkLoosenedTypes(diff).passed).toBe(false);
  });

  it('does not flag a strict option that remains enabled after a format change', () => {
    const diff = `diff --git a/tsconfig.json b/tsconfig.json
--- a/tsconfig.json
+++ b/tsconfig.json
@@ -1 +1 @@
-  "strict": true
+  strict: true
`;
    expect(checkLoosenedTypes(diff).passed).toBe(true);
  });

  it.each([
    "+  'no-console': 'off',",
    "+  exclude: ['src/failing.test.ts'],",
  ])('detects a relaxed lint or Vitest configuration: %s', (line) => {
    const path = line.includes('exclude') ? 'vitest.config.ts' : 'eslint.config.js';
    const diff = `diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
@@ -1 +1 @@
-export default {};
${line}
`;
    expect(checkRelaxedConfig(diff).passed).toBe(false);
  });

  it('detects removal of an enabled ESLint rule', () => {
    const diff = `diff --git a/eslint.config.js b/eslint.config.js
--- a/eslint.config.js
+++ b/eslint.config.js
@@ -1,3 +1,2 @@
 export default { rules: {
-  'no-console': 'error',
 }};
`;

    expect(checkRelaxedConfig(diff).passed).toBe(false);
  });

  it('detects a package test command that excludes the failing test', () => {
    const diff = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -2 +2 @@
-  "test": "vitest run"
+  "test": "vitest run --exclude src/failing.test.ts"
`;

    expect(checkPassWithNoTests(diff).passed).toBe(false);
  });

  it('fails closed when a quoted file header is malformed', () => {
    const diff = `diff --git "a/src/foo.test.ts" "b/src/foo.test.ts"
--- "a/src/foo.test.ts
+++ "b/src/foo.test.ts"
@@ -1 +1 @@
-expect(value).toBe(1);
+expect(true).toBe(true);
`;

    const checks = runMechanicalChecks(diff);
    expect(checks.some(({ passed }) => !passed)).toBe(true);
    expect(checks.find(({ passed }) => !passed)?.evidence).toMatch(/invalid unified diff/i);
  });
});
