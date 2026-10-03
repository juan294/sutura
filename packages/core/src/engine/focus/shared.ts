import { errorFingerprint } from '../fingerprint.js';

/** One failing test as a runner reported it. */
export interface ReportedFailure {
  file: string;
  /** The runner's own test identity (for example `file > name` or `file::name`). */
  testId: string;
  /** The failure text that is fingerprinted (the runner's message block). */
  message: string;
}

export interface LogScan {
  failures: ReportedFailure[];
  /** Collection, import or load errors outside any one test. */
  loadErrors: number;
}

export interface ParsedInvocation {
  /** Environment assignments and the launcher (`npx`, `pnpm exec`, ...), kept verbatim. */
  prefix: string[];
  /** Options kept for the focused command. */
  kept: string[];
}

export interface FocusRunner {
  readonly name: 'vitest' | 'jest' | 'node-test' | 'pytest';
  /** Parse the command, or explain why it has no focused form. */
  parse(words: readonly string[]): ParsedInvocation | string | undefined;
  scan(lines: readonly string[]): LogScan;
  focusedCommand(invocation: ParsedInvocation, failure: ReportedFailure): string;
}

const GITHUB_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\S+Z\s/u;
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]/gu;
const RUNNER_WORKSPACE = /^(?:\/home\/runner\/work|\/__w)\/([^/]+)\/\1\//u;
const ENV_ASSIGNMENT = /^[A-Z_][A-Z0-9_]*=[^\s'"`$\\]*$/u;

export function logLines(log: string): string[] {
  return log.split(/\r?\n/u).map((line) => line.replace(GITHUB_TIMESTAMP, '').replace(ANSI, ''));
}

/** A repository-relative path, or undefined when it leaves the repository. */
export function repositoryPath(path: string): string | undefined {
  const relative = path
    .replace(/^file:\/\//u, '')
    .replace(RUNNER_WORKSPACE, '')
    .replace(/^\/workspace\//u, '')
    .replace(/^\.\//u, '');
  if (!relative || relative.startsWith('/') || relative.startsWith('-') ||
    relative.split('/').some((part) => part === '..' || part === '')) {
    return undefined;
  }
  return /^[\w@./+-]+$/u.test(relative) ? relative : undefined;
}

export function failureFingerprint(message: string): string {
  return errorFingerprint(message.trim());
}

/** Shell words for a plain command; undefined when shell syntax could change its meaning. */
export function shellWords(command: string): string[] | undefined {
  if (/[\n;&|`<>\\]|\$\(|\$\{/u.test(command)) return undefined;
  const words: string[] = [];
  const pattern = /'([^']*)'|"([^"$]*)"|(\S+)/gu;
  let end = 0;
  for (const match of command.matchAll(pattern)) {
    // Adjacent fragments ('a'b) form one shell word; refuse rather than split them.
    if (match.index > 0 && (match.index === end || !/^\s+$/u.test(command.slice(end, match.index)))) return undefined;
    end = match.index + match[0].length;
    const word = match[1] ?? match[2] ?? match[3] ?? '';
    if (match[3] !== undefined && (/['"$]/u.test(word) || word.startsWith('#'))) return undefined;
    words.push(word);
  }
  return words;
}

function quoteWord(word: string): string {
  return /^[\w@%+=:,./-]+$/u.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

/** Shell-quotes a word; an environment assignment keeps its name unquoted so it stays an assignment. */
export function quote(word: string): string {
  const assignment = /^([A-Z_][A-Z0-9_]*)=(.*)$/su.exec(word);
  return assignment ? `${assignment[1]!}=${quoteWord(assignment[2]!)}` : quoteWord(word);
}

/** Leading `NAME=value` words. */
export function splitEnvironment(words: readonly string[]): { environment: string[]; rest: string[] } {
  let index = 0;
  while (index < words.length && ENV_ASSIGNMENT.test(words[index]!)) index += 1;
  return { environment: words.slice(0, index), rest: words.slice(index) };
}

export interface OptionGrammar {
  /** Options that take a value as the next word (or after `=`). */
  valued: (option: string) => boolean;
  /** Boolean options. */
  flag: (option: string) => boolean;
  /** Options dropped from the focused command (with their value). */
  dropped: (option: string) => boolean;
  /** Splits an option word into the option and its attached value; defaults to `--name=value`. */
  split?: (word: string) => [string, string | undefined];
  /** Positional words are dropped (replaced by the focused file) unless rejected. */
  positionals?: 'drop' | 'reject';
}

function splitLong(word: string): [string, string | undefined] {
  const equals = word.indexOf('=');
  return equals < 0 ? [word, undefined] : [word.slice(0, equals), word.slice(equals + 1)];
}

/** Launchers that run a package's own binary unchanged. */
export const PACKAGE_LAUNCHERS = [['npx'], ['pnpm', 'exec'], ['pnpm'], ['yarn']] as const;

/** Leading launcher words (`npx`, `pnpm exec`, ...) when the next word is `runner`. */
export function launcherFor(words: readonly string[], runner: string, launchers: readonly (readonly string[])[]): string[] | undefined {
  for (const launcher of [[], ...launchers]) {
    if (launcher.every((word, index) => words[index] === word) && words[launcher.length] === runner) return [...launcher];
  }
  return undefined;
}

/** The first message block after a failure header: non-blank lines until `stop` matches. */
export function messageBlock(lines: readonly string[], start: number, stop: (line: string) => boolean): string {
  const block: string[] = [];
  for (const line of lines.slice(start)) {
    if (stop(line)) break;
    if (line.trim() !== '') block.push(line.trim());
  }
  return block.join('\n');
}

/**
 * Splits runner arguments into kept options and dropped selection. An unknown
 * option is refused because its arity, and so the meaning of the next word, is
 * unknown.
 */
export function partitionOptions(args: readonly string[], grammar: OptionGrammar): string[] | string {
  const kept: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index]!;
    if (!word.startsWith('-')) {
      if (grammar.positionals === 'reject') return `positional argument ${word} before the test selection`;
      continue; // positional selection is replaced by the focused file
    }
    const [option, inline] = grammar.split?.(word) ?? splitLong(word);
    const valued = grammar.valued(option);
    if (!valued && !grammar.flag(option)) return `unknown option ${option}`;
    const value = valued && inline === undefined ? args[++index] : undefined;
    if (valued && inline === undefined && value === undefined) return `option ${option} has no value`;
    if (grammar.dropped(option)) continue;
    kept.push(word, ...(value === undefined ? [] : [value]));
  }
  return kept;
}
