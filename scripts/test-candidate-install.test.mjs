import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { assertCandidateCheckout } from './test-candidate-install.mjs';
import { packedFilename, verifyInstall, validateGeneratedWorkflow } from './install-test-lib.mjs';

const ACTION_SHA = 'a'.repeat(40);

const progressiveWorkflow = `permissions: {}
jobs:
  inspect:
    permissions: { actions: read, contents: read }
    outputs:
      repair-eligible: \${{ steps.inspect.outputs.repair-eligible }}
    steps:
      - id: inspect
        uses: juan294/sutura@${ACTION_SHA}
        with: { mode: inspect }
  repair:
    needs: inspect
    if: \${{ needs.inspect.outputs['repair-eligible'] == 'true' && vars.SUTURA_DISABLED != 'true' && !startsWith(github.event.workflow_run.head_branch, 'sutura/fix-') && (github.event.workflow_run.conclusion == 'failure' || github.event.workflow_run.conclusion == 'timed_out') }}
    permissions: { actions: read, checks: write, contents: write, pull-requests: write }
    steps:
      - uses: juan294/sutura@${ACTION_SHA}
        with: { mode: heal }
  finalize:
    needs: [inspect, repair]
    if: \${{ always() }}
    permissions: {}
    steps:
      - run: echo finalizing
`;

function doctorOutput(commit) {
  return [
    'Sutura workflow exists.', `Workflow uses juan294/sutura@${commit}.`,
    'Workflow grants checks: write.', 'Workflow wires github-token.',
    'Workflow wires run-id.', 'Workflow wires runtime.',
    'Workflow wires nebius-api-key.', 'Workflow wires contree-token.',
    'Workflow wires contree-project.', 'GitHub secret NEBIUS_API_KEY is configured.',
    'GitHub secret CONTREE_TOKEN is configured.', 'GitHub variable CONTREE_PROJECT is configured.',
  ].map((line) => `[PASS] ${line}`).join('\n');
}

test('candidate pack accepts npm 11 and npm 12 JSON output only when one package is present', () => {
  assert.equal(packedFilename('[{"filename":"sutura-0.5.0.tgz"}]'), 'sutura-0.5.0.tgz');
  assert.equal(packedFilename('{"filename":"sutura-0.5.0.tgz"}'), 'sutura-0.5.0.tgz');
  assert.equal(packedFilename('{"sutura":{"filename":"sutura-0.5.0.tgz"}}'),
    'sutura-0.5.0.tgz');
  assert.throws(() => packedFilename('{}'), /did not return one filename/u);
  assert.throws(() => packedFilename('{"one":{"filename":"one.tgz"},"two":{"filename":"two.tgz"}}'),
    /did not return one filename/u);
});

test('candidate install uses the local tarball and exact candidate Action SHA without network', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'sutura-candidate-unit-'));
  const calls = [];
  try {
    await writeFile(join(temporary, 'LICENSE'), 'MIT fixture\n');
    const result = await verifyInstall({
      mode: 'candidate',
      root: temporary,
      actionCommit: ACTION_SHA,
      now: (() => { let value = 100; return () => value += 25; })(),
      dependencies: {
        pack: async (source, destination) => {
          calls.push(['pack', source]);
          const tarball = join(destination, 'sutura-0.5.0.tgz');
          await writeFile(tarball, 'candidate');
          return tarball;
        },
        install: async (_tarball, consumer) => {
          calls.push(['install']);
          await mkdir(join(consumer, 'node_modules', 'sutura'), { recursive: true });
          await writeFile(join(consumer, 'node_modules', 'sutura', 'package.json'), JSON.stringify({
            name: 'sutura', version: '0.5.0', dependencies: {},
          }));
          await writeFile(join(consumer, 'node_modules', 'sutura', 'LICENSE'), 'MIT fixture\n');
        },
        invoke: async (_binary, args, consumer, environment) => {
          calls.push(args);
          if (args[0] === 'assess') return JSON.stringify({ schemaVersion: 'sutura-repository-assessment-v1', jobs: [], complete: true });
          if (args[0] === 'init' && args.includes('--plan')) return JSON.stringify({ plan: { digest: 'd'.repeat(64), blockers: [], actionSha: ACTION_SHA } });
          if (args[0] === 'init' && args.includes('--apply')) {
            await mkdir(join(consumer, '.github', 'workflows'), { recursive: true });
            await writeFile(join(consumer, '.github', 'workflows', 'sutura.yml'),
              progressiveWorkflow);
            return '';
          }
          if (args[0] === 'doctor') {
            for (const kind of ['secret', 'variable']) {
              assert.equal(execFileSync('gh', [kind, 'list', '--json', 'name', '--jq', '.[].name'], { env: environment, encoding: 'utf8', timeout: 5000 }), '', 'candidate shim must not invent configured credential names');
            }
            return doctorOutput(ACTION_SHA) + '\n[INFO] Readiness: assessed=observed; configured=incomplete; activated=unknown; prepared=unmeasured; reproduced=unmeasured; native-verified=unmeasured; integrated=unmeasured.\n[INFO] No paid execution was attempted.';
          }
          if (args[0] === '--version') return '0.5.0\n';
          throw new Error(`unexpected invocation ${args.join(' ')}`);
        },
      },
    });

    assert.equal(result.mode, 'candidate');
    assert.equal(result.doctorOutcome, 'incomplete-expected');
    assert.ok(calls.some(entry => entry.includes('--plan')));
    assert.ok(calls.some(entry => entry.includes('--apply')));
    assert.equal(result.actionCommit, ACTION_SHA);
    assert.equal(result.packageVersion, '0.5.0');
    assert.equal(result.setupDurationMs, 25);
    assert.match(result.packageIntegrity, /^[a-f0-9]{64}$/u);
    assert.deepEqual(calls[0], ['pack', join(temporary, 'packages', 'cli')]);
    assert.ok(calls.some((entry) => Array.isArray(entry) && entry.includes('--action-sha')));
    assert.ok(!JSON.stringify(calls).includes('sutura@0.5.0'));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('candidate install rejects a mutable or malformed Action ref before packing', async () => {
  let packed = false;
  await assert.rejects(() => verifyInstall({
    mode: 'candidate', root: '/tmp/unused', actionCommit: 'main',
    dependencies: {
      pack: async () => { packed = true; return ''; },
      install: async () => undefined,
      invoke: async () => '',
    },
  }), /exact 40-character/u);
  assert.equal(packed, false);
});

test('candidate wrapper rejects a different HEAD or relevant dirty files', async () => {
  const clean = async (_command, args) => {
    if (args[0] === 'rev-parse') return `${ACTION_SHA}\n`;
    if (args[0] === 'diff') return '';
    if (args[0] === 'ls-files') return '';
    throw new Error('unexpected command');
  };
  await assert.doesNotReject(() => assertCandidateCheckout('/repo', ACTION_SHA, clean));
  await assert.rejects(() => assertCandidateCheckout('/repo', 'main', clean), /exact 40-character/u);
  await assert.rejects(() => assertCandidateCheckout('/repo', 'b'.repeat(40), clean), /HEAD/u);
  await assert.rejects(() => assertCandidateCheckout('/repo', ACTION_SHA, async (command, args, options) => {
    if (args[0] === 'diff') throw new Error('dirty');
    if (args[0] === 'status') return ' M packages/action/dist/index.cjs\n';
    return clean(command, args, options);
  }), /differs from the candidate commit; changed paths:\n M packages\/action\/dist\/index\.cjs/u);
  await assert.rejects(() => assertCandidateCheckout('/repo', ACTION_SHA, async (command, args, options) => {
    if (args[0] === 'ls-files') return 'packages/cli/src/untracked.ts\n';
    return clean(command, args, options);
  }), /untracked/u);
});

test('progressive workflow validation checks privilege and unconditional finalization semantics', () => {
  assert.doesNotThrow(() => validateGeneratedWorkflow(progressiveWorkflow, ACTION_SHA, true));
  for (const workflow of [
    progressiveWorkflow.replace('permissions: {}', 'permissions: write-all'),
    progressiveWorkflow.replace('actions: read, contents: read', 'actions: read, contents: write'),
    progressiveWorkflow.replace('with: { mode: inspect }', 'with: { mode: heal }'),
    progressiveWorkflow.replace("needs.inspect.outputs['repair-eligible'] == 'true' && ", ''),
    progressiveWorkflow.replace(`uses: juan294/sutura@${ACTION_SHA}`, 'uses: unrelated/action@v1') + `\n  extra:\n    steps:\n      - uses: juan294/sutura@${ACTION_SHA}\n`,
    progressiveWorkflow.replace('always()', 'success()'),
    progressiveWorkflow.replace('run: echo finalizing', 'run: echo \${{ secrets.NEBIUS_API_KEY }}'),
  ]) assert.throws(() => validateGeneratedWorkflow(workflow, ACTION_SHA, true), /inspection|finaliz|admission|permission/iu);
});
