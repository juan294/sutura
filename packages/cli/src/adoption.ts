import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, rmdir, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';

export const WORKFLOW_PATH = '.github/workflows/sutura.yml';
export const RECEIPT_PATH = '.sutura/setup-receipt.json';
export const CREDENTIAL_NAMES = ['NEBIUS_API_KEY', 'CONTREE_TOKEN', 'CONTREE_PROJECT', 'TAVILY_API_KEY', 'OPENAI_API_KEY', 'TYPESAFE_API_KEY'] as const;
export type SetupOperation = 'init' | 'upgrade' | 'pause' | 'resume' | 'remove';
export interface PlannedOperation {
  id: string;
  kind: 'workflow-write' | 'workflow-remove' | 'secret-set' | 'variable-set';
  name: string;
  /** Only nonsecret repository variable values. Secret values never enter a plan. */
  value?: string;
  previousValue?: string | null;
}
export interface SetupPlan {
  schemaVersion: 1;
  digest: string;
  root: string;
  operation: SetupOperation;
  cliVersion: string;
  repository: string | null;
  workflow: string;
  actionSha: string;
  credentialNames: string[];
  runtime: string;
  inputDigest: string;
  baselineSha256: string | null;
  proposedSha256: string | null;
  diff: { path: typeof WORKFLOW_PATH; before: string | null; after: string | null };
  conflict?: { base: string | null; current: string | null; proposed: string | null };
  reconciliation?: { priorPlanDigest: string; operationIds: string[]; confirmation: 'new-reviewed-apply-required' };
  capabilities: {
    assessment: unknown;
    selectedProviders: string[];
    destinations: string[];
    permissions: unknown;
    limits: unknown;
    unpriced: string[];
    retention: string[];
    readiness: Record<string, string>;
    nativeChecks: string;
  };
  operations: PlannedOperation[];
  blockers: string[];
  nextAction: string;
}
export interface SetupReceipt {
  schemaVersion: 1;
  planDigest: string;
  plan: SetupPlan;
  operations: Array<{ id: string; status: 'pending' | 'intent' | 'completed' | 'outcome-unknown' }>;
  installation: { wholeWorkflowOwned: boolean; workflowSha256: string | null };
  nextAction: string;
}

export class SetupError extends Error {
  constructor(message: string) { super(message); this.name = 'SetupError'; }
}
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
export function planDigest(plan: Omit<SetupPlan, 'digest'> | SetupPlan): string {
  const contents = Object.fromEntries(Object.entries(plan).filter(([key]) => key !== 'digest' && key !== 'nextAction'));
  return sha256(JSON.stringify(contents));
}

/** Fixed paths only; reject links and special files before any content read or mutation. */
export async function safeParents(root: string, relative: string): Promise<void> {
  const parts = relative.split('/');
  for (let index = 1; index < parts.length; index += 1) {
    const path = join(root, ...parts.slice(0, index));
    try {
      const stat = await lstat(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new SetupError(`Unsafe setup directory: ${path}`);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}

export async function boundedFile(root: string, relative: string, maximum = 128 * 1024): Promise<string | null> {
  await safeParents(root, relative);
  let file;
  try { file = await open(join(root, relative), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new SetupError(`Cannot safely read ${relative}`);
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximum) throw new SetupError(`Unsafe or oversized setup input: ${relative}`);
    const buffer = Buffer.alloc(maximum + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maximum) throw new SetupError(`Oversized setup input: ${relative}`);
    return buffer.subarray(0, offset).toString('utf8');
  } finally { await file.close(); }
}

export async function readReceipt(root: string): Promise<SetupReceipt | undefined> {
  const text = await boundedFile(root, RECEIPT_PATH, 1024 * 1024);
  if (text === null) return undefined;
  let receipt: SetupReceipt;
  try { receipt = JSON.parse(text) as SetupReceipt; } catch { throw new SetupError('Invalid setup receipt; preserve it and reconcile before applying'); }
  if (receipt.schemaVersion !== 1 || receipt.plan?.schemaVersion !== 1 || receipt.plan.root !== root ||
    receipt.plan.diff?.path !== WORKFLOW_PATH || receipt.planDigest !== receipt.plan.digest ||
    planDigest(receipt.plan) !== receipt.planDigest || !Array.isArray(receipt.operations) ||
    receipt.operations.length > 10 || receipt.operations.length !== receipt.plan.operations?.length ||
    !receipt.installation || typeof receipt.installation.wholeWorkflowOwned !== 'boolean' ||
    !(receipt.installation.workflowSha256 === null || /^[a-f0-9]{64}$/u.test(receipt.installation.workflowSha256)) ||
    receipt.operations.some((entry, index) => entry.id !== receipt.plan.operations[index]?.id ||
      !['pending', 'intent', 'completed', 'outcome-unknown'].includes(entry.status))) {
    throw new SetupError('Unsupported or conflicting setup receipt; preserve it and reconcile before applying');
  }
  return receipt;
}

/** Atomic, owner-readable receipt replacement. No credential bytes are accepted here. */
export async function writeReceipt(root: string, receipt: SetupReceipt): Promise<void> {
  await safeParents(root, RECEIPT_PATH);
  await mkdir(join(root, '.sutura'), { recursive: true, mode: 0o700 });
  const existing = await boundedFile(root, RECEIPT_PATH, 1024 * 1024);
  if (existing !== null && !existing.trim()) throw new SetupError('Empty setup receipt cannot be overwritten');
  if (existing !== null && (JSON.parse(existing) as SetupReceipt).planDigest !== receipt.planDigest) {
    const archive = `.sutura/setup-receipts/${sha256(existing)}.json`;
    await safeParents(root, archive);
    await mkdir(join(root, '.sutura', 'setup-receipts'), { recursive: true, mode: 0o700 });
    const archived = await boundedFile(root, archive, 1024 * 1024);
    if (archived !== null && archived !== existing) throw new SetupError('Receipt archive identity conflict');
    if (archived === null) {
      const retained = await open(join(root, archive), 'wx', 0o600);
      try { await retained.writeFile(existing); await retained.sync(); } finally { await retained.close(); }
    }
  }
  const path = join(root, RECEIPT_PATH), temporary = `${path}.${randomUUID()}.tmp`;
  const content = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(content) > 1024 * 1024) throw new SetupError('Setup receipt exceeds its storage bound');
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(content);
    await file.sync();
  } finally { await file.close(); }
  await rename(temporary, path);
  const directory = await open(dirname(path), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

export async function replaceWorkflow(root: string, expected: string | null, content: string | null): Promise<void> {
  const current = await boundedFile(root, WORKFLOW_PATH);
  if ((current === null ? null : sha256(current)) !== expected) throw new SetupError('Workflow changed before its reviewed operation');
  const path = join(root, WORKFLOW_PATH);
  if (content === null) await unlink(path);
  else {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o644);
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    try {
      const latest = await boundedFile(root, WORKFLOW_PATH);
      if ((latest === null ? null : sha256(latest)) !== expected) throw new SetupError('Workflow changed before atomic replacement');
      await rename(temporary, path);
    } catch (error) { await unlink(temporary); throw error; }
  }
  const directory = await open(dirname(path), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

export async function acquireSetupLock(root: string): Promise<() => Promise<void>> {
  await safeParents(root, RECEIPT_PATH);
  await mkdir(join(root, '.sutura'), { recursive: true, mode: 0o700 });
  const path = join(root, '.sutura', 'setup.lock'), guard = `${path}.recovery`;
  const busy = () => new SetupError('Setup lock ownership is live, unknown or requires recovery reconciliation');
  type Owner = { root: string; pid: number; hostname: string; token: string };
  const owner = async (): Promise<Owner | undefined> => {
    try { return JSON.parse(await boundedFile(root, '.sutura/setup.lock', 4096) ?? '') as Owner; }
    catch { return undefined; }
  };
  const dead = (value: Owner | undefined): value is Owner => {
    if (!value || value.root !== root || value.hostname !== hostname() || !Number.isSafeInteger(value.pid) || value.pid <= 0 || typeof value.token !== 'string' || !value.token) return false;
    try { process.kill(value.pid, 0); return false; }
    catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
  };
  try { await lstat(guard); throw busy(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  let handle;
  try { handle = await open(path, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const previous = await owner();
    if (!dead(previous)) throw busy();
    try { await mkdir(guard, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw busy(); throw error; }
    try {
      const current = await owner();
      if (!dead(current) || current.token !== previous.token) throw busy();
      // Recovery is serialized; a second stale observer cannot remove the new owner.
      await unlink(path);
      handle = await open(path, 'wx', 0o600);
    } finally { await rmdir(guard); }
  }
  const value: Owner = { root, pid: process.pid, hostname: hostname(), token: randomUUID() };
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  finally { await handle.close(); }
  return async () => {
    const current = await owner();
    if (current?.token !== value.token || current.pid !== value.pid || current.hostname !== value.hostname || current.root !== root) throw busy();
    await unlink(path);
  };
}
