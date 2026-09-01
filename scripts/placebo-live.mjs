import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  canonicalJson, contentHash, exactSha, publicGitHubUrl, SHA256_PATTERN,
} from './evidence-contract.mjs';
import { RELEASE_VERSION } from './install-test-lib.mjs';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const CORPUS_PATH = resolve(ROOT, 'docs/demo/placebo-v0.2-corpus.json');
const LEDGER_PATH = resolve(ROOT, '.sutura/placebo-v0.2.1-live-ledger.json');
const LOCK_PATH = resolve(ROOT, '.sutura/placebo-v0.2.1-live.lock');
const ARTIFACT_ROOT = resolve(ROOT, '.sutura/placebo-v0.2.1-live-artifacts');
const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const OUTCOMES = new Set(['fixed', 'flaky-no-patch', 'refused', 'gave-up', 'infra-stop']);
const KIND_ORDER = new Map([['flaky', 0], ['trap', 1], ['upstream', 2], ['repairable', 3]]);
const CORPUS_HASH = '77594bc260dbf4918548bda43d24238bfe43da3f428e2fde4da0a3e029571d24';

function boundedUsd(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be a bounded nonnegative USD amount`);
  }
  return value;
}

function exactSha256(value, label) {
  if (!SHA256_PATTERN.test(value ?? '')) throw new Error(`${label} must be an exact SHA-256 digest`);
  return value;
}

function runId(value, label = 'GitHub run') {
  const text = String(value ?? '');
  if (!/^[1-9]\d{0,19}$/u.test(text)) throw new Error(`${label} must be a workflow run id`);
  return text;
}

function artifactName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw new Error('Placebo artifact name is invalid');
  }
  return value;
}

function loadCorpusSync() {
  const value = JSON.parse(Buffer.from(requireCorpusBytes()).toString('utf8'));
  return validateCorpus(value);
}

let corpusBytes;
function requireCorpusBytes() {
  corpusBytes ??= readFileSync(CORPUS_PATH);
  return corpusBytes;
}

function validateCorpus(value) {
  if (value?.schemaVersion !== 'placebo-corpus-manifest-v1' || value.corpusVersion !== '0.2' ||
      !Array.isArray(value.cases) || value.cases.length !== 51 ||
      value.corpusHash !== CORPUS_HASH ||
      new Set(value.cases.map(({ id }) => id)).size !== 51) {
    throw new Error('Placebo canonical corpus must contain 51 unique cases');
  }
  return value;
}

function corpusCase(corpus, caseId) {
  const matches = corpus.cases.filter(({ id }) => id === caseId);
  if (matches.length !== 1) throw new Error(`Placebo case is not one canonical case: ${caseId}`);
  return matches[0];
}

function normalizeResult(value, expectedCase) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      value.caseId !== expectedCase.id || value.kind !== expectedCase.metadata.kind ||
      value.language !== expectedCase.metadata.language || typeof value.tavilyEnabled !== 'boolean' ||
      typeof value.elapsedTimeMs !== 'number' || !Number.isFinite(value.elapsedTimeMs) || value.elapsedTimeMs < 0) {
    throw new Error(`Placebo result differs from canonical case ${expectedCase.id}`);
  }
  const caseFile = value.caseFile;
  if (caseFile === null || typeof caseFile !== 'object' || Array.isArray(caseFile) ||
      !OUTCOMES.has(caseFile.outcome) || !Array.isArray(caseFile.cost?.entries) ||
      !Array.isArray(caseFile.stages) || caseFile.stages.length > 128 ||
      !Array.isArray(caseFile.trace) || caseFile.trace.length > 10_000) {
    throw new Error(`Placebo result contract is invalid for ${expectedCase.id}`);
  }
  for (const entry of caseFile.cost.entries) boundedUsd(entry?.usd, 'Placebo inference cost');
  for (const stage of caseFile.stages) {
    if (stage?.operationId !== undefined &&
        (typeof stage.operationId !== 'string' || stage.operationId.length === 0 || stage.operationId.length > 240)) {
      throw new Error(`Placebo operation ID is invalid for ${expectedCase.id}`);
    }
    if (stage?.metrics?.cost !== undefined) boundedUsd(stage.metrics.cost, 'Placebo sandbox cost');
  }
  return value;
}

function validateResultSet(results, expectedCase) {
  if (!Array.isArray(results)) throw new Error('Placebo case results must be an array');
  const normalized = results.map((result) => normalizeResult(result, expectedCase));
  if (expectedCase.metadata.kind === 'upstream') {
    if (normalized.length !== 2 || normalized[0].tavilyEnabled !== true ||
        normalized[1].tavilyEnabled !== false) {
      throw new Error(`Upstream case ${expectedCase.id} requires its exact Tavily pair`);
    }
  } else if (normalized.length !== 1) {
    throw new Error(`Placebo case ${expectedCase.id} requires one evaluation`);
  }
  return normalized;
}

function artifactBase(input, options = {}) {
  const corpus = validateCorpus(options.corpus ?? loadCorpusSync());
  const expectedCase = corpusCase(corpus, input.caseId);
  const results = validateResultSet(input.results, expectedCase);
  const controllerSha = exactSha(input.controllerSha, 'Placebo controller');
  const subjectSha = exactSha(input.subjectSha, 'Placebo subject');
  if (input.subjectVersion !== RELEASE_VERSION) {
    throw new Error('Placebo subject identity is invalid');
  }
  if (!SHA256_PATTERN.test(input.packageContentHash ?? '') ||
      !SHA256_PATTERN.test(input.packageIntegrity ?? '') ||
      !SHA256_PATTERN.test(input.evaluationManifestHash ?? '')) {
    throw new Error('Placebo package or evaluation identity is invalid');
  }
  const inferenceUsd = results.reduce((total, result) => total +
    result.caseFile.cost.entries.reduce((subtotal, entry) => subtotal + entry.usd, 0), 0);
  const sandboxUsd = results.reduce((total, result) => total +
    result.caseFile.stages.reduce((subtotal, stage) => subtotal + (stage.metrics?.cost ?? 0), 0), 0);
  return {
    schemaVersion: 'sutura-placebo-live-case-v1',
    controllerSha,
    githubRunId: runId(input.githubRunId),
    subjectVersion: RELEASE_VERSION,
    subjectSha,
    packageContentHash: input.packageContentHash,
    packageIntegrity: input.packageIntegrity,
    corpusVersion: corpus.corpusVersion,
    corpusHash: corpus.corpusHash,
    caseId: expectedCase.id,
    caseContentHash: expectedCase.contentHash,
    kind: expectedCase.metadata.kind,
    results,
    evaluationManifestHash: input.evaluationManifestHash,
    inferenceUsd,
    sandboxUsd,
    totalUsd: inferenceUsd + sandboxUsd,
    evaluationCount: results.length,
    artifactName: artifactName(input.artifactName),
  };
}

export function createPlaceboCaseArtifact(input, options = {}) {
  const expectedEvaluationCaseIds = (input.results ?? []).map((result) =>
    `${input.caseId}:${result.tavilyEnabled ? 'with-tavily' : 'without-tavily'}`).sort();
  const actualEvaluationCaseIds = Array.isArray(input.evaluationManifest?.cases)
    ? input.evaluationManifest.cases.map(({ caseId }) => caseId).sort() : [];
  if (input.evaluationManifest === null || typeof input.evaluationManifest !== 'object' ||
      Array.isArray(input.evaluationManifest) ||
      input.evaluationManifest.schemaVersion !== 'sutura-evaluation-v1' ||
      input.evaluationManifest.suturaCommit !== input.controllerSha ||
      input.evaluationManifest.corpusHash !== (options.corpus ?? loadCorpusSync()).corpusHash ||
      !Array.isArray(input.evaluationManifest.cases) ||
      input.evaluationManifest.cases.length !== input.results?.length ||
      JSON.stringify(actualEvaluationCaseIds) !== JSON.stringify(expectedEvaluationCaseIds)) {
    throw new Error('Placebo evaluation manifest identity is invalid');
  }
  const evaluationManifestHash = contentHash(input.evaluationManifest);
  const base = artifactBase({ ...input, evaluationManifestHash }, options);
  const artifact = { ...base, resultHash: contentHash(base) };
  if (Buffer.byteLength(canonicalJson(artifact)) > MAX_ARTIFACT_BYTES) {
    throw new Error(`Placebo case artifact exceeds ${MAX_ARTIFACT_BYTES} bytes`);
  }
  return artifact;
}

export function assertPublicArtifactSafe(value, secrets = []) {
  const serialized = canonicalJson(value);
  const forbidden = /(?:\/Users\/|[A-Z]:\\Users\\|Authorization:\s*(?:Bearer|Basic)|github_pat_|ghp_|sk-[A-Za-z0-9]{20,})/u;
  if (forbidden.test(serialized) || secrets.some((secret) =>
    typeof secret === 'string' && secret.length > 0 && serialized.includes(secret))) {
    throw new Error('Placebo public artifact contains a credential or private local path');
  }
  return value;
}

export function validatePlaceboCaseArtifact(value, options = {}) {
  if (value?.schemaVersion !== 'sutura-placebo-live-case-v1') {
    throw new Error('Placebo case artifact schema is invalid');
  }
  const base = artifactBase(value, options);
  if (value.resultHash !== contentHash(base)) throw new Error('Placebo case artifact resultHash is invalid');
  const artifact = { ...base, resultHash: value.resultHash };
  if (Buffer.byteLength(canonicalJson(artifact)) > MAX_ARTIFACT_BYTES) {
    throw new Error(`Placebo case artifact exceeds ${MAX_ARTIFACT_BYTES} bytes`);
  }
  return assertPublicArtifactSafe(artifact);
}

export function createPlaceboLedger(entries) {
  return {
    schemaVersion: 'sutura-placebo-live-ledger-v1',
    entries,
    resultHash: contentHash(entries),
  };
}

export function validatePlaceboLedger(value) {
  if (value?.schemaVersion !== 'sutura-placebo-live-ledger-v1' || !Array.isArray(value.entries) ||
      value.entries.length > 51 || value.resultHash !== contentHash(value.entries)) {
    throw new Error('Placebo live ledger schema or resultHash is invalid');
  }
  const caseIds = new Set();
  const runIds = new Set();
  const entries = value.entries.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry) ||
        typeof entry.caseId !== 'string' || caseIds.has(entry.caseId) ||
        runIds.has(entry.runId) || !SHA256_PATTERN.test(entry.artifactSha256 ?? '') ||
        !SHA256_PATTERN.test(entry.resultHash ?? '') || !Array.isArray(entry.outcomes) ||
        !entry.outcomes.every((outcome) => OUTCOMES.has(outcome)) ||
        !Number.isSafeInteger(entry.evaluationCount) || ![1, 2].includes(entry.evaluationCount) ||
        entry.outcomes.length !== entry.evaluationCount) {
      throw new Error(`Placebo live ledger entry ${index + 1} is invalid or duplicate`);
    }
    caseIds.add(entry.caseId);
    runIds.add(entry.runId);
    const normalizedRunId = runId(entry.runId);
    const url = new URL(publicGitHubUrl(entry.runUrl, 'Placebo workflow run'));
    if (url.pathname !== `/juan294/sutura/actions/runs/${normalizedRunId}` || url.search || url.hash) {
      throw new Error(`Placebo live ledger entry ${index + 1} run URL is invalid`);
    }
    const recorded = new Date(entry.recordedAt);
    if (Number.isNaN(recorded.valueOf()) || recorded.toISOString() !== entry.recordedAt) {
      throw new Error(`Placebo live ledger entry ${index + 1} timestamp is invalid`);
    }
    boundedUsd(entry.inferenceUsd, 'Placebo ledger inference cost');
    boundedUsd(entry.sandboxUsd, 'Placebo ledger sandbox cost');
    boundedUsd(entry.totalUsd, 'Placebo ledger total cost');
    if (Math.abs(entry.inferenceUsd + entry.sandboxUsd - entry.totalUsd) > 1e-9) {
      throw new Error(`Placebo live ledger entry ${index + 1} cost is inconsistent`);
    }
    return {
      caseId: entry.caseId,
      runId: normalizedRunId,
      runUrl: url.toString(),
      artifactName: artifactName(entry.artifactName),
      artifactSha256: entry.artifactSha256,
      controllerSha: exactSha(entry.controllerSha, 'Placebo ledger controller'),
      subjectSha: exactSha(entry.subjectSha, 'Placebo ledger subject'),
      packageContentHash: exactSha256(entry.packageContentHash, 'Placebo package content hash'),
      packageIntegrity: exactSha256(entry.packageIntegrity, 'Placebo package integrity'),
      resultHash: entry.resultHash,
      outcomes: [...entry.outcomes],
      evaluationCount: entry.evaluationCount,
      inferenceUsd: entry.inferenceUsd,
      sandboxUsd: entry.sandboxUsd,
      totalUsd: entry.totalUsd,
      recordedAt: entry.recordedAt,
    };
  });
  return createPlaceboLedger(entries);
}

export function appendPlaceboLedger(ledgerInput, artifactInput, metadata, options = {}) {
  const ledger = validatePlaceboLedger(ledgerInput);
  const artifact = validatePlaceboCaseArtifact(artifactInput, options);
  if (ledger.entries.some(({ caseId, runId }) =>
    caseId === artifact.caseId || runId === artifact.githubRunId)) {
    throw new Error('Placebo ledger cannot append a duplicate case or workflow run');
  }
  const bytes = metadata.artifactBytes;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_ARTIFACT_BYTES) {
    throw new Error('Placebo downloaded artifact is invalid or too large');
  }
  const entry = {
    caseId: artifact.caseId,
    runId: artifact.githubRunId,
    runUrl: metadata.runUrl,
    artifactName: artifact.artifactName,
    artifactSha256: createHash('sha256').update(bytes).digest('hex'),
    controllerSha: artifact.controllerSha,
    subjectSha: artifact.subjectSha,
    packageContentHash: artifact.packageContentHash,
    packageIntegrity: artifact.packageIntegrity,
    resultHash: artifact.resultHash,
    outcomes: artifact.results.map(({ caseFile }) => caseFile.outcome),
    evaluationCount: artifact.evaluationCount,
    inferenceUsd: artifact.inferenceUsd,
    sandboxUsd: artifact.sandboxUsd,
    totalUsd: artifact.totalUsd,
    recordedAt: metadata.recordedAt,
  };
  return validatePlaceboLedger(createPlaceboLedger([...ledger.entries, entry]));
}

export function placeboSpendDecision({ spentUsd, observedMaximumUsd, initialReserveUsd, capUsd }) {
  for (const [value, label] of [
    [spentUsd, 'Placebo spent'], [observedMaximumUsd, 'Placebo observed maximum'],
    [initialReserveUsd, 'Placebo initial reserve'], [capUsd, 'Placebo cap'],
  ]) boundedUsd(value, label);
  const reserveUsd = Math.max(initialReserveUsd, observedMaximumUsd);
  const mayDispatch = Math.round((spentUsd + reserveUsd) * 1_000_000) <=
    Math.round(capUsd * 1_000_000);
  return { reserveUsd, mayDispatch };
}

export function orderedPlaceboCaseIds(corpusInput = loadCorpusSync()) {
  const corpus = validateCorpus(corpusInput);
  return [...corpus.cases].sort((left, right) =>
    (KIND_ORDER.get(left.metadata.kind) ?? 99) - (KIND_ORDER.get(right.metadata.kind) ?? 99) ||
    left.id.localeCompare(right.id)).map(({ id }) => id);
}

function hasFalseApproval(artifact) {
  return artifact.kind === 'trap' && artifact.results.some(({ caseFile }) =>
    caseFile.audit?.approved === true);
}

export async function runPlaceboStreak(options, dependencies) {
  if (options.authorize !== true) throw new Error('Placebo live streak requires literal --authorize');
  exactSha(options.controllerSha, 'Placebo controller');
  exactSha(options.subjectSha, 'Placebo subject');
  const capUsd = boundedUsd(options.capUsd, 'Placebo cap');
  const initialReserveUsd = boundedUsd(options.initialReserveUsd, 'Placebo initial reserve');
  if (initialReserveUsd <= 0) throw new Error('Placebo initial reserve must be greater than zero');
  let ledger = validatePlaceboLedger(await dependencies.readLedger());
  if (ledger.entries.some((entry) => entry.controllerSha !== options.controllerSha ||
      entry.subjectSha !== options.subjectSha)) {
    throw new Error('Placebo ledger identity differs from requested identity');
  }
  const caseIds = options.caseIds ?? orderedPlaceboCaseIds();
  let spentUsd = ledger.entries.reduce((sum, entry) => sum + entry.totalUsd, 0);
  let observedMaximumUsd = ledger.entries.reduce((maximum, entry) => Math.max(maximum, entry.totalUsd), 0);
  let stoppedFor = 'complete';
  for (const caseId of caseIds) {
    if (ledger.entries.some((entry) => entry.caseId === caseId)) continue;
    const decision = placeboSpendDecision({ spentUsd, observedMaximumUsd, initialReserveUsd, capUsd });
    if (!decision.mayDispatch) { stoppedFor = 'cap-reserve'; break; }
    const completed = await dependencies.runCase(caseId);
    ledger = validatePlaceboLedger(completed.ledger);
    const artifact = validatePlaceboCaseArtifact(completed.artifact, dependencies);
    spentUsd += artifact.totalUsd;
    observedMaximumUsd = Math.max(observedMaximumUsd, artifact.totalUsd);
    if (hasFalseApproval(artifact)) { stoppedFor = 'false-approval'; break; }
  }
  return {
    ledger, spentUsd, reserveUsd: Math.max(initialReserveUsd, observedMaximumUsd), stoppedFor,
  };
}

export async function finalizePlaceboEvidence(ledgerInput, artifactInputs, options = {}) {
  const corpus = validateCorpus(options.corpus ?? loadCorpusSync());
  const ledger = validatePlaceboLedger(ledgerInput);
  const artifacts = artifactInputs.map((value) => validatePlaceboCaseArtifact(value, { corpus }));
  const expectedIds = orderedPlaceboCaseIds(corpus);
  if (ledger.entries.length !== 51 || artifacts.length !== 51 ||
      new Set(ledger.entries.map(({ caseId }) => caseId)).size !== 51 ||
      expectedIds.some((id) => !ledger.entries.some((entry) => entry.caseId === id)) ||
      expectedIds.some((id) => !artifacts.some((artifact) => artifact.caseId === id))) {
    throw new Error('Placebo finalization requires all 51 canonical cases');
  }
  if (new Set(ledger.entries.map(({ controllerSha }) => controllerSha)).size !== 1 ||
      new Set(ledger.entries.map(({ subjectSha }) => subjectSha)).size !== 1 ||
      new Set(ledger.entries.map(({ packageContentHash }) => packageContentHash)).size !== 1 ||
      new Set(ledger.entries.map(({ packageIntegrity }) => packageIntegrity)).size !== 1) {
    throw new Error('Placebo finalization requires one exact controller and subject identity');
  }
  for (const entry of ledger.entries) {
    const artifact = artifacts.find(({ caseId }) => caseId === entry.caseId);
    if (!artifact || artifact.resultHash !== entry.resultHash ||
        artifact.githubRunId !== entry.runId || artifact.controllerSha !== entry.controllerSha ||
        artifact.subjectSha !== entry.subjectSha) {
      throw new Error(`Placebo finalization identity mismatch for ${entry.caseId}`);
    }
  }
  const results = expectedIds.flatMap((id) =>
    artifacts.find((artifact) => artifact.caseId === id).results);
  if (results.length !== 55) throw new Error('Placebo finalization requires 55 evaluations');
  const scoreResults = options.scoreResults ?? await import('../packages/placebo/dist/score.js')
    .then(({ score }) => score);
  const base = {
    schemaVersion: 'sutura-placebo-live-result-v1',
    controllerSha: ledger.entries[0].controllerSha,
    subjectSha: ledger.entries[0].subjectSha,
    subjectVersion: RELEASE_VERSION,
    corpusHash: corpus.corpusHash,
    caseCount: 51,
    evaluationCount: 55,
    inferenceUsd: ledger.entries.reduce((sum, entry) => sum + entry.inferenceUsd, 0),
    sandboxUsd: ledger.entries.reduce((sum, entry) => sum + entry.sandboxUsd, 0),
    totalUsd: ledger.entries.reduce((sum, entry) => sum + entry.totalUsd, 0),
    results,
    score: scoreResults(results),
    ledgerHash: ledger.resultHash,
  };
  return { ...base, resultHash: contentHash(base) };
}

async function command(commandName, args, options = {}) {
  const result = await execFileAsync(commandName, args, {
    cwd: options.cwd ?? ROOT,
    encoding: options.binary ? null : 'utf8',
    maxBuffer: options.maxBuffer ?? 20 * 1024 * 1024,
    timeout: options.timeout ?? 120_000,
  });
  return options.binary ? result.stdout : result.stdout.trim();
}

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function withLock(operation) {
  await mkdir(dirname(LOCK_PATH), { recursive: true, mode: 0o700 });
  let lock;
  try { lock = await open(LOCK_PATH, 'wx', 0o600); }
  catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`Placebo live lock is held: ${basename(LOCK_PATH)}`);
    throw error;
  }
  try { return await operation(); }
  finally { try { await lock.close(); } finally { await rm(LOCK_PATH, { force: true }); } }
}

async function readLedgerDefault() {
  if (!await exists(LEDGER_PATH)) return createPlaceboLedger([]);
  const bytes = await readFile(LEDGER_PATH);
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) throw new Error('Placebo ledger is too large');
  return validatePlaceboLedger(JSON.parse(bytes.toString('utf8')));
}

async function ghApi(endpoint, binary = false) {
  return command('gh', ['api', '-X', 'GET', endpoint], { binary, maxBuffer: MAX_ARTIFACT_BYTES });
}

export async function gatePlaceboLive(controllerSha, subjectSha) {
  const controller = exactSha(controllerSha, 'Placebo controller');
  const subject = exactSha(subjectSha, 'Placebo subject');
  if (subject !== controller) throw new Error('Placebo candidate controller and subject must be the same exact commit');
  const { gateDogfood } = await import('./dogfood.mjs');
  await gateDogfood(controller);
  const corpus = validateCorpus(JSON.parse(await readFile(CORPUS_PATH, 'utf8')));
  return {
    controllerSha: controller,
    subjectSha: subject,
    corpusHash: corpus.corpusHash,
  };
}

async function pollRun(controllerId, caseId, controllerSha) {
  const deadline = Date.now() + 35 * 60_000;
  const expectedTitle = `Placebo live ${controllerId} ${caseId}`;
  while (Date.now() <= deadline) {
    const runs = JSON.parse(await command('gh', [
      'run', 'list', '--workflow', 'placebo-live-case.yml', '--limit', '100',
      '--json', 'databaseId,displayTitle,status,conclusion,url,headSha',
    ]));
    const matches = runs.filter((run) => run?.displayTitle === expectedTitle);
    if (matches.length > 1) throw new Error(`Multiple Placebo runs match ${controllerId}`);
    const current = matches[0];
    if (current?.status === 'completed') {
      if (current.headSha !== controllerSha) throw new Error('Placebo run controller SHA differs from dispatch');
      if (current.conclusion !== 'success') throw new Error(`Placebo run ${current.databaseId} failed`);
      return current;
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 10_000));
  }
  throw new Error(`Timed out waiting for Placebo case ${caseId}`);
}

async function findArtifactJson(directory) {
  const files = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const next = join(path, entry.name);
      if (entry.isDirectory()) await visit(next);
      else if (entry.isFile() && entry.name.endsWith('.json')) files.push(next);
    }
  }
  await visit(directory);
  if (files.length !== 1) throw new Error(`Placebo download must contain one JSON file, found ${files.length}`);
  return files[0];
}

async function runRemoteCase({ controllerSha, subjectSha, caseId, skipGate = false }) {
  if (!skipGate) await gatePlaceboLive(controllerSha, subjectSha);
  const corpus = loadCorpusSync();
  corpusCase(corpus, caseId);
  const controllerId = `pl-${Date.now()}-${randomUUID().slice(0, 8)}`;
  await command('gh', [
    'workflow', 'run', 'placebo-live-case.yml', '--ref', 'develop',
    '-f', `controller-sha=${controllerSha}`, '-f', `subject-sha=${subjectSha}`,
    '-f', `case-id=${caseId}`, '-f', `controller-id=${controllerId}`,
  ]);
  const run = await pollRun(controllerId, caseId, controllerSha);
  const expectedArtifactName = `sutura-placebo-${controllerId}-${caseId}`;
  const directory = await mkdtemp(join(tmpdir(), 'sutura-placebo-live-'));
  try {
    await command('gh', [
      'run', 'download', String(run.databaseId), '--name', expectedArtifactName, '--dir', directory,
    ], { timeout: 120_000 });
    const path = await findArtifactJson(directory);
    const bytes = await readFile(path);
    const artifact = validatePlaceboCaseArtifact(JSON.parse(bytes.toString('utf8')), { corpus });
    assertPublicArtifactSafe(artifact, [
      process.env.NEBIUS_API_KEY,
      process.env.TAVILY_API_KEY,
      process.env.CONTREE_TOKEN,
    ]);
    if (artifact.controllerSha !== controllerSha || artifact.subjectSha !== subjectSha ||
        artifact.githubRunId !== String(run.databaseId) || artifact.caseId !== caseId ||
        artifact.artifactName !== expectedArtifactName) {
      throw new Error('Placebo downloaded artifact identity differs from dispatch');
    }
    const ledger = appendPlaceboLedger(await readLedgerDefault(), artifact, {
      artifactBytes: bytes, runUrl: run.url, recordedAt: new Date().toISOString(),
    }, { corpus });
    await atomicWrite(LEDGER_PATH, `${canonicalJson(ledger)}\n`);
    await mkdir(ARTIFACT_ROOT, { recursive: true, mode: 0o700 });
    await atomicWrite(join(ARTIFACT_ROOT, `${caseId}.json`), `${canonicalJson(artifact)}\n`);
    return { artifact, ledger };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  const value = index < 0 ? undefined : args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

async function artifactCommand(args) {
  const report = JSON.parse(await readFile(valueAfter(args, '--report'), 'utf8'));
  const evaluationManifest = JSON.parse(await readFile(valueAfter(args, '--manifest'), 'utf8'));
  const installEvidence = JSON.parse(await readFile(valueAfter(args, '--install-evidence'), 'utf8'));
  const controllerId = valueAfter(args, '--controller-id');
  const caseId = valueAfter(args, '--case');
  const subjectSha = valueAfter(args, '--subject-sha');
  if (installEvidence?.schemaVersion !== 'sutura-install-evidence-v1' ||
      installEvidence.mode !== 'candidate' || installEvidence.packageVersion !== RELEASE_VERSION ||
      installEvidence.actionCommit !== subjectSha || installEvidence.outcome !== 'passed' ||
      !SHA256_PATTERN.test(installEvidence.packageContentHash ?? '') ||
      !SHA256_PATTERN.test(installEvidence.packageIntegrity ?? '')) {
    throw new Error('Placebo candidate install evidence is invalid');
  }
  const artifact = createPlaceboCaseArtifact({
    controllerSha: valueAfter(args, '--controller-sha'),
    githubRunId: valueAfter(args, '--run-id'),
    subjectVersion: RELEASE_VERSION,
    subjectSha,
    packageContentHash: installEvidence.packageContentHash,
    packageIntegrity: installEvidence.packageIntegrity,
    caseId,
    results: report.results,
    evaluationManifest,
    artifactName: `sutura-placebo-${controllerId}-${caseId}`,
  });
  assertPublicArtifactSafe(artifact, [
    process.env.NEBIUS_API_KEY,
    process.env.TAVILY_API_KEY,
    process.env.CONTREE_TOKEN,
  ]);
  await writeFile(valueAfter(args, '--output'), `${canonicalJson(artifact)}\n`, { encoding: 'utf8', flag: 'wx' });
  return artifact;
}

export async function main(args = process.argv.slice(2)) {
  const commandName = args[0];
  if (commandName === 'artifact') return artifactCommand(args);
  const controllerSha = valueAfter(args, '--controller-sha');
  const subjectSha = valueAfter(args, '--subject-sha');
  if (commandName === 'gate') return gatePlaceboLive(controllerSha, subjectSha);
  if (commandName === 'run') {
    if (!args.includes('--authorize')) throw new Error('Placebo live run requires literal --authorize');
    return withLock(() => runRemoteCase({
      controllerSha, subjectSha, caseId: valueAfter(args, '--case'),
    }));
  }
  if (commandName === 'streak') {
    return withLock(async () => {
      await gatePlaceboLive(controllerSha, subjectSha);
      return runPlaceboStreak({
        controllerSha, subjectSha, authorize: args.includes('--authorize'),
        capUsd: Number(valueAfter(args, '--cap-usd')),
        initialReserveUsd: Number(valueAfter(args, '--initial-reserve-usd')),
      }, {
        readLedger: readLedgerDefault,
        runCase: (caseId) => runRemoteCase({ controllerSha, subjectSha, caseId, skipGate: true }),
      });
    });
  }
  if (commandName === 'finalize') {
    const outputDirectory = valueAfter(args, '--output-dir');
    await mkdir(outputDirectory, { recursive: false });
    const artifactFiles = (await readdir(ARTIFACT_ROOT)).filter((name) => name.endsWith('.json')).sort();
    const artifacts = await Promise.all(artifactFiles.map(async (name) =>
      JSON.parse(await readFile(join(ARTIFACT_ROOT, name), 'utf8'))));
    const finalized = await finalizePlaceboEvidence(await readLedgerDefault(), artifacts);
    await writeFile(join(outputDirectory, 'placebo-v0.2.1-live.json'), `${canonicalJson(finalized)}\n`, {
      encoding: 'utf8', flag: 'wx',
    });
    return finalized;
  }
  throw new Error('Usage: placebo-live.mjs gate|run|streak|finalize with exact controller and subject SHAs');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
