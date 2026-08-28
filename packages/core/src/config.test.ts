import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config.js';

const REQUIRED_ENV = {
  NEBIUS_API_KEY: 'nebius-secret',
};

describe('loadConfig', () => {
  it('fails closed and names the missing required secret', () => {
    expect(() => loadConfig({})).toThrowError(ConfigError);
    expect(() => loadConfig({})).toThrowError(/NEBIUS_API_KEY/);
  });

  it('loads the documented defaults and omits unavailable optional keys', () => {
    const config = loadConfig(REQUIRED_ENV);

    expect(config.triageN).toBe(5);
    expect(config.raceK).toBe(3);
    expect(config.maxOps).toBe(40);
    expect(config.repairBudgets).toEqual({
      modelTurns: 8, toolCalls: 24, branches: 12, sandboxOperations: 32,
      elapsedTimeSec: 600, inferenceCostUsd: 0.25, diffBytes: 65_536,
    });
    expect(config.search).toEqual({ initialBranches: 4, beamWidth: 2, maximumDepth: 4, maximumTotalBranches: 12 });
    expect(config.models).toEqual({
      nano: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B',
      super: 'nvidia/nemotron-3-super-120b-a12b',
      ultra: 'nvidia/Nemotron-3-Ultra-550b-a55b',
    });
    expect(config).not.toHaveProperty('tavilyApiKey');
    expect(config).not.toHaveProperty('contreeToken');
    expect(config).not.toHaveProperty('contreeProject');
  });

  it('accepts valid feature, model, and numeric overrides', () => {
    const config = loadConfig({
      ...REQUIRED_ENV,
      TAVILY_API_KEY: 'tavily-secret',
      CONTREE_TOKEN: 'contree-secret',
      CONTREE_PROJECT: 'project-id',
      SUTURA_TRIAGE_N: '7',
      SUTURA_RACE_K: '4',
      SUTURA_MAX_OPS: '24',
      SUTURA_REPAIR_MODEL_TURNS: '4',
      SUTURA_REPAIR_TOOL_CALLS: '12',
      SUTURA_REPAIR_BRANCHES: '2',
      SUTURA_REPAIR_SANDBOX_OPERATIONS: '16',
      SUTURA_REPAIR_ELAPSED_TIME_SEC: '300',
      SUTURA_REPAIR_INFERENCE_COST_USD: '0.10',
      SUTURA_REPAIR_DIFF_BYTES: '32768',
      SUTURA_SEARCH_INITIAL_BRANCHES: '2',
      SUTURA_SEARCH_BEAM_WIDTH: '1',
      SUTURA_SEARCH_MAX_DEPTH: '3',
      SUTURA_SEARCH_MAX_TOTAL_BRANCHES: '6',
      SUTURA_MODEL_NANO: 'nano-override',
      SUTURA_MODEL_SUPER: 'super-override',
      SUTURA_MODEL_ULTRA: 'ultra-override',
    });

    expect(config).toEqual({
      nebiusApiKey: 'nebius-secret',
      tavilyApiKey: 'tavily-secret',
      contreeToken: 'contree-secret',
      contreeProject: 'project-id',
      triageN: 7,
      raceK: 4,
      models: {
        nano: 'nano-override',
        super: 'super-override',
        ultra: 'ultra-override',
      },
      maxOps: 24,
      repairBudgets: {
        modelTurns: 4, toolCalls: 12, branches: 2, sandboxOperations: 16,
        elapsedTimeSec: 300, inferenceCostUsd: 0.1, diffBytes: 32_768,
      },
      search: { initialBranches: 2, beamWidth: 1, maximumDepth: 3, maximumTotalBranches: 6 },
    });
  });

  it.each(['SUTURA_TRIAGE_N', 'SUTURA_RACE_K', 'SUTURA_MAX_OPS'])(
    'rejects an invalid %s value',
    (name) => {
      expect(() => loadConfig({ ...REQUIRED_ENV, [name]: '0' })).toThrowError(
        new RegExp(name),
      );
    },
  );

  it.each([
    ['SUTURA_TRIAGE_N', '21'],
    ['SUTURA_RACE_K', '11'],
    ['SUTURA_REPAIR_MODEL_TURNS', '9'],
    ['SUTURA_REPAIR_INFERENCE_COST_USD', '0.26'],
    ['SUTURA_SEARCH_MAX_TOTAL_BRANCHES', '13'],
  ])('rejects an excessive %s value', (name, value) => {
    expect(() => loadConfig({ ...REQUIRED_ENV, [name]: value })).toThrowError(
      new RegExp(name),
    );
  });
});
