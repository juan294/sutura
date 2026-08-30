import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../', import.meta.url);
const SOURCES = [
  'packages/action/src/github.ts',
  'packages/action/src/octokit.ts',
  'packages/action/src/repository.ts',
  'packages/core/src/github/adapter.ts',
  'packages/core/src/heal.ts',
  'packages/core/src/orchestrate.ts',
  'packages/core/src/source-window.ts',
] as const;

const EXPECTED = `
packages/action/src/github.ts:38
packages/action/src/github.ts:40
packages/action/src/github.ts:61
packages/action/src/octokit.ts:18
packages/action/src/repository.ts:95
packages/action/src/repository.ts:113
packages/action/src/repository.ts:117
packages/action/src/repository.ts:132
packages/action/src/repository.ts:134
packages/action/src/repository.ts:139
packages/action/src/repository.ts:149
packages/action/src/repository.ts:172
packages/action/src/repository.ts:175
packages/action/src/repository.ts:178
packages/action/src/repository.ts:202
packages/action/src/repository.ts:214
packages/action/src/repository.ts:218
packages/action/src/repository.ts:226
packages/action/src/repository.ts:235
packages/action/src/repository.ts:272
packages/action/src/repository.ts:303
packages/action/src/repository.ts:319
packages/action/src/repository.ts:324
packages/action/src/repository.ts:335
packages/core/src/github/adapter.ts:25
packages/core/src/github/adapter.ts:27
packages/core/src/github/adapter.ts:52
packages/core/src/github/adapter.ts:57
packages/core/src/github/adapter.ts:65
packages/core/src/github/adapter.ts:97
packages/core/src/github/adapter.ts:104
packages/core/src/github/adapter.ts:112
packages/core/src/github/adapter.ts:124
packages/core/src/github/adapter.ts:129
packages/core/src/github/adapter.ts:132
packages/core/src/github/adapter.ts:135
packages/core/src/github/adapter.ts:138
packages/core/src/github/adapter.ts:143
packages/core/src/github/adapter.ts:155
packages/core/src/github/adapter.ts:160
packages/core/src/github/adapter.ts:185
packages/core/src/github/adapter.ts:200
packages/core/src/github/adapter.ts:209
packages/core/src/github/adapter.ts:218
packages/core/src/github/adapter.ts:236
packages/core/src/github/adapter.ts:265
packages/core/src/github/adapter.ts:291
packages/core/src/github/adapter.ts:293
packages/core/src/github/adapter.ts:297
packages/core/src/github/adapter.ts:318
packages/core/src/github/adapter.ts:320
packages/core/src/heal.ts:167
packages/core/src/heal.ts:227
packages/core/src/heal.ts:1221
packages/core/src/heal.ts:1224
packages/core/src/heal.ts:1242
packages/core/src/heal.ts:1247
packages/core/src/orchestrate.ts:225
packages/core/src/orchestrate.ts:228
packages/core/src/orchestrate.ts:235
packages/core/src/orchestrate.ts:238
packages/core/src/orchestrate.ts:241
packages/core/src/orchestrate.ts:244
packages/core/src/orchestrate.ts:247
packages/core/src/orchestrate.ts:369
packages/core/src/orchestrate.ts:372
packages/core/src/orchestrate.ts:395
packages/core/src/orchestrate.ts:511
packages/core/src/orchestrate.ts:515
packages/core/src/orchestrate.ts:546
packages/core/src/orchestrate.ts:552
packages/core/src/orchestrate.ts:566
packages/core/src/orchestrate.ts:575
packages/core/src/source-window.ts:46
`.trim().split('\n');

function currentGuards(): string[] {
  return SOURCES.flatMap((path) => readFileSync(new URL(path, ROOT), 'utf8')
    .split('\n')
    .flatMap((line, index) => /throw new |process\.exit|core\.setFailed/u.test(line)
      ? [`${path}:${index + 1}`]
      : []));
}

describe('Phase 3a guard inventory', () => {
  it('keeps the interim 74-guard checklist exact until the Phase 3c AST gate lands', () => {
    expect(currentGuards().sort()).toEqual([...EXPECTED].sort());
  });
});
