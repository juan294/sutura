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
      requireFixed: false,
      captureReplay: false,
      environment: {
        NEBIUS_API_KEY: 'neb_test',
        CONTREE_TOKEN: 'con_test',
        CONTREE_PROJECT: 'project_test',
        SUTURA_TRIAGE_N: '5',
        SUTURA_TRIAGE_SANDBOX_SEC: '240',
        SUTURA_ROUTING_PROFILE: 'production-baseline-v1',
        SUTURA_REPAIR_MODEL_TURNS: '8',
        SUTURA_REPAIR_TOOL_CALLS: '24',
        SUTURA_REPAIR_BRANCHES: '12',
        SUTURA_REPAIR_SANDBOX_OPERATIONS: '32',
        SUTURA_REPAIR_ELAPSED_TIME_SEC: '600',
        SUTURA_REPAIR_INFERENCE_COST_USD: '0.25',
        SUTURA_SECOND_OPINION_USD: '0.3',
        SUTURA_TYPESAFE_AUDIT_USD: '0.02',
        SUTURA_REPAIR_DIFF_BYTES: '65536',
        SUTURA_SEARCH_INITIAL_BRANCHES: '4',
        SUTURA_SEARCH_BEAM_WIDTH: '2',
        SUTURA_SEARCH_MAX_DEPTH: '4',
        SUTURA_SEARCH_MAX_TOTAL_BRANCHES: '12',
      },
    });
  });

  it('maps the strict self-hosting acceptance gate', () => {
    const values = { ...REQUIRED, 'require-fixed': 'true' };
    expect(mapActionInputs((name) => values[name as keyof typeof values] ?? ''))
      .toMatchObject({ requireFixed: true });

    for (const value of ['1', 'yes', 'TRUE']) {
      const invalid = { ...REQUIRED, 'require-fixed': value };
      expect(() => mapActionInputs((name) => invalid[name as keyof typeof invalid] ?? ''))
        .toThrow(/require-fixed must be true or false/u);
    }
  });

  it('maps replay capture and accepts only true or false', () => {
    const enabled = { ...REQUIRED, 'capture-replay': 'true' };
    expect(mapActionInputs((name) => enabled[name as keyof typeof enabled] ?? ''))
      .toMatchObject({ captureReplay: true });

    for (const value of ['1', 'yes', 'TRUE']) {
      const invalid = { ...REQUIRED, 'capture-replay': value };
      expect(() => mapActionInputs((name) => invalid[name as keyof typeof invalid] ?? ''))
        .toThrow(/capture-replay must be true or false/u);
    }
  });

  it('maps optional Tavily, OpenAI, TypeSafe, and model selectors without exposing the GitHub token', () => {
    const values = {
      ...REQUIRED,
      'tavily-api-key': 'tav_test',
      'openai-api-key': 'sk-openai_test',
      'typesafe-api-key': 'typesafe_test',
      'triage-n': '7',
      'model-nano': 'nano-override',
      'model-super': 'nvidia/nemotron-3-super-120b-a12b',
      'model-ultra': 'ultra-override',
      'routing-profile': 'production-baseline-v1',
    };
    const config = mapActionInputs((name) => values[name as keyof typeof values] ?? '');

    expect(config.environment).toEqual({
      NEBIUS_API_KEY: 'neb_test',
      TAVILY_API_KEY: 'tav_test',
      OPENAI_API_KEY: 'sk-openai_test',
      TYPESAFE_API_KEY: 'typesafe_test',
      CONTREE_TOKEN: 'con_test',
      CONTREE_PROJECT: 'project_test',
      SUTURA_TRIAGE_N: '7',
      SUTURA_TRIAGE_SANDBOX_SEC: '240',
      SUTURA_ROUTING_PROFILE: 'production-baseline-v1',
      SUTURA_REPAIR_MODEL_TURNS: '8',
      SUTURA_REPAIR_TOOL_CALLS: '24',
      SUTURA_REPAIR_BRANCHES: '12',
      SUTURA_REPAIR_SANDBOX_OPERATIONS: '32',
      SUTURA_REPAIR_ELAPSED_TIME_SEC: '600',
      SUTURA_REPAIR_INFERENCE_COST_USD: '0.25',
      SUTURA_SECOND_OPINION_USD: '0.3',
      SUTURA_TYPESAFE_AUDIT_USD: '0.02',
      SUTURA_REPAIR_DIFF_BYTES: '65536',
      SUTURA_SEARCH_INITIAL_BRANCHES: '4',
      SUTURA_SEARCH_BEAM_WIDTH: '2',
      SUTURA_SEARCH_MAX_DEPTH: '4',
      SUTURA_SEARCH_MAX_TOTAL_BRANCHES: '12',
      SUTURA_MODEL_NANO: 'nano-override',
      SUTURA_MODEL_SUPER: 'nvidia/nemotron-3-super-120b-a12b',
      SUTURA_MODEL_ULTRA: 'ultra-override',
    });
    expect(Object.values(config.environment)).not.toContain('ghs_test');
  });

  it('maps a lower-only second-opinion budget override', () => {
    const values = { ...REQUIRED, 'repair-second-opinion-usd': '0.1' };
    expect(mapActionInputs((name) => values[name as keyof typeof values] ?? '').environment)
      .toMatchObject({ SUTURA_SECOND_OPINION_USD: '0.1' });
  });

  it('maps a lower-only TypeSafe audit budget override', () => {
    const values = { ...REQUIRED, 'repair-typesafe-audit-usd': '0.01' };
    expect(mapActionInputs((name) => values[name as keyof typeof values] ?? '').environment)
      .toMatchObject({ SUTURA_TYPESAFE_AUDIT_USD: '0.01' });
  });

  it('rejects a TypeSafe audit budget above the default and names the input', () => {
    const values = { ...REQUIRED, 'repair-typesafe-audit-usd': '0.03' };
    expect(() => mapActionInputs((name) => values[name as keyof typeof values] ?? ''))
      .toThrow(/repair-typesafe-audit-usd must be greater than 0 and at most 0.02/u);
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

  it.each(['node', 'python'] as const)('maps explicit %s runtime without an image override', (runtime) => {
    const values = { ...REQUIRED, runtime };
    const environment = mapActionInputs((name) => values[name as keyof typeof values] ?? '').environment;
    expect(environment.SUTURA_RUNTIME).toBe(runtime);
    expect(Object.keys(environment).some((name) => /IMAGE/iu.test(name))).toBe(false);
  });

  it('leaves automatic runtime detection unset and rejects unknown selectors', () => {
    const values = { ...REQUIRED, runtime: 'auto' };
    expect(mapActionInputs((name) => values[name as keyof typeof values] ?? '').environment)
      .not.toHaveProperty('SUTURA_RUNTIME');
    expect(() => mapActionInputs((name) => name === 'runtime' ? 'ruby' : REQUIRED[name as keyof typeof REQUIRED] ?? ''))
      .toThrow(/runtime/iu);
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

  it('maps and bounds the triage sandbox budget', () => {
    const base = { 'github-token': 'gh_test', 'run-id': '42', 'nebius-api-key': 'neb_test', 'contree-token': 'con_test', 'contree-project': 'project_test' };
    const map = (value: string) => mapActionInputs((name) => ({ ...base, 'triage-sandbox-seconds': value } as Record<string, string>)[name] ?? '');

    expect(map('600').environment.SUTURA_TRIAGE_SANDBOX_SEC).toBe('600');
    expect(map('').environment.SUTURA_TRIAGE_SANDBOX_SEC).toBe('240');
    expect(() => map('0')).toThrow(/triage-sandbox-seconds/u);
    expect(() => map('3601')).toThrow(/triage-sandbox-seconds/u);
  });
});

it('parses inspect before provider inputs are requested', () => {
  const names: string[] = [];
  const result = mapActionInputs(name => {
    names.push(name);
    return ({ mode: 'inspect', 'run-id': '7', 'github-token': 'read-only' } as Record<string, string>)[name] ?? '';
  });
  expect(result).toMatchObject({ mode: 'inspect', environment: {}, runId: '7' });
  expect(names).not.toContain('nebius-api-key');
});


describe('explicit Jev role controls', () => {
  const map = (values: Record<string, string>) => mapActionInputs(name => ({ ...REQUIRED, ...values })[name] ?? '');

  it('leaves default and explicitly off roles absent without new spend authority', () => {
    expect(map({})).not.toHaveProperty('semantic');
    expect(map({ 'jev-ranking': 'off', 'jev-grounding': 'off', 'jev-classification': 'off', 'jev-recovery': 'off', 'jev-budget-usd': '0' })).not.toHaveProperty('semantic');
  });

  it('maps all four role modes and one independently bounded shared budget', () => {
    const result = map({ 'typesafe-api-key': 'typesafe_test', 'jev-ranking': 'assist', 'jev-grounding': 'shadow', 'jev-classification': 'assist', 'jev-recovery': 'shadow', 'jev-budget-usd': '0.01' });
    expect(result.semantic).toEqual({ schemaVersion: 'sutura-semantic-config-v1', model: 'jev-1.14.0', policyVersion: 'semantic-v1', modes: { ranking: 'assist', grounding: 'shadow', classification: 'assist', recovery: 'shadow' }, maxUsd: 0.01 });
    expect(result.environment.SUTURA_TYPESAFE_AUDIT_USD).toBe('0.02');
    expect(result.environment.SUTURA_REPAIR_INFERENCE_COST_USD).toBe('0.25');
  });

  it.each(['ranking', 'grounding', 'classification', 'recovery'])('rejects unsupported %s mode and identifies its input', role => {
    expect(() => map({ [`jev-${role}`]: 'on' })).toThrow(`jev-${role} must be off, shadow, or assist`);
  });

  it.each(['-0.01', '0.020001', 'NaN', 'Infinity', 'invalid'])('rejects invalid shared cap %s', cap => {
    expect(() => map({ 'jev-budget-usd': cap })).toThrow(/jev-budget-usd/);
  });

  it.each(['shadow', 'assist'])('requires an explicit positive cap and existing key for %s', mode => {
    expect(() => map({ 'jev-ranking': mode, 'typesafe-api-key': 'typesafe_test' })).toThrow(/jev-budget-usd/);
    expect(() => map({ 'jev-ranking': mode, 'jev-budget-usd': '0.01' })).toThrow(/typesafe-api-key/);
  });

  it('does not silently accept repair role selection in supplied-patch verification', () => {
    expect(() => map({ mode: 'verify', 'typesafe-api-key': 'typesafe_test', 'jev-recovery': 'assist', 'jev-budget-usd': '0.01' })).toThrow(/Jev role inputs require mode heal/);
  });
});
