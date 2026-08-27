import { describe, expect, it } from 'vitest';

import { isSensitiveRepositoryPath } from './repository-path.js';

describe('isSensitiveRepositoryPath', () => {
  it('uses one policy for repository secrets and metadata', () => {
    for (const path of [
      '.git/config',
      '.env',
      'config/.env.local',
      '.netrc',
      '.npmrc',
      '.pypirc',
      'credentials.json',
      'keys/id_rsa',
      'keys/id_ed25519',
      'keys/client.key',
      'keys/client.pem',
      'keys/client.p12',
      'keys/client.pfx',
      'node_modules/pkg/index.js',
    ]) {
      expect(isSensitiveRepositoryPath(path), path).toBe(true);
    }
  });

  it('can include dependencies without including other sensitive paths', () => {
    expect(isSensitiveRepositoryPath('node_modules/pkg/index.js', {
      includeDependencies: true,
    })).toBe(false);
    expect(isSensitiveRepositoryPath('node_modules/pkg/credentials.json', {
      includeDependencies: true,
    })).toBe(true);
  });

  it('accepts ordinary source and configuration files', () => {
    expect(isSensitiveRepositoryPath('src/index.ts')).toBe(false);
    expect(isSensitiveRepositoryPath('package.json')).toBe(false);
  });
});
