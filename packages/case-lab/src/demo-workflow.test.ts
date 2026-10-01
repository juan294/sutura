import { execFileSync } from 'node:child_process';
import { lstatSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CASE_LAB_CASES, CASE_LAB_CASE_IDS } from './cases.js';

const WORKFLOW = readFileSync(resolve(import.meta.dirname, '../demo/case-lab.yml'), 'utf8');
const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../..');
const CORPUS_LINK_STEP = 'Expose the Placebo corpus where the matrix materializer expects it';
const MATERIALIZER = readFileSync(resolve(import.meta.dirname, '../demo/materialize-case-lab-case.mjs'), 'utf8');

function stepBlocks(text: string): Array<{ name: string; body: string }> {
  const parts = text.split(/\n {6}- (?=name:|uses:)/u).slice(1);
  return parts.map((part) => {
    const name = /^name:\s*(.+)$/mu.exec(part)?.[1] ?? part.split('\n')[0] ?? '';
    return { name: name.trim(), body: part };
  });
}

describe('demo case-lab.yml contract', () => {
  const steps = stepBlocks(WORKFLOW);

  it('accepts exactly two inputs: a choice of the five cases and a bounded request id', () => {
    const inputs = /inputs:\n([\s\S]*?)\n\npermissions:/u.exec(WORKFLOW)?.[1] ?? '';
    expect(inputs.match(/^ {6}[a-z-]+:$/gmu)).toEqual(['      case-id:', '      request-id:']);
    const options = [...inputs.matchAll(/^ {10}- ([a-z-]+)$/gmu)].map((match) => match[1]);
    expect(options).toEqual([...CASE_LAB_CASE_IDS]);
    expect(inputs).toContain('type: choice');
    expect(WORKFLOW).toContain('[[ "$REQUEST_ID" =~ ^cl-[0-9]{13}-[a-f0-9]{8}$ ]]');
    expect(WORKFLOW).toContain('javascript-repair|python-repair|flaky-failure|greenwash-trap|upstream-incident) ;;');
  });

  it('grants exactly the four permissions and never id-token', () => {
    const permissions = /permissions:\n([\s\S]*?)\n\n/u.exec(WORKFLOW)?.[1] ?? '';
    expect(permissions.split('\n').map((line) => line.trim()).sort()).toEqual([
      'actions: write', 'checks: write', 'contents: write', 'pull-requests: write',
    ]);
    expect(WORKFLOW).not.toContain('id-token');
    expect(WORKFLOW.match(/permissions:/gu)).toHaveLength(1);
  });

  it('serializes through one static concurrency group and a 45-minute timeout', () => {
    expect(WORKFLOW).toContain('concurrency:\n  group: case-lab\n  cancel-in-progress: false');
    expect(WORKFLOW).toContain('timeout-minutes: 45');
  });

  it('gates on the repository variable and the daily cap before any checkout', () => {
    const names = steps.map((step) => step.name);
    expect(names[0]).toBe('Gate on the emergency switch');
    expect(names[1]).toBe('Validate bounded dispatch input');
    expect(names[2]).toBe('Enforce the daily run cap');
    expect(names[3]).toBe('Check out the trusted demo default branch');
    expect(steps[0]?.body).toContain('if [ "$CASE_LAB_ENABLED" != "true" ]');
    expect(steps[0]?.body).toContain('exit 1');
    expect(steps[2]?.body).toContain('gh run list -R "$GITHUB_REPOSITORY" --workflow case-lab.yml --created ">=$since"');
    expect(steps[2]?.body).toContain('if [ "$count" -gt "$CASE_LAB_DAILY_RUN_CAP" ]');
    expect(WORKFLOW).toContain("CASE_LAB_DAILY_RUN_CAP: '24'");
  });

  it('checks out with persist-credentials false and pins the Action and the controller by exact commit', () => {
    expect(WORKFLOW.match(/persist-credentials: false/gu)).toHaveLength(2);
    expect(WORKFLOW).toContain('ref: ${{ env.SUTURA_CONTROLLER_SHA }}');
    expect(WORKFLOW).toContain('test "$(git -C .sutura rev-parse HEAD)" = "$SUTURA_CONTROLLER_SHA"');
    const uses = [...WORKFLOW.matchAll(/uses: juan294\/sutura\/packages\/action@([a-f0-9]{40})/gu)];
    expect(uses).toHaveLength(1);
    expect(WORKFLOW).toContain(`SUTURA_ACTION_SHA: ${uses[0]?.[1]}`);
  });

  it('passes provider secrets only to the Action step and the publish step that scrubs them', () => {
    const secretSteps = steps.filter((step) => /secrets\.(?:NEBIUS_API_KEY|TAVILY_API_KEY|CONTREE_TOKEN)/u.test(step.body)).map((step) => step.name);
    expect(secretSteps).toEqual(['Run Sutura at the exact release', 'Publish the public-safe result document']);
    const publish = steps.find((step) => step.name === 'Publish the public-safe result document');
    expect(publish?.body).toContain('publish-result');
    expect(WORKFLOW).toContain("capture-replay: 'true'");
    expect(WORKFLOW).toContain('continue-on-error: true');
  });

  it('publishes to the results branch without overwriting and uploads the artifact', () => {
    expect(WORKFLOW).toContain('RESULTS_BRANCH: case-lab-results');
    expect(WORKFLOW).toContain('test ! -e "results/${REQUEST_ID}.json"');
    expect(WORKFLOW).toContain('git push origin "HEAD:${RESULTS_BRANCH}"');
    expect(WORKFLOW).toContain('name: sutura-case-lab-${{ inputs.request-id }}');
    expect(WORKFLOW).toContain('if-no-files-found: error');
  });

  it('links the Placebo corpus where the demo matrix materializer reads it, before materializing', () => {
    const names = steps.map((step) => step.name);
    expect(names).toContain(CORPUS_LINK_STEP);
    expect(names.indexOf(CORPUS_LINK_STEP))
      .toBeGreaterThan(names.indexOf('Check out the Case Lab tooling at the exact controller commit'));
    expect(names.indexOf(CORPUS_LINK_STEP)).toBeLessThan(names.indexOf('Materialize the selected case'));
  });

  it('resolves every matrix fixture at the exact path the live python-repair run failed to read', () => {
    // v0.3.3 live dispatch cl-1790859715678-f35cc333 failed with
    //   ENOENT lstat <workspace>/.sutura-action/packages/placebo/corpus/python-repair-missing-await/metadata.json
    // because the tooling is checked out at .sutura while the demo materializer reads .sutura-action.
    const step = steps.find((candidate) => candidate.name === CORPUS_LINK_STEP);
    expect(step).toBeDefined();
    const script = (step?.body.split('run: |\n')[1] ?? '').split('\n').map((line) => line.replace(/^ {10}/u, '')).join('\n');
    const workspace = mkdtempSync(join(tmpdir(), 'case-lab-corpus-link-'));
    try {
      symlinkSync(REPOSITORY_ROOT, join(workspace, '.sutura'));
      execFileSync('git', ['init', '-q'], { cwd: workspace });
      execFileSync('bash', ['-e', '-c', script], { cwd: workspace, env: { ...process.env, GITHUB_WORKSPACE: workspace } });
      // The link must stay out of the fixture commit even when the demo's .gitignore lacks it.
      execFileSync('git', ['check-ignore', '-q', '.sutura-action/packages/placebo/corpus'], { cwd: workspace });
      const matrixCases = CASE_LAB_CASES.filter((item) => item.materializer.kind === 'matrix');
      expect(matrixCases.map((item) => item.id)).toContain('python-repair');
      for (const item of matrixCases) {
        const metadata = join(workspace, '.sutura-action/packages/placebo/corpus', item.placeboCaseId, 'metadata.json');
        expect(lstatSync(metadata).isFile(), metadata).toBe(true);
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('stages the fixture without naming the ignored corpus link in a pathspec', () => {
    // `git add -A -- . ':(exclude).sutura-action'` exits 1 when the path is ignored, which would
    // fail the whole step under `bash -e`; the link is ignored through .git/info/exclude instead.
    const fixture = steps.find((step) => step.name === 'Push the broken branch and open the broken pull request');
    expect(fixture?.body).toContain("git add -A -- . ':(exclude).sutura'\n");
    expect(fixture?.body).not.toMatch(/exclude\)\.sutura-action/u);
  });

  it('closes its bot pull requests and discards their held CI runs last, without changing the outcome', () => {
    const last = steps.at(-1);
    expect(last?.name).toBe('Close the reported pull requests and discard their held CI runs');
    expect(last?.body).toContain("if: ${{ always() && steps.fixture.outputs.branch != '' }}");
    expect(last?.body).toContain('continue-on-error: true');
    // The repair pull request targets the case branch, so it closes first.
    expect(last?.body).toContain('branches=()');
    expect(last?.body.indexOf('branches+=("sutura/fix-${CI_RUN_ID}")'))
      .toBeLessThan(last?.body.indexOf('branches+=("$CASE_BRANCH")') ?? -1);
    expect(last?.body).toContain('gh pr close "$pr"');
    expect(last?.body).toContain('gh api -X DELETE "repos/${GITHUB_REPOSITORY}/git/refs/heads/${branch}"');
    expect(last?.body).toContain('status=action_required');
    expect(last?.body).toContain('gh api -X DELETE "repos/${GITHUB_REPOSITORY}/actions/runs/${run}"');
    expect(last?.body).not.toMatch(/secrets\./u);
  });
});

describe('demo materializer', () => {
  it('maps the five ids onto the existing break and matrix materializers and nothing else', () => {
    for (const id of CASE_LAB_CASE_IDS) expect(MATERIALIZER).toContain(`'${id}':`);
    expect(MATERIALIZER).toContain("kind: 'break', name: 'assertion'");
    expect(MATERIALIZER).toContain("kind: 'matrix', name: 'python-repair'");
    expect(MATERIALIZER).toContain('Object.hasOwn(CASES, caseId)');
    expect(MATERIALIZER).toContain('process.exit(2)');
    expect(MATERIALIZER).not.toMatch(/exec(?:Sync)?\(/u);
  });
});
