import { describe, expect, it } from 'vitest';

import { githubApi, RUN_ID } from '../replay/replay-fixtures.test-helper.js';
import { GitHubAdapter } from './adapter.js';

const AT = '2026-10-02T05:33:03.1315708Z';

function stamped(lines: readonly string[]): string[] {
  return lines.map((line) => `${AT} ${line}`);
}

function filler(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `ok ${index + 100} - passing ${index}`);
}

async function retainedLog(body: readonly string[], script: readonly string[] = []): Promise<string[]> {
  const api = githubApi({
    logLines: stamped(['##[group]Run tests', ...script, 'shell: /usr/bin/bash -e {0}', '##[endgroup]', ...body]),
    startedAt: '2026-10-02T05:33:03Z',
    completedAt: '2026-10-02T05:33:03Z',
  });
  const adapter = new GitHubAdapter(api, { owner: 'acme', repo: 'widget', runId: RUN_ID });
  const [step] = (await adapter.getFailingRun(RUN_ID)).failedSteps;
  return (step?.log ?? '').split('\n').map((line) => line.slice(AT.length + 1));
}

function tapBlock(header: string, yaml: readonly string[] = []): string[] {
  return [header, '  ---', ...yaml.map((line) => `  ${line}`), '  ...'];
}

describe('failed-step window over 200 lines', () => {
  it('does not spend failure slots on TAP directives', async () => {
    const retained = await retainedLog([
      ...tapBlock('not ok 1 - pending feature # TODO later'),
      ...tapBlock('not ok 2 - unsupported platform # SKIP linux only'),
      ...filler(60),
      ...tapBlock('not ok 3 - real failure', ["location: 'test/real.test.mjs:9:1'"]),
      ...filler(300),
    ]);

    expect(retained).toContain('not ok 3 - real failure');
    expect(retained).not.toContain('not ok 1 - pending feature # TODO later');
    expect(retained).not.toContain('not ok 2 - unsupported platform # SKIP linux only');
    expect(retained).toHaveLength(200);
  });

  it('keeps a second real failure after a nested parent summary', async () => {
    const retained = await retainedLog([
      ...tapBlock('    not ok 1 - child a', ["location: 'test/a.test.mjs:4:3'"]),
      ...tapBlock('not ok 1 - suite', ["failureType: 'subtestsFailed'"]),
      ...filler(60),
      ...tapBlock('not ok 2 - second', ["location: 'test/b.test.mjs:7:1'"]),
      ...filler(300),
    ]);

    expect(retained).toContain('    not ok 1 - child a');
    expect(retained).toContain('not ok 2 - second');
    expect(retained).not.toContain('not ok 1 - suite');
  });

  it('keeps a script echo that ends at the shared block limit', async () => {
    const script = Array.from({ length: 39 }, (_, index) => `step ${index}`);
    const retained = await retainedLog(filler(400), script);

    expect(retained.slice(0, 41)).toEqual(['##[group]Run tests', ...script, 'shell: /usr/bin/bash -e {0}']);
  });

  it('keeps only the header when the script echo exceeds the limit', async () => {
    const script = Array.from({ length: 40 }, (_, index) => `step ${index}`);
    const retained = await retainedLog(filler(400), script);

    expect(retained[0]).toBe('##[group]Run tests');
    expect(retained[1]).not.toBe('step 0');
  });
});

