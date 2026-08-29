import type { CommandRunner } from './command.js';

const ACTION_REMOTE = 'https://github.com/juan294/sutura.git';
const SHA_PATTERN = /^[a-f0-9]{40}$/iu;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

export class ReleaseResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleaseResolutionError';
  }
}

export interface ResolveActionCommitOptions {
  version: string;
  cwd: string;
  run: CommandRunner;
  explicitCommit?: string;
}

function exactCommit(value: string, source: string): string {
  if (!SHA_PATTERN.test(value)) {
    throw new ReleaseResolutionError(`${source} must be an exact 40-character commit`);
  }
  return value.toLowerCase();
}

export async function resolveActionCommit(
  options: ResolveActionCommitOptions,
): Promise<string> {
  if (options.explicitCommit !== undefined) {
    return exactCommit(options.explicitCommit, 'Action SHA');
  }
  if (!VERSION_PATTERN.test(options.version)) {
    throw new ReleaseResolutionError('Release version is invalid');
  }

  const tag = `v${options.version}`;
  let output: string;
  try {
    output = await options.run('git', [
      'ls-remote', ACTION_REMOTE, `refs/tags/${tag}`, `refs/tags/${tag}^{}`,
    ], { cwd: options.cwd });
  } catch (error) {
    throw new ReleaseResolutionError(
      `Could not resolve Action release tag ${tag}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const direct: string[] = [];
  const peeled: string[] = [];
  for (const line of output.split(/\r?\n/u).filter(Boolean)) {
    const match = /^([^\t]+)\t([^\t]+)$/u.exec(line);
    if (!match) throw new ReleaseResolutionError(`Action release tag ${tag} returned malformed data`);
    const [, sha = '', ref = ''] = match;
    if (ref === `refs/tags/${tag}`) direct.push(exactCommit(sha, `Action release tag ${tag}`));
    else if (ref === `refs/tags/${tag}^{}`) peeled.push(exactCommit(sha, `Action release tag ${tag}`));
    else throw new ReleaseResolutionError(`Action release tag ${tag} returned an unexpected ref`);
  }
  if (direct.length !== 1 || peeled.length > 1) {
    throw new ReleaseResolutionError(`Action release tag ${tag} did not resolve uniquely`);
  }
  return peeled[0] ?? direct[0]!;
}
