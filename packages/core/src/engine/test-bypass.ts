const SHELL_EXPANSION = /\$\{[^}\r\n]*\}|\$\([^\r\n)]*\)|`[^`\r\n]*`|\$[A-Za-z_][A-Za-z0-9_]*|\$[0-9@*#?$!-]/gu;
const SHELL_OPTION = new RegExp(
  String.raw`^(?:(?:${SHELL_EXPANSION.source})|[^\s;&|,<>=])+`,
  'u',
);
const TOKEN_FRAGMENTS = [
  '',
  'pass',
  'with',
  'no',
  'tests',
  'passwith',
  'withno',
  'notests',
  'passwithno',
  'withnotests',
  'passwithnotests',
] as const;

function compact(value: string): string {
  return value.replace(/[^A-Za-z0-9]/gu, '').toLowerCase();
}

function shellCommandSource(line: string): string {
  try {
    const parsed = JSON.parse(line) as { scripts?: Record<string, unknown> };
    const scripts = Object.values(parsed.scripts ?? {}).filter(
      (script): script is string => typeof script === 'string',
    );
    if (scripts.length > 128) return '--passWithNoTests';
    if (scripts.length > 0) return scripts.join('\0');
  } catch {
    // A unified-diff hunk can contain only one property from a multi-line JSON file.
  }
  const properties: string[] = [];
  for (const property of line.matchAll(
    /"(?:\\.|[^"\\])*"\s*:\s*("(?:\\.|[^"\\])*")/gu,
  )) {
    if (properties.length === 128) return '--passWithNoTests';
    try {
      properties.push(JSON.parse(property[1] ?? '') as string);
    } catch {
      // Keep inspecting later properties on a partial hunk line.
    }
  }
  if (properties.length > 0) {
    return properties.join('\0');
  }
  const markers = [...line.matchAll(/"(?:\\.|[^"\\])*"\s*:\s*"/gu)];
  const marker = markers.at(-1);
  if (!marker) return line;
  return line
    .slice((marker.index ?? 0) + marker[0].length)
    .replace(/"\s*[,}].*$/u, '');
}

interface ShellState {
  readonly assignments: ReadonlyMap<string, string>;
  readonly result: string;
  readonly skipConditionalList?: boolean;
}

function removeShellLineContinuations(value: string): string {
  let result = '';
  let quote: 'double' | 'single' | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (character === '\\' && quote !== 'single') {
      if (value[index + 1] === '\n') {
        index += 1;
        continue;
      }
      if (value[index + 1] === '\r' && value[index + 2] === '\n') {
        index += 2;
        continue;
      }
      result += character + (value[index + 1] ?? '');
      index += 1;
      continue;
    }
    if (character === "'" && quote !== 'double') {
      quote = quote === 'single' ? undefined : 'single';
    } else if (character === '"' && quote !== 'single') {
      quote = quote === 'double' ? undefined : 'double';
    }
    result += character;
  }
  return result;
}

function removeShellComments(value: string): string {
  let result = '';
  let quote: 'double' | 'single' | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (character === '\\' && quote !== 'single') {
      result += character + (value[index + 1] ?? '');
      index += 1;
      continue;
    }
    if (character === "'" && quote !== 'double') {
      quote = quote === 'single' ? undefined : 'single';
    } else if (character === '"' && quote !== 'single') {
      quote = quote === 'double' ? undefined : 'double';
    } else if (
      !quote &&
      character === '#' &&
      (index === 0 || /[\s;&|()<>]/u.test(value[index - 1] ?? ''))
    ) {
      while (index < value.length && !/[\r\n]/u.test(value[index] ?? '')) index += 1;
      index -= 1;
      continue;
    }
    result += character;
  }
  return result;
}

function hasHeredocOperator(value: string): boolean {
  const command = removeShellLineContinuations(value);
  let quote: 'double' | 'single' | undefined;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index] ?? '';
    if (character === '\\' && quote !== 'single') {
      index += 1;
    } else if (character === "'" && quote !== 'double') {
      quote = quote === 'single' ? undefined : 'single';
    } else if (character === '"' && quote !== 'single') {
      quote = quote === 'double' ? undefined : 'double';
    } else if (!quote && command.slice(index, index + 3) === '<<<') {
      index += 2;
    } else if (!quote && command.slice(index, index + 3) === '$((') {
      let depth = 2;
      for (index += 3; index < command.length && depth > 0; index += 1) {
        if (command[index] === '(') depth += 1;
        if (command[index] === ')') depth -= 1;
      }
      index -= 1;
    } else if (!quote && command.slice(index, index + 2) === '<<' && command[index + 2] !== '<') {
      return true;
    }
  }
  return false;
}

function expandKnownShellVariables(value: string, failClosedOnHeredoc: boolean): string[] {
  if (failClosedOnHeredoc) {
    const normalized = removeShellComments(removeShellLineContinuations(value));
    if (hasHeredocOperator(normalized)) return ['--passWithNoTests'];
    return expandKnownShellVariables(normalized, false);
  }
  let states: ShellState[] = [{ assignments: new Map(), result: '' }];
  let quote: 'double' | 'single' | undefined;
  let conditionalAssignmentList = false;
  let redirectionTarget = false;
  let simpleCommandStarted = false;
  const referenceAt = (index: number) =>
    /^(?:\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*))/u
      .exec(value.slice(index));
  const expandReferences = (
    fragment: string,
    assignments: ReadonlyMap<string, string>,
  ): string => fragment.replace(
      /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/gu,
      (reference, braced: string | undefined, unbraced: string | undefined) =>
        assignments.get(braced ?? unbraced ?? '') ?? reference,
    );
  const append = (text: string) => {
    states = states.map((state) => ({ ...state, result: state.result + text }));
  };

  for (let index = 0; index < value.length;) {
    const character = value[index] ?? '';
    if (!quote && /[;&|\r\n]/u.test(character)) {
      conditionalAssignmentList = false;
      simpleCommandStarted = false;
      states = states.map((state) => ({ ...state, skipConditionalList: false }));
    }
    const startsRedirectionTarget = !quote && redirectionTarget &&
      !/\s/u.test(character) && !/[<>]/u.test(character);
    if (startsRedirectionTarget) {
      redirectionTarget = false;
    }
    const atBoundary = index === 0 || /[\s;&|()]/u.test(value[index - 1] ?? '');
    if (!quote && atBoundary && !simpleCommandStarted) {
      const prefixRedirection = /^(?:[0-9]+)?(?:<<<|<<-?|>>|<>|<&|>&|>\||[<>])/u
        .exec(value.slice(index));
      if (prefixRedirection) {
        append(prefixRedirection[0]);
        redirectionTarget = true;
        index += prefixRedirection[0].length;
        continue;
      }
      const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=(?:"((?:\\.|[^"\\])*)"|'([^']*)'|([^\s;&|<>]+))/u
        .exec(value.slice(index));
      if (assignment) {
        const name = assignment[1] ?? '';
        const doubleQuoted = assignment[2];
        const singleQuoted = assignment[3];
        const raw = doubleQuoted ?? singleQuoted ?? assignment[4] ?? '';
        const startsConditional = /(?:&&|\|\|)\s*$/u.test(value.slice(0, index));
        const conditional: boolean = conditionalAssignmentList || startsConditional;
        conditionalAssignmentList = conditional;
        const next: ShellState[] = [];
        for (const state of states) {
          const resolved = singleQuoted === undefined
            ? expandReferences(raw, state.assignments)
            : raw;
          const rendered = state.result + assignment[0].replace(raw, resolved);
          if (startsConditional) {
            next.push({ ...state, result: rendered, skipConditionalList: true });
          }
          if (resolved.length <= 4096 && !state.skipConditionalList) {
            const assignments = new Map(state.assignments);
            assignments.set(name, resolved);
            next.push({ assignments, result: rendered, skipConditionalList: false });
          } else if (conditional && !startsConditional) {
            next.push({ ...state, result: rendered });
          }
        }
        if (next.length > 128) return ['--passWithNoTests'];
        states = next;
        index += assignment[0].length;
        continue;
      }
      if (/[<>]/u.test(character)) {
        redirectionTarget = true;
      } else if (
        !/\s/u.test(character) &&
        !/[;&|()\r\n]/u.test(character) &&
        !redirectionTarget &&
        !startsRedirectionTarget
      ) {
        conditionalAssignmentList = false;
        simpleCommandStarted = true;
        states = states.map((state) => ({ ...state, skipConditionalList: false }));
      }
    }
    if (character === '\\' && quote !== 'single') {
      append(value.slice(index, index + 2));
      index += 2;
      continue;
    }
    if (character === "'" && quote !== 'double') {
      quote = quote === 'single' ? undefined : 'single';
      append(character);
      index += 1;
      continue;
    }
    if (character === '"' && quote !== 'single') {
      quote = quote === 'double' ? undefined : 'double';
      append(character);
      index += 1;
      continue;
    }
    const reference = quote !== 'single' && character === '$' ? referenceAt(index) : null;
    if (reference) {
      const name = reference[1] ?? reference[2] ?? '';
      states = states.map((state) => ({
        ...state,
        result: state.result + (state.assignments.get(name) ?? reference[0]),
      }));
      index += reference[0].length;
      continue;
    }
    append(character);
    index += 1;
  }
  return states.map(({ result }) => result);
}

function canComposeForbiddenOption(option: string): boolean {
  if (compact(option) === 'passwithnotests') return true;
  const segments = option.split(SHELL_EXPANSION);
  const expansionCount = segments.length - 1;
  if (expansionCount === 0) return false;
  if (expansionCount > 3) return true;

  const visit = (index: number, assembled: string): boolean => {
    if (index === expansionCount) {
      return compact(`${assembled}${segments[index] ?? ''}`) === 'passwithnotests';
    }
    const prefix = `${assembled}${segments[index] ?? ''}`;
    return TOKEN_FRAGMENTS.some((fragment) => visit(index + 1, `${prefix}${fragment}`));
  };
  return visit(0, '');
}

export function isTestCommandPath(path: string): boolean {
  return isShellCommandPath(path) ||
    /(?:^|\/)(?:jest|vitest)\.config\.[^/]+$/iu.test(path);
}

export function isShellCommandPath(path: string): boolean {
  return path === 'package.json' ||
    /(?:^|\/)[^/]+\.(?:sh|bash|zsh)$/iu.test(path) ||
    /^\.github\/workflows\/[^/]+\.ya?ml$/iu.test(path);
}

export function containsPassWithNoTestsBypass(
  lines: readonly string[],
  options: {
    allowComposed?: boolean;
    decodePackageJson?: boolean;
    shellCommands?: boolean;
  } = {},
): boolean {
  const added = lines.join('\n');
  if (compact(added).includes('passwithnotests')) return true;
  if (!options.allowComposed) return false;
  const sources = options.decodePackageJson
    ? lines.map(shellCommandSource).join('\0').split('\0')
    : [added];
  for (const source of sources) {
    const expansions = expandKnownShellVariables(source, options.shellCommands === true);
    for (const expanded of expansions) {
      if (compact(expanded).includes('passwithnotests')) return true;
      for (const match of expanded.matchAll(/--/gu)) {
        const tail = expanded.slice((match.index ?? 0) + 2);
        const option = SHELL_OPTION.exec(tail)?.[0] ?? '';
        if (canComposeForbiddenOption(option)) return true;
      }
    }
  }
  return false;
}
