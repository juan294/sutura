export type ReachabilityStatus = 'configured-unexercised' | 'observed-delivery' | 'missed-eligible-event' | 'misconfigured' | 'unknown';
export interface ReachabilityInput {
  workflow: Record<string, unknown>;
  sources: readonly { path: string; name: string; events: readonly string[] }[];
  activated: boolean | undefined;
  disabled: boolean | undefined;
  observedAt: string;
  since: string;
  complete: boolean;
  sourceRuns: readonly { id: number; name: string; event: string; conclusion: string | null; head_branch: string; updated_at: string }[];
  monitorRuns: readonly { created_at: string }[];
  deliveredRunIds: readonly number[];
}
export interface ReachabilityResult { status: ReachabilityStatus; reason: string; since: string; observedAt: string; eligibleRunIds: number[]; watched: string[] }
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function names(value: unknown): string[] | undefined {
  const values = typeof value === 'string' ? [value] : value;
  return Array.isArray(values) && values.every(item => typeof item === 'string' && !/[${}*?!]/u.test(item)) ? values : undefined;
}
/** Conservative admission for the shipped failure/recursion/disable guards; arbitrary expressions stay unknown. */
function conditionAtoms(value: unknown): string[] | undefined {
  if (value === undefined || value === true) return [];
  if (typeof value !== 'string') return undefined;
  const expression = value.replace(/^\s*\$\{\{|\}\}\s*$/gu, '')
    .replace(/needs\.inspect\.outputs\[['"]repair-eligible['"]\]\s*==\s*['"]true['"]/gu, 'I')
    .replace(/vars\.SUTURA_DISABLED\s*!=\s*['"]true['"]/gu, 'D')
    .replace(/!startsWith\(github\.event\.workflow_run\.head_branch,\s*['"]sutura\/fix-['"]\)/gu, 'R')
    .replace(/github\.event\.workflow_run\.conclusion\s*==\s*['"]failure['"]/gu, 'F')
    .replace(/github\.event\.workflow_run\.conclusion\s*==\s*['"]timed_out['"]/gu, 'T')
    .replace(/\s/gu, '')
    // The only supported OR is the grouped failure/timeout choice, never an admission guard.
    .replace(/\((?:F\|\|T|T\|\|F)\)/gu, 'C');
  return /^[DRFTCI](?:&&[DRFTCI])*$/u.test(expression) ? expression.split('&&') : undefined;
}
export function assessReachability(input: ReachabilityInput): ReachabilityResult {
  const trigger = record(record(input.workflow.on).workflow_run), watched = names(trigger.workflows) ?? [];
  const result = (status: ReachabilityStatus, reason: string, eligibleRunIds: number[] = []): ReachabilityResult => ({ status, reason, since: input.since, observedAt: input.observedAt, eligibleRunIds, watched });
  if (input.activated === false) return result('misconfigured', 'Current workflow is absent or differs on the default branch.');
  if (input.disabled === true) return result('misconfigured', 'Automatic repair is explicitly paused.');
  if (!watched.length || !names(trigger.types)?.includes('completed')) return result('misconfigured', 'No exact watched workflow/completed event configuration.');
  if (watched.some(name => input.sources.filter(source => source.name === name).length !== 1)) return result('misconfigured', 'Watched workflow name is absent or ambiguous.');
  const paths = Object.values(record(input.workflow.jobs)).map(record).flatMap(job =>
    (Array.isArray(job.steps) ? job.steps.map(record) : []).filter(step => /^juan294\/sutura@[a-f0-9]{40}$/iu.test(String(step.uses)) && record(step.with).mode !== 'inspect')
      .map(step => ({ job, step })));
  if (!paths.length) return result('misconfigured', 'No immutable Sutura action step.');
  if (input.activated === undefined || input.disabled === undefined || paths.some(({ job, step }) => !conditionAtoms(job.if) || !conditionAtoms(step.if))) return result('unknown', 'Activation, disable state or repair job/step conditions are unresolved.');
  const guards = paths.map(({ job, step }) => `${String(job.if ?? '')} ${String(step.if ?? '')}`);
  if (guards.some(guard => !/!startsWith\(github\.event\.workflow_run\.head_branch,\s*['"]sutura\/fix-['"]\)/u.test(guard) || !/vars\.SUTURA_DISABLED\s*!=\s*['"]true['"]/u.test(guard))) return result('misconfigured', 'Repair path lacks an explicit recursion or disable guard.');
  const branches = trigger.branches === undefined ? undefined : names(trigger.branches);
  if ((trigger.branches !== undefined && !branches) || trigger['branches-ignore'] !== undefined || JSON.stringify(trigger).includes('${{')) return result('unknown', 'Dynamic or unsupported branch/trigger expression.');
  if (!input.complete || !Number.isFinite(Date.parse(input.since)) || !Number.isFinite(Date.parse(input.observedAt))) return result('unknown', 'Observation window or bounded run history is incomplete.');
  const conclusions = ['failure', 'timed_out'].filter(value => paths.some(({ job, step }) =>
    [...conditionAtoms(job.if)!, ...conditionAtoms(step.if)!].every(atom =>
      (atom !== 'F' || value === 'failure') && (atom !== 'T' || value === 'timed_out'))));
  if (!conclusions.length) return result('misconfigured', 'Repair conditions admit neither failure nor timeout.');
  const eligible = input.sourceRuns.filter(run => watched.includes(run.name) && conclusions.includes(run.conclusion ?? '') &&
    !run.head_branch.startsWith('sutura/fix-') && (!branches || branches.includes(run.head_branch)) &&
    Date.parse(run.updated_at) >= Date.parse(input.since) && Date.parse(run.updated_at) <= Date.parse(input.observedAt) - 120_000 &&
    input.sources.find(source => source.name === run.name)?.events.includes(run.event));
  const ids = eligible.map(run => run.id);
  if (!ids.length) return result('configured-unexercised', 'No eligible failures in this observation window.');
  if (ids.every(id => input.deliveredRunIds.includes(id))) return result('observed-delivery', 'Exact source-run Sutura checks observed; repair and native verification remain separate.', ids);
  if (guards.some(guard => guard.includes('needs.inspect.outputs'))) return result('unknown', 'Inspection admission decision is required before a failed source run proves a missed repair opportunity.', ids);
  if (eligible.some(run => !input.deliveredRunIds.includes(run.id) && !input.monitorRuns.some(monitor => Date.parse(monitor.created_at) >= Date.parse(run.updated_at)))) return result('missed-eligible-event', 'An eligible failure has no subsequent monitor invocation in complete bounded history.', ids);
  return result('unknown', 'Monitor invocations exist but exact source-run delivery is not established.', ids);
}
