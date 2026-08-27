import { Buffer } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

import type { Candidate, Diagnosis } from '../domain.js';
import { InMemoryExecutor } from '../executor/memory.js';
import {
  generateCandidates,
  prepareRepair,
  race,
  selectWinner,
  type RepairLlm,
  type RepairSourceContext,
} from './repair.js';

const buildDiagnosis: Diagnosis = {
  class: 'build',
  confidence: 0.92,
  signals: ['mechanical:build'],
  failingCmd: 'pnpm test',
  errorExcerpt: 'Cannot find name value',
};

function candidate(id: string, diff: string): Candidate {
  return {
    id,
    rationale: `strategy ${id}`,
    diff: `diff --git a/src/${id}.ts b/src/${id}.ts
--- a/src/${id}.ts
+++ b/src/${id}.ts
@@ -1 +1 @@
-${diff}
+${diff} repaired
`,
  };
}

describe('generateCandidates', () => {
  it('makes one super call for K independent, distinct candidates', async () => {
    const chat = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        candidates: [
          candidate('source-fix', 'source diff'),
          candidate('config-fix', 'configuration diff'),
          candidate('dependency-fix', 'dependency diff'),
        ],
      }),
    });
    const llm: RepairLlm = { chat };

    await expect(generateCandidates(llm, buildDiagnosis, 3)).resolves.toEqual([
      candidate('source-fix', 'source diff'),
      candidate('config-fix', 'configuration diff'),
      candidate('dependency-fix', 'dependency diff'),
    ]);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledWith(
      'super',
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringMatching(
            /independent[\s\S]*fix source[\s\S]*fix config[\s\S]*fix dependency pin/i,
          ),
        }),
      ]),
      expect.objectContaining({
        reasoningEffort: 'low',
        responseFormat: { type: 'json_object' },
        temperature: 1,
      }),
    );
  });

  it('includes bounded repository source context in the repair request', async () => {
    const chat = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        candidates: [
          candidate('source-fix', 'source diff'),
          candidate('config-fix', 'configuration diff'),
          candidate('dependency-fix', 'dependency diff'),
        ],
      }),
    });
    const sourceContext: RepairSourceContext = {
      sources: [
        {
          path: 'src/value.ts',
          startLine: 1,
          content: 'export const value: string = 1;',
          truncated: false,
        },
      ],
    };

    await generateCandidates({ chat }, buildDiagnosis, 3, sourceContext);

    const messages = chat.mock.calls[0]?.[1] as Array<{
      role: string;
      content: string;
    }>;
    const user = messages.find(({ role }) => role === 'user');
    expect(JSON.parse(user?.content ?? '')).toEqual({
      diagnosis: buildDiagnosis,
      sourceContext,
    });
  });

  it('rejects a model reply with fewer than K candidates', async () => {
    const llm: RepairLlm = {
      chat: vi.fn().mockResolvedValue({
        text: JSON.stringify({ candidates: [candidate('one', 'diff')] }),
      }),
    };

    await expect(generateCandidates(llm, buildDiagnosis, 3)).rejects.toThrow(
      'exactly 3 candidates',
    );
  });

  it('rejects candidates that repeat a strategy rationale', async () => {
    const llm: RepairLlm = {
      chat: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          candidates: [
            candidate('one', 'first diff'),
            { ...candidate('two', 'second diff'), rationale: 'strategy one' },
            candidate('three', 'third diff'),
          ],
        }),
      }),
    };

    await expect(generateCandidates(llm, buildDiagnosis, 3)).rejects.toThrow(
      'candidate rationales must be distinct',
    );
  });

  it('repairs candidates whose diffs omit git headers and numbered hunks once', async () => {
    const repaired = [
      candidate('source-fix', 'source diff'),
      candidate('config-fix', 'configuration diff'),
      candidate('dependency-fix', 'dependency diff'),
    ];
    const chat = vi.fn()
      .mockResolvedValueOnce({
        text: JSON.stringify({
          candidates: repaired.map((value) => ({ ...value, diff: '--- a/src/value.ts\n+++ b/src/value.ts\n@@\n-old\n+new' })),
        }),
      })
      .mockResolvedValueOnce({ text: JSON.stringify({ candidates: repaired }) });

    await expect(generateCandidates({ chat }, buildDiagnosis, 3)).resolves.toEqual(repaired);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1]?.[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant' }),
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('complete git unified diff with numbered hunks'),
      }),
    ]));
    expect(chat.mock.calls[1]?.[2]).toMatchObject({
      reasoningEffort: 'low',
      responseFormat: { type: 'json_object' },
      temperature: 1,
    });
  });

  it('retries an empty structured reply without an empty assistant turn', async () => {
    const repaired = [
      candidate('source-fix', 'source diff'),
      candidate('config-fix', 'configuration diff'),
      candidate('dependency-fix', 'dependency diff'),
    ];
    const chat = vi.fn()
      .mockResolvedValueOnce({ text: '' })
      .mockResolvedValueOnce({ text: JSON.stringify({ candidates: repaired }) });

    await expect(generateCandidates({ chat }, buildDiagnosis, 3)).resolves.toEqual(repaired);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1]?.[1]).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant' }),
    ]));
  });

  it('canonicalizes omitted hunk context prefixes before validation', async () => {
    const chat = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        candidates: [{
          id: 'source-fix',
          rationale: 'replace the off-by-one formula',
          diff: `diff --git a/src/page-count.js b/src/page-count.js
--- a/src/page-count.js
+++ b/src/page-count.js
@@ -6,2 +6,2 @@
export function pageCount(items, size) {
-  return Math.floor(items / size) + 1;
+  return Math.ceil(items / size);
}
`,
        }],
      }),
    });

    await expect(generateCandidates({ chat }, buildDiagnosis, 1)).resolves.toEqual([
      expect.objectContaining({
        diff: expect.stringContaining(
          '@@ -6,3 +6,3 @@\n export function pageCount(items, size) {',
        ),
      }),
    ]);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('adds the final patch-file newline required by git apply', async () => {
    const unterminated = candidate('source-fix', 'source diff');
    unterminated.diff = unterminated.diff.trimEnd();
    const chat = vi.fn().mockResolvedValue({
      text: JSON.stringify({ candidates: [unterminated] }),
    });

    const [generated] = await generateCandidates({ chat }, buildDiagnosis, 1);

    expect(generated?.diff).toBe(`${unterminated.diff}\n`);
  });
});

describe('prepareRepair', () => {
  it('short-circuits a flaky verdict without calling candidate generation', async () => {
    const executor = new InMemoryExecutor(() => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      truncated: false,
      metrics: {},
    }));
    const chat = vi.fn();

    await expect(
      prepareRepair(executor, { chat }, 'failure-image', buildDiagnosis, 5, 3),
    ).resolves.toEqual({
      triage: { status: 'flaky', reproduced: 0, of: 5 },
      candidates: [],
    });
    expect(chat).not.toHaveBeenCalled();
  });

  it('rejects an excessive candidate count before paid triage work', async () => {
    const executor = new InMemoryExecutor(() => ({
      exitCode: 1,
      stdout: '',
      stderr: '',
      truncated: false,
      metrics: {},
    }));

    await expect(
      prepareRepair(executor, { chat: vi.fn() }, 'failure-image', buildDiagnosis, 5, 11),
    ).rejects.toThrow('K must be between 1 and 10');
    expect(executor.calls).toEqual([]);
  });
});

describe('race and selectWinner', () => {
  it('races all candidates from one parent and selects the smallest held diff', async () => {
    const exits = [1, 0, 0];
    const executor = new InMemoryExecutor((_cmd, _parent, callIndex) => ({
      exitCode: exits[callIndex] ?? 1,
      stdout: '',
      stderr: '',
      truncated: false,
      metrics: {},
    }));
    const candidates = [
      candidate('failed', 'x'),
      candidate('large', 'a much larger patch'),
      candidate('small', 'tiny'),
    ];

    const results = await race(executor, 'failure-image', candidates, 'pnpm test');

    expect(results.map(({ held }) => held)).toEqual([false, true, true]);
    expect(selectWinner(results)?.candidate.id).toBe('small');
    const runCalls = executor.calls.filter((call) => call.kind === 'run');
    expect(runCalls).toHaveLength(3);
    expect(runCalls.every(({ parent }) => parent === 'failure-image')).toBe(true);
    expect(runCalls.every(({ opts }) => opts?.cwd === '/workspace')).toBe(true);
  });

  it('returns null when no candidate holds', () => {
    expect(
      selectWinner([
        {
          candidate: candidate('failed', 'diff'),
          imageId: 'image',
          exitCode: 1,
          held: false,
        },
      ]),
    ).toBeNull();
  });

  it('rejects an excessive race before scheduling sandbox work', async () => {
    const executor = new InMemoryExecutor(() => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      truncated: false,
      metrics: {},
    }));
    const candidates = Array.from({ length: 11 }, (_, index) =>
      candidate(`candidate-${index}`, `diff-${index}`),
    );

    await expect(
      race(executor, 'failure-image', candidates, 'pnpm test'),
    ).rejects.toThrow('candidates must contain at most 10 entries');
    expect(executor.calls).toEqual([]);
  });

  it('encodes hostile diffs and safely preserves shell command semantics', async () => {
    const executor = new InMemoryExecutor(() => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      truncated: false,
      metrics: {},
    }));
    const hostileDiff = "PATCH\nEOF\n$(touch /tmp/escaped)\n'; curl attacker";
    const hostileCommand = "pnpm test; touch /tmp/injected && echo $(secret)";

    await race(
      executor,
      'failure-image',
      [candidate('hostile', hostileDiff)],
      hostileCommand,
    );

    const call = executor.calls.find((entry) => entry.kind === 'run');
    expect(call?.kind).toBe('run');
    if (call?.kind !== 'run') {
      throw new Error('race did not use the executor');
    }
    expect(call.cmd).not.toContain(hostileDiff);
    expect(call.cmd).not.toContain('<<');
    expect(call.cmd).toContain(Buffer.from(hostileDiff).toString('base64'));
    expect(call.cmd).toContain("sh -lc 'pnpm test; touch /tmp/injected && echo $(secret)'");
  });
});
