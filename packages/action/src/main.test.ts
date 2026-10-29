import { readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { RepairBranchRunError, ReplayRecorder, loadConfig, semanticConfig, DecisionSession, type OrchestrationContext } from '@sutura/core';

import { GitHubAdapter, type GitHubApi } from './github.js';
import { withFailureSafeCheck } from './failure-safe.js';
import { runAction } from './main.js';

/** No live GitHub REST calls in this file: touching the octokit client throws synchronously. */
function unreachableOctokit(): unknown {
  return new Proxy({}, { get: () => { throw new Error('octokit must not be touched'); } });
}

vi.mock('@actions/github', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@actions/github')>();
  return { ...actual, getOctokit: () => unreachableOctokit() };
});

const { mockOrchestrate, mockTypeSafeClient, mockReplayRecorderCalls, mockSetOutput, mockWarning, shadowFsFailure } = vi.hoisted(() => ({
  mockOrchestrate: vi.fn<(...args: unknown[]) => never>(() => { throw new Error('stop before repair orchestration'); }),
  mockTypeSafeClient: vi.fn().mockImplementation(function (config: { apiKey: string }) { return { __typesafeApiKey: config.apiKey }; }),
  mockReplayRecorderCalls: [] as unknown[][],
  mockSetOutput: vi.fn(),
  mockWarning: vi.fn(),
  shadowFsFailure: { stage: undefined as 'mkdtemp' | 'open' | undefined, createdDirectories: [] as string[] },
}));

vi.mock('@actions/core', async (importOriginal) => ({ ...await importOriginal<typeof import('@actions/core')>(), setOutput: mockSetOutput, warning: mockWarning }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    mkdtemp: async (...args: Parameters<typeof actual.mkdtemp>) => {
      const shadow = String(args[0]).includes('sutura-semantic-');
      if (shadow && shadowFsFailure.stage === 'mkdtemp') throw new Error('private-filesystem-detail-token=secret-test');
      const result = await actual.mkdtemp(...args);
      if (shadow && shadowFsFailure.stage === 'open') shadowFsFailure.createdDirectories.push(String(result));
      return result;
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      if (shadowFsFailure.stage === 'open' && String(args[0]).endsWith('/semantic-shadow.jsonl')) throw new Error('private-filesystem-detail-token=secret-test');
      return actual.open(...args);
    },
  };
});

vi.mock('@sutura/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sutura/core')>();
  class SpyReplayRecorder extends actual.ReplayRecorder {
    constructor(...args: ConstructorParameters<typeof actual.ReplayRecorder>) {
      super(...args);
      mockReplayRecorderCalls.push(args);
    }
  }
  return {
    ...actual,
    orchestrate: (...args: unknown[]) => mockOrchestrate(...args),
    TypeSafeClient: mockTypeSafeClient,
    ReplayRecorder: SpyReplayRecorder,
  };
});

const SHA = 'a'.repeat(40);
const REPLAY_CONFIG = {
  triageN: 1, raceK: 1,
  models: { nano: 'nano', super: 'super', ultra: 'ultra' },
  routingProfileId: 'test', maxOps: 1,
} as const;

describe('action check failure safety', () => {
  it('completes the same created check when orchestration throws', async () => {
    const checks: Array<{ id: number; headSha: string; externalId: string; name: string; status: string; conclusion: string | null }> = [];
    const updates: Array<Record<string, unknown>> = [];
    const commentUpdates: Array<{ commentId: number; body: string }> = [];
    const api = {
      getWorkflowRun: async () => ({ id: 77, headSha: SHA, repository: 'owner/repo', event: 'pull_request', conclusion: 'failure', pullRequests: [{ number: 9 }] }),
      listCheckRunsForRef: async () => checks.map((check) => ({ ...check })),
      listIssueComments: async () => [],
      createRef: async () => undefined,
      deleteRef: async () => undefined,
      createCheckRun: async (input: { headSha: string; externalId: string; name: string }) => {
        checks.push({ id: 91, headSha: input.headSha, externalId: input.externalId, name: input.name, status: 'in_progress', conclusion: null });
        return { id: 91 };
      },
      createIssueComment: async () => ({ id: 44 }),
      updateIssueComment: async (commentId: number, body: string) => { commentUpdates.push({ commentId, body }); },
      updateCheckRun: async (input: Record<string, unknown>) => { updates.push(input); },
    } as unknown as GitHubApi;
    const adapter = new GitHubAdapter(api, { owner: 'owner', repo: 'repo', runId: '77' });
    let claimedCheckRunId: number | undefined;

    await expect(withFailureSafeCheck(
      adapter,
      async () => {
        claimedCheckRunId = (await adapter.claimAttempt(9, '<!-- marker -->'))?.checkRunId;
        throw new Error('artifact serialization failed');
      },
    )).rejects.toThrow('artifact serialization failed');

    expect(claimedCheckRunId).toBe(91);
    expect(updates).toEqual([expect.objectContaining({
      checkRunId: claimedCheckRunId,
      status: 'completed',
      conclusion: 'action_required',
    })]);
    expect(commentUpdates).toEqual([{
      commentId: 44,
      body: expect.stringContaining('Sutura stopped unexpectedly'),
    }]);
  });

  it('preserves the orchestration failure when terminal check completion also fails', async () => {
    const warnings: string[] = [];
    await expect(withFailureSafeCheck(
      { completeUnexpectedFailure: async () => { throw new Error('checks API unavailable'); } },
      async () => { throw new Error('provider failed'); },
      (message) => warnings.push(message),
    )).rejects.toThrow('provider failed');
    expect(warnings).toEqual([
      'Sutura could not complete its GitHub check after an unexpected failure.',
    ]);
  });

  it('leaves checks and evidence untouched when a run on a repair branch is refused', async () => {
    const completeUnexpectedFailure = vi.fn(async () => undefined);
    const uploadReplayBundle = vi.fn(async () => ({ url: 'https://example.test/replay' }));

    await expect(withFailureSafeCheck(
      { completeUnexpectedFailure, uploadReplayBundle },
      async () => { throw new RepairBranchRunError('77', 'sutura/fix-76'); },
      () => undefined,
      new ReplayRecorder('77', 'owner/repo', SHA, REPLAY_CONFIG),
      { actionRunId: '88', targetRunId: '77', repository: 'owner/repo', actionSha: SHA },
    )).rejects.toBeInstanceOf(RepairBranchRunError);

    expect(completeUnexpectedFailure).not.toHaveBeenCalled();
    expect(uploadReplayBundle).not.toHaveBeenCalled();
  });

  it('uploads an infra-stop replay bundle when orchestration crashes', async () => {
    const uploads: Array<{ name: string; json: string }> = [];
    const recorder = new ReplayRecorder('77', 'owner/repo', SHA, REPLAY_CONFIG);

    await expect(withFailureSafeCheck(
      {
        completeUnexpectedFailure: async () => undefined,
        uploadReplayBundle: async (name, json) => {
          uploads.push({ name, json });
          return { url: 'https://example.test/replay' };
        },
      },
      async () => { throw new Error('provider failed'); },
      () => undefined,
      recorder,
      {
        actionRunId: '88', targetRunId: '77', repository: 'owner/repo', actionSha: SHA,
      },
    )).rejects.toThrow('provider failed');

    expect(uploads).toHaveLength(2);
    expect(uploads[0]?.name).toBe('sutura-terminal-failure-77.json');
    expect(JSON.parse(uploads[0]?.json ?? '{}')).toMatchObject({
      schemaVersion: 'sutura-terminal-failure-v2',
      outcome: 'infra-stop',
      costStatus: 'unavailable',
      fixtureIdentity: { repository: 'owner/repo', targetRunId: '77' },
    });
    expect(uploads[1]?.name).toBe('sutura-replay-77.json');
    expect(JSON.parse(uploads[1]?.json ?? '{}')).toMatchObject({
      schemaVersion: 'sutura-replay-v1',
      outcome: 'infra-stop',
    });
  });
});

describe('runAction input guards', () => {
  const action = {
    githubToken: 'github-test',
    runId: '77',
    triageN: 1,
    requireFixed: false,
    captureReplay: false,
    environment: {},
  } as const;

  it('reports missing ConTree configuration through the side-effect-free seam', async () => {
    const setFailed = vi.fn();

    await runAction({
      readAction: () => action,
      loadConfiguration: () => loadConfig({ NEBIUS_API_KEY: 'nebius-test' }),
      repository: () => ({ owner: 'acme', repo: 'widget' }),
      environment: { GITHUB_RUN_ID: '88' },
      setFailed,
    });

    expect(setFailed).toHaveBeenCalledWith(
      'ConTree token and project are required by the GitHub Action',
    );
  });

  it('reports a malformed action run id before creating an Octokit client', async () => {
    const setFailed = vi.fn();

    await runAction({
      readAction: () => action,
      loadConfiguration: () => loadConfig({
        NEBIUS_API_KEY: 'nebius-test',
        CONTREE_TOKEN: 'contree-test',
        CONTREE_PROJECT: 'project-test',
      }),
      repository: () => ({ owner: 'acme', repo: 'widget' }),
      environment: { GITHUB_RUN_ID: 'not-an-id' },
      setFailed,
    });

    expect(setFailed).toHaveBeenCalledWith('GITHUB_RUN_ID must be a positive decimal id');
  });

  it('fails closed when replay capture cannot identify the executed Action commit', async () => {
    const setFailed = vi.fn();

    await runAction({
      readAction: () => ({ ...action, captureReplay: true }),
      loadConfiguration: () => loadConfig({
        NEBIUS_API_KEY: 'nebius-test',
        CONTREE_TOKEN: 'contree-test',
        CONTREE_PROJECT: 'project-test',
      }),
      repository: () => ({ owner: 'acme', repo: 'widget' }),
      environment: { GITHUB_RUN_ID: '88', GITHUB_SHA: SHA },
      setFailed,
    });

    expect(setFailed).toHaveBeenCalledWith(
      'capture-replay requires Sutura to be pinned to an exact Action commit SHA',
    );
  });
});

 it('dispatches verify mode without constructing repair orchestration',async()=>{
 const verify=vi.fn(async()=>({status:'refused' as const}));const setFailed=vi.fn();
 await runAction({readAction:()=>({mode:'verify',githubToken:'token',runId:'77',triageN:1,requireFixed:false,captureReplay:false,environment:{}}),loadConfiguration:()=>({contreeToken:'token',contreeProject:'project'} as never),repository:()=>({owner:'owner',repo:'repo'}),environment:{GITHUB_RUN_ID:'88'},readVerification:()=>({sourceSha:SHA,policyBaseSha:SHA,candidateDiff:'diff',failingCommandId:'diagnosed'}),verify,setFailed});
 expect(verify).toHaveBeenCalledOnce();expect(setFailed).toHaveBeenCalledWith('Sutura verification: refused');
 });

describe('runAction repair-branch refusal', () => {
  it('skips a run on its own repair branch without failing the job', async () => {
    mockOrchestrate.mockClear();
    mockOrchestrate.mockImplementationOnce(() => {
      throw new RepairBranchRunError('77', 'sutura/fix-76');
    });
    const setFailed = vi.fn();

    await runAction({
      readAction: () => ({
        githubToken: 'github-test', runId: '77', triageN: 1,
        requireFixed: false, captureReplay: false, environment: {},
      }),
      loadConfiguration: () => loadConfig({
        NEBIUS_API_KEY: 'nebius-test',
        CONTREE_TOKEN: 'contree-test',
        CONTREE_PROJECT: 'project-test',
      }),
      repository: () => ({ owner: 'acme', repo: 'widget' }),
      environment: { GITHUB_RUN_ID: '88' },
      setFailed,
    });

    expect(mockOrchestrate).toHaveBeenCalledOnce();
    expect(setFailed).not.toHaveBeenCalled();
  });
});

describe('runAction triage policy', () => {
  it('triages the failing test file first under the configured sandbox budget', async () => {
    mockOrchestrate.mockClear();

    await runAction({
      readAction: () => ({
        githubToken: 'github-test', runId: '77', triageN: 1,
        requireFixed: false, captureReplay: false, environment: {},
      }),
      loadConfiguration: () => loadConfig({
        NEBIUS_API_KEY: 'nebius-test',
        CONTREE_TOKEN: 'contree-test',
        CONTREE_PROJECT: 'project-test',
        SUTURA_TRIAGE_SANDBOX_SEC: '300',
      }),
      repository: () => ({ owner: 'acme', repo: 'widget' }),
      environment: { GITHUB_RUN_ID: '88' },
      setFailed: vi.fn(),
    });

    expect(mockOrchestrate.mock.calls[0]?.[0]).toMatchObject({ triagePolicy: { scope: 'focused', sandboxBudgetSec: 300 } });
  });
});

describe('TypeSafe Jev calibrated audit construction', () => {
  const action = {
    githubToken: 'github-test',
    runId: '77',
    triageN: 1,
    requireFixed: false,
    captureReplay: false,
    environment: {},
  } as const;

  it('constructs the TypeSafe client only when TYPESAFE_API_KEY is configured, and passes it into orchestrate', async () => {
    mockOrchestrate.mockClear();
    mockTypeSafeClient.mockClear();
    const setFailed = vi.fn();

    await runAction({
      readAction: () => action,
      loadConfiguration: () => loadConfig({
        NEBIUS_API_KEY: 'nebius-test',
        CONTREE_TOKEN: 'contree-test',
        CONTREE_PROJECT: 'project-test',
        TYPESAFE_API_KEY: 'typesafe-secret',
      }),
      repository: () => ({ owner: 'acme', repo: 'widget' }),
      environment: { GITHUB_RUN_ID: '88' },
      setFailed,
    });

    expect(mockTypeSafeClient).toHaveBeenCalledTimes(1);
    expect(mockTypeSafeClient.mock.calls[0]?.[0]).toMatchObject({ apiKey: 'typesafe-secret' });
    expect(mockOrchestrate).toHaveBeenCalledTimes(1);
    expect(mockOrchestrate.mock.calls[0]?.[0]).toMatchObject({
      typesafeAudit: { __typesafeApiKey: 'typesafe-secret' },
    });
  });

  it('does not construct the TypeSafe client when TYPESAFE_API_KEY is unconfigured', async () => {
    mockOrchestrate.mockClear();
    mockTypeSafeClient.mockClear();
    const setFailed = vi.fn();

    await runAction({
      readAction: () => action,
      loadConfiguration: () => loadConfig({
        NEBIUS_API_KEY: 'nebius-test',
        CONTREE_TOKEN: 'contree-test',
        CONTREE_PROJECT: 'project-test',
      }),
      repository: () => ({ owner: 'acme', repo: 'widget' }),
      environment: { GITHUB_RUN_ID: '88' },
      setFailed,
    });

    expect(mockTypeSafeClient).not.toHaveBeenCalled();
    expect(mockOrchestrate).toHaveBeenCalledTimes(1);
    expect(mockOrchestrate.mock.calls[0]?.[0]).not.toHaveProperty('typesafeAudit');
  });

  it('records the TypeSafe key in the replay recorder secrets when capture-replay is enabled', async () => {
    mockOrchestrate.mockClear();
    mockReplayRecorderCalls.length = 0;
    const setFailed = vi.fn();

    await runAction({
      readAction: () => ({ ...action, captureReplay: true }),
      loadConfiguration: () => loadConfig({
        NEBIUS_API_KEY: 'nebius-test',
        CONTREE_TOKEN: 'contree-test',
        CONTREE_PROJECT: 'project-test',
        TYPESAFE_API_KEY: 'typesafe-secret',
      }),
      repository: () => ({ owner: 'acme', repo: 'widget' }),
      environment: { GITHUB_RUN_ID: '88', GITHUB_ACTION_REF: SHA },
      setFailed,
    });

    expect(mockReplayRecorderCalls).toHaveLength(1);
    const secrets = mockReplayRecorderCalls[0]?.[4];
    expect(secrets).toContain('typesafe-secret');
  });
});

describe('inspection dispatch before provider configuration', () => {
  it('does not load providers or claim when inspecting a run', async () => {
    const loadConfiguration = vi.fn(() => { throw new Error('provider configuration must not be touched'); });
    const inspect = vi.fn(async () => ({ schemaVersion: 'sutura-action-inspection-v1' as const, repository: 'owner/repo', runId: '7', attempt: 1, sourceSha: SHA,
      disposition: 'observe-only' as const, reason: 'no-failed-source-run', owner: 'repository', nextAction: 'Wait for a real failure.', evidenceDigest: 'c'.repeat(64), repairEligible: false, executionAuthorized: false as const }));
    const publishInspection = vi.fn(), setFailed = vi.fn();
    await runAction({ readAction: () => ({ mode: 'inspect', githubToken: 'read-only', runId: '7', triageN: 0, requireFixed: false, captureReplay: false, environment: {} }),
      repository: () => ({ owner: 'owner', repo: 'repo' }), environment: {}, loadConfiguration, inspect, publishInspection, setFailed });
    expect(inspect).toHaveBeenCalledOnce();
    expect(loadConfiguration).not.toHaveBeenCalled();
    expect(publishInspection).toHaveBeenCalledOnce();
    expect(setFailed).not.toHaveBeenCalled();
  });
});

it.each([false, true])('preserves strict=%s when missing provider input stops before configuration', async strict => {
  const { mapActionInputs } = await import('./input.js');
  const setFailed = vi.fn(), loadConfiguration = vi.fn(), publishTerminal = vi.fn(async () => undefined);
  await runAction({ repository: () => ({ owner: 'owner', repo: 'repo' }), environment: { GITHUB_RUN_ID: '88' }, publishTerminal, readAction: () => mapActionInputs(name => ({ 'run-id': '7', 'github-token': 'read-only', 'require-fixed': String(strict) } as Record<string, string>)[name] ?? ''), loadConfiguration, setFailed });
  expect(loadConfiguration).not.toHaveBeenCalled();
  expect(setFailed).toHaveBeenCalledTimes(strict ? 1 : 0);
  expect(publishTerminal).toHaveBeenCalledWith(expect.objectContaining({ terminal: expect.objectContaining({ reason: 'setup-blocked' }), costStatus: 'unavailable' }));
});

it('never turns verify-mode missing provider input into advisory success', async () => {
  const { mapActionInputs } = await import('./input.js');
  const setFailed = vi.fn(), publishTerminal = vi.fn(async () => undefined);
  await runAction({ readAction: () => mapActionInputs(name => ({ mode: 'verify', 'run-id': '7', 'github-token': 'read-only' } as Record<string, string>)[name] ?? ''), setFailed, publishTerminal });
  expect(setFailed).toHaveBeenCalledOnce();
  expect(publishTerminal).not.toHaveBeenCalled();
});


describe('Jev semantic orchestration wiring', () => {
  const environment = { NEBIUS_API_KEY: 'nebius-test', TYPESAFE_API_KEY: 'typesafe-secret', CONTREE_TOKEN: 'contree-test', CONTREE_PROJECT: 'project-test' };
  const action = { githubToken: 'github-test', runId: '77', triageN: 1, requireFixed: false, captureReplay: false, environment };

  it('passes a separate pinned semantic client without changing the existing audit client', async () => {
    mockOrchestrate.mockClear(); mockTypeSafeClient.mockClear();
    const selected = semanticConfig({ modes: { ranking: 'assist', recovery: 'assist' }, maxUsd: .01 }, true);
    await runAction({ readAction: () => ({ ...action, semantic: selected }), repository: () => ({ owner: 'acme', repo: 'widget' }), environment: { GITHUB_RUN_ID: '88' }, setFailed: vi.fn() });
    expect(mockTypeSafeClient).toHaveBeenCalledTimes(2);
    expect(mockTypeSafeClient.mock.calls[0]?.[0]).not.toHaveProperty('model');
    expect(mockTypeSafeClient.mock.calls[1]?.[0]).toMatchObject({ apiKey: 'typesafe-secret', model: 'jev-1.14.0' });
    const context = mockOrchestrate.mock.calls[0]?.[0] as { semantic?: { config: unknown; client: unknown }; typesafeAudit?: unknown };
    expect(context.semantic?.config).toEqual(selected);
    expect(context.semantic?.client).toBe(mockTypeSafeClient.mock.results[1]?.value);
    expect(context.typesafeAudit).toBe(mockTypeSafeClient.mock.results[0]?.value);
  });

  it('wires real shadow capture to a private runner-local path without constructing a semantic provider', async () => {
    mockOrchestrate.mockClear(); mockTypeSafeClient.mockClear();
    mockSetOutput.mockClear();
    const selected = semanticConfig({ modes: { classification: 'shadow' }, maxUsd: .01 }, true);
    let recordedPath: string | undefined;
    mockOrchestrate.mockImplementationOnce((value: unknown) => {
      const context = value as OrchestrationContext;
      return (async () => {
        expect(context.semantic?.config).toEqual(selected);
        expect(context.semantic).not.toHaveProperty('client');
        const session = new DecisionSession({ ...context.semantic!, deadline: Date.now() + 5000 });
        const result = await session.judge('classification', { token: 'shadow-secret', log: 'AssertionError' }, { sufficient: { type: 'noul', instructions: 'Is the evidence sufficient?' } }, 'native-classifier');
        expect(result.reason).toBe('shadow-captured');
        throw new Error('stop after real shadow capture');
      })() as never;
    });
    try {
      await runAction({ readAction: () => ({ ...action, semantic: selected }), repository: () => ({ owner: 'acme', repo: 'widget' }), environment: { GITHUB_RUN_ID: '88' }, setFailed: vi.fn() });
      recordedPath = mockSetOutput.mock.calls.find(([name]) => name === 'semantic-shadow-path')?.[1] as string | undefined;
      expect(recordedPath).toBeTypeOf('string');
      const capture = await readFile(recordedPath!, 'utf8');
      expect(capture).toContain('AssertionError');
      expect(capture).not.toContain('shadow-secret');
      expect(mockTypeSafeClient).toHaveBeenCalledTimes(1);
      expect(mockTypeSafeClient.mock.calls[0]?.[0]).not.toHaveProperty('model');
    } finally {
      if (recordedPath) await rm(dirname(recordedPath), { recursive: true, force: true });
    }
  });

  it.each(['mkdtemp', 'open'] as const)('preserves baseline orchestration when shadow initialization %s fails', async stage => {
    mockOrchestrate.mockReset(); mockTypeSafeClient.mockClear(); mockSetOutput.mockClear(); mockWarning.mockClear();
    shadowFsFailure.stage = stage;
    const selected = semanticConfig({ modes: { classification: 'shadow' }, maxUsd: .01 }, true);
    const setFailed = vi.fn();
    let shadowDecision: unknown;
    mockOrchestrate.mockImplementationOnce((value: unknown) => {
      const context = value as OrchestrationContext;
      return (async () => {
        expect(context.semantic?.config).toEqual(selected);
        expect(context.semantic).not.toHaveProperty('client');
        const session = new DecisionSession({ ...context.semantic!, deadline: Date.now() + 5000 });
        shadowDecision = await session.judge('classification', { log: 'AssertionError' }, { sufficient: { type: 'noul', instructions: 'Is the evidence sufficient?' } }, 'native-classifier', ['test-assertion'], ['test-assertion']);
        expect(session.records).toHaveLength(1);
        throw new Error('stop-after-baseline-assertions');
      })() as never;
    });
    try {
      await runAction({ readAction: () => ({ ...action, semantic: selected }), repository: () => ({ owner: 'acme', repo: 'widget' }), environment: { GITHUB_RUN_ID: '88' }, setFailed });
      expect(mockOrchestrate).toHaveBeenCalledOnce();
      expect(shadowDecision).toMatchObject({ outcome: 'unavailable', reason: 'shadow-capture-failed', fallback: 'native-classifier', baseline: ['test-assertion'], attempts: 0, actualUsd: 0, unknownSpendUsd: 0 });
      expect(mockWarning).toHaveBeenCalledWith('Jev shadow capture could not be initialized; native decisions continue and shadow evidence is unavailable.');
      expect(JSON.stringify(mockWarning.mock.calls)).not.toContain('private-filesystem-detail');
      expect(JSON.stringify(mockWarning.mock.calls)).not.toContain('secret-test');
      expect(mockSetOutput.mock.calls.some(([name]) => name === 'semantic-shadow-path')).toBe(false);
      expect(mockTypeSafeClient).toHaveBeenCalledTimes(1);
      expect(mockTypeSafeClient.mock.calls[0]?.[0]).not.toHaveProperty('model');
      expect(setFailed).toHaveBeenCalledWith('stop-after-baseline-assertions');
    } finally {
      shadowFsFailure.stage = undefined;
      for (const directory of shadowFsFailure.createdDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
      mockOrchestrate.mockReset();
      mockOrchestrate.mockImplementation(() => { throw new Error('stop before repair orchestration'); });
    }
  });

  it('validates selected semantics before constructing provider clients or orchestrating', async () => {
    mockOrchestrate.mockClear(); mockTypeSafeClient.mockClear();
    const setFailed = vi.fn();
    const selected = semanticConfig({ modes: { classification: 'assist' }, maxUsd: .01 }, true);
    await runAction({ readAction: () => ({ ...action, environment: { ...environment, TYPESAFE_API_KEY: '' }, semantic: selected }), repository: () => ({ owner: 'acme', repo: 'widget' }), environment: { GITHUB_RUN_ID: '88' }, setFailed });
    expect(mockOrchestrate).not.toHaveBeenCalled();
    expect(mockTypeSafeClient).not.toHaveBeenCalled();
    expect(setFailed).toHaveBeenCalledWith(expect.stringMatching(/semantic.authorization/));
  });
});
