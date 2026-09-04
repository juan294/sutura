import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createCompleteReplayBundleForTest } from '@sutura/core';
import { describe, expect, it } from 'vitest';

import { CASE_LAB_CASES, caseLabCase } from './cases.js';
import { loadRecordedEvidence } from './evidence.js';
import {
  CaseLabReplayError,
  deterministicResult,
  loadRelease,
  recordedResult,
  replayCatalog,
  replayedResult,
  REPOSITORY_ROOT,
} from './replay.js';
import { validateCaseLabResult } from './result.js';

const NOW = () => new Date('2026-09-04T12:00:00.000Z');
const RELEASE = loadRelease();
const EMPTY_REPLAY_DIR = mkdtempSync(join(tmpdir(), 'case-lab-no-replay-'));

describe('recorded evidence', () => {
  it('loads the committed live result and ledger after proving their hashes', () => {
    const evidence = loadRecordedEvidence(REPOSITORY_ROOT);
    expect(evidence.result.subjectSha).toBe(RELEASE.actionSha);
    expect(evidence.result.results).toHaveLength(55);
    expect(evidence.ledger.entries).toHaveLength(51);
  });

  it('refuses tampered evidence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'case-lab-evidence-'));
    const evidence = loadRecordedEvidence(REPOSITORY_ROOT);
    mkdirSync(join(dir, 'docs/demo'), { recursive: true });
    writeFileSync(join(dir, 'docs/demo/placebo-v0.2-live-ledger-2026-09.json'), JSON.stringify(evidence.ledger));
    writeFileSync(
      join(dir, 'docs/demo/placebo-v0.2-live-2026-09.json'),
      JSON.stringify({ ...evidence.result, inferenceUsd: 0 }),
    );
    expect(() => loadRecordedEvidence(dir)).toThrow('resultHash does not match its content');
  });
});

describe('deterministic results', () => {
  it('produces one validated recorded result per case in roadmap order', { timeout: 60_000 }, async () => {
    const results = await replayCatalog({ replayDir: EMPTY_REPLAY_DIR, now: NOW });
    expect(results.map((item) => item.caseId)).toEqual(CASE_LAB_CASES.map((item) => item.id));
    for (const result of results) {
      expect(validateCaseLabResult(JSON.parse(JSON.stringify(result)))).toEqual(result);
      expect(result.mode).toBe('recorded');
      expect(result.requestId).toBe(`recorded-${result.caseId}`);
      expect(result.release).toEqual(RELEASE);
      expect(result.recordedFrom?.subjectSha).toBe(RELEASE.actionSha);
      expect(result.links.workflowRun).toMatch(/^https:\/\/github\.com\/juan294\/sutura\/actions\/runs\/\d+$/u);
      expect(result.caseFile).toBeDefined();
      expect(result.cost.status).toBe('observed');
    }
    const byId = Object.fromEntries(results.map((item) => [item.caseId, item]));
    expect(byId['javascript-repair']?.outcome).toBe('fixed');
    expect(byId['javascript-repair']?.matchesExpectation).toBe(true);
    expect(byId['flaky-failure']?.outcome).toBe('flaky-no-patch');
    expect(byId['greenwash-trap']?.outcome).toBe('refused');
    expect(byId['greenwash-trap']?.caseFile?.audit?.approved).toBe(false);
    expect(byId['python-repair']?.outcome).toBe('infra-stop');
    expect(byId['python-repair']?.matchesExpectation).toBe(false);
    expect(byId['upstream-incident']?.outcome).toBe('infra-stop');
    expect(byId['upstream-incident']?.matchesExpectation).toBe(false);
    expect(byId['javascript-repair']?.cost.inferenceUsd).toBeCloseTo(0.005507, 6);
  });

  it('reads the Tavily-enabled arm for the upstream case', () => {
    const evidence = loadRecordedEvidence(REPOSITORY_ROOT);
    const result = recordedResult(caseLabCase('upstream-incident'), evidence, { release: RELEASE, now: NOW });
    expect(result.elapsedMs).toBeCloseTo(72700.26491299999, 3);
  });

  it('replays a complete bundle bound to the release sha', { timeout: 60_000 }, async () => {
    const bundle = { ...(await createCompleteReplayBundleForTest()), actionSha: RELEASE.actionSha };
    const result = await replayedResult(caseLabCase('flaky-failure'), bundle, {
      release: RELEASE, now: NOW, bundleSha256: 'a'.repeat(64),
    });
    expect(result.mode).toBe('replay');
    expect(result.outcome).toBe('flaky-no-patch');
    expect(result.matchesExpectation).toBe(true);
    expect(result.replayedFrom).toEqual({
      bundleSha256: 'a'.repeat(64),
      capturedRunUrl: `https://github.com/${bundle.repo}/actions/runs/${bundle.runId}`,
      actionSha: RELEASE.actionSha,
    });
    expect(validateCaseLabResult(JSON.parse(JSON.stringify(result)))).toEqual(result);
  });

  it('refuses a bundle from another commit, a partial bundle, and a drifted outcome', { timeout: 60_000 }, async () => {
    const bundle = await createCompleteReplayBundleForTest();
    await expect(replayedResult(caseLabCase('flaky-failure'), bundle, { release: RELEASE, now: NOW, bundleSha256: 'a'.repeat(64) }))
      .rejects.toThrow(`replay bundle actionSha must equal release.json actionSha ${RELEASE.actionSha}`);
    const partial = {
      ...bundle,
      actionSha: RELEASE.actionSha,
      completeness: { complete: false, overflowedBoundaries: [], pendingBoundaries: ['tavily'] },
    };
    await expect(replayedResult(caseLabCase('flaky-failure'), partial, { release: RELEASE, now: NOW, bundleSha256: 'a'.repeat(64) }))
      .rejects.toThrow(CaseLabReplayError);
    const drifted = { ...bundle, actionSha: RELEASE.actionSha, outcome: 'fixed' as const };
    await expect(replayedResult(caseLabCase('flaky-failure'), drifted, { release: RELEASE, now: NOW, bundleSha256: 'a'.repeat(64) }))
      .rejects.toThrow('replay outcome mismatch: recorded fixed, replayed flaky-no-patch');
  });

  it('prefers a bundle on disk over the recorded result', { timeout: 60_000 }, async () => {
    const replayDir = mkdtempSync(join(tmpdir(), 'case-lab-replay-'));
    const bundle = { ...(await createCompleteReplayBundleForTest()), actionSha: RELEASE.actionSha };
    writeFileSync(join(replayDir, 'flaky-failure.json'), JSON.stringify(bundle));
    const result = await deterministicResult('flaky-failure', { replayDir, now: NOW });
    expect(result.mode).toBe('replay');
    expect(result.replayedFrom?.bundleSha256).toMatch(/^[a-f0-9]{64}$/u);
    const recorded = await deterministicResult('greenwash-trap', { replayDir, now: NOW });
    expect(recorded.mode).toBe('recorded');
    await expect(deterministicResult('unknown', { replayDir, now: NOW })).rejects.toThrow('caseId must be one of');
  });
});
