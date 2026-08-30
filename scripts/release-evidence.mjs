import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  canonicalJson,
  contentHash,
  exactSha,
  publicGitHubUrl,
  SHA256_PATTERN,
} from './evidence-contract.mjs';
import { validateDogfoodLedger } from './dogfood.mjs';

export const RELEASE_EVIDENCE_IDS = Object.freeze([
  'benchmark', 'candidate-matrix', 'demo', 'devpost', 'dogfood', 'feedback',
  'github-release', 'local-gate', 'marketplace', 'npm', 'public-matrix',
]);
const STATUSES = new Set(['passed', 'failed', 'skipped', 'pending']);

function githubApiDefault(endpoint, binary = false) {
  return execFileSync('gh', ['api', '-X', 'GET', endpoint], {
    encoding: binary ? null : 'utf8',
    maxBuffer: binary ? 10 * 1024 * 1024 : 1024 * 1024,
    timeout: 60_000,
  });
}

export function createGitHubEvidenceVerifier(githubApi = githubApiDefault) {
  const cache = new Map();
  return ({ runId, artifactName }) => {
    const cacheKey = `${runId}\0${artifactName}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    const run = JSON.parse(githubApi(`repos/juan294/sutura/actions/runs/${runId}`, false));
    if (run === null || typeof run !== 'object' || typeof run.head_sha !== 'string') {
      throw new Error(`GitHub run ${runId} returned invalid metadata`);
    }
    const listing = JSON.parse(githubApi(
      `repos/juan294/sutura/actions/runs/${runId}/artifacts?per_page=100`, false,
    ));
    if (!Number.isSafeInteger(listing?.total_count) || listing.total_count < 0 ||
        listing.total_count > 100 || !Array.isArray(listing.artifacts)) {
      throw new Error(`GitHub run ${runId} returned invalid or unbounded artifact metadata`);
    }
    const matches = listing.artifacts.filter((artifact) =>
      artifact?.name === artifactName && artifact.expired === false && Number.isSafeInteger(artifact.id));
    if (matches.length !== 1) throw new Error(`GitHub run ${runId} did not contain one live ${artifactName} artifact`);
    const archive = githubApi(
      `repos/juan294/sutura/actions/artifacts/${matches[0].id}/zip`, true,
    );
    if (!(archive instanceof Uint8Array) || archive.byteLength > 10 * 1024 * 1024) {
      throw new Error(`GitHub run ${runId} artifact archive is invalid or too large`);
    }
    const verified = { headSha: run.head_sha, artifactName, artifactBytes: archive };
    cache.set(cacheKey, verified);
    return verified;
  };
}

function evidenceReference(value, checkId, releaseCommit, options) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${checkId} has an invalid evidence reference`);
  }
  const { reference, contentHash: recordHash, candidate, runId, artifactName } = value;
  if (typeof reference !== 'string' || reference.length === 0 || reference.length > 500 ||
      /placeholder|todo|tbd/iu.test(reference)) {
    throw new Error(`${checkId} has an invalid evidence reference`);
  }
  if (!SHA256_PATTERN.test(recordHash ?? '')) throw new Error(`${checkId} evidence content hash is invalid`);
  if (candidate !== releaseCommit) throw new Error(`${checkId} evidence candidate differs from release candidate`);
  if (reference.startsWith('https://')) {
    const url = new URL(publicGitHubUrl(reference, `${checkId} evidence`));
    if (typeof runId !== 'string' || !/^[1-9]\d{0,19}$/u.test(runId) ||
        url.pathname !== `/juan294/sutura/actions/runs/${runId}` || url.search || url.hash) {
      throw new Error(`${checkId} evidence must identify one public Sutura workflow run`);
    }
    if (typeof artifactName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(artifactName)) {
      throw new Error(`${checkId} evidence must identify one bounded run artifact`);
    }
    if (typeof options.verifyRemoteEvidence !== 'function') {
      throw new Error(`${checkId} remote evidence requires a read-only verifier`);
    }
    const verified = options.verifyRemoteEvidence({ runId, artifactName });
    if (verified?.headSha !== releaseCommit) {
      throw new Error(`${checkId} run candidate differs from release candidate`);
    }
    if (verified.artifactName !== artifactName ||
        !(verified.artifactBytes instanceof Uint8Array) ||
        verified.artifactBytes.byteLength > 10 * 1024 * 1024) {
      throw new Error(`${checkId} run artifact verification is invalid`);
    }
    const actualHash = createHash('sha256').update(verified.artifactBytes).digest('hex');
    if (actualHash !== recordHash) throw new Error(`${checkId} evidence content hash differs from the run artifact`);
  } else {
    if (!/^docs\/(?:demo|feedback)\/[A-Za-z0-9._/-]+$/u.test(reference) || reference.includes('..')) {
      throw new Error(`${checkId} evidence must be a public docs path or GitHub URL`);
    }
    let bytes;
    try {
      bytes = readFileSync(resolve(reference));
    } catch {
      throw new Error(`${checkId} evidence path does not exist`);
    }
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== recordHash) throw new Error(`${checkId} evidence content hash differs from the file`);
  }
  return {
    reference,
    contentHash: recordHash,
    candidate,
    ...(runId === undefined ? {} : { runId }),
    ...(artifactName === undefined ? {} : { artifactName }),
  };
}

export function analyzeReleaseEvidence(input, options = {}) {
  const releaseCommit = exactSha(input.releaseCommit, 'Release evidence commit');
  if (!Array.isArray(input.checks) || input.checks.length === 0) {
    throw new Error('Release evidence requires at least one check');
  }
  const passedCount = input.checks.filter(({ status }) => status === 'passed').length;
  if (passedCount === 0) throw new Error('Release evidence requires at least one passed check');
  const ids = input.checks.map(({ id }) => id);
  if (new Set(ids).size !== RELEASE_EVIDENCE_IDS.length || input.checks.length !== RELEASE_EVIDENCE_IDS.length ||
      RELEASE_EVIDENCE_IDS.some((id) => !ids.includes(id))) {
    throw new Error('Release evidence check IDs must be complete and unique');
  }
  const checks = [...input.checks].sort((left, right) => left.id.localeCompare(right.id)).map((check) => {
    if (check.required !== true || !STATUSES.has(check.status)) {
      throw new Error(`${check.id} must be a required check with a valid status`);
    }
    if (check.candidate !== releaseCommit) throw new Error(`${check.id} candidate differs from release candidate`);
    if (!Array.isArray(check.evidence)) throw new Error(`${check.id} evidence must be an array`);
    const evidence = [...check.evidence]
      .map((value) => evidenceReference(value, check.id, releaseCommit, options))
      .sort((left, right) => left.reference.localeCompare(right.reference));
    if (check.status === 'passed' && evidence.length === 0) {
      throw new Error(`passed check ${check.id} requires evidence`);
    }
    if (check.status === 'pending' &&
        (typeof check.authorizationGate !== 'string' || check.authorizationGate.trim().length === 0)) {
      throw new Error(`Pending check ${check.id} requires an authorization gate`);
    }
    return {
      id: check.id,
      required: true,
      status: check.status,
      candidate: check.candidate,
      evidence,
      ...(check.authorizationGate === undefined ? {} : { authorizationGate: check.authorizationGate }),
    };
  });
  const requiredMisses = checks.filter(({ status }) => status !== 'passed').map(({ id }) => id);
  const base = {
    schemaVersion: 'sutura-release-evidence-v1',
    releaseCommit,
    checks,
    passedCount,
    requiredMisses,
    ready: requiredMisses.length === 0,
  };
  return { ...base, resultHash: contentHash(base) };
}

export function assertReleaseReady(report) {
  if (!report.ready || report.requiredMisses.length > 0 || report.passedCount === 0) {
    throw new Error(`Release is not ready: ${report.requiredMisses.join(', ') || 'no passed checks'}`);
  }
}

export function verifyDogfoodStreak(ledger, releaseCommit, options = {}) {
  const candidate = exactSha(releaseCommit, 'Dogfood release commit');
  const validatedLedger = validateDogfoodLedger(ledger);
  const packagesTreeHash = options.packagesTreeHash ?? execFileSync(
    'git', ['rev-parse', `${candidate}:packages`], { encoding: 'utf8' },
  ).trim();
  if (!/^[a-f0-9]{40}$/u.test(packagesTreeHash)) throw new Error('Dogfood packages tree hash is invalid');
  const trailing = validatedLedger.entries.slice(-10);
  const actionShas = new Set(trailing.map((entry) => entry?.actionSha));
  const actionSha = actionShas.size === 1 && /^[a-f0-9]{40}$/u.test(trailing[0]?.actionSha ?? '')
    ? trailing[0].actionSha : undefined;
  const actionPackagesTreeHash = actionSha === undefined ? undefined
    : options.actionPackagesTreeHash ?? execFileSync(
      'git', ['rev-parse', `${actionSha}:packages`], { encoding: 'utf8' },
    ).trim();
  const totalMicroUsd = trailing.reduce((sum, entry) => sum + Math.round(
    ((Number.isFinite(entry?.sandboxUsd) ? entry.sandboxUsd : Number.NaN) +
    (Number.isFinite(entry?.inferenceUsd) ? entry.inferenceUsd : Number.NaN)) * 1_000_000,
  ), 0);
  const distinct = (field) => new Set(trailing.map((entry) => entry?.[field])).size === 10;
  const passed = trailing.length === 10 && actionSha !== undefined &&
    actionPackagesTreeHash === packagesTreeHash && totalMicroUsd <= 10_000_000 &&
    distinct('ciRunId') && distinct('suturaRunId') && distinct('dogfoodSha') && distinct('prUrl') &&
    trailing.every((entry) => entry?.outcome === 'fixed' &&
      entry.actionSha === actionSha && entry.packagesTreeHash === packagesTreeHash &&
      typeof entry.prUrl === 'string');
  const ledgerBytes = options.ledgerBytes ?? Buffer.from(`${JSON.stringify(validatedLedger, null, 2)}\n`);
  return {
    id: 'dogfood',
    required: true,
    status: passed ? 'passed' : 'pending',
    candidate,
    evidence: passed ? [{
      reference: 'docs/demo/dogfood-ledger.json',
      contentHash: createHash('sha256').update(ledgerBytes).digest('hex'),
      candidate,
    }] : [],
    ...(passed ? {} : { authorizationGate: 'live-dogfood-streak' }),
  };
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  const value = index < 0 ? undefined : args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

export async function main(args = process.argv.slice(2), options = {}) {
  if (args[0] === 'dogfood-status') {
    if (args.length !== 5 || args[1] !== '--ledger' || args[3] !== '--candidate') {
      throw new Error('Usage: release-evidence.mjs dogfood-status --ledger <path> --candidate <sha>');
    }
    const bytes = await readFile(args[2]);
    if (bytes.byteLength > 1024 * 1024) throw new Error('Dogfood ledger exceeds 1048576 bytes');
    const result = verifyDogfoodStreak(JSON.parse(bytes.toString('utf8')), args[4], {
      ...options,
      ledgerBytes: bytes,
    });
    (options.stdout ?? process.stdout).write(`${canonicalJson(result)}\n`);
    return result;
  }
  if (args.length !== 4 || args.some((value, index) => index % 2 === 0 && value !== '--input' && value !== '--output')) {
    throw new Error('Usage: release-evidence.mjs --input <path> --output <path>');
  }
  const inputPath = valueAfter(args, '--input');
  const outputPath = valueAfter(args, '--output');
  const bytes = await readFile(inputPath);
  if (bytes.byteLength > 1024 * 1024) throw new Error('Release evidence input exceeds 1048576 bytes');
  const manifest = analyzeReleaseEvidence(JSON.parse(bytes.toString('utf8')), {
    ...options,
    verifyRemoteEvidence: options.verifyRemoteEvidence ??
      createGitHubEvidenceVerifier(options.githubApi),
  });
  await writeFile(outputPath, `${canonicalJson(manifest)}\n`, { encoding: 'utf8', flag: 'wx' });
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
