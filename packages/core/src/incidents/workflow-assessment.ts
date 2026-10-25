import { isAlias, parseDocument, visit } from 'yaml';
import { nativeExecutionCommand, nativeFailureForCommand } from '../engine/failure-identity.js';
import { ASSESSMENT_BOUNDS } from './assess.js';
import type { JobAssessmentInput } from './types.js';

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Parse only bounded workflow data. No expressions, aliases, custom tags or commands are evaluated. */
export function parseAssessmentWorkflow(source: string): Record<string, unknown> {
  if (Buffer.byteLength(source) > ASSESSMENT_BOUNDS.metadataFileBytes) throw new Error('workflow-byte-limit');
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length || document.warnings.length) throw new Error('workflow-yaml-invalid');
  let nodes = 0;
  visit(document, (_key, node, path) => {
    if (++nodes > 10_000 || path.length > 32 || isAlias(node)) throw new Error('workflow-structure-unsupported');
  });
  const value = object(document.toJS({ maxAliasCount: 0 }));
  if (!value) throw new Error('workflow-object-required');
  return value;
}

/** Keep nested package manifests scoped to declared workspaces, not unrelated projects or examples. */
export function selectAssessmentMetadata(files: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  if (files['package.json'] === undefined) return files;
  const manifest = object(JSON.parse(files['package.json']));
  if (!manifest) throw new Error('manifest-object-required');
  const workspaces = manifest.workspaces;
  const patterns: unknown[] = [];
  if (workspaces !== undefined) {
    const values = Array.isArray(workspaces) ? workspaces : object(workspaces)?.packages;
    if (!Array.isArray(values)) throw new Error('workspace-format-unsupported');
    patterns.push(...values);
  }
  if (files['pnpm-workspace.yaml'] !== undefined) {
    const values = parseAssessmentWorkflow(files['pnpm-workspace.yaml']).packages;
    if (!Array.isArray(values)) throw new Error('workspace-format-unsupported');
    patterns.push(...values);
  }
  if (patterns.length > 256 || !patterns.every(pattern => typeof pattern === 'string' && pattern !== '' &&
    !pattern.startsWith('/') && !pattern.startsWith('!') && !pattern.includes('\\') && !/[{}[\]]/u.test(pattern) &&
    pattern.split('/').length <= 16 && !pattern.split('/').some(segment => segment === '..' || segment === '' ||
      (segment.includes('*') && segment !== '*' && segment !== '**')))) throw new Error('workspace-pattern-unsupported');
  function matches(path: string, pattern: string): boolean {
    const parts = path.split('/'), tokens = pattern.split('/'), memo = new Map<string, boolean>();
    function match(i: number, j: number): boolean {
      const key = `${i}:${j}`, prior = memo.get(key);
      if (prior !== undefined) return prior;
      const value = j === tokens.length ? i === parts.length : tokens[j] === '**' ?
        match(i, j + 1) || (i < parts.length && match(i + 1, j)) :
        i < parts.length && (tokens[j] === '*' || tokens[j] === parts[i]) && match(i + 1, j + 1);
      memo.set(key, value); return value;
    }
    return match(0, 0);
  }
  return Object.fromEntries(Object.entries(files).filter(([path]) => !path.endsWith('/package.json') ||
    patterns.some(pattern => matches(path.slice(0, -'/package.json'.length), pattern as string))));
}

export interface AssessmentWorkflowJob { jobKey: string; job: JobAssessmentInput['job'] }
const PREPARE = /^(?:npm ci(?: --ignore-scripts)?|pnpm install --frozen-lockfile(?: --ignore-scripts)?|yarn install --immutable|uv sync --(?:frozen|locked)(?: --all-extras)?)$/u;
const NATIVE = /(?:^|[\s;&|])(?:sudo|apt-get|apt|brew|docker|supabase|service|systemctl|make|gcc|cmake)(?:\s|$)/u;
const KNOWN_ACTION = /^(?:actions\/(?:checkout|setup-node|setup-python|cache)|pnpm\/action-setup|astral-sh\/setup-uv)@[A-Za-z0-9._/-]+$/u;

/** Static selected-job facts shared by local and authenticated remote adapters. Unknown syntax stays unknown. */
export function extractAssessmentJobs(workflow: Record<string, unknown>, files: Readonly<Record<string, string>>): AssessmentWorkflowJob[] {
  const jobs = object(workflow.jobs);
  if (!jobs || Object.keys(jobs).length > 128) throw new Error('workflow-jobs-unavailable');
  const sources = Object.entries(files).filter(([path]) => path === 'package.json' || path.endsWith('/package.json')).map(([path, content]) => ({ path, content }));
  return Object.entries(jobs).map(([jobKey, value]) => {
    const source = object(value) ?? {}, commands: string[] = [];
    const job: JobAssessmentInput['job'] = { command: '', services: source.services === undefined ? 'absent' : 'present',
      applicationSecrets: 'absent', nativePreparation: source.container === undefined ? 'absent' : 'present', privateDependencies: 'absent',
      dynamicConfiguration: 'absent', workspaceEvidenceComplete: true };
    // Workflow env/defaults affect every job; unrelated jobs do not.
    const context = JSON.stringify({ env: workflow.env, defaults: workflow.defaults, job: source });
    if (/\bsecrets\s*(?:\.|\[)/u.test(context)) job.applicationSecrets = 'present';
    if (/\$\{\{/u.test(context) || source.if !== undefined || source.strategy !== undefined || source.uses !== undefined ||
      source.defaults !== undefined || workflow.defaults !== undefined || source.environment !== undefined) job.dynamicConfiguration = 'unknown';
    const runner = source['runs-on'];
    if (typeof runner === 'string' && /^(?:windows|macos)-/u.test(runner)) job.nativePreparation = 'present';
    else if (runner !== undefined && (typeof runner !== 'string' || !/^ubuntu-(?:latest|22\.04|24\.04)$/u.test(runner))) job.dynamicConfiguration = 'unknown';
    if (!Array.isArray(source.steps) || source.steps.length > 256) job.dynamicConfiguration = 'unknown';
    const runtimes = new Set<'node' | 'python'>();
    for (const raw of Array.isArray(source.steps) ? source.steps.slice(0, 256) : []) {
      const step = object(raw);
      if (!step) { job.dynamicConfiguration = 'unknown'; continue; }
      if (step.if !== undefined || step['working-directory'] !== undefined || (step.shell !== undefined && step.shell !== 'bash')) job.dynamicConfiguration = 'unknown';
      if (step.uses !== undefined) {
        if (typeof step.uses !== 'string' || !KNOWN_ACTION.test(step.uses)) job.dynamicConfiguration = 'unknown';
        else if (step.uses.startsWith('actions/checkout@')) {
          const config = object(step.with);
          if (config && Object.keys(config).some(key => !['fetch-depth', 'persist-credentials', 'fetch-tags'].includes(key))) job.dynamicConfiguration = 'unknown';
        } else if (step.uses.startsWith('actions/setup-node@')) {
          const config = object(step.with);
          if (config?.['node-version-file'] !== undefined && config['node-version-file'] !== '.nvmrc') job.dynamicConfiguration = 'unknown';
          if (config?.['registry-url'] !== undefined && config['registry-url'] !== 'https://registry.npmjs.org') job.privateDependencies = 'present';
          runtimes.add('node');
          const version = object(step.with)?.['node-version'];
          if (version !== undefined && !/^(?:22|24)(?:\.\d+(?:\.\d+|\.x)?|\.x)?$/u.test(String(version))) job.nativePreparation = 'present';
        } else if (step.uses.startsWith('actions/setup-python@')) {
          runtimes.add('python');
          const version = object(step.with)?.['python-version'];
          if (version !== undefined && !/^3\.13(?:\.11|\.x)?$/u.test(String(version))) job.nativePreparation = 'present';
        }
      }
      if (step.run === undefined) continue;
      if (typeof step.run !== 'string') { job.dynamicConfiguration = 'unknown'; continue; }
      for (const line of step.run.split(/\r?\n/u).map(item => item.trim()).filter(item => item && !item.startsWith('#'))) {
        if (NATIVE.test(line)) job.nativePreparation = 'present';
        if (PREPARE.test(line)) continue;
        // uv run selects the frozen Python environment; it does not execute during assessment.
        const inspection = line.replace(/^uv run (?:--(?:frozen|locked) )?/u, '');
        const provenance = nativeFailureForCommand(inspection, '', sources);
        const terminal = nativeExecutionCommand(provenance);
        if (!terminal) { job.dynamicConfiguration = 'unknown'; continue; }
        const scripts = provenance.workspaceScripts ?? provenance.scriptChain ?? (provenance.script ? [provenance.script] : []);
        for (const script of scripts) {
          try {
            const manifest = object(JSON.parse(files[script.manifestPath] ?? 'null'));
            const declarations = object(manifest?.scripts);
            if (declarations?.[`pre${script.name}`] !== undefined || declarations?.[`post${script.name}`] !== undefined) job.dynamicConfiguration = 'unknown';
          } catch { job.dynamicConfiguration = 'unknown'; }
        }
        commands.push(line);
      }
    }
    if (runtimes.size === 1) job.configuredRuntime = [...runtimes][0]!;
    else if (runtimes.size > 1) job.dynamicConfiguration = 'unknown';
    if (!commands.length) job.dynamicConfiguration = 'unknown';
    job.command = commands.join(' && ');
    return { jobKey, job };
  });
}
