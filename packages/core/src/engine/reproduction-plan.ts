import { createHash } from 'node:crypto';
import type { RepositoryPolicy } from '../policy/schema.js';
import { parseReproductionProfiles, type ReproductionProfile } from '../policy/reproduction-profile.js';
import { policyAllowsSourceRead } from '../policy/evaluate.js';
import { parseAssessmentWorkflow } from '../incidents/workflow-assessment.js';
import { canonicalJson } from '../replay/canonical-json.js';
import { shellQuote } from './shell.js';
import { isCapturedDiagnostics, type NativeDiagnostics } from './native-diagnostics.js';
const readyPlans = new WeakSet<object>();
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
export interface ResolvedReproductionPlan {
  profile: ReproductionProfile;
  profileSha256: string;
  policySha256: string;
  native: NativeDiagnostics;
  probeCommand: string;
  fullCommand: string;
  cwd: string;
  policy: RepositoryPolicy;
}
export type ReproductionResolution = { status: 'not-profiled' } | { status: 'stopped'; reason: string; nextAction: string } | { status: 'ready'; plan: ResolvedReproductionPlan };
export interface ReproductionPlanInput {
  policy: RepositoryPolicy; policySha256: string; command: string; runtimeId: 'node' | 'python'; sourceSha: string;
  native: NativeDiagnostics | undefined;
  sources: Readonly<Record<string, string>>;
  sourcePaths?: readonly string[];
}
export function isResolvedReproductionPlan(value: unknown): value is ResolvedReproductionPlan {
  return typeof value === 'object' && value !== null && readyPlans.has(value);
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function observedCwd(input: ReproductionPlanInput, profile: ReproductionProfile): string | undefined {
  const binding = input.native?.binding;
  if (!binding?.workflowPath || !binding.jobName || !binding.stepName || !profile.sourceInputs.some(item => item.path === binding.workflowPath)) return undefined;
  const source = input.sources[binding.workflowPath];
  if (source === undefined) return undefined;
  try {
    const workflow = parseAssessmentWorkflow(source), jobs = record(workflow.jobs);
    const matches = Object.entries(jobs ?? {}).filter(([key, value]) => (record(value)?.name ?? key) === binding.jobName);
    if (matches.length !== 1) return undefined;
    const job = record(matches[0]![1]);
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    const selected = steps.map(record).filter(step => step && (step.name === binding.stepName || (typeof step.run === 'string' && step.run.trim() === profile.nativeCommand)));
    if (selected.length !== 1 || typeof selected[0]?.run !== 'string' || selected[0].run.trim() !== profile.nativeCommand) return undefined;
    const cwd = selected[0]['working-directory'] ?? record(record(job?.defaults)?.run)?.['working-directory'] ?? record(record(workflow.defaults)?.run)?.['working-directory'] ?? '.';
    return typeof cwd === 'string' && !cwd.includes('${{') ? cwd.replace(/^\.\//u, '') || '.' : undefined;
  } catch { return undefined; }
}
/** Resolve only protected policy data against complete captured source evidence and exact input bytes. */
export function resolveReproductionPlan(input: ReproductionPlanInput): ReproductionResolution {
  const declared = input.policy.reproductionProfiles?.filter(profile => profile.nativeCommand === input.command) ?? [];
  if (!declared.length) return { status: 'not-profiled' };
  const stopped = (reason: string, detail: string): ReproductionResolution => ({ status: 'stopped', reason,
    nextAction: `${detail}. Prepare a reviewed protected .sutura.json reproduction profile for the exact source; do not execute an unreviewed wrapper.` });
  if (declared.length !== 1) return stopped('reproduction-profile-ambiguous', 'Multiple profiles match the observed command');
  let profile: ReproductionProfile;
  try { profile = parseReproductionProfiles(declared)[0]!; }
  catch (error) { return stopped('reproduction-profile-invalid', error instanceof Error ? error.message : 'Profile validation failed'); }
  const native = input.native;
  if (!isCapturedDiagnostics(native) || !native.complete || !native.summary || native.summary.failed < 1) return stopped('native-diagnostics-incomplete', native?.reason ?? 'Complete captured native diagnostics are unavailable');
  if (native.binding.sourceSha !== input.sourceSha || !/^[a-f0-9]{64}$/u.test(input.policySha256)) return stopped('reproduction-profile-source-mismatch', 'Source or protected policy identity differs');
  if (input.runtimeId !== 'node' || native.binding.runtimeVersion !== profile.nativeNodeVersion) return stopped('reproduction-profile-runtime-mismatch', `Observed native runtime ${native.binding.runtimeVersion ?? 'unknown'} does not match required Node ${profile.nativeNodeVersion}`);
  let bytes = 0;
  for (const item of profile.sourceInputs) {
    if (!policyAllowsSourceRead(item.path, input.policy)) return stopped('reproduction-profile-read-denied', `Protected policy denies input ${item.path}`);
    const content = input.sources[item.path];
    if (content === undefined) return stopped('reproduction-profile-input-missing', `Missing input ${item.path}`);
    bytes += Buffer.byteLength(content);
    if (Buffer.byteLength(content) > 1_048_576 || bytes > 8_388_608) return stopped('reproduction-profile-input-limit', `Input bounds exceeded at ${item.path}`);
    const observed = sha(content);
    if (observed !== item.sha256) return stopped('reproduction-profile-stale', `Changed input ${item.path}: expected ${item.sha256}, observed ${observed}`);
  }
  const paths = input.sourcePaths ?? Object.keys(input.sources);
  const required = ['package.json', 'pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', '.nvmrc', 'pnpm-workspace.yaml'];
  const directories = profile.cwd === '.' ? [''] : ['', ...profile.cwd.split('/').map((_part, index, parts) => parts.slice(0, index + 1).join('/') + '/')];
  const missing = directories.flatMap(directory => required.map(path => `${directory}${path}`)).find(path => paths.includes(path) && !profile.sourceInputs.some(item => item.path === path));
  if (missing) return stopped('reproduction-profile-input-missing', `Reviewed dependency/runtime input ${missing} has no digest`);
  const cwd = observedCwd(input, profile);
  if (cwd === undefined || cwd !== profile.cwd) return stopped('reproduction-profile-cwd-mismatch', `Observed native cwd ${cwd ?? 'unknown'} does not match profile cwd ${profile.cwd}`);
  const prefix = profile.cwd === '.' ? '' : `${profile.cwd}/`;
  const files = [...new Set(native.identities.map(identity => {
    const file = identity.file;
    return prefix && file.startsWith(prefix) ? file.slice(prefix.length) : file;
  }))];
  const canonicalFiles = files.map(file => `${prefix}${file}`);
  if (!files.length || canonicalFiles.some(file => !policyAllowsSourceRead(file, input.policy))) return stopped('reproduction-profile-read-denied', 'Native failing files are unavailable to the protected policy');
  const policy = Object.freeze({ ...input.policy, protectedPaths: [...new Set([...input.policy.protectedPaths, ...profile.sourceInputs.map(item => item.path)])] });
  const plan: ResolvedReproductionPlan = Object.freeze({ profile, policySha256: input.policySha256, profileSha256: sha(canonicalJson(profile)), native,
    probeCommand: [...profile.argv, ...files].map(shellQuote).join(' '), fullCommand: profile.fullCommand,
    cwd: profile.cwd === '.' ? '/workspace' : `/workspace/${profile.cwd}`, policy });
  readyPlans.add(plan);
  return { status: 'ready', plan };
}
