import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { mapActionInputs } from './input.js';
import { inspectEvidence, type InspectionCapture } from './inspect.js';
const SHA = 'a'.repeat(40);
const capture: InspectionCapture = { observedAt: '2026-10-25T12:00:00Z',
  repository: 'owner/repo', repositoryId: 1, runId: '7', attempt: 1, sourceSha: SHA, workflowId: 9, workflowPath: '.github/workflows/ci.yml', event: 'push',
  actionSha: 'b'.repeat(40), conclusion: 'failure', headBranch: 'main', complete: true,
  selected: { jobId: 3, jobName: 'unit', stepNumber: 2, stepName: 'Test', log: 'Run pnpm test\n FAIL src/value.test.ts > adds\nAssertionError: expected 1 to be 2' },
  workflow: 'name: CI\non: [push]\njobs:\n  unit:\n    runs-on: ubuntu-latest\n    steps: [{ run: pnpm test }]\n',
  files: { 'package.json': '{"engines":{"node":">=22"},"scripts":{"test":"vitest run"}}', 'pnpm-lock.yaml': 'lockfileVersion: "9.0"\nimporters: { .: {} }\n' },
  paths: ['package.json', 'pnpm-lock.yaml', 'src/value.test.ts'], snapshot: { complete: true, fileCount: 3, totalBytes: 500, largestFileBytes: 200 },
};
describe('provider-free Action inspection', () => {
  it('reads no provider input in inspect mode', () => {
    const read = vi.fn((name: string) => ({ mode: 'inspect', 'run-id': '7', 'github-token': 'read-only', runtime: 'auto' }[name] ?? ''));
    expect(mapActionInputs(read)).toMatchObject({ mode: 'inspect', runId: '7', githubToken: 'read-only', environment: {} });
    expect(read.mock.calls.map(([name]) => name)).not.toContain('nebius-api-key');
  });
  it.each(['push', 'schedule', 'pull_request'])('classifies the same supported assertion independently of event %s', event => {
    const result = inspectEvidence({ ...capture, event });
    expect(result).toMatchObject({ schemaVersion: 'sutura-action-inspection-v1', disposition: 'repair-supported', repairEligible: true, executionAuthorized: false });
    expect(result.evidenceDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(result)).not.toContain('AssertionError');
  });
  it.each([
    ["node main.js", "Error: Cannot find module './missing.js' imported from /workspace/main.js"],
    ["vitest run", "FAIL src/value.test.ts > adds\nTypeError: invalid value\n at src/value.test.ts:2:3"],
    ["node main.js", "Error: Cannot find module '@acme/library' imported from /workspace/main.js"],
  ])('preserves covered structured native diagnostics for %s', (command, diagnostic) => {
    const result = inspectEvidence({ ...capture, files: { ...capture.files, 'package.json': JSON.stringify({ engines: { node: '>=22' }, scripts: { test: command } }) }, selected: { ...capture.selected!, log: `Run pnpm test\n${diagnostic}` } });
    expect(result).toMatchObject({ disposition: 'repair-supported', repairEligible: true });
  });
  it('keeps truncated logs and unsupported service jobs out of privileged routing', () => {
    expect(inspectEvidence({ ...capture, complete: false }).repairEligible).toBe(false);
    expect(inspectEvidence({ ...capture, selected: { ...capture.selected!, truncated: true } }).repairEligible).toBe(false);
    expect(inspectEvidence({ ...capture, workflow: capture.workflow.replace('    steps:', '    services: { db: { image: postgres } }\n    steps:') })).toMatchObject({ disposition: 'observe-only', repairEligible: false });
  });
  it('does not promote an unknown shell command or invented failure to source evidence', () => {
    expect(inspectEvidence({ ...capture, selected: { ...capture.selected!, log: 'Run echo untrusted\nAssertionError: expected 1 to be 2' } }).repairEligible).toBe(false);
  });
  it('fails closed on corrupt identity or ambiguous job mapping', () => {
    expect(() => inspectEvidence({ ...capture, sourceSha: 'wrong' })).toThrow();
    expect(inspectEvidence({ ...capture, selected: { ...capture.selected!, jobName: 'dynamic (22)' } }).repairEligible).toBe(false);
  });
  it('reports successful CI as unexercised, not a synthetic repair', () => {
    expect(inspectEvidence({ ...capture, conclusion: 'success', selected: undefined })).toMatchObject({ disposition: 'observe-only', repairEligible: false, reason: 'no-failed-source-run' });
  });
});

it('admission of a complete selected control block agrees with CLI assessment', () => {
  const command = readFileSync(new URL('../../core/src/engine/__fixtures__/native-ci-control.sh', import.meta.url), 'utf8');
  const workflow = `jobs:\n  unit:\n    steps:\n      - run: |\n${command.trimEnd().split('\n').map(line => `          ${line}`).join('\n')}\n`;
  const log = `Run set -euo pipefail\n${command}shell: /usr/bin/bash -e {0}\n##[endgroup]\nError: merge parent mismatch`;
  expect(inspectEvidence({ ...capture, workflow, selected: { ...capture.selected!, log } })).toMatchObject({ repairEligible: false, reason: 'native-command-admission', nextAction: expect.stringContaining('Sutura') });
});
