import { readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument, isMap, isSeq, isScalar } from 'yaml';
import { DEFAULT_REPAIR_BUDGET_LIMITS } from '@sutura/core';
import type { InitArguments } from './args.js';
import { VERSION } from './args.js';
import { type CommandRunner, resolveRepository, runCommand } from './command.js';
import { resolveActionCommit } from './release.js';
import { assessRepository } from './assess.js';
import { acquireSetupLock, boundedFile, CREDENTIAL_NAMES, planDigest, readReceipt, replaceWorkflow, safeParents,
  SetupError, sha256, WORKFLOW_PATH, writeReceipt, type SetupPlan, type SetupReceipt, type PlannedOperation } from './adoption.js';

export { SetupError } from './adoption.js';
export type { SetupPlan, SetupReceipt } from './adoption.js';
const REQUIRED_NAMES = ['NEBIUS_API_KEY', 'CONTREE_TOKEN', 'CONTREE_PROJECT'];
export interface SetupOptions { cwd?: string; environment?: Readonly<NodeJS.ProcessEnv>; run?: CommandRunner }
export interface SetupResult {
  exitCode: 0 | 1 | 2;
  workflowPath: string;
  configured: string[];
  missing: string[];
  lines: string[];
  plan?: SetupPlan;
  receipt?: SetupReceipt;
}
async function chooseWorkflow(root: string, requested?: string): Promise<string> {
  await safeParents(root, WORKFLOW_PATH);
  let files: string[];
  try { files = await readdir(join(root, '.github', 'workflows')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') files = []; else throw error; }
  if (files.length > 128) throw new SetupError('Workflow inventory exceeds 128 entries; select a smaller repository scope');
  const names: string[] = [];
  for (const file of files.sort()) {
    if (!/\.ya?ml$/u.test(file) || /^sutura\.ya?ml$/u.test(file)) continue;
    const content = await boundedFile(root, `.github/workflows/${file}`);
    if (content === null) continue;
    const doc = parseDocument(content);
    if (doc.errors.length) throw new SetupError(`Invalid workflow YAML: ${file}`);
    const name = doc.get('name');
    if (typeof name === 'string') names.push(name);
  }
  if (requested && names.includes(requested)) return requested;
  if (requested) throw new SetupError(`Workflow not found: ${requested}`);
  if (names.length === 1) return names[0]!;
  throw new SetupError(names.length ? 'Select one watched workflow with --workflow' : 'No GitHub Actions workflow was found. Add CI before Sutura.');
}

function workflowDetails(content: string): { permissions: unknown; guarded: boolean; pins: Array<{ sha: string; start: number; end: number }> } {
  const document = parseDocument(content);
  if (document.errors.length) throw new SetupError('Installed workflow is invalid YAML; resolve it before setup');
  // Aliases and merge keys are not ownership evidence.
  try { document.toJS({ maxAliasCount: 0 }); } catch { throw new SetupError('Workflow aliases require manual ownership resolution'); }
  const pins: Array<{ sha: string; start: number; end: number }> = [];
  let guarded = true, repairSteps = 0;
  const expectedGuard = String(parseDocument(actionWorkflow('CI', false, 'a'.repeat(40))).getIn(['jobs', 'repair', 'if'])).replace(/\s+/gu, ' ').trim();
  const legacyGuard = expectedGuard.replace("needs.inspect.outputs['repair-eligible'] == 'true' && ", '');
  const jobPermissions: Record<string, unknown> = {};
  const jobs = document.get('jobs', true);
  if (isMap(jobs)) for (const pair of jobs.items) {
    if (!isMap(pair.value)) continue;
    const steps = pair.value.get('steps', true);
    if (!isSeq(steps)) continue;
    for (const step of steps.items) {
      if (!isMap(step)) continue;
      const uses = step.get('uses', true);
      if (!isScalar(uses) || typeof uses.value !== 'string' || !uses.range) continue;
      const match = /^juan294\/sutura@([a-f0-9]{40})$/iu.exec(uses.value);
      if (match) {
        pins.push({ sha: match[1]!, start: uses.range[0], end: uses.range[1] });
        if (step.getIn(['with', 'mode']) !== 'inspect') {
          repairSteps += 1;
          guarded &&= [expectedGuard, legacyGuard].includes(String(pair.value.get('if')).replace(/\s+/gu, ' ').trim());
        }
        jobPermissions[String(pair.key)] = pair.value.get('permissions', true)?.toJSON() ?? 'inherited';
      }
    }
  }
  const permissions = document.get('permissions', true);
  return { pins, guarded: guarded && repairSteps > 0, permissions: { workflow: isMap(permissions) || isScalar(permissions) ? permissions.toJSON() : 'inherited; inspect repository defaults', jobs: jobPermissions } };
}

const quote = (value: string): string => `'${value.replaceAll("'", "'\"'\"'")}'`;
function nextCommand(plan: SetupPlan): string {
  return ['sutura', plan.operation, '--apply', plan.digest, '--workflow', quote(plan.workflow),
    ...(plan.repository ? ['--repo', quote(plan.repository)] : []), '--action-sha', plan.actionSha,
    ...plan.credentialNames.flatMap(name => ['--credential', name])].join(' ');
}

async function remoteVariables(root: string, repository: string, run: CommandRunner): Promise<Map<string, string>> {
  const output = await run('gh', ['variable', 'list', '--repo', repository, '--json', 'name,value'], { cwd: root });
  if (Buffer.byteLength(output) > 128 * 1024) throw new SetupError('Repository variable inventory exceeds the setup bound');
  let values: unknown;
  try { values = JSON.parse(output); } catch { throw new SetupError('Repository variable inventory was not valid JSON'); }
  if (!Array.isArray(values) || values.length > 1000 || values.some(value =>
    !value || typeof value !== 'object' || typeof value.name !== 'string' || typeof value.value !== 'string')) {
    throw new SetupError('Repository variable inventory was incomplete');
  }
  return new Map(values.map(value => [value.name, value.value]));
}

async function inputAssessment(root: string, actionSha: string) {
  const assessment = await assessRepository(root, { target: { kind: 'installed-action', actionSha } });
  const inputs = assessment.inputs.filter(input => input.path !== WORKFLOW_PATH);
  return {
    digest: sha256(JSON.stringify(inputs)),
    summary: {
      schemaVersion: assessment.schemaVersion, scopeKind: assessment.scopeKind, complete: assessment.complete,
      jobs: assessment.jobs.filter(job => job.scope.workflowPath !== WORKFLOW_PATH).map(job => ({
        scope: { workflowPath: job.scope.workflowPath, jobKey: job.scope.jobKey }, target: job.target,
        support: job.support, reason: job.reason, requiredInput: job.requiredInput, nextAction: job.nextAction,
        evidenceStage: job.evidenceStage, readiness: job.readiness,
      })), warnings: assessment.warnings, nextAction: assessment.nextAction,
    },
  };
}

/** Preview has no local writes and no configuration mutations; apply is exact-plan only. */
export async function installSutura(request: InitArguments, options: SetupOptions = {}): Promise<SetupResult> {
  const root = await realpath(options.cwd ?? process.cwd());
  const environment = options.environment ?? process.env;
  const adapter = options.run ?? runCommand;
  const run: CommandRunner = (command, args, settings) => adapter(command, args, { ...settings, timeoutMs: 15_000, maxOutputBytes: 128 * 1024 });
  const operation = request.operation ?? 'init';
  const credentials: string[] = CREDENTIAL_NAMES.filter(name => request.credentials?.includes(name));
  if (credentials.length !== (request.credentials ?? []).length || credentials.some(name => !(CREDENTIAL_NAMES as readonly string[]).includes(name))) {
    throw new SetupError('Select only documented, unique credential names with --credential');
  }
  if (operation !== 'init' && credentials.length) throw new SetupError('Credential configuration is selected through init, not lifecycle operations');
  if (request.repository && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(request.repository)) throw new SetupError('Invalid repository scope');
  await safeParents(root, WORKFLOW_PATH);
  const current = await boundedFile(root, WORKFLOW_PATH);
  const prior = await readReceipt(root);
  const workflow = await chooseWorkflow(root, request.workflow);
  const runtime = selectedRuntime(environment);
  const actionSha = await resolveActionCommit({ version: VERSION, cwd: root, run,
    ...(request.actionSha ? { explicitCommit: request.actionSha } : {}) });
  const repository = request.repository ?? (credentials.length || operation === 'pause' || operation === 'resume'
    ? await resolveRepository(root, undefined, run) : null);
  const assessment = await inputAssessment(root, actionSha);
  const currentHash = current === null ? null : sha256(current);
  let proposed = current;
  const blockers: string[] = [], operations: PlannedOperation[] = [];
  let permissions: unknown = 'unavailable';
  let guarded = false;
  let pins: ReturnType<typeof workflowDetails>['pins'] = [];
  if (current !== null) {
    try { ({ permissions, pins, guarded } = workflowDetails(current)); }
    catch (error) { blockers.push(error instanceof SetupError ? error.message : 'Workflow ownership unavailable'); }
  }
  if (operation === 'init') {
    if (current !== null && (!prior?.installation.wholeWorkflowOwned || prior.installation.workflowSha256 !== currentHash)) {
      blockers.push('Existing workflow is not an unchanged owned installation; use upgrade --plan or resolve the three-way diff. --force cannot overwrite it.');
    } else if (current === null) {
      proposed = actionWorkflow(workflow, request.tavilyEnabled, actionSha, runtime, credentials);
      permissions = workflowDetails(proposed).permissions;
      operations.push({ id: 'workflow', kind: 'workflow-write', name: WORKFLOW_PATH });
    }
    for (const name of credentials) operations.push(name === 'CONTREE_PROJECT'
      ? { id: `variable:${name}`, kind: 'variable-set', name, value: environment[name]?.trim() ?? '' }
      : { id: `secret:${name}`, kind: 'secret-set', name });
  } else if (operation === 'upgrade') {
    if (current === null || !pins.length || new Set(pins.map(pin => pin.sha.toLowerCase())).size !== 1) blockers.push('Installed immutable Sutura Action references must share one release; resolve ownership before upgrade.');
    else if (prior && prior.installation.workflowSha256 !== currentHash) blockers.push('Workflow drift: resolve the three-way diff before upgrade.');
    else {
      proposed = current;
      for (const pin of [...pins].sort((left, right) => right.start - left.start)) {
        proposed = proposed.slice(0, pin.start) + proposed.slice(pin.start, pin.end).replace(pin.sha, actionSha) + proposed.slice(pin.end);
      }
      if (proposed !== current) operations.push({ id: 'workflow', kind: 'workflow-write', name: WORKFLOW_PATH });
    }
  } else if (operation === 'remove') {
    if (!prior?.installation.wholeWorkflowOwned || prior.installation.workflowSha256 !== currentHash || current === null) {
      blockers.push('Removal requires the unchanged wholly owned workflow; custom jobs, credentials and evidence are retained.');
    } else {
      proposed = null;
      operations.push({ id: 'workflow', kind: 'workflow-remove', name: WORKFLOW_PATH });
    }
  } else {
    if (current === null || !pins.length || new Set(pins.map(pin => pin.sha.toLowerCase())).size !== 1 || !guarded) blockers.push('Pause/resume requires a proved SUTURA_DISABLED admission guard on the installed workflow.');
    if (!repository) blockers.push('Pause/resume requires one explicit GitHub repository');
    else {
      const previousValue = (await remoteVariables(root, repository, run)).get('SUTURA_DISABLED') ?? null;
      operations.push({ id: 'variable:SUTURA_DISABLED', kind: 'variable-set', name: 'SUTURA_DISABLED', value: operation === 'pause' ? 'true' : 'false', previousValue });
    }
  }
  const uncertain = prior?.operations.filter(entry => entry.status === 'outcome-unknown' ||
    entry.status === 'intent' && ['secret-set', 'variable-set'].includes(prior.plan.operations.find(op => op.id === entry.id)!.kind)) ?? [];
  if (uncertain.some(entry => !operations.some(op => op.id === entry.id))) {
    blockers.push('A prior remote write has unknown outcome. Select its same credential or admission operation and review an explicit replacement plan before continuing.');
  }
  const plan: SetupPlan = {
    schemaVersion: 1, digest: '', root, operation, cliVersion: VERSION, repository, workflow, actionSha,
    credentialNames: credentials, runtime, inputDigest: assessment.digest,
    baselineSha256: currentHash, proposedSha256: proposed === null ? null : sha256(proposed),
    diff: { path: WORKFLOW_PATH, before: current, after: proposed },
    ...(uncertain.length ? { reconciliation: { priorPlanDigest: prior!.planDigest, operationIds: uncertain.map(entry => entry.id), confirmation: 'new-reviewed-apply-required' as const } } : {}),
    ...(prior && prior.installation.workflowSha256 !== currentHash ? {
      conflict: { base: prior.plan.diff.after, current, proposed },
    } : {}),
    capabilities: {
      assessment: assessment.summary,
      selectedProviders: credentials.filter(name => name !== 'CONTREE_PROJECT').map(name => name.replace(/_API_KEY$|_TOKEN$/u, '').toLowerCase()),
      destinations: ['GitHub Actions repository configuration', 'Nebius: selected CI logs and bounded repair context', 'ConTree: bounded source snapshot and sandbox commands',
        ...(credentials.includes('OPENAI_API_KEY') ? ['OpenAI: veto-only repair audit context'] : []),
        ...(credentials.includes('TYPESAFE_API_KEY') ? ['TypeSafe: veto-only repair audit context'] : []),
        ...(credentials.includes('TAVILY_API_KEY') ? ['Tavily: selected dependency search terms'] : [])],
      permissions, limits: DEFAULT_REPAIR_BUDGET_LIMITS,
      unpriced: ['ConTree execution', 'GitHub runner time', 'No total cost cap or static price estimate'],
      retention: ['Local setup receipt retained until explicitly removed', 'GitHub and selected provider retention remains account-controlled; setup does not change it'],
      readiness: { assessed: assessment.summary.complete ? 'observed' : 'incomplete', configured: 'unmeasured', activated: 'unmeasured', prepared: 'unmeasured', reproduced: 'unmeasured', 'native-verified': 'unmeasured', integrated: 'unmeasured' },
      nativeChecks: 'Automated-token repair PRs may require native workflow approval; App-token wiring is preserved. No push, activation, paid smoke or merge is performed by setup.',
    },
    operations, blockers, nextAction: '',
  };
  plan.digest = planDigest(plan);
  plan.nextAction = blockers.length ? `Resolve the displayed scope/ownership conflict, then run sutura ${operation} --plan` : nextCommand(plan);

  const selected = request.apply && prior?.planDigest === request.apply ? prior.plan : plan;
  const configured = prior && selected === prior.plan
    ? prior.operations.filter(entry => entry.status === 'completed').map(entry => selected.operations.find(op => op.id === entry.id)!).filter(op => op.kind === 'secret-set' || op.kind === 'variable-set').map(op => op.name)
    : [];
  const missing = REQUIRED_NAMES.filter(name => !credentials.includes(name) && !configured.includes(name));
  const result: SetupResult = { exitCode: 2, workflowPath: join(root, WORKFLOW_PATH), configured, missing, plan: selected, lines: [
    'Setup v1: init now previews; use the exact --apply digest after reviewing its scope. --force does not bypass review.',
    `CLI ${VERSION}; desired Action ${actionSha}; local workflow is not activated or repair-ready.`,
    ...(selected.reconciliation ? ['Prior remote write outcome is unknown. This NEW plan explicitly replaces only its listed selected values; review it before applying. Historical receipts will be retained.'] : []),
    ...selected.blockers, `Next: ${selected.nextAction}`,
  ] };
  if (!request.apply || request.plan) return result;
  if (request.apply !== selected.digest || selected.blockers.length || selected.root !== root ||
    selected.repository !== repository || selected.operation !== operation || selected.workflow !== workflow ||
    selected.actionSha !== actionSha || selected.runtime !== runtime || JSON.stringify(selected.credentialNames) !== JSON.stringify(credentials) ||
    selected.inputDigest !== assessment.digest) {
    result.lines.push('Plan digest or repository input drift; review a fresh plan before any effects.');
    return result;
  }
  const receipt: SetupReceipt = prior?.planDigest === selected.digest ? prior : {
    schemaVersion: 1, planDigest: selected.digest, plan: selected,
    operations: selected.operations.map(op => ({ id: op.id, status: 'pending' })),
    installation: prior?.installation ?? { wholeWorkflowOwned: operation === 'init' && current === null, workflowSha256: currentHash },
    nextAction: selected.nextAction,
  };
  result.receipt = receipt;
  const acceptedWorkflow = currentHash === selected.baselineSha256 || currentHash === selected.proposedSha256;
  if (!acceptedWorkflow) {
    result.plan = { ...selected, conflict: { base: selected.diff.before, current, proposed: selected.diff.after } };
    result.lines.push('Workflow drift; preserve user edits and resolve the displayed three-way diff.');
    return result;
  }
  const release = await acquireSetupLock(root);
  try {
    // Another setup may have completed while this invocation waited to acquire the lock.
    const latest = await readReceipt(root);
    if (latest && JSON.stringify(latest) !== JSON.stringify(prior)) {
      result.lines.push('Setup receipt changed; reload the plan before continuing.');
      return result;
    }
    if (receipt.operations.some(entry => entry.status === 'outcome-unknown' || entry.status === 'intent' && ['secret-set', 'variable-set'].includes(selected.operations.find(op => op.id === entry.id)!.kind))) {
      for (const entry of receipt.operations) if (entry.status === 'intent') entry.status = 'outcome-unknown';
      receipt.nextAction = 'reconcile the selected credential write using provider operation evidence; secret-name presence cannot prove its value. Review a replacement before repeating gh secret set.';
      await writeReceipt(root, receipt);
      result.lines.push(receipt.nextAction);
      return result;
    }
    await writeReceipt(root, receipt);
    for (const [index, op] of selected.operations.entries()) {
      const state = receipt.operations[index]!;
      const actual = await boundedFile(root, WORKFLOW_PATH);
      const actualHash = actual === null ? null : sha256(actual);
      if (actualHash !== selected.baselineSha256 && actualHash !== selected.proposedSha256) {
        receipt.nextAction = 'Workflow drift; review the three-way diff and rerun --plan';
        await writeReceipt(root, receipt); result.lines.push(receipt.nextAction); return result;
      }
      if (state.status === 'completed') {
        if (op.kind === 'workflow-write' || op.kind === 'workflow-remove') {
          if (actualHash !== selected.proposedSha256) { result.lines.push('Completed workflow operation drifted; do not overwrite it.'); return result; }
        } else if (op.kind === 'secret-set') {
          const output = await run('gh', ['secret', 'list', '--repo', repository!, '--json', 'name'], { cwd: root });
          if (Buffer.byteLength(output) > 128 * 1024 || !Array.isArray(JSON.parse(output)) ||
            !JSON.parse(output).some((item: { name?: string }) => item.name === op.name)) {
            result.lines.push(`Completed credential ${op.name} is no longer listed; reconcile without automatic replacement.`); return result;
          }
        } else if ((await remoteVariables(root, repository!, run)).get(op.name) !== op.value) {
          result.lines.push(`Completed variable ${op.name} drifted; review a fresh plan.`); return result;
        }
        continue;
      }
      if (op.kind === 'secret-set' && !environment[op.name]?.trim() || op.kind === 'variable-set' && op.name === 'CONTREE_PROJECT' && !op.value) {
        if (!result.missing.includes(op.name)) result.missing.push(op.name);
        receipt.nextAction = `Supply the explicitly selected ${op.name} and resume the same plan`; await writeReceipt(root, receipt); result.lines.push(receipt.nextAction); return result;
      }
      if (state.status === 'intent' && (op.kind === 'workflow-write' || op.kind === 'workflow-remove') && actualHash === selected.proposedSha256) {
        state.status = 'completed';
      } else {
        if (op.kind === 'variable-set' && op.previousValue !== undefined &&
          ((await remoteVariables(root, repository!, run)).get(op.name) ?? null) !== op.previousValue) {
          result.lines.push('Admission variable drifted after preview; review a new plan.'); return result;
        }
        state.status = 'intent'; await writeReceipt(root, receipt);
        try {
          if (op.kind === 'workflow-write' || op.kind === 'workflow-remove') {
            await replaceWorkflow(root, actualHash, selected.diff.after);
          }
          else if (op.kind === 'secret-set') await run('gh', ['secret', 'set', op.name, '--repo', repository!], { cwd: root, stdin: environment[op.name]!.trim() });
          else await run('gh', ['variable', 'set', op.name, '--repo', repository!, '--body', op.value!], { cwd: root });
        } catch {
          if (op.kind === 'secret-set' || op.kind === 'variable-set') state.status = 'outcome-unknown';
          receipt.nextAction = state.status === 'outcome-unknown' ? `reconcile ${op.id}: response loss cannot establish whether the write completed; review replacement before repeating it` : 'Inspect the local operation and exact diff before resuming';
          await writeReceipt(root, receipt); result.lines.push(receipt.nextAction); result.exitCode = state.status === 'outcome-unknown' ? 2 : 1; return result;
        }
        state.status = 'completed';
      }
      if (op.kind === 'workflow-write' || op.kind === 'workflow-remove') receipt.installation.workflowSha256 = selected.proposedSha256;
      else if (!result.configured.includes(op.name)) result.configured.push(op.name);
      receipt.nextAction = 'Continue remaining reviewed setup operations';
      await writeReceipt(root, receipt);
    }
    receipt.nextAction = operation === 'init' && result.missing.length
      ? `Review explicit configuration of ${result.missing.join(', ')} with sutura init --plan --credential <name>`
      : 'Run sutura doctor; activation, preparation, reproduction, native checks and integration remain unmeasured';
    await writeReceipt(root, receipt);
    result.lines.push('Requested local/configuration operations completed; no hosted activation or repair readiness is claimed.', receipt.nextAction);
    result.exitCode = operation === 'init' && result.missing.length ? 2 : 0;
    return result;
  } finally { await release(); }
}

export { actionWorkflow };

function selectedRuntime(environment: Readonly<NodeJS.ProcessEnv>): 'auto' | 'node' | 'python' {
  const runtime = environment.SUTURA_RUNTIME?.trim() || 'auto';
  if (runtime !== 'auto' && runtime !== 'node' && runtime !== 'python') {
    throw new SetupError('SUTURA_RUNTIME must be auto, node, or python');
  }
  return runtime;
}

function actionWorkflow(
  workflow: string,
  tavilyEnabled: boolean,
  actionSha: string,
  runtime = 'auto',
  credentials: readonly string[] = [],
): string {
  const tavilyInput = tavilyEnabled && credentials.includes('TAVILY_API_KEY')
    ? '          tavily-api-key: ${{ secrets.TAVILY_API_KEY }}\n'
    : '';
  return `name: Sutura repair monitor
run-name: "\${{ format('{0}: {1} #{2} ({3}) on {4}', github.event.workflow_run.conclusion == 'success' && 'No repair needed' || (github.event.workflow_run.conclusion == 'failure' || github.event.workflow_run.conclusion == 'timed_out') && 'Repair requested' || 'Repair not triggered', github.event.workflow_run.name, github.event.workflow_run.run_number, github.event.workflow_run.conclusion, github.event.workflow_run.head_branch) }}"

on:
  workflow_run:
    workflows: [${JSON.stringify(workflow)}]
    types: [completed]

permissions: {}

concurrency:
  group: sutura-\${{ github.event.workflow_run.id }}
  cancel-in-progress: false

jobs:
  inspect:
    name: Inspect CI without repair credentials
    runs-on: ubuntu-latest
    permissions:
      actions: read
      contents: read
    outputs:
      repair-eligible: \${{ steps.inspect.outputs.repair-eligible }}
    steps:
      - name: Inspect failed CI
        id: inspect
        uses: juan294/sutura@${actionSha}
        with:
          mode: inspect
          github-token: \${{ github.token }}
          run-id: \${{ github.event.workflow_run.id }}
          runtime: ${runtime}
  repair:
    name: Attempt verified CI repair
    needs: inspect
    if: >-
      \${{
        needs.inspect.outputs['repair-eligible'] == 'true' &&
        vars.SUTURA_DISABLED != 'true' &&
        !startsWith(github.event.workflow_run.head_branch, 'sutura/fix-') &&
        (github.event.workflow_run.conclusion == 'failure' ||
        github.event.workflow_run.conclusion == 'timed_out')
      }}
    runs-on: ubuntu-latest
    permissions:
      actions: read
      checks: write
      contents: write
      pull-requests: write
    steps:
      - name: Verify and repair failed CI
        uses: juan294/sutura@${actionSha}
        with:
          mode: heal
          github-token: \${{ github.token }}
          run-id: \${{ github.event.workflow_run.id }}
          runtime: ${runtime}
          nebius-api-key: \${{ secrets.NEBIUS_API_KEY }}
${credentials.includes('OPENAI_API_KEY') ? '          openai-api-key: ${{ secrets.OPENAI_API_KEY }}\n' : ''}${credentials.includes('TYPESAFE_API_KEY') ? '          typesafe-api-key: ${{ secrets.TYPESAFE_API_KEY }}\n' : ''}${tavilyInput}          contree-token: \${{ secrets.CONTREE_TOKEN }}
          contree-project: \${{ vars.CONTREE_PROJECT }}
  finalize:
    name: Retain monitor outcome
    needs: [inspect, repair]
    if: \${{ always() }}
    runs-on: ubuntu-latest
    permissions: {}
    steps:
      - name: Summarize available evidence
        env:
          INSPECT_RESULT: \${{ needs.inspect.result }}
          REPAIR_RESULT: \${{ needs.repair.result }}
        run: |
          printf '### Sutura monitor\\nInspection job: %s\\nRepair job: %s\\nNative verification and integration remain separate.\\n' "$INSPECT_RESULT" "$REPAIR_RESULT" >> "$GITHUB_STEP_SUMMARY"
          if [ "$INSPECT_RESULT" != success ]; then
            printf 'Inspection evidence unavailable. Inspect the failed job; a collector may recover run metadata after access returns. No artifact is assumed.\\n' >> "$GITHUB_STEP_SUMMARY"
            exit 1
          fi
          if [ "$REPAIR_RESULT" != success ] && [ "$REPAIR_RESULT" != skipped ]; then
            printf 'Repair did not complete. Read its typed outcome and next action before a distinct authorized attempt.\\n' >> "$GITHUB_STEP_SUMMARY"
            exit 1
          fi
          printf 'Read the inspection output for disposition and next action. A skipped repair is not a verified recovery.\\n' >> "$GITHUB_STEP_SUMMARY"
`;
}
