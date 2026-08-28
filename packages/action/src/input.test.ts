import { describe, expect, it } from 'vitest';

import { ActionInputError, mapActionInputs } from './input.js';

const REQUIRED = {
  'github-token': 'ghs_test',
  'nebius-api-key': 'neb_test',
  'contree-token': 'con_test',
  'contree-project': 'project_test',
  'run-id': '12345',
};

describe('mapActionInputs', () => {
  it('maps required inputs and defaults', () => {
    const config = mapActionInputs((name) => REQUIRED[name as keyof typeof REQUIRED] ?? '');

    expect(config).toMatchObject({
      githubToken: 'ghs_test',
      runId: '12345',
      triageN: 5,
      environment: {
        NEBIUS_API_KEY: 'neb_test',
        CONTREE_TOKEN: 'con_test',
        CONTREE_PROJECT: 'project_test',
        SUTURA_TRIAGE_N: '5',
        SUTURA_REPAIR_MODEL_TURNS: '8',
        SUTURA_REPAIR_TOOL_CALLS: '24',
        SUTURA_REPAIR_BRANCHES: '12',
        SUTURA_REPAIR_SANDBOX_OPERATIONS: '32',
        SUTURA_REPAIR_ELAPSED_TIME_SEC: '600',
        SUTURA_REPAIR_INFERENCE_COST_USD: '0.25',
        SUTURA_REPAIR_DIFF_BYTES: '65536',
        SUTURA_SEARCH_INITIAL_BRANCHES: '4',
        SUTURA_SEARCH_BEAM_WIDTH: '2',
        SUTURA_SEARCH_MAX_DEPTH: '4',
        SUTURA_SEARCH_MAX_TOTAL_BRANCHES: '12',
      },
    });
  });

  it('maps optional Tavily and model overrides without exposing the GitHub token', () => {
    const values = {
      ...REQUIRED,
      'tavily-api-key': 'tav_test',
      'triage-n': '7',
      'model-nano': 'nano-override',
      'model-super': 'super-override',
      'model-ultra': 'ultra-override',
    };
    const config = mapActionInputs((name) => values[name as keyof typeof values] ?? '');

    expect(config.environment).toEqual({
      NEBIUS_API_KEY: 'neb_test',
      TAVILY_API_KEY: 'tav_test',
      CONTREE_TOKEN: 'con_test',
      CONTREE_PROJECT: 'project_test',
      SUTURA_TRIAGE_N: '7',
      SUTURA_REPAIR_MODEL_TURNS: '8',
      SUTURA_REPAIR_TOOL_CALLS: '24',
      SUTURA_REPAIR_BRANCHES: '12',
      SUTURA_REPAIR_SANDBOX_OPERATIONS: '32',
      SUTURA_REPAIR_ELAPSED_TIME_SEC: '600',
      SUTURA_REPAIR_INFERENCE_COST_USD: '0.25',
      SUTURA_REPAIR_DIFF_BYTES: '65536',
      SUTURA_SEARCH_INITIAL_BRANCHES: '4',
      SUTURA_SEARCH_BEAM_WIDTH: '2',
      SUTURA_SEARCH_MAX_DEPTH: '4',
      SUTURA_SEARCH_MAX_TOTAL_BRANCHES: '12',
      SUTURA_MODEL_NANO: 'nano-override',
      SUTURA_MODEL_SUPER: 'super-override',
      SUTURA_MODEL_ULTRA: 'ultra-override',
    });
    expect(Object.values(config.environment)).not.toContain('ghs_test');
  });

  it('maps adaptive search overrides into production configuration', () => {
    const values = {
      ...REQUIRED,
      'search-initial-branches': '3',
      'search-beam-width': '2',
      'search-max-depth': '3',
      'search-max-total-branches': '9',
    };
    expect(mapActionInputs((name) => values[name as keyof typeof values] ?? '').environment).toMatchObject({
      SUTURA_SEARCH_INITIAL_BRANCHES: '3',
      SUTURA_SEARCH_BEAM_WIDTH: '2',
      SUTURA_SEARCH_MAX_DEPTH: '3',
      SUTURA_SEARCH_MAX_TOTAL_BRANCHES: '9',
    });
  });

  it('rejects a missing required input', () => {
    expect(() => mapActionInputs(() => '')).toThrowError(ActionInputError);
  });

  it.each([
    ['run-id', '0'],
    ['run-id', '1e3'],
    ['triage-n', '21'],
    ['repair-model-turns', '9'],
    ['repair-inference-cost-usd', '0.26'],
  ])('rejects invalid %s input', (name, value) => {
    const values: Record<string, string> = { ...REQUIRED, [name]: value };
    expect(() => mapActionInputs((key) => values[key] ?? '')).toThrowError(
      ActionInputError,
    );
  });
});
