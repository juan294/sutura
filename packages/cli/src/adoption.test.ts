import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { acquireSetupLock } from './adoption.js';

const race = vi.hoisted(() => ({ enabled: false, path: '', removals: 0, beforeRemoval: Promise.resolve(), beforeSecond: Promise.resolve() }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, unlink: async (path: Parameters<typeof actual.unlink>[0]) => {
    if (race.enabled && String(path) === race.path) {
      const removal = ++race.removals;
      await race.beforeRemoval;
      if (removal > 1) await race.beforeSecond;
    }
    return actual.unlink(path);
  } };
});
afterEach(() => { vi.restoreAllMocks(); race.enabled = false; });
async function fixture(run: (root: string, path: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'sutura-setup-lock-'));
  try { await mkdir(join(root, '.sutura')); await run(root, join(root, '.sutura', 'setup.lock')); }
  finally { await rm(root, { recursive: true, force: true }); }
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const deadPid = 2_000_000_000;
function deadOwner(root: string) { return { root, pid: deadPid, hostname: hostname(), token: 'prior-owner-token' }; }

it('serializes stale lock recovery so two reclaimers cannot remove a new live lock', async () => fixture(async (root, path) => {
  await writeFile(path, JSON.stringify(deadOwner(root)));
  const bothInspected = deferred(), firstAcquired = deferred();
  let checks = 0;
  const originalKill = process.kill.bind(process);
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (pid !== deadPid) return originalKill(pid, signal);
    if (++checks >= 2) bothInspected.resolve();
    throw Object.assign(new Error('dead fixture owner'), { code: 'ESRCH' });
  });
  Object.assign(race, { enabled: true, path, removals: 0, beforeRemoval: bothInspected.promise, beforeSecond: firstAcquired.promise });
  const attempts = [acquireSetupLock(root), acquireSetupLock(root)];
  // Observe rejections immediately while allowing the first successful owner to establish its receipt.
  const settled = Promise.allSettled(attempts);
  const release = await Promise.any(attempts);
  firstAcquired.resolve();
  const outcomes = await settled;
  expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
  race.enabled = false;
  await release();
}));

it('refuses to release a lock whose ownership token changed', async () => fixture(async (root, path) => {
  const release = await acquireSetupLock(root);
  const owner = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...owner, token: 'another-owner' }));
  await expect(release()).rejects.toThrow(/owner|lock/u);
  expect(JSON.parse(await readFile(path, 'utf8')).token).toBe('another-owner');
}));

it('never reclaims a foreign host lock', async () => fixture(async (root, path) => {
  await writeFile(path, JSON.stringify({ ...deadOwner(root), hostname: 'another-host' }));
  vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('not local'), { code: 'ESRCH' }); });
  await expect(acquireSetupLock(root)).rejects.toThrow(/lock|owner/u);
}));

it('does not pass an interrupted recovery guard', async () => fixture(async (root, path) => {
  await mkdir(`${path}.recovery`);
  await expect(acquireSetupLock(root)).rejects.toThrow(/lock|recovery/u);
}));
