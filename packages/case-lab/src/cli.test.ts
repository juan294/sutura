import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCaseLabCli, USAGE } from './cli.js';
import { validateCaseLabResult } from './result.js';

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { write: (text: string) => { out.push(text); }, writeError: (text: string) => { err.push(text); } } };
}

const EMPTY_REPLAY_DIR = mkdtempSync(join(tmpdir(), 'case-lab-cli-no-replay-'));
const NOW = () => new Date('2026-09-04T12:00:00.000Z');

describe('case-lab CLI', () => {
  it('writes the five-case catalog and refuses to overwrite it', { timeout: 60_000 }, async () => {
    const outDir = join(mkdtempSync(join(tmpdir(), 'case-lab-cli-')), 'catalog');
    const first = io();
    const code = await runCaseLabCli(['catalog', '--out', outDir], { io: first.io, catalog: { replayDir: EMPTY_REPLAY_DIR, now: NOW } });
    expect(code).toBe(0);
    expect(readdirSync(outDir).sort()).toEqual([
      'flaky-failure.json', 'greenwash-trap.json', 'javascript-repair.json', 'python-repair.json', 'upstream-incident.json',
    ]);
    for (const file of readdirSync(outDir)) {
      validateCaseLabResult(JSON.parse(readFileSync(join(outDir, file), 'utf8')));
    }
    expect(first.out.join('')).toContain('greenwash-trap\trecorded\trefused\n');
    const second = io();
    expect(await runCaseLabCli(['catalog', '--out', outDir], { io: second.io, catalog: { replayDir: EMPTY_REPLAY_DIR, now: NOW } })).toBe(1);
    expect(second.err.join('')).toContain('EEXIST');
  });

  it('prints or writes one deterministic result', { timeout: 60_000 }, async () => {
    const printed = io();
    expect(await runCaseLabCli(['replay', 'flaky-failure'], { io: printed.io, catalog: { replayDir: EMPTY_REPLAY_DIR, now: NOW } })).toBe(0);
    const result = validateCaseLabResult(JSON.parse(printed.out.join('')));
    expect(result.caseId).toBe('flaky-failure');
    const file = join(mkdtempSync(join(tmpdir(), 'case-lab-cli-')), 'result.json');
    expect(await runCaseLabCli(['replay', 'flaky-failure', '--out', file], { catalog: { replayDir: EMPTY_REPLAY_DIR, now: NOW } })).toBe(0);
    expect(existsSync(file)).toBe(true);
  });

  it('reports usage and argument errors with exit code 2', async () => {
    const unknown = io();
    expect(await runCaseLabCli(['nope'], { io: unknown.io })).toBe(2);
    expect(unknown.err.join('')).toBe(`${USAGE}\n`);
    const missing = io();
    expect(await runCaseLabCli(['catalog'], { io: missing.io })).toBe(2);
    expect(missing.err.join('')).toBe('--out is required\n');
    const badCase = io();
    expect(await runCaseLabCli(['replay', 'nope'], { io: badCase.io, catalog: { replayDir: EMPTY_REPLAY_DIR } })).toBe(2);
    expect(badCase.err.join('')).toContain('caseId must be one of');
    const noCase = io();
    expect(await runCaseLabCli(['replay', '--out', 'x'], { io: noCase.io })).toBe(2);
    expect(noCase.err.join('')).toContain('replay requires a case id');
  });
});
