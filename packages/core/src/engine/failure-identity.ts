import { createHash } from 'node:crypto';
import { vitestRunner } from './focus/vitest.js';
import { jestRunner } from './focus/jest.js';
import { nodeTestRunner } from './focus/node-test.js';
import { pytestRunner } from './focus/pytest.js';
import { logLines, repositoryPath, shellWords } from './focus/shared.js';

export interface ScriptProvenance {
  manifestPath: string;
  manifestSha256: string;
  name: string;
  command: string;
  packageName?: string;
}
export interface NativeFailureEvidence {
  command: string;
  log: string;
  truncated?: boolean;
  selectedStep?: { jobId?: number; jobName: string; stepNumber?: number; stepName: string };
  /** Exact observed manifest provenance supplied by the authenticated source adapter. */
  script?: ScriptProvenance;
  /** Ordered exact manifests for at most four nested package-script invocations. */
  scriptChain?: ScriptProvenance[];
  /** Complete supplied workspace participants for a pnpm recursive script. */
  workspaceScripts?: ScriptProvenance[];
}
export interface FailureIdentityEvidence {
  version: 'sutura-failure-identity-v1';
  status: 'matched' | 'mismatch' | 'unavailable';
  parser: string;
  reason: string;
  nativeFingerprint?: string;
  sandboxFingerprint?: string;
  selectedStep?: NativeFailureEvidence['selectedStep'];
}
interface Source { path: string; content: string; truncated?: boolean }
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const RUNNERS = [vitestRunner, jestRunner, nodeTestRunner, pytestRunner];

function terminalCommand(command: string): string { return command.trim().replace(/;$/u, '').trim(); }
function recursiveScript(command: string): string | undefined {
  return /^pnpm (?:-r|--recursive) (?:run )?([\w:-]+)$/u.exec(terminalCommand(command))?.[1];
}

function packageScript(command: string): { name: string; filter?: string } | undefined {
  const words = shellWords(command);
  if (!words || !['npm', 'pnpm', 'yarn'].includes(words[0] ?? '')) return undefined;
  let rest = words.slice(1);
  let filter: string | undefined;
  if (rest[0] === '--filter' && rest[1]) { filter = rest[1]; rest = rest.slice(2); }
  if (rest[0] === 'run' || rest[0] === 'run-script') rest = rest.slice(1);
  const name = rest[0];
  if (!name || !/^[\w:-]+$/u.test(name) || ['exec', 'dlx', 'audit', 'install'].includes(name)) return undefined;
  if (rest.length > 1 && rest[1] !== '--') return undefined;
  return { name, ...(filter ? { filter } : {}) };
}

/** Read only supplied exact source bytes. No filesystem, package execution or script evaluation. */
export function nativeFailureForCommand(command: string, log: string, sources: readonly Source[] = []): NativeFailureEvidence {
  const evidence: NativeFailureEvidence = { command, log };
  if (sources.length > 64 || sources.reduce((sum, source) => sum + Buffer.byteLength(source.content), 0) > 1_000_000) return evidence;
  const recursive = recursiveScript(command);
  if (recursive) {
    const participants: ScriptProvenance[] = [];
    for (const source of sources) {
      if (source.path === 'package.json' || !source.path.endsWith('/package.json')) continue;
      if (source.truncated || repositoryPath(source.path) !== source.path) return evidence;
      try {
        const manifest = JSON.parse(source.content) as { name?: unknown; scripts?: Record<string, unknown> };
        const script = manifest.scripts?.[recursive];
        if (script === undefined) continue;
        if (typeof manifest.name !== 'string' || !manifest.name || typeof script !== 'string' || !toolsFor(script)) return evidence;
        participants.push({ manifestPath: source.path, manifestSha256: digest(source.content), packageName: manifest.name, name: recursive, command: script });
      } catch { return evidence; }
    }
    if (participants.length && new Set(participants.map(item => item.manifestPath)).size === participants.length &&
      new Set(participants.map(item => item.packageName)).size === participants.length) evidence.workspaceScripts = participants;
    return evidence;
  }
  const chain: ScriptProvenance[] = [], seen = new Set<string>();
  let current = command, manifestPath = 'package.json';
  for (let depth = 0; depth < 4; depth += 1) {
    if (toolsFor(current)) break;
    const request = packageScript(current);
    if (!request) return evidence;
    const matches: ScriptProvenance[] = [];
    for (const source of sources) {
      if (source.truncated || repositoryPath(source.path) !== source.path ||
        !(source.path === 'package.json' || source.path.endsWith('/package.json'))) continue;
      try {
        const manifest = JSON.parse(source.content) as { name?: unknown; scripts?: Record<string, unknown> };
        if (request.filter ? manifest.name !== request.filter : source.path !== manifestPath) continue;
        const script = manifest.scripts?.[request.name];
        if (typeof script === 'string' && script.trim()) matches.push({ manifestPath: source.path, manifestSha256: digest(source.content),
          name: request.name, command: script, ...(typeof manifest.name === 'string' ? { packageName: manifest.name } : {}) });
      } catch { /* Missing or malformed source cannot establish script provenance. */ }
    }
    const match = matches.length === 1 ? matches[0] : undefined;
    if (!match) return evidence;
    const key = `${match.manifestPath}:${match.name}`;
    if (seen.has(key)) return evidence;
    seen.add(key); chain.push(match); current = match.command; manifestPath = match.manifestPath;
  }
  if (chain[0] && toolsFor(current)) {
    evidence.script = chain[0];
    if (chain.length > 1) evidence.scriptChain = chain;
  }
  return evidence;
}

function underlying(evidence: NativeFailureEvidence): string | undefined {
  if (evidence.workspaceScripts) {
    const name = recursiveScript(evidence.command), scripts = evidence.workspaceScripts;
    if (!name || evidence.script || evidence.scriptChain || !scripts.length || scripts.length > 64 ||
      new Set(scripts.map(script => script.manifestPath)).size !== scripts.length ||
      new Set(scripts.map(script => script.packageName)).size !== scripts.length || scripts.some(script =>
        script.name !== name || !script.packageName || !/^[a-f0-9]{64}$/u.test(script.manifestSha256) ||
        repositoryPath(script.manifestPath) !== script.manifestPath || !script.manifestPath.endsWith('/package.json') || !toolsFor(script.command))) return undefined;
    return scripts.map(script => script.command).join(' && ');
  }
  if (!evidence.script && !evidence.scriptChain) return evidence.command;
  const chain = evidence.scriptChain ?? (evidence.script ? [evidence.script] : []);
  if (!chain.length || chain.length > 4) return undefined;
  if (evidence.script && ['manifestPath', 'manifestSha256', 'name', 'command', 'packageName'].some(key =>
    evidence.script![key as keyof ScriptProvenance] !== chain[0]![key as keyof ScriptProvenance])) return undefined;
  let current = evidence.command, manifestPath = 'package.json';
  const seen = new Set<string>();
  for (const script of chain) {
    const requested = packageScript(current), key = `${script.manifestPath}:${script.name}`;
    if (!requested || requested.name !== script.name || !/^[a-f0-9]{64}$/u.test(script.manifestSha256) ||
      repositoryPath(script.manifestPath) !== script.manifestPath ||
      !(script.manifestPath === 'package.json' || script.manifestPath.endsWith('/package.json')) || seen.has(key)) return undefined;
    if (requested.filter ? script.packageName !== requested.filter : script.manifestPath !== manifestPath) return undefined;
    seen.add(key); current = script.command; manifestPath = script.manifestPath;
  }
  return toolsFor(current) ? current : undefined;
}

/** The exact supported tool command resolved from supplied manifest provenance. */
export function nativeExecutionCommand(evidence: NativeFailureEvidence): string | undefined {
  const command = underlying(evidence);
  return command && toolsFor(command) ? command : undefined;
}

/** Ignore known location/timing noise, never assertion values or message case. */
function stable(value: string): string {
  return value.replace(/(?:file:\/\/)?\/home\/runner\/work\/([^/\s]+)\/\1\//gu, '')
    .replace(/(?:file:\/\/)?\/__w\/([^/\s]+)\/\1\//gu, '')
    .replace(/(?:file:\/\/)?\/workspace\//gu, '')
    .replace(/ at 0x[\da-f]+(?=>)/giu, ' at <address>')
    .replace(/\s+/gu, ' ').trim();
}
/** Preserve assertion detail omitted by the focused-runner optimization. */
function vitestMessage(lines: readonly string[], testId: string, fallback: string): string {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const annotation = /^::error file=([^,]+),title=([^,]+?)(?:,line=\d+)?(?:,column=\d+)?::(.*)$/u.exec(line);
    if (annotation && stable(annotation[2]!) === stable(testId)) {
      return assertionBlock(annotation[3]!.replaceAll('%0A', '\n').replaceAll('%0D', '\r').replaceAll('%25', '%').split(/\r?\n/u)).join('\n');
    }
    const header = /^\s*FAIL\s+(\S+) > (.+?)\s*$/u.exec(line);
    if (!header || `${repositoryPath(header[1]!)} > ${header[2]!}` !== testId) continue;
    let start = index + 1;
    while (start < lines.length && (!lines[start]!.trim() || /^\s*FAIL\s+\S+ > /u.test(lines[start]!))) start += 1;
    return assertionBlock(lines.slice(start)).join('\n');
  }
  return fallback;
}
function assertionBlock(lines: readonly string[]): string[] {
  const result: string[] = [];
  for (const line of lines) {
    if (/^\s*(?:❯|at |FAIL |Test Files|Tests\s|⎯)/u.test(line)) break;
    if (line.trim()) result.push(line.trim());
  }
  return result;
}
interface Parsed { parser: string; entries: string[]; incomplete: boolean }
function toolsFor(command: string): string[] | undefined {
  // Only straight AND chains of supported tools. Source is inspected, never evaluated.
  const stages = terminalCommand(command).split(/\s+&&\s+/u);
  const tools: string[] = [];
  for (const stage of stages) {
    const words = shellWords(stage);
    if (!words?.length) return undefined;
    let index = 0;
    while (/^[A-Z_][A-Z0-9_]*=/u.test(words[index] ?? '')) index += 1;
    if (words[index] === 'npx' || words[index] === 'yarn') index += 1;
    else if (words[index] === 'pnpm' || words[index] === 'npm') {
      if (words[index + 1] === 'audit') { tools.push('audit'); continue; }
      index += words[index + 1] === 'exec' ? 2 : 1;
    }
    let tool = words[index];
    if (tool === 'python' || tool === 'python3') {
      const module = words.indexOf('-m', index + 1);
      tool = module >= 0 ? words[module + 1] : undefined;
    }
    if (tool === 'node') tool = words.includes('--test') ? 'node-test' : 'node';
    if (!tool || !['vitest', 'jest', 'node-test', 'pytest', 'unittest', 'tsc', 'eslint', 'ruff', 'vite', 'rollup', 'esbuild', 'webpack', 'node', 'audit'].includes(tool)) return undefined;
    tools.push(tool);
  }
  return tools;
}

function parse(log: string, tools: readonly string[]): Parsed {
  const lines = logLines(log), entries: string[] = [], parsers = new Set<string>();
  let incomplete = false, testCount = 0;
  const add = (parser: string, ...parts: string[]) => { parsers.add(parser); entries.push(JSON.stringify([parser, ...parts.map(stable)])); };
  for (const runner of RUNNERS) {
    if (!tools.includes(runner.name)) continue;
    const scan = runner.scan(lines);
    for (const failure of scan.failures) {
      if (!failure.message.trim() || /^(?:FAIL |Test Files|Tests\s|Duration\s)/u.test(failure.message.trim())) { incomplete = true; continue; }
      const message = runner.name === 'vitest' ? vitestMessage(lines, failure.testId, failure.message) : failure.message;
      add(runner.name, failure.testId, message); testCount += 1;
    }
    if (scan.loadErrors) {
      const modules = lines.filter(line => /(?:Cannot find module|ERR_MODULE_NOT_FOUND|Failed to resolve import|Could not resolve)/u.test(line));
      if (!modules.length) incomplete = true;
    }
  }
  if (tools.includes('unittest')) {
    for (let i = 0; i < lines.length; i += 1) {
      const header = /^(FAIL|ERROR): (.+) \((.+)\)$/u.exec(lines[i]!);
      if (!header) continue;
      const block: string[] = [];
      for (const line of lines.slice(i + 1)) {
        if (/^(?:FAIL|ERROR): |^Ran \d+ tests? |^FAILED \(/u.test(line)) break;
        block.push(line);
      }
      const errorAt = block.findIndex(line => /^[\w.]+(?:Error|Exception):/u.test(line));
      const errors = errorAt < 0 ? [] : block.slice(errorAt).filter(line => !/^-{3,}$/u.test(line));
      const file = block.map(line => /File "([^"]+)", line \d+/u.exec(line)?.[1]).find(path => path && repositoryPath(path));
      if (!errors.length || !file) { incomplete = true; continue; }
      add('unittest', header[3]!, repositoryPath(file)!, errors.join('\n')); testCount += 1;
    }
  }
  let lintFile: string | undefined;
  for (const line of lines) {
    const compiler = /^(.+?)\(\d+,\d+\): error (TS\d+): (.+)$/u.exec(line) ?? /^(.+?):\d+:\d+ - error (TS\d+): (.+)$/u.exec(line);
    if (tools.includes('tsc') && compiler) {
      const path = repositoryPath(compiler[1]!); if (path) add('tsc', path, compiler[2]!, compiler[3]!); else incomplete = true;
    }
    if (tools.includes('eslint')) {
      if (/\.[cm]?[jt]sx?$/u.test(line.trim())) lintFile = repositoryPath(line.trim());
      const lint = /^\s*\d+:\d+\s+(?:error|warning)\s+(.+?)\s{2,}(\S+)\s*$/u.exec(line);
      if (lint) { if (lintFile) add('eslint', lintFile, lint[2]!, lint[1]!); else incomplete = true; }
    }
    const ruff = /^(.+?):\d+:\d+: ([A-Z]+\d+) (.+)$/u.exec(line);
    if (tools.includes('ruff') && ruff) { const path = repositoryPath(ruff[1]!); if (path) add('ruff', path, ruff[2]!, ruff[3]!); else incomplete = true; }
    // Module/source-bearing build errors are distinct from test assertions or absent tools.
    if (tools.some(tool => ['node', 'vitest', 'jest', 'vite', 'rollup', 'esbuild', 'webpack'].includes(tool))) {
      const build = /(?:Error(?: \[[A-Z_]+\])?: )?(?:Cannot find module|Could not resolve|Failed to resolve import) ["']([^"']+)["'] (?:imported from|from) ["']?([^"'%\s]+)["']?/u.exec(line);
      if (build) add('module-build', build[1]!, build[2]!);
    }
    if (tools.includes('audit')) {
      for (const finding of line.matchAll(/\b(?:GHSA-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{4}|CVE-\d{4}-\d+)\b/giu)) add('dependency-advisory', finding[0]);
    }
  }
  // Reported totals expose partial captures even when the caller missed a truncation marker.
  for (const line of lines) {
    const count = /^\s*Tests:?\s+(\d+) failed/u.exec(line) ?? /^# fail (\d+)$/u.exec(line) ?? /^=+ (\d+) failed/u.exec(line);
    if (count && Number(count[1]) !== testCount) incomplete = true;
    const unit = /^FAILED \(([^)]+)\)/u.exec(line);
    if (unit && [...unit[1]!.matchAll(/(?:failures|errors)=(\d+)/gu)].reduce((sum, item) => sum + Number(item[1]), 0) !== testCount) incomplete = true;
  }
  return { parser: [...parsers].sort().join('+') || 'unavailable', entries: [...new Set(entries)].sort(), incomplete };
}

function parseEvidence(log: string, evidence: NativeFailureEvidence, tools: readonly string[]): Parsed {
  if (!evidence.workspaceScripts) {
    const script = evidence.scriptChain?.at(-1) ?? evidence.script;
    if (!script || script.manifestPath === 'package.json') return parse(log, tools);
    const directory = script.manifestPath.slice(0, -'/package.json'.length);
    let foreign = false;
    const lines = logLines(log).map(line => {
      const scoped = /^(\S+) ([\w:-]+): ?(.*)$/u.exec(line);
      if (scoped) {
        if (scoped[1] !== directory || scoped[2] !== script.name) foreign = true;
        else line = scoped[3]!;
      }
      return line.replaceAll(`${directory}/`, '');
    });
    const parsed = parse(lines.join('\n'), tools);
    return { ...parsed, incomplete: parsed.incomplete || foreign,
      entries: parsed.entries.map(entry => JSON.stringify([script.manifestPath, entry])) };
  }
  const lines = logLines(log), grouped = new Map<string, string[]>(), unscoped: string[] = [];
  let incomplete = false;
  for (const line of lines) {
    const scoped = /^(\S+) ([\w:-]+): ?(.*)$/u.exec(line);
    if (!scoped) { unscoped.push(line); continue; }
    const script = evidence.workspaceScripts.find(item => item.manifestPath === `${scoped[1]}/package.json` && item.name === scoped[2]);
    if (!script) { incomplete = true; continue; }
    const group = grouped.get(script.manifestPath) ?? [];
    group.push(scoped[3]!); grouped.set(script.manifestPath, group);
  }
  const outside = parse(unscoped.join('\n'), tools);
  incomplete ||= outside.entries.length > 0 || outside.incomplete || grouped.size === 0;
  const entries: string[] = [], parsers = new Set<string>();
  for (const script of evidence.workspaceScripts) {
    const group = grouped.get(script.manifestPath);
    if (!group) continue;
    const parsed = parse(group.join('\n'), toolsFor(script.command)!);
    incomplete ||= parsed.incomplete;
    if (parsed.entries.length) parsers.add(parsed.parser);
    entries.push(...parsed.entries.map(entry => JSON.stringify([script.manifestPath, entry])));
  }
  return { entries: entries.sort(), parser: [...parsers].sort().join('+') || 'unavailable', incomplete };
}

/** A nonzero exit is necessary, but never sufficient, evidence of original reproduction. */
export function compareFailureIdentity(native: NativeFailureEvidence | undefined, sandbox: { log: string; exitCode: number; truncated?: boolean }): FailureIdentityEvidence {
  const base = { version: 'sutura-failure-identity-v1' as const, parser: 'unavailable', ...(native?.selectedStep ? { selectedStep: native.selectedStep } : {}) };
  const unavailable = (reason: string): FailureIdentityEvidence => ({ ...base, status: 'unavailable', reason });
  if (!native) return unavailable('Native selected-step evidence is required');
  if (sandbox.exitCode === 0) return unavailable('A passing probe is not failure reproduction');
  if (native.truncated || sandbox.truncated || native.log.length > 1_000_000 || sandbox.log.length > 1_000_000 || !native.log.trim()) return unavailable('Complete native and sandbox diagnostic logs are required');
  const command = underlying(native), tools = command ? toolsFor(command) : undefined;
  if (!tools) return unavailable('Supported tool command and exact package-script provenance are required');
  const source = parseEvidence(native.log, native, tools);
  if (!source.entries.length || source.incomplete) return unavailable('Native diagnostics lack a complete supported failure identity');
  const probe = parseEvidence(sandbox.log, native, tools);
  const nativeFingerprint = digest(JSON.stringify(source.entries));
  if (source.parser === 'dependency-advisory' && !probe.entries.length) return { ...base, parser: source.parser, status: 'mismatch', reason: 'Native vulnerability findings; sandbox scanner evidence unavailable', nativeFingerprint };
  if (/\b(?:command not found|No such file or directory|not found: (?:vitest|pytest|node|python|tsc))\b/u.test(sandbox.log) && !probe.entries.length) {
    return { ...base, parser: source.parser, status: 'mismatch', reason: 'Sandbox prerequisite evidence differs from the native failure', nativeFingerprint };
  }
  if (!probe.entries.length || probe.incomplete) return { ...unavailable('Sandbox diagnostics lack a complete supported failure identity'), parser: source.parser, nativeFingerprint };
  const sandboxFingerprint = digest(JSON.stringify(probe.entries));
  return { ...base, parser: source.parser, nativeFingerprint, sandboxFingerprint, status: nativeFingerprint === sandboxFingerprint ? 'matched' : 'mismatch',
    reason: nativeFingerprint === sandboxFingerprint ? 'Complete diagnostic identities agree' : 'Native and sandbox diagnostic identities differ' };
}
