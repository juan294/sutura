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
});
