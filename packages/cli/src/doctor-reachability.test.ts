import { describe, expect, it } from 'vitest';
import { assessReachability } from './doctor-reachability.js';
const workflow = { on: { workflow_run: { workflows: ['CI'], types: ['completed'] } }, jobs: { repair: { if: "${{ vars.SUTURA_DISABLED != 'true' && !startsWith(github.event.workflow_run.head_branch, 'sutura/fix-') && github.event.workflow_run.conclusion == 'failure' }}", steps: [{ uses: `juan294/sutura@${'a'.repeat(40)}` }] } } };
const sources = [{ path: '.github/workflows/ci.yml', name: 'CI', events: ['push'] }];
const base = { workflow, sources, activated: true, disabled: false, observedAt: '2026-10-25T12:00:00Z', since: '2026-10-24T12:00:00Z', complete: true, sourceRuns: [], monitorRuns: [], deliveredRunIds: [] };
describe('bounded trigger reachability', () => {
  it('distinguishes healthy CI with no opportunity', () => expect(assessReachability(base).status).toBe('configured-unexercised'));
  it('requires explicit recursion and disable guards on the repair path', () => {
    expect(assessReachability({ ...base, workflow: { ...workflow, jobs: { repair: { steps: workflow.jobs.repair.steps } } } }).status).toBe('misconfigured');
  });
  it('checks repair step conditions and ignores unrelated job conditions', () => {
    expect(assessReachability({ ...base, workflow: { ...workflow, jobs: { repair: { ...workflow.jobs.repair, steps: [{ ...workflow.jobs.repair.steps[0], if: '${{ needs.dynamic.outputs.run }}' }] } } } }).status).toBe('unknown');
    expect(assessReachability({ ...base, workflow: { ...workflow, jobs: { ...workflow.jobs, unrelated: { if: '${{ needs.dynamic.outputs.run }}', steps: [{ run: 'echo unrelated' }] } } } }).status).toBe('configured-unexercised');
  });
  it('does not certify guards bypassed by OR expressions', () => {
    for (const condition of [
      workflow.jobs.repair.if.replaceAll(' && ', ' || '),
      "${{ vars.SUTURA_DISABLED != 'true' && (!startsWith(github.event.workflow_run.head_branch, 'sutura/fix-') || github.event.workflow_run.conclusion == 'failure') }}",
    ]) expect(assessReachability({ ...base, workflow: { ...workflow, jobs: { repair: { ...workflow.jobs.repair, if: condition } } } }).status).toBe('unknown');
  });
  it('preserves the guarded failure-or-timeout conjunction', () => {
    const condition = workflow.jobs.repair.if.replace("github.event.workflow_run.conclusion == 'failure'", "(github.event.workflow_run.conclusion == 'failure' || github.event.workflow_run.conclusion == 'timed_out')");
    expect(assessReachability({ ...base, workflow: { ...workflow, jobs: { repair: { ...workflow.jobs.repair, if: condition } } } }).status).toBe('configured-unexercised');
  });
  it('rejects renamed or unwatched workflows', () => expect(assessReachability({ ...base, sources: [{ ...sources[0]!, name: 'Renamed' }] }).status).toBe('misconfigured'));
  it('separates local configuration from default-branch activation', () => expect(assessReachability({ ...base, activated: false }).status).toBe('misconfigured'));
  it('keeps dynamic conditions and incomplete history unknown', () => {
    expect(assessReachability({ ...base, workflow: { ...workflow, jobs: { repair: { ...workflow.jobs.repair, if: '${{ needs.route.outputs.go }}' } } } }).status).toBe('unknown');
    expect(assessReachability({ ...base, complete: false }).status).toBe('unknown');
  });
  const failure = { id: 7, name: 'CI', event: 'push', conclusion: 'failure', head_branch: 'develop', updated_at: '2026-10-25T10:00:00Z' };
  it('distinguishes delivery from a missed eligible event within the observation window', () => {
    expect(assessReachability({ ...base, sourceRuns: [failure], deliveredRunIds: [7] }).status).toBe('observed-delivery');
    expect(assessReachability({ ...base, sourceRuns: [failure] }).status).toBe('missed-eligible-event');
  });
  it('does not infer missing delivery when a monitor invocation may correspond', () => {
    expect(assessReachability({ ...base, sourceRuns: [failure], monitorRuns: [{ created_at: '2026-10-25T10:00:01Z' }] }).status).toBe('unknown');
  });
  it('excludes recursion and mismatched branches without inventing an opportunity', () => {
    expect(assessReachability({ ...base, sourceRuns: [{ ...failure, head_branch: 'sutura/fix-7' }] }).status).toBe('configured-unexercised');
    expect(assessReachability({ ...base, workflow: { ...workflow, on: { workflow_run: { workflows: ['CI'], types: ['completed'], branches: ['main'] } } }, sourceRuns: [failure] }).status).toBe('configured-unexercised');
  });
});

it('intersects job and step conclusion conditions instead of unioning their text', () => {
  const timedOutStep = { ...workflow.jobs.repair.steps[0], if: "${{ github.event.workflow_run.conclusion == 'timed_out' }}" };
  expect(assessReachability({ ...base, workflow: { ...workflow, jobs: { repair: { ...workflow.jobs.repair, steps: [timedOutStep] } } } }).status).toBe('misconfigured');
});
