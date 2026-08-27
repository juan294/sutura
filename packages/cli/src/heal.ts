import { constants } from 'node:fs';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';

import {
  ContreeExecutor,
  DEFAULT_MODEL_PRICES,
  NebiusClient,
  TavilyClient,
  healCase,
  loadConfig,
  readRepairSourceContext,
  type CaseFile,
  type ConfigEnvironment,
  type CostLedger,
  type Diagnosis,
  type Executor,
  type HealLlm,
  type RepairSourceContext,
  type RepositorySourceExcerpt,
  type SourceReadLimits,
  type SourceReference,
  type TavilySearch,
} from '@sutura/core';

import type { HealArguments } from './args.js';

const NEBIUS_BASE_URL = 'https://api.tokenfactory.nebius.com/v1/';
const MAX_SOURCE_SCAN_BYTES = 1024 * 1024;

export interface HealRuntime {
  executor: Executor;
  llm: HealLlm;
  cost: CostLedger;
  triageN: number;
  raceK: number;
  tavily?: TavilySearch;
  imageRef?: string;
}

export class CliConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliConfigError';
  }
}

function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

function safeRelativePath(path: string): boolean {
  if (
    !path ||
    path.length > 240 ||
    path.includes('\\') ||
    path.startsWith('/') ||
    !/^[A-Za-z0-9_@./-]+$/u.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    return false;
  }
  const segments = path.split('/');
  if (segments.includes('.git') || segments.includes('node_modules')) return false;
  const name = segments.at(-1)?.toLowerCase() ?? '';
  return !(
    name === '.env' || name.startsWith('.env.') || name === '.npmrc' ||
    name === '.netrc' || name === '.pypirc' || name === 'credentials.json' ||
    name === 'id_rsa' || name === 'id_ed25519' || /\.(?:key|pem|p12|pfx)$/u.test(name)
  );
}

async function hasSymlinkComponent(root: string, path: string): Promise<boolean> {
  let current = root;
  for (const segment of path.split('/')) {
    current = resolve(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) return true;
    } catch {
      return true;
    }
  }
  return false;
}

async function readLineWindow(
  path: string,
  targetLine: number | undefined,
  limits: Readonly<SourceReadLimits>,
): Promise<{ startLine: number; content: string; truncated: boolean }> {
  const halfWindow = Math.floor(limits.maxLinesPerFile / 2);
  const startLine = targetLine === undefined ? 1 : Math.max(1, targetLine - halfWindow);
  const endLine = startLine + limits.maxLinesPerFile - 1;
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const chunks: Buffer[] = [];
  let keptBytes = 0;
  let scannedBytes = 0;
  let line = 1;
  let position = 0;
  let stoppedAtLimit = false;
  try {
    const buffer = Buffer.alloc(4_096);
    while (line <= endLine && scannedBytes < MAX_SOURCE_SCAN_BYTES) {
      const available = Math.min(buffer.length, MAX_SOURCE_SCAN_BYTES - scannedBytes);
      const { bytesRead } = await handle.read(buffer, 0, available, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      scannedBytes += bytesRead;
      let segmentStart = 0;
      for (let index = 0; index < bytesRead; index += 1) {
        if (buffer[index] !== 10) continue;
        if (line >= startLine && line <= endLine && keptBytes <= limits.maxBytesPerFile) {
          const segment = buffer.subarray(segmentStart, index + 1);
          const remaining = limits.maxBytesPerFile + 1 - keptBytes;
          if (remaining > 0) {
            const kept = segment.subarray(0, remaining);
            chunks.push(Buffer.from(kept));
            keptBytes += kept.length;
          }
        }
        line += 1;
        segmentStart = index + 1;
        if (line > endLine) break;
      }
      if (line >= startLine && line <= endLine && segmentStart < bytesRead && keptBytes <= limits.maxBytesPerFile) {
        const segment = buffer.subarray(segmentStart, bytesRead);
        const remaining = limits.maxBytesPerFile + 1 - keptBytes;
        if (remaining > 0) {
          const kept = segment.subarray(0, remaining);
          chunks.push(Buffer.from(kept));
          keptBytes += kept.length;
        }
      }
    }
    stoppedAtLimit = scannedBytes === MAX_SOURCE_SCAN_BYTES || line > endLine || keptBytes > limits.maxBytesPerFile;
  } finally {
    await handle.close();
  }
  if (line < startLine) throw new CliConfigError('Referenced source line exceeds the bounded scan limit');
  const decoded = Buffer.concat(chunks).subarray(0, limits.maxBytesPerFile).toString('utf8');
  const content = decoded
    .slice(0, limits.maxCharactersPerFile)
    .replace(/\r?\n$/u, '');
  return {
    startLine,
    content,
    truncated: stoppedAtLimit || decoded.length > limits.maxCharactersPerFile,
  };
}

async function readBoundedSource(
  root: string,
  reference: SourceReference,
  limits: Readonly<SourceReadLimits>,
): Promise<RepositorySourceExcerpt | null> {
  const { path } = reference;
  if (!safeRelativePath(path)) return null;
  if (await hasSymlinkComponent(root, path)) return null;
  const requested = resolve(root, path);
  let canonical: string;
  try {
    canonical = await realpath(requested);
  } catch {
    return null;
  }
  if (!isInside(root, canonical)) return null;

  try {
    return { path, ...(await readLineWindow(canonical, reference.line, limits)) };
  } catch {
    return null;
  }
}

export async function readLocalSourceContext(
  caseDir: string,
  log: string,
  _diagnosis: Diagnosis,
): Promise<RepairSourceContext> {
  const root = await realpath(caseDir);
  return readRepairSourceContext(
    {
      async readSourceExcerpts(
        checkoutDir: string,
        references: readonly SourceReference[],
        limits: Readonly<SourceReadLimits>,
      ): Promise<RepositorySourceExcerpt[]> {
        if (checkoutDir !== root) throw new CliConfigError('Source checkout changed during heal');
        const excerpts = await Promise.all(
          references.map((reference) => readBoundedSource(root, reference, limits)),
        );
        return excerpts.filter((source): source is RepositorySourceExcerpt => source !== null);
      },
    },
    root,
    log,
    _diagnosis,
  );
}

async function canonicalCaseDirectory(caseDir: string): Promise<string> {
  const canonical = await realpath(caseDir);
  const metadata = await stat(canonical);
  if (!metadata.isDirectory()) throw new CliConfigError('--case-dir must name a directory');
  return canonical;
}

export async function healWithRuntime(
  request: HealArguments,
  runtime: HealRuntime,
): Promise<CaseFile> {
  const caseDir = await canonicalCaseDirectory(request.caseDir);
  const caseName = basename(caseDir).replace(/[^A-Za-z0-9_.-]+/gu, '-') || 'case';
  return healCase({
    runId: `local-${caseName}`,
    repo: `local/${caseName}`,
    caseDir,
    executor: runtime.executor,
    llm: runtime.llm,
    cost: runtime.cost,
    triageN: runtime.triageN,
    raceK: runtime.raceK,
    readSourceContext: (log, diagnosis) => readLocalSourceContext(caseDir, log, diagnosis),
    ...(runtime.tavily ? { tavily: runtime.tavily } : {}),
    ...(runtime.imageRef ? { imageRef: runtime.imageRef } : {}),
    ...(request.candidateDiff === undefined ? {} : { candidateDiff: request.candidateDiff }),
  });
}

export function runtimeFromEnvironment(
  request: HealArguments,
  environment: ConfigEnvironment = process.env,
): HealRuntime {
  const config = loadConfig(environment);
  if (!config.contreeToken) throw new CliConfigError('CONTREE_TOKEN is required');
  if (!config.contreeProject) throw new CliConfigError('CONTREE_PROJECT is required');
  if (request.tavilyEnabled && !config.tavilyApiKey) {
    throw new CliConfigError('TAVILY_API_KEY is required unless --no-tavily is set');
  }
  const llm = new NebiusClient({
    apiKey: config.nebiusApiKey,
    baseUrl: NEBIUS_BASE_URL,
    models: config.models,
    prices: DEFAULT_MODEL_PRICES,
  });
  return {
    executor: new ContreeExecutor({
      token: config.contreeToken,
      project: config.contreeProject,
      maxOps: config.maxOps,
    }),
    llm,
    cost: llm.ledger,
    triageN: config.triageN,
    raceK: config.raceK,
    ...(request.tavilyEnabled ? { tavily: new TavilyClient(config.tavilyApiKey) } : {}),
  };
}

export async function healFromEnvironment(request: HealArguments): Promise<CaseFile> {
  return healWithRuntime(request, runtimeFromEnvironment(request));
}
