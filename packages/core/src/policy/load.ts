import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

import {
  DEFAULT_REPOSITORY_POLICY,
  PolicyValidationError,
  parseRepositoryPolicy,
  type RepositoryPolicy,
} from './schema.js';

export const MAX_POLICY_BYTES = 65_536;

export interface LoadedRepositoryPolicy {
  policy: RepositoryPolicy;
  sha: string;
  source: 'default' | 'repository';
}

export function createDefaultRepositoryPolicy(): RepositoryPolicy {
  return {
    ...DEFAULT_REPOSITORY_POLICY,
    allowedPaths: [...DEFAULT_REPOSITORY_POLICY.allowedPaths],
    protectedPaths: [...DEFAULT_REPOSITORY_POLICY.protectedPaths],
    deniedReadPaths: [...DEFAULT_REPOSITORY_POLICY.deniedReadPaths],
    requiredCommands: [...DEFAULT_REPOSITORY_POLICY.requiredCommands],
    resourceLimits: { ...DEFAULT_REPOSITORY_POLICY.resourceLimits },
  };
}

export function loadRepositoryPolicy(content: string | null): LoadedRepositoryPolicy {
  if (content === null) {
    return {
      policy: createDefaultRepositoryPolicy(),
      sha: 'default',
      source: 'default',
    };
  }
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_POLICY_BYTES) {
    throw new PolicyValidationError(
      `Repository policy exceeds the 65,536 bytes limit (${bytes.toLocaleString('en-US')} bytes)`,
    );
  }
  return {
    policy: parseRepositoryPolicy(content),
    sha: createHash('sha256').update(content, 'utf8').digest('hex'),
    source: 'repository',
  };
}
