import { constants } from 'node:fs';
import { lstat, mkdtemp, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ShadowInput } from '@sutura/core';

/** Shadow inputs remain private on the runner, excluded from public case/replay artifacts. */
export async function createActionSemanticShadow(): Promise<{ path: string; capture(input: ShadowInput): Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'sutura-semantic-'));
  const directoryIdentity = await lstat(directory);
  const path = join(directory, 'semantic-shadow.jsonl');
  const created = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const identity = await created.stat();
  await created.close();
  let pending = Promise.resolve();
  const append = async (input: ShadowInput) => {
    const currentDirectory = await lstat(directory);
    if (currentDirectory.ino !== directoryIdentity.ino || currentDirectory.dev !== directoryIdentity.dev || !currentDirectory.isDirectory() || currentDirectory.isSymbolicLink()) throw new Error('Private Jev shadow directory changed');
    const handle = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
    try {
      const current = await handle.stat();
      if (current.ino !== identity.ino || current.dev !== identity.dev || current.nlink !== 1 || !current.isFile() || (current.mode & 0o777) !== 0o600) throw new Error('Private Jev shadow file changed');
      const line = `${JSON.stringify(input)}\n`;
      if (current.size + Buffer.byteLength(line) > 4 * 1024 * 1024) throw new Error('Private Jev shadow capture exceeds 4 MiB');
      await handle.writeFile(line, 'utf8');
    } finally { await handle.close(); }
  };
  return { path, capture(input) { pending = pending.then(() => append(input)); return pending; } };
}
