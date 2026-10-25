import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { parse } from 'yaml';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { VERSION } from './args.js';
import { actionWorkflow, installSutura, SetupError } from './setup.js';

const ACTION_SHA = 'a'.repeat(40);

describe('installSutura', () => {
  it('writes the BYOK workflow and sends secrets through stdin', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-init-'));
    const calls: Array<{ command: string; args: readonly string[]; stdin?: string }> = [];
    try {
      await mkdir(join(directory, '.github', 'workflows'), { recursive: true });
      await writeFile(join(directory, '.github', 'workflows', 'ci.yml'), 'name: CI\non: [push]\n');
      const run = vi.fn(async (command: string, args: readonly string[], options?: { stdin?: string }) => {
        calls.push({ command, args, ...(options?.stdin ? { stdin: options.stdin } : {}) });
        if (args[0] === 'repo') return 'octo/example\n';
        return '';
      });

      const request = { command: 'init' as const, workflow: 'CI', repository: 'octo/example', actionSha: ACTION_SHA, force: false, tavilyEnabled: true,
        credentials: ['NEBIUS_API_KEY', 'CONTREE_TOKEN', 'CONTREE_PROJECT', 'TAVILY_API_KEY'] };
      const preview = await installSutura(request, { cwd: directory, environment: { CONTREE_PROJECT: 'project-id' }, run });
      const result = await installSutura(
        { ...request, apply: preview.plan!.digest },
        {
          cwd: directory,
          environment: {
            NEBIUS_API_KEY: 'nebius-private',
            CONTREE_TOKEN: 'contree-private',
            CONTREE_PROJECT: 'project-id',
            TAVILY_API_KEY: 'tavily-private',
          },
          run,
        },
      );

      const workflow = await readFile(join(directory, '.github', 'workflows', 'sutura.yml'), 'utf8');
      expect(workflow).toContain('workflows: ["CI"]');
      expect(workflow).toContain("workflow_run.conclusion == 'timed_out'");
      expect(workflow).toContain("vars.SUTURA_DISABLED != 'true'");
      expect(workflow).toContain("!startsWith(github.event.workflow_run.head_branch, 'sutura/fix-')");
      expect(workflow).toContain(`uses: juan294/sutura@${ACTION_SHA}`);
      expect(workflow).toContain('checks: write');
      expect(workflow).toContain('name: Sutura repair monitor');
      expect(workflow).toContain('run-name: "${{ format(');
      expect(workflow).toContain("&& 'No repair needed'");
      expect(workflow).toContain("&& 'Repair requested'");
      expect(workflow).toContain("|| 'Repair not triggered'");
      expect(workflow.match(/^run-name:.*$/gmu)).toHaveLength(1);
      expect(workflow).toContain('name: Attempt verified CI repair');
      expect(workflow).toContain('nebius-api-key: ${{ secrets.NEBIUS_API_KEY }}');
      expect(workflow).toContain('contree-project: ${{ vars.CONTREE_PROJECT }}');
      expect(result.lines.join('\n')).not.toMatch(/private|project-id/u);
      expect(calls.filter(({ args }) => args[0] === 'secret')).toHaveLength(3);
      expect(calls.filter(({ args }) => args[0] === 'secret').map(({ stdin }) => stdin)).toEqual([
        'nebius-private', 'contree-private', 'tavily-private',
      ]);
      expect(calls.flatMap(({ args }) => args)).not.toEqual(expect.arrayContaining([
        'nebius-private', 'contree-private', 'tavily-private',
      ]));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('detects one workflow and reports missing required BYOK values', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-init-missing-'));
    try {
      await mkdir(join(directory, '.github', 'workflows'), { recursive: true });
      await writeFile(join(directory, '.github', 'workflows', 'checks.yaml'), 'name: Checks\non: [push]\n');
      const result = await installSutura(
        { command: 'init', actionSha: ACTION_SHA, force: false, tavilyEnabled: true },
        { cwd: directory, environment: {}, run: vi.fn(async () => 'octo/example\n') },
      );

      expect(result.missing).toEqual(['NEBIUS_API_KEY', 'CONTREE_TOKEN', 'CONTREE_PROJECT']);
      expect(result.exitCode).toBe(2);
      expect(result.plan?.digest).toMatch(/^[a-f0-9]{64}$/u);
      await expect(readFile(join(directory, '.github', 'workflows', 'sutura.yml'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not overwrite an existing workflow without force', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-init-existing-'));
    try {
      await mkdir(join(directory, '.github', 'workflows'), { recursive: true });
      await writeFile(join(directory, '.github', 'workflows', 'ci.yml'), 'name: CI\non: [push]\n');
      await writeFile(join(directory, '.github', 'workflows', 'sutura.yml'), 'existing\n');

      const preview = await installSutura(
        { command: 'init', workflow: 'CI', actionSha: ACTION_SHA, force: false, tavilyEnabled: true },
        { cwd: directory, environment: {}, run: vi.fn(async () => 'octo/example\n') },
      );
      expect(preview.exitCode).toBe(2);
      expect(preview.plan?.blockers).not.toHaveLength(0);
      expect(await readFile(join(directory, '.github', 'workflows', 'sutura.yml'), 'utf8')).toBe('existing\n');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('refuses a symlinked workflows directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-init-link-'));
    const outside = await mkdtemp(join(tmpdir(), 'sutura-init-outside-'));
    try {
      await mkdir(join(directory, '.github'), { recursive: true });
      await writeFile(join(outside, 'ci.yml'), 'name: CI\non: [push]\n');
      await symlink(outside, join(directory, '.github', 'workflows'));

      await expect(installSutura(
        { command: 'init', workflow: 'CI', actionSha: ACTION_SHA, force: false, tavilyEnabled: true },
        { cwd: directory, environment: {} },
      )).rejects.toThrow(SetupError);
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('resolves the release tag before writing or configuring GitHub', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-init-release-'));
    const run = vi.fn(async (command: string) => {
      if (command === 'git') return `${ACTION_SHA}\trefs/tags/v${VERSION}\n`;
      throw new Error('GitHub mutation must not run');
    });
    try {
      await mkdir(join(directory, '.github', 'workflows'), { recursive: true });
      await writeFile(join(directory, '.github', 'workflows', 'ci.yml'), 'name: CI\non: [push]\n');

      const preview = await installSutura(
        { command: 'init', workflow: 'CI', force: false, tavilyEnabled: false },
        { cwd: directory, environment: {}, run },
      );

      expect(preview.plan?.diff.after).toContain(`uses: juan294/sutura@${ACTION_SHA}`);
      await expect(readFile(join(directory, '.github', 'workflows', 'sutura.yml'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(run).toHaveBeenCalledTimes(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('writes nothing when release tag resolution fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sutura-init-release-fail-'));
    try {
      await mkdir(join(directory, '.github', 'workflows'), { recursive: true });
      await writeFile(join(directory, '.github', 'workflows', 'ci.yml'), 'name: CI\non: [push]\n');

      await expect(installSutura(
        { command: 'init', workflow: 'CI', force: false, tavilyEnabled: false },
        { cwd: directory, environment: {}, run: vi.fn().mockResolvedValue('') },
      )).rejects.toThrow(/release tag/u);
      await expect(readFile(join(directory, '.github', 'workflows', 'sutura.yml'), 'utf8'))
        .rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});


const request = { command: 'init' as const, repository: 'octo/example', workflow: 'CI', actionSha: ACTION_SHA, force: false, tavilyEnabled: false };
async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-adoption-'));
  try {
    await mkdir(join(directory, '.github', 'workflows'), { recursive: true });
    await writeFile(join(directory, '.github', 'workflows', 'ci.yml'), 'name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n');
    await writeFile(join(directory, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' }, engines: { node: '22' } }));
    await writeFile(join(directory, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {} }));
    await run(directory);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
const receiptPath = (root: string) => join(root, '.sutura', 'setup-receipt.json');

describe('reviewed adoption', () => {
  it('previews without writes, shell calls, or ambient optional credentials', async () => fixture(async cwd => {
    const run = vi.fn();
    const result = await installSutura(request, { cwd, run, environment: { OPENAI_API_KEY: 'ambient-private', TYPESAFE_API_KEY: 'other-private' } });
    expect(result.exitCode).toBe(2);
    expect(result.plan?.operations.some(op => op.kind === 'secret-set')).toBe(false);
    expect(result.plan?.diff.after).not.toContain('secrets.OPENAI_API_KEY');
    expect(result.plan?.diff.after).not.toContain('secrets.TYPESAFE_API_KEY');
    expect(JSON.stringify(result)).not.toContain('ambient-private');
    expect(run).not.toHaveBeenCalled();
    await expect(readFile(receiptPath(cwd))).rejects.toMatchObject({ code: 'ENOENT' });
  }));

  it('rejects stale digests before local or remote effects', async () => fixture(async cwd => {
    const run = vi.fn();
    const preview = await installSutura(request, { cwd, run, environment: {} });
    await writeFile(join(cwd, '.github', 'workflows', 'ci.yml'), 'name: CI\non: [pull_request]\n');
    const result = await installSutura({ ...request, apply: preview.plan!.digest }, { cwd, run, environment: {} });
    expect(result.exitCode).toBe(2);
    expect(result.lines.join(' ')).toMatch(/drift|digest/u);
    expect(run).not.toHaveBeenCalled();
    await expect(readFile(receiptPath(cwd))).rejects.toMatchObject({ code: 'ENOENT' });
  }));

  it('records intent before selected uploads and never repeats completed uploads', async () => fixture(async cwd => {
    const chosen = { ...request, credentials: ['NEBIUS_API_KEY'] };
    const run = vi.fn(async (_command: string, args: readonly string[]) => {
      if (args[0] === 'secret' && args[1] === 'set') {
        const receipt = JSON.parse(await readFile(receiptPath(cwd), 'utf8'));
        expect(receipt.operations.find((op: { id: string }) => op.id === 'secret:NEBIUS_API_KEY').status).toBe('intent');
      }
      if (args[1] === 'list') return JSON.stringify([{ name: 'NEBIUS_API_KEY' }]);
      return '';
    });
    const options = { cwd, run, environment: { NEBIUS_API_KEY: 'private-key' } };
    const preview = await installSutura(chosen, options);
    const first = await installSutura({ ...chosen, apply: preview.plan!.digest }, options);
    expect(first.receipt?.operations.find(op => op.id === 'secret:NEBIUS_API_KEY')?.status).toBe('completed');
    await installSutura({ ...chosen, apply: preview.plan!.digest }, options);
    expect(run.mock.calls.filter(([, args]) => args[0] === 'secret' && args[1] === 'set')).toHaveLength(1);
    expect(await readFile(receiptPath(cwd), 'utf8')).not.toContain('private-key');
  }));

  it('preserves response-loss ambiguity and refuses automatic secret replacement', async () => fixture(async cwd => {
    const chosen = { ...request, credentials: ['NEBIUS_API_KEY'] };
    const run = vi.fn(async (_command: string, args: readonly string[]) => {
      if (args[0] === 'secret' && args[1] === 'set') throw new Error('remote accepted then connection lost with private-key');
      return JSON.stringify([{ name: 'NEBIUS_API_KEY' }]);
    });
    const options = { cwd, run, environment: { NEBIUS_API_KEY: 'private-key' } };
    const preview = await installSutura(chosen, options);
    const first = await installSutura({ ...chosen, apply: preview.plan!.digest }, options);
    expect(first.exitCode).toBe(2);
    expect(first.receipt?.operations.find(op => op.id === 'secret:NEBIUS_API_KEY')?.status).toBe('outcome-unknown');
    const next = await installSutura({ ...chosen, apply: preview.plan!.digest }, options);
    expect(next.exitCode).toBe(2);
    expect(run.mock.calls.filter(([, args]) => args[0] === 'secret' && args[1] === 'set')).toHaveLength(1);
    expect(JSON.stringify(next)).not.toContain('private-key');
    expect(next.lines.join(' ')).toContain('reconcile');
  }));

  it('preserves custom legacy App wiring and unrelated jobs during pin-only upgrade', async () => fixture(async cwd => {
    const old = `name: Custom monitor\non: [workflow_dispatch]\npermissions:\n  contents: read\njobs:\n  unrelated:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo keep\n  repair:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: juan294/sutura@${'b'.repeat(40)} # custom pin\n        with:\n          github-token: \${{ steps.app.outputs.token }}\n`;
    await writeFile(join(cwd, '.github', 'workflows', 'sutura.yml'), old);
    const upgrade = { ...request, operation: 'upgrade' as const };
    const options = { cwd, run: vi.fn(), environment: {} };
    const preview = await installSutura(upgrade, options);
    expect(preview.plan?.diff.after).toBe(old.replace('b'.repeat(40), ACTION_SHA));
    const result = await installSutura({ ...upgrade, apply: preview.plan!.digest }, options);
    expect(result.exitCode).toBe(0);
    expect(await readFile(join(cwd, '.github', 'workflows', 'sutura.yml'), 'utf8')).toBe(old.replace('b'.repeat(40), ACTION_SHA));
    const remove = await installSutura({ ...request, operation: 'remove' }, options);
    expect(remove.exitCode).toBe(2);
    expect(remove.plan?.blockers).not.toHaveLength(0);
  }));

  it('refuses unknown legacy ownership even with force and keeps user edits on resume', async () => fixture(async cwd => {
    const options = { cwd, run: vi.fn(), environment: {} };
    const preview = await installSutura(request, options);
    await installSutura({ ...request, apply: preview.plan!.digest }, options);
    const changed = (await readFile(join(cwd, '.github', 'workflows', 'sutura.yml'), 'utf8')) + '\n# user edit\n';
    await writeFile(join(cwd, '.github', 'workflows', 'sutura.yml'), changed);
    const result = await installSutura({ ...request, force: true, apply: preview.plan!.digest }, options);
    expect(result.exitCode).toBe(2);
    expect(result.plan?.conflict).toMatchObject({ current: changed });
    expect(await readFile(join(cwd, '.github', 'workflows', 'sutura.yml'), 'utf8')).toBe(changed);
  }));

  it('removes only the unchanged owned workflow and retains evidence and unrelated files', async () => fixture(async cwd => {
    const options = { cwd, run: vi.fn(), environment: {} };
    const preview = await installSutura(request, options);
    await installSutura({ ...request, apply: preview.plan!.digest }, options);
    const remove = await installSutura({ ...request, operation: 'remove' }, options);
    const result = await installSutura({ ...request, operation: 'remove', apply: remove.plan!.digest }, options);
    expect(result.exitCode).toBe(0);
    await expect(readFile(join(cwd, '.github', 'workflows', 'sutura.yml'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(cwd, '.github', 'workflows', 'ci.yml'), 'utf8')).toContain('name: CI');
    expect(JSON.parse(await readFile(receiptPath(cwd), 'utf8')).operations[0].status).toBe('completed');
  }));
});

it('records and reconciles an interrupted local write without repeating remote configuration', async () => fixture(async cwd => {
  const options = { cwd, run: vi.fn(), environment: {} };
  const preview = await installSutura(request, options);
  await installSutura({ ...request, apply: preview.plan!.digest }, options);
  const receipt = JSON.parse(await readFile(receiptPath(cwd), 'utf8'));
  receipt.operations[0].status = 'intent';
  await writeFile(receiptPath(cwd), JSON.stringify(receipt));
  const resumed = await installSutura({ ...request, apply: preview.plan!.digest }, options);
  expect(resumed.receipt?.operations[0]?.status).toBe('completed');
  expect(options.run).not.toHaveBeenCalled();
}));

it('previews and applies pause/resume only for the guarded installed workflow and exact repository variable', async () => fixture(async cwd => {
  let disabled: string | undefined;
  const run = vi.fn(async (_command: string, args: readonly string[]) => {
    expect(args).toContain('octo/example');
    if (args[0] === 'variable' && args[1] === 'list') return JSON.stringify(disabled === undefined ? [] : [{ name: 'SUTURA_DISABLED', value: disabled }]);
    if (args[0] === 'variable' && args[1] === 'set') { disabled = args.at(-1)!; return ''; }
    throw new Error('Unexpected configuration request');
  });
  const options = { cwd, run, environment: {} };
  const initial = await installSutura(request, options);
  await installSutura({ ...request, apply: initial.plan!.digest }, options);
  for (const operation of ['pause', 'resume'] as const) {
    const preview = await installSutura({ ...request, operation }, options);
    expect(run.mock.calls.filter(([, args]) => args[1] === 'set')).toHaveLength(operation === 'pause' ? 0 : 1);
    const applied = await installSutura({ ...request, operation, apply: preview.plan!.digest }, options);
    expect(applied.exitCode).toBe(0);
    expect(disabled).toBe(operation === 'pause' ? 'true' : 'false');
  }
}));

it('rejects a commented or ineffective pause guard', async () => fixture(async cwd => {
  await writeFile(join(cwd, '.github', 'workflows', 'sutura.yml'), `name: Custom\non: [workflow_dispatch]\n# vars.SUTURA_DISABLED != 'true'\njobs:\n  repair:\n    if: always()\n    runs-on: ubuntu-latest\n    steps:\n      - uses: juan294/sutura@${ACTION_SHA}\n`);
  const preview = await installSutura({ ...request, operation: 'pause' }, { cwd, environment: {}, run: vi.fn(async () => '[]') });
  expect(preview.plan?.blockers).not.toHaveLength(0);
}));

it('requires a new reviewed digest to replace an uncertain credential and archives its prior receipt', async () => fixture(async cwd => {
  const chosen = { ...request, credentials: ['NEBIUS_API_KEY'] };
  let lost = true;
  const run = vi.fn(async (_command: string, args: readonly string[]) => {
    if (args[0] === 'secret' && args[1] === 'set' && lost) throw new Error('response lost');
    return '';
  });
  const options = { cwd, run, environment: { NEBIUS_API_KEY: 'never-record-this-value' } };
  const preview = await installSutura(chosen, options);
  await installSutura({ ...chosen, apply: preview.plan!.digest }, options);
  const unknown = await readFile(receiptPath(cwd), 'utf8');
  const replacement = await installSutura({ ...chosen, plan: true }, options);
  expect(replacement.plan?.reconciliation).toEqual({ priorPlanDigest: preview.plan!.digest, operationIds: ['secret:NEBIUS_API_KEY'], confirmation: 'new-reviewed-apply-required' });
  expect(replacement.plan?.digest).not.toBe(preview.plan?.digest);
  expect(run.mock.calls.filter(([, args]) => args[1] === 'set')).toHaveLength(1);
  lost = false;
  const applied = await installSutura({ ...chosen, apply: replacement.plan!.digest }, options);
  expect(applied.receipt?.operations[0]?.status).toBe('completed');
  const { createHash } = await import('node:crypto');
  const archive = join(cwd, '.sutura', 'setup-receipts', `${createHash('sha256').update(unknown).digest('hex')}.json`);
  expect(await readFile(archive, 'utf8')).toBe(unknown);
  expect(await readFile(receiptPath(cwd), 'utf8')).not.toContain('never-record-this-value');
}));

it('converts an interrupted remote intent into durable outcome-unknown without a remote retry', async () => fixture(async cwd => {
  const chosen = { ...request, credentials: ['NEBIUS_API_KEY'] };
  const options = { cwd, run: vi.fn(async () => ''), environment: { NEBIUS_API_KEY: 'private' } };
  const preview = await installSutura(chosen, options);
  await installSutura({ ...chosen, apply: preview.plan!.digest }, options);
  const receipt = JSON.parse(await readFile(receiptPath(cwd), 'utf8'));
  receipt.operations.find((op: { id: string }) => op.id === 'secret:NEBIUS_API_KEY').status = 'intent';
  await writeFile(receiptPath(cwd), JSON.stringify(receipt));
  options.run.mockClear();
  const resumed = await installSutura({ ...chosen, apply: preview.plan!.digest }, options);
  expect(resumed.exitCode).toBe(2);
  expect(JSON.parse(await readFile(receiptPath(cwd), 'utf8')).operations.find((op: { id: string }) => op.id === 'secret:NEBIUS_API_KEY').status).toBe('outcome-unknown');
  expect(options.run).not.toHaveBeenCalled();
}));

interface GeneratedJob { if?: string; needs?: string | string[]; permissions: Record<string, string>; outputs?: Record<string, string>; steps: Array<{ id?: string; uses?: string; with?: Record<string, string>; run?: string; env?: Record<string, string> }> }
function generated() { return parse(actionWorkflow('CI', false, ACTION_SHA)) as { permissions: Record<string, string>; jobs: Record<string, GeneratedJob> }; }
describe('generated inspection and repair admission', () => {
  it('isolates readonly inspection and the always-evaluated credential-free finalizer', () => {
    const document = generated(), { inspect, repair, finalize } = document.jobs;
    expect(document.permissions).toEqual({});
    expect(inspect!.permissions).toEqual({ actions: 'read', contents: 'read' });
    expect(inspect!.steps[0]!.with).toEqual({ mode: 'inspect', 'github-token': '${{ github.token }}', 'run-id': '${{ github.event.workflow_run.id }}', runtime: 'auto' });
    expect(inspect!.outputs?.['repair-eligible']).toBe('${{ steps.inspect.outputs.repair-eligible }}');
    expect(repair!.needs).toBe('inspect');
    expect(repair!.permissions).toEqual({ actions: 'read', checks: 'write', contents: 'write', 'pull-requests': 'write' });
    expect(repair!.steps[0]!.with?.mode).toBe('heal');
    expect(finalize!.needs).toEqual(['inspect', 'repair']);
    expect(finalize!.if).toBe('${{ always() }}');
    expect(finalize!.permissions).toEqual({});
    expect(JSON.stringify(finalize)).not.toMatch(/secrets\.|CONTREE|NEBIUS/u);
  });
  it('evaluates generated repair admission for every conclusion, disable, recursion and inspection decision', () => {
    const condition = generated().jobs.repair!.if!.replace(/^\$\{\{|\}\}$/gu, '').trim();
    for (const conclusion of ['success', 'failure', 'timed_out', 'cancelled']) for (const disabled of ['true', 'false']) for (const branch of ['develop', 'sutura/fix-7']) for (const eligible of ['true', 'false']) {
      const admitted = runInNewContext(condition, { vars: { SUTURA_DISABLED: disabled }, github: { event: { workflow_run: { conclusion, head_branch: branch } } }, needs: { inspect: { outputs: { 'repair-eligible': eligible } } }, startsWith: (value: string, prefix: string) => value.startsWith(prefix) });
      expect(admitted).toBe(eligible === 'true' && disabled !== 'true' && branch === 'develop' && ['failure', 'timed_out'].includes(conclusion));
    }
  });
  it('runs finalization after missing inspection evidence or repair failure without provider configuration', async () => fixture(async cwd => {
    const step = generated().jobs.finalize!.steps[0]!;
    for (const [inspect, repair, code] of [['success', 'skipped', 0], ['success', 'success', 0], ['success', 'failure', 1], ['failure', 'skipped', 1], ['cancelled', 'skipped', 1], ['success', '', 1]]) {
      const summary = join(cwd, `summary-${inspect}-${repair}.md`);
      const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-c', step.run!], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', GITHUB_STEP_SUMMARY: summary, INSPECT_RESULT: String(inspect), REPAIR_RESULT: String(repair) } });
      expect(result.status, result.stderr).toBe(code);
      const text = await readFile(summary, 'utf8');
      expect(text).toContain('Native verification and integration remain separate');
      if (inspect !== 'success') expect(text).toContain('Inspection evidence unavailable');
    }
  }));
  it('minimally upgrades every same-release pin and can pause the multi-job monitor', async () => fixture(async cwd => {
    const old = actionWorkflow('CI', false, 'b'.repeat(40));
    await writeFile(join(cwd, '.github/workflows/sutura.yml'), old);
    const options = { cwd, environment: {}, run: vi.fn(async () => '[]') };
    const upgrade = await installSutura({ ...request, operation: 'upgrade' }, options);
    expect(upgrade.plan?.blockers).toEqual([]);
    expect(upgrade.plan?.diff.after).toBe(old.replaceAll('b'.repeat(40), ACTION_SHA));
    const pause = await installSutura({ ...request, operation: 'pause' }, options);
    expect(pause.plan?.blockers).toEqual([]);
  }));
});
