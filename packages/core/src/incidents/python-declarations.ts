import { PYTHON_REQUIRED_TOOLS } from '../runtime/python.js';

type DeclarationFit = 'compatible' | 'incompatible' | 'unknown';

// This is deliberately a bounded declaration scanner, not a TOML parser or
// dependency solver. Unsupported syntax cannot establish static runtime fit.
function uncomment(raw: string): string {
  let quote = '';
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (quote) {
      if (quote === '"' && char === '\\') { index += 1; continue; }
      if (char === quote) quote = '';
    } else if (char === '#') return raw.slice(0, index).trim();
    else if (char === '"' || char === "'") quote = char;
  }
  if (quote) throw new Error('multiline-or-unclosed-string');
  return raw.trim();
}

function keyPath(text: string): string[] {
  return text.split('.').map(part => {
    const key = part.trim();
    if (/^[A-Za-z0-9_-]+$/u.test(key)) return key;
    if (/^(?:"[A-Za-z0-9_-]+"|'[A-Za-z0-9_-]+')$/u.test(key)) return key.slice(1, -1);
    throw new Error('unhandled-toml-key');
  });
}

function declaration(content: string | undefined, project: boolean): string | undefined {
  if (content === undefined) return undefined;
  if (Buffer.byteLength(content) > 1_048_576 || content.includes('\0')) throw new Error('unbounded-declaration');
  let table: string[] = [];
  let projectSeen = false;
  let dynamicSeen = false;
  let found: string | undefined;
  for (const raw of content.split(/\r?\n/u)) {
    const line = uncomment(raw);
    if (!line) continue;
    if (line.includes('"""') || line.includes("'''")) throw new Error('multiline-string-unsupported');
    if (line.startsWith('[')) {
      const header = /^\[\[([^\]]+)\]\]$|^\[([^\]]+)\]$/u.exec(line);
      if (!header) throw new Error('unhandled-toml-header');
      table = keyPath(header[1] ?? header[2]!);
      if (project && table[0] === 'project') {
        if (table[1] === 'requires-python') throw new Error('non-string-declaration');
        if (table.length === 1) {
          if (projectSeen || header[1] !== undefined) throw new Error('ambiguous-project-table');
          projectSeen = true;
        }
      } else if (!project && table[0] === 'requires-python') throw new Error('non-string-declaration');
      continue;
    }
    const selected = project ? table.length === 1 && table[0] === 'project' : table.length === 0;
    // Package artifact arrays and other tables do not declare the interpreter.
    // Header/string checks above still prevent unsupported syntax hiding scope.
    if (!selected && (!project || table.length !== 0)) continue;
    const equals = line.indexOf('=');
    if (equals < 0) {
      if (selected && line.includes('requires-python')) throw new Error('malformed-declaration');
      continue;
    }
    const keys = keyPath(line.slice(0, equals));
    if (project && table.length === 0 && keys[0] === 'project') throw new Error('alternative-project-construction');
    if (!selected) continue;
    if (project && keys[0] === 'dynamic') {
      const array = /^\[([^\[\]]*)\]$/u.exec(line.slice(equals + 1).trim());
      if (dynamicSeen || keys.length !== 1 || !array) throw new Error('ambiguous-dynamic-metadata');
      dynamicSeen = true;
      const items = array[1]!.trim() ? array[1]!.split(',') : [];
      if (items.length && !items.at(-1)!.trim()) items.pop();
      const names = items.map(item => {
        const name = /^(?:"([A-Za-z0-9_-]+)"|'([A-Za-z0-9_-]+)')$/u.exec(item.trim());
        if (!name) throw new Error('unhandled-dynamic-metadata');
        return name[1] ?? name[2];
      });
      if (names.includes('requires-python')) throw new Error('dynamic-python-declaration');
      continue;
    }
    if (keys[0] !== 'requires-python') continue;
    if (keys.length !== 1 || found !== undefined) throw new Error('ambiguous-declaration');
    const value = line.slice(equals + 1).trim();
    const literal = /^(?:"([^"\\]*)"|'([^']*)')$/u.exec(value);
    if (!literal) throw new Error('unhandled-declaration-value');
    found = literal[1] ?? literal[2]!;
  }
  return found;
}

function release(text: string): number[] {
  if (!/^\d{1,6}(?:\.\d{1,6}){0,7}$/u.test(text)) throw new Error('unhandled-release');
  return text.split('.').map(Number);
}
function compare(left: number[], right: number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}
function prefixMatches(version: number[], prefix: number[]): boolean {
  return prefix.every((component, index) => component === (version[index] ?? 0));
}
function admits(specifier: string | undefined, version: number[]): boolean {
  if (specifier === undefined) return true;
  if (!specifier.trim() || specifier.length > 1024) throw new Error('unhandled-specifier');
  const clauses = specifier.split(',');
  if (clauses.length > 32) throw new Error('specifier-clause-limit');
  // Evaluate every clause: an incompatible clause must not hide malformed syntax.
  const results = clauses.map(clause => {
    const match = /^(==|!=|<=|>=|<|>|~=)\s*(\d+(?:\.\d+)*)(\.\*)?$/u.exec(clause.trim());
    if (!match) throw new Error('unhandled-specifier-clause');
    const [, operator, text, wildcard] = match;
    const expected = release(text!);
    const order = compare(version, expected);
    if (wildcard) {
      if (operator !== '==' && operator !== '!=') throw new Error('invalid-wildcard');
      const matches = prefixMatches(version, expected);
      return operator === '==' ? matches : !matches;
    }
    switch (operator) {
      case '==': return order === 0;
      case '!=': return order !== 0;
      case '<=': return order <= 0;
      case '>=': return order >= 0;
      case '<': return order < 0;
      case '>': return order > 0;
      case '~=':
        if (expected.length < 2) throw new Error('invalid-compatible-release');
        return order >= 0 && prefixMatches(version, expected.slice(0, -1));
      default: throw new Error('unhandled-comparator');
    }
  });
  return results.every(Boolean);
}

/** Check only the advertised interpreter; never select or install another one. */
export function assessPythonDeclarations(pyproject: string | undefined, uvLock: string | undefined): DeclarationFit {
  try {
    const pinned = /^Python (\d+(?:\.\d+)*)$/u.exec(PYTHON_REQUIRED_TOOLS[0] ?? '');
    if (!pinned) return 'unknown';
    const version = release(pinned[1]!);
    const projectFit = admits(declaration(pyproject, true), version);
    const lockFit = admits(declaration(uvLock, false), version);
    return projectFit && lockFit ? 'compatible' : 'incompatible';
  } catch { return 'unknown'; }
}
