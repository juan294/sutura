import { spawn } from 'node:child_process';

export interface RunOptions {
  cwd?: string;
  stdin?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: RunOptions,
) => Promise<string>;

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

export function runCommand(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let failure: CommandError | undefined;
    const stop = (message: string): void => {
      failure ??= new CommandError(message);
      child.kill('SIGKILL');
    };
    const deadline = options.timeoutMs === undefined ? undefined : setTimeout(
      () => stop(`${command} timed out`), options.timeoutMs,
    );
    const receive = (target: Buffer[], chunk: Buffer): void => {
      outputBytes += chunk.length;
      if (options.maxOutputBytes !== undefined && outputBytes > options.maxOutputBytes) {
        stop(`${command} exceeded output limit`);
      } else if (!failure) {
        target.push(chunk);
      }
    };
    child.stdout.on('data', (chunk: Buffer) => receive(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => receive(stderr, chunk));
    child.on('error', (error) => {
      clearTimeout(deadline);
      reject(new CommandError(`${command} failed: ${error.message}`));
    });
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') stop(`${command} input failed: ${error.message}`);
    });
    child.on('close', (code) => {
      clearTimeout(deadline);
      if (failure) {
        reject(failure);
      } else if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8'));
      } else {
        reject(new CommandError(
          `${command} exited ${String(code)}: ${Buffer.concat(stderr).toString('utf8').slice(-2_000)}`,
        ));
      }
    });
    child.stdin.end(options.stdin);
  });
}

export async function resolveRepository(
  cwd: string,
  repository: string | undefined,
  run: CommandRunner,
): Promise<string> {
  if (repository) return repository;
  const detected = (await run(
    'gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { cwd },
  )).trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(detected)) {
    throw new CommandError('Could not detect a GitHub owner/repository name');
  }
  return detected;
}
