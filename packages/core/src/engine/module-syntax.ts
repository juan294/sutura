const COMMONJS_FILE = /\.cjs$/u;
// A static `import` declaration. Dynamic `import(...)` is valid CommonJS and must not match.
const ESM_IMPORT = /^\s*import\s+(?!\()/u;
// An `export` declaration. `exports.name = ...` starts with `exports` and does not match.
const ESM_EXPORT = /^\s*export\s+(?:default\b|const\b|let\b|var\b|function\b|class\b|async\b|\{|\*)/u;

export function isCommonJsPath(path: string): boolean {
  return COMMONJS_FILE.test(path);
}

export function addsEsModuleSyntax(lines: readonly string[]): boolean {
  return lines.some((line) => ESM_IMPORT.test(line) || ESM_EXPORT.test(line));
}
