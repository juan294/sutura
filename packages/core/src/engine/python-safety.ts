function commentText(line: string): string | null {
  let quote: "'" | '"' | null = null;
  let triple = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote !== null) {
      if (character === '\\') escaped = true;
      else if (triple && line.slice(index, index + 3) === quote.repeat(3)) {
        quote = null;
        triple = false;
        index += 2;
      } else if (!triple && character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      triple = line.slice(index, index + 3) === character.repeat(3);
      if (triple) index += 2;
    } else if (character === '#') return line.slice(index + 1).trim();
  }
  return null;
}

function executableText(line: string): string {
  let output = '';
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (escaped) {
      escaped = false;
      output += ' ';
    } else if (quote !== null) {
      if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      output += ' ';
    } else if (character === "'" || character === '"') {
      quote = character;
      output += ' ';
    } else if (character === '#') break;
    else output += character;
  }
  return output;
}

export function hasBroadPythonSuppression(lines: readonly string[]): boolean {
  return lines.some((line) => {
    const comment = commentText(line);
    return comment !== null && (
      /^type:\s*ignore\s*$/iu.test(comment) ||
      /^noqa\s*$/iu.test(comment)
    );
  });
}

export function hasPythonSkip(lines: readonly string[]): boolean {
  return lines.some((line) => {
    const code = executableText(line).trim();
    return /^@(?:pytest\.mark\.(?:skip|skipif)|unittest\.skip(?:If|Unless)?)\b/u.test(code) ||
      /(?:^|[^A-Za-z0-9_.])pytest\.skip\s*\(/u.test(code);
  });
}

export function hasSwallowedPythonException(lines: readonly string[]): boolean {
  const code = lines.map((line) => line.trim()).filter(Boolean);
  return code.some((line, index) =>
    /^except(?:\s+[^:]+)?:\s*(?:pass|return\s+None)\s*$/u.test(line) ||
    (/^except(?:\s+[^:]+)?:\s*$/u.test(line) && /^(?:pass|return(?:\s+.+)?)\s*$/u.test(code[index + 1] ?? '')),
  );
}

export function isPythonControlPath(path: string): boolean {
  return /(?:^|\/)(?:ruff\.toml|mypy\.ini|pytest\.ini|pyproject\.toml)$/u.test(path);
}

export function hasRelaxedPythonConfig(path: string, lines: readonly string[]): boolean {
  if (!isPythonControlPath(path)) return false;
  return lines.some((line) =>
    /\b(?:ignore_errors|ignore_missing_imports|allow_untyped_defs|allow_untyped_calls|allow_redefinition)\s*=\s*true\b/iu.test(line) ||
    /\b(?:strict|disallow_untyped_defs|check_untyped_defs|warn_unused_ignores|warn_return_any|no_implicit_optional)\s*=\s*false\b/iu.test(line) ||
    /\b(?:disable_error_code|follow_imports)\s*=\s*(?:[^\s#]+|\[[^\]]*\])/iu.test(line) ||
    /\b(?:extend-?ignore|ignore)\s*=\s*\[[^\]]+\]/iu.test(line) ||
    /\b(?:exclude|extend-exclude|norecursedirs|testpaths|addopts)\b.*(?:tests?|--ignore)/iu.test(line) ||
    /--ignore(?:=|\s)/iu.test(line),
  );
}
