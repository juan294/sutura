import { describe, expect, it } from 'vitest';

import {
  capturedDogfoodReplayBundle,
  decodedRecordedBody,
} from '../__fixtures__/captured/live-dogfood-replay.test-helper.js';
import { DEFAULT_MODELS } from '../config.js';
import { SUPER_REPAIR_PROVIDER_CONTRACT_VERSION } from '../llm/provider-contract-canary.js';
import { DEFAULT_ROUTING_PROFILE_ID } from '../llm/router.js';
import { REPLAY_BUNDLE_SCHEMA_VERSION, type ReplayBundle } from './bundle.js';
import { createAuditPathReplayBundleForTest } from './complete-audit-bundle.test-helper.js';
import { createCompleteReplayBundleForTest } from './complete-bundle.test-helper.js';
import { ReplayMismatchError } from './replay-fetch.js';
import { replayBundle } from './replay-orchestrate.js';

const SHA = 'a'.repeat(40);

function baseBundle(): ReplayBundle {
  return {
    schemaVersion: REPLAY_BUNDLE_SCHEMA_VERSION,
    runId: '77',
    repo: 'acme/widget',
    actionSha: SHA,
    capturedAt: '2026-08-30T10:00:00.000Z',
    github: [],
    repository: [],
    executor: [],
    http: [],
    configuration: {
      triageN: 1,
      raceK: 1,
      models: DEFAULT_MODELS,
      routingProfileId: DEFAULT_ROUTING_PROFILE_ID,
      maxOps: 10,
    },
    completeness: {
      complete: false,
      overflowedBoundaries: [],
      pendingBoundaries: ['repository'],
    },
  };
}

function recordedReport(bundle: ReplayBundle): string {
  const report = bundle.github.findLast(({ method }) => method === 'updateCommitComment')?.args[1];
  if (typeof report !== 'string') throw new Error('Captured replay bundle lacks its final report');
  return report;
}

function recordedProviderRequestIncludes(bundle: ReplayBundle, expected: string): boolean {
  return bundle.http.some(({ boundary, request }) =>
    boundary === 'nebius' && decodedRecordedBody(request.body).includes(expected)
  );
}

function capturedSuperRequestBodies(bundle: ReplayBundle): Array<Record<string, unknown>> {
  return bundle.http.flatMap(({ boundary, request }) => {
    if (boundary !== 'nebius') return [];
    const body = JSON.parse(decodedRecordedBody(request.body)) as Record<string, unknown>;
    return body.model === DEFAULT_MODELS.super ? [body] : [];
  });
}

async function captureReplayMismatch(bundle: ReplayBundle): Promise<ReplayMismatchError> {
  try {
    await replayBundle(bundle);
  } catch (error) {
    if (error instanceof ReplayMismatchError) return error;
    throw error;
  }
  throw new Error('Current replay unexpectedly accepted a historical runtime contract');
}

// The sandbox Git baseline gained `add --force` (#152) and removed the
// unsafe blanket lifecycle rebuild. Normalize those known historical command
// differences only in a private copy so these tests still reach command-provenance drift.
// Recorded bundles remain immutable; current initialization has separate tests.
function withCurrentGitBaseline(recorded: ReplayBundle): ReplayBundle {
  const bundle = structuredClone(recorded);
  const baseline = bundle.executor.find(({ sequence }) => sequence === 5);
  expect(baseline?.args[1]).toEqual(expect.stringContaining('add --pathspec-from-file='));
  const command = String(baseline!.args[1]);
  expect(command).toContain(' && if [ -f pnpm-lock.yaml ]; then corepack pnpm rebuild;');
  expect(command).toMatch(/; else true; fi'$/u);
  baseline!.args[1] = command
    .replace('add --pathspec-from-file=', 'add --force --pathspec-from-file=')
    .replace(/ && if \[ -f pnpm-lock\.yaml \]; then corepack pnpm rebuild;.*; else true; fi'$/u, "'");
  return bundle;
}

describe('replayBundle', () => {
  it.each(['assist', 'shadow'] as const)('replays enabled %s classification and recovery through full orchestration', async mode => {
    for (const role of ['classification', 'recovery'] as const) {
      const bundle = await createAuditPathReplayBundleForTest(false, undefined, undefined, role === 'classification' ? mode : undefined, role === 'recovery' ? mode : undefined);
      expect(bundle.configuration.semantic?.modes[role]).toBe(mode);
      const result = await replayBundle(bundle);
      expect(result.caseFile.outcome).toBe('fixed');
      expect(result.caseFile.semanticDecisions?.records[0]).toMatchObject({ role, mode, reason: mode === 'shadow' ? 'shadow-captured' : role === 'classification' ? 'classification-applied' : 'recovery-none-supported' });
      expect(result.caseFile.semanticDecisions?.budget).toEqual(bundle.configuration.semanticBudget);
      expect(result.caseFile.audit?.approved).toBe(true);
    }
  }, 30_000);

  it.each(['assist', 'shadow'] as const)('replays enabled %s grounding with original provenance and selected prompt sources', async mode => {
    const bundle = await createAuditPathReplayBundleForTest(false, undefined, mode);
    expect(bundle.configuration.semantic?.modes.grounding).toBe(mode);
    const result = await replayBundle(bundle);
    expect(result.caseFile.outcome).toBe('fixed');
    expect(result.caseFile.diagnosis.grounding?.selection?.originals).toHaveLength(2);
    expect(result.caseFile.diagnosis.grounding?.citations).toHaveLength(mode === 'assist' ? 1 : 2);
    expect(result.caseFile.semanticDecisions?.records[0]).toMatchObject({ role: 'grounding', mode, latencyMs: expect.any(Number) });
    expect(result.caseFile.semanticDecisions?.records[0]?.latencyMs).toBeGreaterThanOrEqual(20);
    expect(result.caseFile.semanticDecisions?.budget).toEqual(bundle.configuration.semanticBudget);
  }, 30_000);
  it.each(['assist', 'shadow'] as const)('replays enabled %s ranking and its delayed timing through full orchestration', async mode => {
    const bundle = await createAuditPathReplayBundleForTest(false, mode);
    expect(bundle.configuration.semantic?.modes.ranking).toBe(mode);
    expect(bundle.http.filter(exchange => exchange.boundary === 'typesafe')).toHaveLength(mode === 'assist' ? 2 : 1);
    const result = await replayBundle(bundle);
    expect(result.caseFile.outcome).toBe('fixed');
    expect(result.caseFile.search?.[2]?.parentNodeId).toBe(mode === 'assist' ? 'search-002' : 'search-001');
    expect(result.caseFile.semanticDecisions?.records[0]).toMatchObject({ role: 'ranking', mode, latencyMs: expect.any(Number) });
    expect(result.caseFile.semanticDecisions?.records[0]?.latencyMs).toBeGreaterThanOrEqual(20);
    expect(result.caseFile.semanticDecisions?.budget).toEqual(bundle.configuration.semanticBudget);
  }, 30_000);
  it('rejects a partial bundle before constructing replay dependencies', async () => {
    await expect(replayBundle(baseBundle())).rejects.toThrow(
      'bundle is partial; complete provider, repository, and sandbox recordings are required',
    );
  });

  it('replays explicit all-off semantic identity without live fallback and verifies final semantic counters', async () => {
    const bundle = await createCompleteReplayBundleForTest({ schemaVersion: 'sutura-semantic-config-v1', model: 'jev-1.14.0', policyVersion: 'semantic-v1', maxUsd: 0, modes: { ranking: 'off', grounding: 'off', classification: 'off', recovery: 'off' } });
    expect(bundle.http.some(({ boundary }) => boundary === 'typesafe')).toBe(false);
    const result = await replayBundle(bundle);
    expect(result.caseFile.outcome).toBe(bundle.outcome);
    expect(result.caseFile.semanticDecisions?.budget).toEqual(bundle.configuration.semanticBudget);
    bundle.configuration.semanticBudget!.attempts = 1;
    await expect(replayBundle(bundle)).rejects.toThrow(/semanticBudget.*differs/u);
  }, 30_000);

  it('replays every recorded boundary through the real offline orchestration path', async () => {
    const bundle = await createCompleteReplayBundleForTest();

    const result = await replayBundle(bundle);

    expect(bundle.completeness.complete).toBe(true);
    expect(new Set(bundle.http.map(({ boundary }) => boundary)))
      .toEqual(new Set(['nebius', 'tavily', 'contree']));
    expect(result.caseFile.outcome).toBe('flaky-no-patch');
    expect(result.caseFile.outcome).toBe(bundle.outcome);
    expect(result.caseFile.diagnosis.grounding).toMatchObject({ skipped: false });
    expect(result.mutations.map(({ method }) => method)).toEqual([
      'createRef',
      'createCheckRun',
      'createCommitComment',
      'deleteRef',
      'updateCommitComment',
      'updateCheckRun',
    ]);
  });

  it.each([false, true])('retains exact synthetic outbound audit bytes with legacy presentation=%s', async (legacy) => {
    const bundle = await createAuditPathReplayBundleForTest(legacy);
    expect(bundle.configuration.auditPresentation).toBe(legacy ? undefined : 'typed-status-v1');
    expect(recordedReport(bundle)).toContain(`| typesafe-audit | **${legacy ? 'PASS' : 'APPROVED'}** |`);
    const result = await replayBundle(bundle);
    expect(result.caseFile.audit?.checks).toContainEqual(expect.objectContaining({ name: 'typesafe-audit', passed: true, metadata: expect.objectContaining({ status: 'approved' }) }));
    expect(result.caseFile.outcome).toBe('fixed');
  }, 30_000);

  it('replays a bundle recorded with an openai second-opinion and a typesafe calibrated-audit exchange', async () => {
    const bundle = await createAuditPathReplayBundleForTest();

    expect(new Set(bundle.http.map(({ boundary }) => boundary)))
      .toEqual(new Set(['contree', 'nebius', 'openai', 'typesafe']));
    expect(bundle.outcome).toBe('fixed');

    const result = await replayBundle(bundle);

    expect(result.caseFile.outcome).toBe('fixed');
    expect(result.caseFile.audit?.checks).toContainEqual(expect.objectContaining({
      name: 'second-opinion', passed: true,
    }));
    expect(result.caseFile.audit?.checks).toContainEqual(expect.objectContaining({
      name: 'typesafe-audit', passed: true,
    }));
  }, 30_000);

  it('replays a bundle without an openai or typesafe exchange (the clients are not constructed)', async () => {
    const bundle = await createCompleteReplayBundleForTest();

    expect(bundle.http.some(({ boundary }) => boundary === 'openai' || boundary === 'typesafe'))
      .toBe(false);

    await expect(replayBundle(bundle)).resolves.toMatchObject({
      caseFile: { outcome: bundle.outcome },
    });
  }, 30_000);

  it('reuses the runtime selected during live execution', async () => {
    const bundle = await createCompleteReplayBundleForTest();
    delete bundle.configuration.runtimeId;
    bundle.runtimeDetection = {
      runtime: 'python', evidenceSource: 'bounded-scan',
      evidencePaths: ['services/worker/tests/test_widget.py'], visitedEntries: 12,
    };

    await expect(replayBundle(bundle)).rejects.toBeInstanceOf(ReplayMismatchError);
  });

  it('preserves live run 33321172589 while current replay fails closed on contract drift', async () => {
    const bundle = withCurrentGitBaseline(await capturedDogfoodReplayBundle());
    const report = recordedReport(bundle);
    const originalBundle = JSON.stringify(bundle);

    expect(bundle).toMatchObject({
      runId: '33321106629',
      outcome: 'gave-up',
    });
    expect(report.match(/^\| search-/gmu)).toHaveLength(7);
    expect(recordedProviderRequestIncludes(bundle, 'invalid: Repair proposal must be valid JSON'))
      .toBe(true);
    expect(SUPER_REPAIR_PROVIDER_CONTRACT_VERSION).toBe('sutura-super-repair-v6');
    expect(capturedSuperRequestBodies(bundle).map(({ chat_template_kwargs }) => chat_template_kwargs))
      .toEqual(Array.from({ length: 7 }, () => ({ enable_thinking: false })));

    const error = await captureReplayMismatch(bundle);
    // Native Run-group provenance now diverges before the old taxonomy prompt.
    // Child stdout no longer overrides the observed pnpm run test command.
    expect(error.sequence).toBe(6);
    expect(error.path).toBe('$[1]');
    expect(error.expected).toContain('pnpm -r test');
    expect(error.actual).toContain('pnpm run test');
    expect(JSON.stringify(bundle)).toBe(originalBundle);
  });

  it('preserves live run 33323856253 while current replay fails closed on contract drift', async () => {
    const bundle = withCurrentGitBaseline(await capturedDogfoodReplayBundle('33323765566'));
    const report = recordedReport(bundle);
    const originalBundle = JSON.stringify(bundle);

    expect(bundle).toMatchObject({
      runId: '33323765566',
      outcome: 'gave-up',
    });
    expect(report).toContain('Failing command: <code>pnpm -r test</code>');
    expect(recordedProviderRequestIncludes(
      bundle,
      'sandbox: Automatic trusted test did not produce valid evidence',
    )).toBe(true);
    expect(SUPER_REPAIR_PROVIDER_CONTRACT_VERSION).toBe('sutura-super-repair-v6');
    expect(capturedSuperRequestBodies(bundle).map(({ chat_template_kwargs }) => chat_template_kwargs))
      .toEqual(Array.from({ length: 6 }, () => ({ enable_thinking: false })));

    // Current command provenance diverges before taxonomy/triage: the native
    // execution header is authoritative over prompt-like child stdout.
    const error = await captureReplayMismatch(bundle);
    expect(error.sequence).toBe(6);
    expect(error.path).toBe('$[1]');
    expect(error.expected).toContain('pnpm -r test');
    expect(error.actual).toContain('pnpm run test');
    expect(JSON.stringify(bundle)).toBe(originalBundle);
  });

  it.each(['github', 'repository', 'executor', 'nebius', 'tavily'] as const)(
    'fails closed when a recorded %s tail is not consumed',
    async (boundary) => {
      const bundle = await createCompleteReplayBundleForTest();
      if (boundary === 'github' || boundary === 'repository') {
        const sequence = Math.max(
          ...bundle.github.map((call) => call.sequence),
          ...bundle.repository.map((call) => call.sequence),
        ) + 1;
        const calls = bundle[boundary];
        calls.push({ ...structuredClone(calls.at(-1)!), sequence } as never);
      } else if (boundary === 'executor') {
        const sequence = Math.max(...bundle.executor.map((call) => call.sequence)) + 1;
        bundle.executor.push({ ...structuredClone(bundle.executor.at(-1)!), sequence });
      } else {
        const sequence = Math.max(...bundle.http.map((exchange) => exchange.sequence)) + 1;
        const exchange = bundle.http.findLast((item) => item.boundary === boundary)!;
        bundle.http.push({ ...structuredClone(exchange), sequence });
      }

      await expect(replayBundle(bundle)).rejects.toBeInstanceOf(ReplayMismatchError);
    },
  );

  it('replays an executor stream whose concurrent calls were recorded in another order', async () => {
    const bundle = await createCompleteReplayBundleForTest();
    const first = bundle.executor[0]!;
    const second = bundle.executor[1]!;
    [first.sequence, second.sequence] = [second.sequence, first.sequence];

    // Swapping two serial calls is an order the replay cannot follow, so the
    // first result waits out the deadline before it is released.
    await expect(replayBundle(bundle, { executorOrdering: { deadlineMs: 50 } })).resolves.toMatchObject({
      caseFile: { outcome: bundle.outcome },
    });
  });

  it('fails closed when shared port boundaries are reordered', async () => {
    const bundle = await createCompleteReplayBundleForTest();
    const github = bundle.github[0]!;
    const repository = bundle.repository[0]!;
    [github.sequence, repository.sequence] = [repository.sequence, github.sequence];

    await expect(replayBundle(bundle)).rejects.toBeInstanceOf(ReplayMismatchError);
  });

  it('fails closed when shared provider HTTP boundaries are reordered', async () => {
    const bundle = await createCompleteReplayBundleForTest();
    const nebius = bundle.http.find((exchange) => exchange.boundary === 'nebius')!;
    const tavily = bundle.http.find((exchange) => exchange.boundary === 'tavily')!;
    [nebius.sequence, tavily.sequence] = [tavily.sequence, nebius.sequence];

    await expect(replayBundle(bundle)).rejects.toBeInstanceOf(ReplayMismatchError);
  });

  it('does not require diagnostic ConTree HTTP records to be consumed', async () => {
    const bundle = await createCompleteReplayBundleForTest();
    const sequence = Math.max(...bundle.http.map((exchange) => exchange.sequence)) + 1;
    const contree = bundle.http.findLast((exchange) => exchange.boundary === 'contree')!;
    bundle.http.push({ ...structuredClone(contree), sequence });

    await expect(replayBundle(bundle)).resolves.toMatchObject({
      caseFile: { outcome: bundle.outcome },
    });
  });
});

it('retains exact recorded operation identities and deadlines', async () => {
  for (const key of ['operationId', 'timeoutSec'] as const) {
    const bundle = await createCompleteReplayBundleForTest();
    const operation = bundle.executor.find(({ method, args }) => method === 'run' && typeof args[2] === 'object' && args[2] !== null && 'operationId' in args[2])!;
    expect(operation).toBeDefined();
    const options = operation.args[2] as Record<string, unknown>;
    options[key] = key === 'operationId' ? 'substituted-operation' : 999;
    await expect(replayBundle(bundle)).rejects.toBeInstanceOf(ReplayMismatchError);
  }
});
