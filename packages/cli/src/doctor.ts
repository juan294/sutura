import { Buffer } from 'node:buffer';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseAssessmentWorkflow, type TargetRuntimeContract } from '@sutura/core';
import type { DoctorArguments } from './args.js';
import { VERSION } from './args.js';
import { assessRepository } from './assess.js';
import { type CommandRunner, resolveRepository, runCommand } from './command.js';
import { assessReachability, record, type ReachabilityInput, type ReachabilityResult } from './doctor-reachability.js';
import { resolveActionCommit } from './release.js';

export interface DoctorOptions { cwd?: string; run?: CommandRunner; now?: () => Date }
export interface DoctorResult { exitCode: 0 | 1 | 2; lines: string[]; reachability?: ReachabilityResult }
const WORKFLOW_PATH = '.github/workflows/sutura.yml';
const MAX_BYTES = 1_048_576;
function line(passed: boolean, text: string): string { return `[${passed ? 'PASS' : 'FAIL'}] ${text}`; }
function listed(output: string): Set<string> { return new Set(output.split(/\r?\n/u).map(value => value.trim()).filter(Boolean)); }
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function reference(value: unknown, context: 'secrets' | 'vars'): string | undefined {
  return new RegExp(`^\\$\\{\\{\\s*${context}\\.([A-Za-z_][A-Za-z0-9_]*)\\s*\\}\\}$`, 'u').exec(text(value))?.[1];
}
interface ActionStep { jobKey: string; job: Record<string, unknown>; steps: Record<string, unknown>[]; index: number; step: Record<string, unknown>; sha: string }
function actionSteps(workflow: Record<string, unknown>): ActionStep[] {
  return Object.entries(record(workflow.jobs)).flatMap(([jobKey, value]) => {
    const job = record(value), steps = Array.isArray(job.steps) ? job.steps.map(record) : [];
    return steps.flatMap((step, index) => {
      const sha = /^juan294\/sutura@([a-f0-9]{40})$/iu.exec(text(step.uses))?.[1];
      return sha ? [{ jobKey, job, steps, index, step, sha: sha.toLowerCase() }] : [];
    });
  });
}
function appToken(action: ActionStep): { valid: boolean; app: boolean; secret?: string; variable?: string } {
  const token = text(record(action.step.with)['github-token']);
  if (/^\$\{\{\s*(?:github\.token|secrets\.GITHUB_TOKEN)\s*\}\}$/u.test(token)) return { valid: true, app: false };
  const id = /^\$\{\{\s*steps\.([\w-]+)\.outputs\.token\s*\}\}$/u.exec(token)?.[1];
  const producers = action.steps.slice(0, action.index).filter(step => step.id === id && /^actions\/create-github-app-token@\S+$/u.test(text(step.uses)));
  const producer = producers.length === 1 ? producers[0] : undefined;
  const inputs = record(producer?.with), secret = reference(inputs['private-key'], 'secrets'), variable = reference(inputs['app-id'], 'vars');
  const literalId = /^\d+$/u.test(text(inputs['app-id']));
  return { valid: !!producer && (producer.if === undefined || producer.if === true) && !!secret && (!!variable || literalId), app: true, ...(secret ? { secret } : {}), ...(variable ? { variable } : {}) };
}
async function workflowBytes(cwd: string): Promise<string> {
  for (const path of ['.github', '.github/workflows', WORKFLOW_PATH]) {
    const metadata = await lstat(join(cwd, path));
    if (metadata.isSymbolicLink() || (path === WORKFLOW_PATH ? !metadata.isFile() || metadata.size > MAX_BYTES : !metadata.isDirectory())) throw new Error('unsafe or oversized workflow path');
  }
  return readFile(join(cwd, WORKFLOW_PATH), 'utf8');
}
function decodeContent(value: unknown): string {
  const data = record(value);
  if (data.encoding !== 'base64' || typeof data.content !== 'string' || data.content.length > MAX_BYTES * 2 || data.type !== 'file') throw new Error('Workflow content is unavailable or exceeds bounds');
  const bytes = Buffer.from(data.content, 'base64');
  if (bytes.length > MAX_BYTES) throw new Error('Workflow content exceeds bounds');
  return bytes.toString('utf8');
}

export async function doctorSutura(request: DoctorArguments, options: DoctorOptions = {}): Promise<DoctorResult> {
  const cwd = options.cwd ?? process.cwd(), adapter = options.run ?? runCommand;
  const run: CommandRunner = (command, args, options = {}) => adapter(command, args, { ...options, timeoutMs: 10_000, maxOutputBytes: MAX_BYTES * 2 });
  const observedAt = (options.now?.() ?? new Date()).toISOString(), lines: string[] = [];
  let operationalFailure = false, configured = true, workflow: Record<string, unknown> = {}, bytes = '';
  try { bytes = await workflowBytes(cwd); workflow = parseAssessmentWorkflow(bytes); lines.push(line(true, 'Sutura workflow exists.')); }
  catch { configured = false; lines.push(line(false, 'Sutura workflow is missing, unsafe or malformed.')); }
  const actions = actionSteps(workflow), installed = [...new Set(actions.map(action => action.sha))];
  let desired: string | undefined;
  try { desired = await resolveActionCommit({ version: VERSION, cwd, run, ...(request.actionSha ? { explicitCommit: request.actionSha } : {}) }); }
  catch { operationalFailure = true; lines.push('[FAIL] Desired Action release could not be resolved.'); }
  lines.push(`[INFO] CLI ${VERSION}; desired Action ${desired ?? 'unknown'}; installed Action ${installed.join(', ') || 'unknown'}.`);
  lines.push(line(actions.length > 0, `Workflow uses juan294/sutura@${installed[0] ?? desired ?? '[unresolved]'}.`));
  if (!actions.length) configured = false;
  const requiredSecrets = new Set<string>(), requiredVariables = new Set<string>();
  for (const action of actions) {
    const effectivePermissions = action.job.permissions ?? workflow.permissions;
    const token = appToken(action), inputs = record(action.step.with), inspection = inputs.mode === 'inspect';
    if (inspection) {
      const readonly = typeof effectivePermissions === 'object' && effectivePermissions !== null &&
        Object.values(record(effectivePermissions)).every(value => value === 'read' || value === 'none') &&
        record(effectivePermissions).actions === 'read' && record(effectivePermissions).contents === 'read' &&
        !token.app && !/secrets\./u.test(JSON.stringify([action.job, workflow.env])) &&
        Object.keys(inputs).every(key => ['mode', 'github-token', 'run-id', 'runtime'].includes(key));
      lines.push(line(readonly, 'Inspect job has read-only repository permissions.')); configured &&= readonly;
    } else {
      const checksWrite = effectivePermissions === 'write-all' || record(effectivePermissions).checks === 'write';
      lines.push(line(checksWrite, 'Workflow grants checks: write.')); configured &&= checksWrite;
      if (inputs.mode !== undefined && !['heal', 'verify'].includes(text(inputs.mode))) configured = false;
    }
    const wiring: [string, boolean][] = [
      ['github-token', token.valid],
      ['run-id', /^\$\{\{\s*github\.event\.workflow_run\.id\s*\}\}$/u.test(text(inputs['run-id']))],
      ['runtime', inputs.runtime === undefined || ['auto', 'node', 'python'].includes(text(inputs.runtime))],
    ];
    for (const name of inspection ? [] : ['nebius-api-key', 'contree-token']) {
      const key = reference(inputs[name], 'secrets'); if (key) requiredSecrets.add(key);
      wiring.push([name, !!key]);
    }
    if (!inspection) {
      const project = reference(inputs['contree-project'], 'vars'); if (project) requiredVariables.add(project);
      wiring.push(['contree-project', !!project]);
    }
    if (token.secret) requiredSecrets.add(token.secret); if (token.variable) requiredVariables.add(token.variable);
    for (const [name, valid] of wiring) { configured &&= valid; lines.push(line(valid, `Workflow wires ${name}.`)); }
    lines.push(`[INFO] ${action.jobKey}: ${token.app ? 'App token wiring; installation access and native PR-check approval remain unverified.' : 'Workflow token; created PRs normally need explicit native CI admission.'}`);
    const limits = ['repair-inference-cost-usd', 'repair-second-opinion-usd', 'repair-typesafe-audit-usd', 'triage-sandbox-seconds', 'repair-sandbox-seconds']
      .map(name => `${name}=${text(inputs[name]) || 'installed Action default (unresolved)'}`);
    lines.push(`[INFO] Configured limits (${action.jobKey}): ${limits.join(', ')}. Inference pools are not a total cost cap.`);
  }
  if (!actions.length) lines.push('[FAIL] Workflow grants checks: write.', '[FAIL] Workflow wires github-token.');
  lines.push('[INFO] Total attempt price unknown: sandbox and GitHub runner charges are unpriced; no price lookup or paid smoke was performed.');
  let reachability: ReachabilityResult | undefined;
  let activatedState: boolean | undefined;
  const watchedPaths = new Set<string>();
  let target: TargetRuntimeContract = { kind: 'installed-action', ...(installed.length === 1 ? { actionSha: installed[0]! } : {}) };
  try {
    const repository = await resolveRepository(cwd, request.repository, run);
    if (!/^[\w.-]+\/[\w.-]+$/u.test(repository)) throw new Error('Invalid repository scope');
    const api = async (path: string): Promise<unknown> => {
      const output = await run('gh', ['api', path], { cwd });
      if (Buffer.byteLength(output) > MAX_BYTES * 2) throw new Error('GitHub metadata exceeds bounded response size');
      return JSON.parse(output) as unknown;
    };
    lines.push(`[INFO] Read scope: ${repository} secret/variable names, default workflow, exact Action contract, and at most 100 recent runs; no credential values or provider calls.`);
    const secrets = listed(await run('gh', ['secret', 'list', '--repo', repository, '--json', 'name', '--jq', '.[].name'], { cwd }));
    const variables = listed(await run('gh', ['variable', 'list', '--repo', repository, '--json', 'name', '--jq', '.[].name'], { cwd }));
    for (const name of requiredSecrets) { const present = secrets.has(name); configured &&= present; lines.push(line(present, `GitHub secret ${name} is ${present ? 'configured' : 'missing'}.`)); }
    for (const name of requiredVariables) { const present = variables.has(name); configured &&= present; lines.push(line(present, `GitHub variable ${name} is ${present ? 'configured' : 'missing'}.`)); }
    lines.push('[INFO] Name presence does not validate credential values, provider access or App permissions.');
    if (installed.length === 1) {
      try {
        const source = decodeContent(await api(`repos/juan294/sutura/contents/packages/core/src/incidents/types.ts?ref=${installed[0]}`));
        const version = /^export const RUNTIME_SUPPORT_CONTRACT = '([^']+)' as const;$/mu.exec(source)?.[1];
        if (version) target = { kind: 'installed-action', actionSha: installed[0]!, resolvedFromActionSha: installed[0]!, runtimeContractVersion: version };
      } catch { lines.push('[INFO] Installed Action runtime contract unavailable; newer CLI support is not attributed to it.'); }
    }
    const repo = record(await api(`repos/${repository}`)), branch = text(repo.default_branch);
    if (!branch) throw new Error('Default branch metadata unavailable');
    const head = record(await api(`repos/${repository}/commits/${encodeURIComponent(branch)}`)), sha = text(head.sha);
    if (!/^[a-f0-9]{40}$/iu.test(sha)) throw new Error('Default branch identity unavailable');
    let activated: boolean | undefined;
    try { activated = decodeContent(await api(`repos/${repository}/contents/${WORKFLOW_PATH}?ref=${sha}`)) === bytes; }
    catch { lines.push('[INFO] Default-branch workflow contents unavailable; activation unknown.'); }
    activatedState = activated;
    const collection = record(await api(`repos/${repository}/actions/workflows?per_page=100`));
    const workflows = Array.isArray(collection.workflows) ? collection.workflows.map(record) : [];
    const sources: ReachabilityInput['sources'][number][] = [];
    const watched = record(record(workflow.on).workflow_run).workflows;
    for (const item of workflows.filter(item => Array.isArray(watched) && watched.includes(item.name)).slice(0, 10)) {
      const path = text(item.path); if (!/^\.github\/workflows\/[\w.-]+\.ya?ml$/u.test(path)) continue;
      const definition = parseAssessmentWorkflow(decodeContent(await api(`repos/${repository}/contents/${path}?ref=${sha}`)));
      const on = definition.on, events = typeof on === 'string' ? [on] : Array.isArray(on) ? on.filter((value): value is string => typeof value === 'string') : Object.keys(record(on));
      sources.push({ path, name: text(item.name), events }); watchedPaths.add(path);
    }
    const commits = await api(`repos/${repository}/commits?path=${encodeURIComponent(WORKFLOW_PATH)}&sha=${sha}&per_page=1`);
    const latest = Array.isArray(commits) ? record(commits[0]) : {};
    const since = text(record(record(latest.commit).committer).date);
    const history = record(await api(`repos/${repository}/actions/runs?per_page=100`));
    const runs = Array.isArray(history.workflow_runs) ? history.workflow_runs.map(record) : [];
    let disabled: boolean | undefined = false;
    if (variables.has('SUTURA_DISABLED')) disabled = (await run('gh', ['variable', 'get', 'SUTURA_DISABLED', '--repo', repository], { cwd })).trim() === 'true';
    const monitor = workflows.find(item => item.path === WORKFLOW_PATH);
    const sourceRuns = runs.filter(item => typeof item.id === 'number' && typeof item.name === 'string' && typeof item.event === 'string' && typeof item.head_branch === 'string' && typeof item.updated_at === 'string').map(item => ({ id: item.id as number, name: text(item.name), event: text(item.event), conclusion: typeof item.conclusion === 'string' ? item.conclusion : null, head_branch: text(item.head_branch), updated_at: text(item.updated_at) }));
    const monitorRuns = runs.filter(item => item.workflow_id === monitor?.id && item.event === 'workflow_run').map(item => ({ created_at: text(item.created_at) }));
    const deliveredRunIds: number[] = [];
    for (const failed of sourceRuns.filter(item => ['failure', 'timed_out'].includes(item.conclusion ?? '') && sources.some(source => source.name === item.name)).slice(0, 10)) {
      const original = runs.find(item => item.id === failed.id), headSha = text(original?.head_sha);
      if (!/^[a-f0-9]{40}$/iu.test(headSha)) continue;
      const checks = record(await api(`repos/${repository}/commits/${headSha}/check-runs?per_page=100`));
      if (Array.isArray(checks.check_runs) && checks.check_runs.map(record).some(check => check.name === 'Sutura repair audit' && check.external_id === `sutura:${repository}:workflow-run:${failed.id}` && record(check.app).slug === 'github-actions' && actions.some(action => !appToken(action).app))) deliveredRunIds.push(failed.id);
    }
    reachability = assessReachability({ workflow, sources, activated, disabled, observedAt, since,
      complete: Number.isInteger(history.total_count) && Number(history.total_count) <= 100 && Number(collection.total_count) <= 100,
      sourceRuns, monitorRuns, deliveredRunIds });
    lines.push(`[INFO] Default branch ${branch}@${sha}: activated=${activated}; reachability=${reachability.status}; window ${since || 'unknown'} to ${observedAt}. ${reachability.reason}`);
    const last = runs.filter(item => item.workflow_id === monitor?.id).sort((a, b) => text(b.updated_at).localeCompare(text(a.updated_at)))[0];
    if (last) lines.push(`[INFO] Last monitor run ${String(last.id)}: conclusion=${text(last.conclusion) || 'pending'}; observed ${text(last.updated_at)}; ageSeconds=${Math.max(0, Math.floor((Date.parse(observedAt) - Date.parse(text(last.updated_at))) / 1000))}. Preparation/reproduction outcome unavailable from run conclusion; inspect gh run view ${String(last.id)} --repo ${repository} --log.`);
    else lines.push('[INFO] No monitor run in the bounded history; preparation/reproduction remain unmeasured.');
  } catch {
    operationalFailure = true; lines.push('[FAIL] Scoped GitHub metadata could not be inspected completely; no readiness inferred.');
  }
  let assessed = false, candidate = false;
  try {
    const assessment = await assessRepository(cwd, { target, now: () => new Date(observedAt) });
    assessed = assessment.complete;
    for (const job of assessment.jobs) {
      lines.push(`[INFO] ${job.scope.workflowPath} / ${job.scope.jobKey}: ${job.support}; ${job.schemaVersion}; ${job.reason}; covered=${job.coveredFailureClasses.join(', ') || 'none'}; prerequisites=${job.requiredInput.join('; ') || 'none identified'}. Next: ${job.nextAction}`);
    }
    const applicable = assessment.jobs.filter(job => watchedPaths.has(job.scope.workflowPath));
    candidate = applicable.some(job => job.support === 'candidate-supported');
    lines.push(`[INFO] Assessment complete=${assessment.complete}; scope=${assessment.scopeKind}; digest=${assessment.scopeDigest}. Static candidate support is not preparation proof.`);
  } catch { operationalFailure = true; lines.push('[FAIL] Bounded local assessment could not complete.'); }
  lines.push(`[INFO] Readiness: assessed=${assessed ? 'observed' : 'unknown'}; configured=${configured ? 'observed' : 'incomplete'}; activated=${activatedState === true ? 'observed' : activatedState === false ? 'absent' : 'unknown'}; prepared=unmeasured; reproduced=unmeasured; native-verified=unmeasured; integrated=unmeasured.`);
  const incomplete = !configured || !assessed || !candidate || !reachability || !['configured-unexercised', 'observed-delivery'].includes(reachability.status);
  lines.push(`[INFO] Next: ${incomplete ? 'resolve the scoped assessment or configuration gaps, then rerun sutura doctor' : 'select one real failed run and review provider access and total unpriced costs before authorizing preparation'}. No paid execution was attempted.`);
  return { exitCode: operationalFailure ? 1 : incomplete ? 2 : 0, lines, ...(reachability ? { reachability } : {}) };
}
