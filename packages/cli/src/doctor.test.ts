import { Buffer } from 'node:buffer';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actionWorkflow } from './setup.js';
import { doctorSutura } from './doctor.js';
const ACTION_SHA = 'a'.repeat(40), HEAD = 'b'.repeat(40), NOW = '2026-10-25T12:00:00Z';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
function workflow(token = '${{ github.token }}', extra = ''): string {
  return `name: Sutura\non:\n  workflow_run:\n    workflows: [CI]\n    types: [completed]\npermissions: { checks: write }\njobs:\n  repair:\n    if: \${{ vars.SUTURA_DISABLED != 'true' && !startsWith(github.event.workflow_run.head_branch, 'sutura/fix-') && github.event.workflow_run.conclusion == 'failure' }}\n    steps:\n${extra}      - uses: juan294/sutura@${ACTION_SHA}\n        with:\n          github-token: ${token}\n          run-id: \${{ github.event.workflow_run.id }}\n          nebius-api-key: \${{ secrets.NEBIUS_API_KEY }}\n          contree-token: \${{ secrets.CONTREE_TOKEN }}\n          contree-project: \${{ vars.CONTREE_PROJECT }}\n          runtime: auto\n          repair-inference-cost-usd: '0.10'\n`;
}
const ci = 'name: CI\non: [push]\njobs:\n  unit:\n    steps: [{ run: pnpm test }]\n';
async function fixture(source = workflow(), overrides: Record<string, unknown> = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'sutura-doctor-')); roots.push(cwd);
  await mkdir(join(cwd, '.github/workflows'), { recursive: true });
  await writeFile(join(cwd, '.github/workflows/sutura.yml'), source);
  await writeFile(join(cwd, '.github/workflows/ci.yml'), ci);
  await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'test', engines: { node: '>=22' }, scripts: { test: 'vitest run' } }));
  await writeFile(join(cwd, 'pnpm-lock.yaml'), 'lockfileVersion: "9.0"\nimporters: { .: {} }\n');
  const content = (value: string) => ({ type: 'file', encoding: 'base64', content: Buffer.from(value).toString('base64') });
  const responses: Record<string, unknown> = {
    'repos/octo/example': { default_branch: 'main' },
    'repos/octo/example/commits/main': { sha: HEAD },
    [`repos/octo/example/contents/.github/workflows/sutura.yml?ref=${HEAD}`]: content(source),
    [`repos/octo/example/contents/.github/workflows/ci.yml?ref=${HEAD}`]: content(ci),
    [`repos/juan294/sutura/contents/packages/core/src/incidents/types.ts?ref=${ACTION_SHA}`]: content("export const RUNTIME_SUPPORT_CONTRACT = 'sutura-runtime-support-v2' as const;"),
    'repos/octo/example/actions/workflows?per_page=100': { total_count: 2, workflows: [{ id: 1, name: 'CI', path: '.github/workflows/ci.yml' }, { id: 2, name: 'Sutura', path: '.github/workflows/sutura.yml' }] },
    [`repos/octo/example/commits?path=.github%2Fworkflows%2Fsutura.yml&sha=${HEAD}&per_page=1`]: [{ commit: { committer: { date: '2026-10-24T12:00:00Z' } } }],
    'repos/octo/example/actions/runs?per_page=100': { total_count: 0, workflow_runs: [] },
    ...overrides,
  };
  const run = vi.fn(async (command: string, args: readonly string[]) => {
    if (command === 'git') return `${ACTION_SHA}\trefs/tags/v0.3.9\n`;
    if (args[0] === 'secret') return 'NEBIUS_API_KEY\nCONTREE_TOKEN\nAPP_PRIVATE_KEY\n';
    if (args[0] === 'variable') return 'CONTREE_PROJECT\nAPP_ID\n';
    if (args[0] === 'repo') return 'octo/example';
    if (args[0] !== 'api' || !Object.hasOwn(responses, args[1]!)) throw new Error('Unexpected scoped read');
    if (responses[args[1]!] instanceof Error) throw responses[args[1]!];
    return JSON.stringify(responses[args[1]!]!);
  });
  const invoke = () => doctorSutura({ command: 'doctor', repository: 'octo/example', actionSha: ACTION_SHA }, { cwd, run, now: () => new Date(NOW) });
  return { cwd, run, invoke };
}
describe('doctor readiness stages and scoped observation', () => {
  it('reports static candidate support and healthy unexercised CI without execution claims', async () => {
    const { invoke, run } = await fixture(), result = await invoke();
    expect(result.exitCode, result.lines.join('\n')).toBe(0);
    expect(result.reachability?.status).toBe('configured-unexercised');
    expect(result.lines.join('\n')).toContain('candidate-supported');
    expect(result.lines.join('\n')).toContain('prepared=unmeasured; reproduced=unmeasured; native-verified=unmeasured; integrated=unmeasured');
    expect(result.lines.join('\n')).toContain('Name presence does not validate credential values');
    expect(run.mock.calls.every(([command]) => ['gh', 'git'].includes(command))).toBe(true);
    expect(run.mock.calls.some(([, args]) => args.includes('set') || args.includes('download'))).toBe(false);
  });
  it('accepts a custom prior App token step and job-local checks permission', async () => {
    const producer = '      - id: mint\n        uses: actions/create-github-app-token@v2\n        with:\n          app-id: ${{ vars.APP_ID }}\n          private-key: ${{ secrets.APP_PRIVATE_KEY }}\n';
    const source = workflow('${{ steps.mint.outputs.token }}', producer).replace('  repair:\n', '  repair:\n    permissions: { checks: write }\n').replace('permissions: { checks: write }\njobs:', 'permissions: { contents: read }\njobs:');
    const result = await (await fixture(source)).invoke();
    expect(result.exitCode, result.lines.join('\n')).toBe(0);
    expect(result.lines).toContain('[PASS] Workflow wires github-token.');
    expect(result.lines).toContain('[PASS] Workflow grants checks: write.');
    expect(result.lines.join('\n')).toContain('native PR-check approval remain unverified');
  });
  it.each(['false', "${{ vars.MINT_TOKEN == 'true' }}"])( 'does not certify a conditional App token producer (%s)', async condition => {
    const producer = `      - id: mint\n        if: ${condition}\n        uses: actions/create-github-app-token@v2\n        with:\n          app-id: \${{ vars.APP_ID }}\n          private-key: \${{ secrets.APP_PRIVATE_KEY }}\n`;
    const result = await (await fixture(workflow('${{ steps.mint.outputs.token }}', producer))).invoke();
    expect(result.exitCode).toBe(2);
    expect(result.lines).toContain('[FAIL] Workflow wires github-token.');
  });
  it('does not borrow token producers or permissions from another job', async () => {
    const source = workflow('${{ steps.mint.outputs.token }}').replace('  repair:\n', '  repair:\n    permissions: { contents: read }\n');
    const result = await (await fixture(source)).invoke();
    expect(result.exitCode).toBe(2);
    expect(result.lines).toContain('[FAIL] Workflow wires github-token.');
    expect(result.lines).toContain('[FAIL] Workflow grants checks: write.');
  });
  it.each([new Error('404'), { type: 'file', encoding: 'base64', content: Buffer.from("export const RUNTIME_SUPPORT_CONTRACT = 'sutura-runtime-support-v1' as const;").toString('base64') }])('keeps an older or unavailable installed contract unknown instead of assigning CLI capabilities (%j)', async contract => {
    const result = await (await fixture(workflow(), { [`repos/juan294/sutura/contents/packages/core/src/incidents/types.ts?ref=${ACTION_SHA}`]: contract })).invoke();
    expect(result.exitCode).toBe(2);
    expect(result.lines.join('\n')).toContain('target-contract-unavailable');
  });
  it('separates configured inference limits from unpriced total execution cost', async () => {
    const result = await (await fixture()).invoke();
    expect(result.lines.join('\n')).toContain('repair-inference-cost-usd=0.10');
    expect(result.lines.join('\n')).toContain('Inference pools are not a total cost cap');
    expect(result.lines.join('\n')).toContain('Total attempt price unknown');
  });
  it('keeps observed activation separate from incomplete trigger history', async () => {
    const result = await (await fixture(workflow(), { 'repos/octo/example/actions/runs?per_page=100': { total_count: 101, workflow_runs: [] } })).invoke();
    expect(result.exitCode).toBe(2);
    expect(result.reachability?.status).toBe('unknown');
    expect(result.lines.join('\n')).toContain('activated=observed');
  });
  it('does not treat another App matching the audit name as observed delivery', async () => {
    const result = await (await fixture(workflow(), {
      'repos/octo/example/actions/runs?per_page=100': { total_count: 1, workflow_runs: [{ id: 7, workflow_id: 1, name: 'CI', event: 'push', conclusion: 'failure', head_sha: HEAD, head_branch: 'main', updated_at: '2026-10-25T10:00:00Z' }] },
      [`repos/octo/example/commits/${HEAD}/check-runs?per_page=100`]: { check_runs: [{ name: 'Sutura repair audit', external_id: 'sutura:octo/example:workflow-run:7', app: { slug: 'unrelated-app', id: 7 } }] },
    })).invoke();
    expect(result.reachability?.status).not.toBe('observed-delivery');
  });
  it('reports operational read failures as 1 without declaring activation', async () => {
    const result = await (await fixture(workflow(), { 'repos/octo/example': new Error('denied') })).invoke();
    expect(result.exitCode).toBe(1);
    expect(result.lines.join('\n')).toContain('activated=unknown');
  });
  it('rejects nested action-like data and unsafe workflow symlinks', async () => {
    const fake = workflow().replace(`      - uses: juan294/sutura@${ACTION_SHA}`, `      - env:\n          uses: juan294/sutura@${ACTION_SHA}`);
    const first = await fixture(fake), result = await first.invoke();
    expect(result.exitCode).toBe(2);
    expect(result.lines).toContain('[FAIL] Workflow wires github-token.');
    const second = await fixture();
    await rm(join(second.cwd, '.github/workflows/sutura.yml'));
    await symlink(join(first.cwd, '.github/workflows/sutura.yml'), join(second.cwd, '.github/workflows/sutura.yml'));
    expect((await second.invoke()).lines).toContain('[FAIL] Sutura workflow is missing, unsafe or malformed.');
  });
  it('shows monitor age and recovery command without inferring preparation from its conclusion', async () => {
    const result = await (await fixture(workflow(), { 'repos/octo/example/actions/runs?per_page=100': { total_count: 1, workflow_runs: [{ id: 90, workflow_id: 2, name: 'Sutura', event: 'workflow_run', conclusion: 'failure', head_branch: 'main', updated_at: '2026-10-25T11:00:00Z', created_at: '2026-10-25T10:00:00Z' }] } })).invoke();
    expect(result.lines.join('\n')).toContain('ageSeconds=3600');
    expect(result.lines.join('\n')).toContain('gh run view 90 --repo octo/example --log');
    expect(result.lines.join('\n')).toContain('Preparation/reproduction outcome unavailable from run conclusion');
  });
});

it('accepts generated readonly inspection separately from provider-bearing repair', async () => {
  const result = await (await fixture(actionWorkflow('CI', false, ACTION_SHA))).invoke();
  expect(result.exitCode, result.lines.join('\n')).toBe(0);
  expect(result.reachability?.status).toBe('configured-unexercised');
  expect(result.lines).toContain('[PASS] Inspect job has read-only repository permissions.');
});

it('does not treat a failed source event as a missed repair when inspection admission is unresolved', async () => {
  const result = await (await fixture(actionWorkflow('CI', false, ACTION_SHA), {
    'repos/octo/example/actions/runs?per_page=100': { total_count: 1, workflow_runs: [{ id: 7, workflow_id: 1, name: 'CI', event: 'push', conclusion: 'failure', head_sha: HEAD, head_branch: 'main', updated_at: '2026-10-25T10:00:00Z' }] },
    [`repos/octo/example/commits/${HEAD}/check-runs?per_page=100`]: { check_runs: [] },
  })).invoke();
  expect(result.reachability?.status).toBe('unknown');
  expect(result.reachability?.reason).toContain('Inspection admission decision');
});
it('does not certify an inspect job with repair secrets or write permissions', async () => {
  for (const source of [
    actionWorkflow('CI', false, ACTION_SHA).replace('      contents: read', '      contents: write'),
    actionWorkflow('CI', false, ACTION_SHA).replace('          mode: inspect', '          mode: inspect\n          nebius-api-key: ${{ secrets.NEBIUS_API_KEY }}'),
  ]) {
    const result = await (await fixture(source)).invoke();
    expect(result.exitCode).toBe(2);
    expect(result.lines).toContain('[FAIL] Inspect job has read-only repository permissions.');
  }
});
