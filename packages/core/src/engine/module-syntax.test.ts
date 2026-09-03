import { describe, expect, it } from 'vitest';

import { addsEsModuleSyntax, isCommonJsPath } from './module-syntax.js';

describe('module syntax detection', () => {
  it('treats only .cjs paths as CommonJS files', () => {
    expect(isCommonJsPath('app.cjs')).toBe(true);
    expect(isCommonJsPath('src/nested/app.cjs')).toBe(true);
    expect(isCommonJsPath('app.js')).toBe(false);
    expect(isCommonJsPath('app.mjs')).toBe(false);
    expect(isCommonJsPath('app.cts')).toBe(false);
  });

  it.each([
    "import chalk from 'chalk';",
    "import fetch from 'node-fetch';",
    "import { execa } from 'execa';",
    "import * as chalk from 'chalk';",
    "  import chalk from 'chalk';",
    'export default { green };',
    'export const green = (value) => value;',
    'export { green };',
    "export * from './colors.js';",
  ])('matches the ES module declaration %s', (line) => {
    expect(addsEsModuleSyntax([line])).toBe(true);
  });

  it.each([
    "const chalk = require('chalk').default;",
    "const { execa } = require('execa');",
    "exports.renderStatus = () => chalk.green('ready');",
    'module.exports = { green };',
    "const mod = await import('chalk');",
    "import('chalk').then((mod) => mod.default);",
    "// import chalk from 'chalk';",
    'const importer = 1;',
    'const exported = 2;',
  ])('does not match the CommonJS-compatible line %s', (line) => {
    expect(addsEsModuleSyntax([line])).toBe(false);
  });
});
