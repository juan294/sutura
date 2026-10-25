import { execFile as callbackExecFile } from 'node:child_process';
import { fstatSync, statSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readIncidentEvidence, incidentEvidenceKey, qualifyIncident, verificationContractDigest } from './fleet-incident-evidence.mjs';
import { buildFleetFieldReport, publicFieldReport } from './fleet-field-report.mjs';
import { buildIncidentQueue, digest, writePrivateAtomic } from './fleet-incident-queue.mjs';
import { deliverWeeklyDigest, persistDigestSnapshot, readDigestSnapshot, resendTransport } from './fleet-digest-email.mjs';
const execFile = promisify(callbackExecFile);
const HERE = dirname(fileURLToPath(import.meta.url));

export async function withDigestEvaluation(collect, evaluate) {
  let failure;
  try { return await collect(); } catch (error) { failure = error; throw error; }
  finally {
    try { await evaluate(Boolean(failure)); } catch (error) { if (!failure) throw error; }
  }
}
export async function evaluateFleetDigest({ output, configPath, collectionFailed }) {
  const directory = join(output, 'weekly-digest');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const result = await execFile('python3', [join(HERE, 'fleet-digest-lock.py'), join(directory, 'writer.lock'),
      process.execPath, fileURLToPath(import.meta.url), resolve(configPath), resolve(output), String(collectionFailed)],
    { timeout: 45_000, maxBuffer: 64 * 1024 });
    return JSON.parse(result.stdout);
  } catch (error) {
    if (error.code === 75) return { status: 'busy', nextAction: 'Another collector holds the OS digest lock.' };
    throw new Error('Weekly digest evaluation failed; preserve private state and inspect the local worker.');
  }
}
async function projectCurrentCollection(output, config, previous, scopeDigest) {
  const read = async name => JSON.parse(await readFile(join(output, name), 'utf8'));
  const incidents = (await readFile(join(output, 'incidents-v2.jsonl'), 'utf8')).split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));
  const summary = await read('recovery-summary.json'), scope = await read('scope-v2.json');
  const installations = await read('installations-v2.json'), postWindows = await read('post-windows-v2.json');
  const names = config.repositories;
  if (scope.startedAt !== config.startedAt || !Array.isArray(scope.repositories) || !Array.isArray(installations) ||
      scope.repositories.length !== names.length || installations.length !== names.length ||
      names.some(name => scope.repositories.filter(row => row.repository === name).length !== 1 || installations.filter(row => row.repository === name).length !== 1)) throw new Error('Digest collection scope differs from configured enrollment');
  const scoped = new Map(scope.repositories.map(row => [row.repositoryId, row]));
  const sources = new Map(incidents.map(item => [incidentEvidenceKey(item), item]));
  if (incidents.some(item => !scoped.get(item.repositoryId)?.workflowIds?.includes(item.workflowId))) throw new Error('Incident outside configured workflow scope');
  const observations = (await readIncidentEvidence(join(output, 'incident-evidence-v1'))).filter(record => sources.has(record.incidentKey));
  const histories = new Map();
  for (const record of observations) {
    const source = sources.get(record.incidentKey);
    if (['repositoryId', 'workflowId', 'sourceRunId', 'sourceAttempt', 'sourceSha', 'branch'].some(key => record.source[key] !== source[key]) || Date.parse(record.observedAt) > Date.parse(summary.observedAt)) throw new Error('Companion source or collection identity conflict');
    const history = histories.get(record.incidentKey) ?? []; history.push(record); histories.set(record.incidentKey, history);
  }
  const contracts = config.verificationContracts ?? {}, classifications = [], latest = new Map();
  const hash = value => /^[a-f0-9]{64}$/u.test(value ?? '');
  for (const [key, records] of histories) {
    const time = records.reduce((maximum, record) => record.observedAt > maximum ? record.observedAt : maximum, '');
    const candidates = records.filter(record => record.observedAt === time);
    const signature = record => digest({ classification: record.classification, classificationRevision: record.classificationRevision,
      failureIdentity: record.sourceEvidence?.failureIdentity, complete: record.sourceEvidence?.complete,
      truncated: record.sourceEvidence?.log?.truncated, completeness: record.completeness, policyDigest: record.policyDigest });
    const unambiguous = new Set(candidates.map(signature)).size === 1, record = candidates[0];
    const identity = record.sourceEvidence?.failureIdentity, classification = record.classification;
    const complete = unambiguous && record.completeness.collection && record.completeness.source && record.completeness.logs &&
      record.sourceEvidence?.complete === true && record.sourceEvidence.log?.truncated === false;
    const classified = complete && record.classificationRevision === 'sutura-incident-classification-v1' &&
      classification?.schemaVersion === 'sutura-incident-classification-v1' && classification.confidence === 'confirmed' &&
      identity?.version === 'sutura-failure-identity-v1' && identity.status === 'matched' && hash(identity.nativeFingerprint);
    latest.set(key, { time, complete, classified });
    const contract = contracts[String(record.source.repositoryId)];
    if (classified && hash(record.policyDigest) && contract?.policyDigest === record.policyDigest &&
        contract.baseBranch === record.source.branch && verificationContractDigest(contract) === record.policyDigest) {
      classifications.push({ incidentKey: key, sourceSha: record.source.sourceSha, signatureVersion: identity.version,
        failureIdentityDigest: identity.nativeFingerprint, ownerDomain: classification.ownerDomain, cause: classification.cause,
        verificationContractDigest: record.policyDigest });
    }
  }
  // A tie or incomplete latest observation cannot resurrect an older classification in the field projection.
  const fieldObservations = observations.map(record => {
    const selected = latest.get(record.incidentKey);
    return record.observedAt === selected.time && !selected.classified ? { ...record, classification: null } : record;
  });
  const coverage = { ...summary.coverage, complete: summary.coverage?.complete === true &&
    summary.coverage.sourceDetailGaps === 0 && incidents.every(item => latest.get(incidentEvidenceKey(item))?.complete === true) };
  const window = { start: config.startedAt, end: summary.observedAt };
  const qualifications = incidents.map(item => qualifyIncident(item, histories.get(incidentEvidenceKey(item)) ?? [], contracts[String(item.repositoryId)]));
  const queue = buildIncidentQueue({ incidents, qualifications, classifications, previous, observedAt: summary.observedAt,
    scopeDigest, scanComplete: coverage.complete, window });
  const field = buildFleetFieldReport({ observedAt: new Date().toISOString(), collectedAt: summary.observedAt,
    window, scope, coverage, incidents, installations, evidenceObservations: fieldObservations, verificationContracts: contracts, postWindows });
  field.journalDigest = digest(observations);
  return { queue, field, publicField: publicFieldReport(field) };
}

async function worker(configPath, output, failed) {
  const directory = join(output, 'weekly-digest');
  const descriptor = Number(process.env.SUTURA_DIGEST_LOCK_FD);
  if (!Number.isSafeInteger(descriptor) || descriptor < 3) throw new Error('Missing OS digest lock');
  const held = fstatSync(descriptor), expected = statSync(join(directory, 'writer.lock'));
  if (held.dev !== expected.dev || held.ino !== expected.ino || !held.isFile()) throw new Error('Wrong OS digest lock');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const scopeDigest = digest({ owner: config.owner, repositories: [...config.repositories].sort(), startedAt: config.startedAt });
  let snapshot = await readDigestSnapshot(directory, scopeDigest);
  if (!failed) {
    try {
    const { queue, field, publicField } = await projectCurrentCollection(output, config, snapshot.queue, scopeDigest);
    await writePrivateAtomic(join(output, 'field-report-v1.json'), field);
    await writePrivateAtomic(join(output, 'field-report-public-v1.json'), publicField);
    await persistDigestSnapshot(directory, queue);
    snapshot = { queue, source: 'current' };
    } catch { failed = true; }
  }
  const mail = config.weeklyDigest;
  // Configuration authorizes only its exact observed scope. A fleet edit cannot silently expand disclosure.
  const bound = mail?.scopeDigest === scopeDigest ? mail : undefined;
  const credential = bound?.credentialEnv ? process.env[bound.credentialEnv] : undefined;
  const receipt = await deliverWeeklyDigest({ directory, config: bound, snapshot, credential,
    transport: credential ? resendTransport(credential) : undefined, collectionFailed: failed });
  return { status: receipt.status, nextAction: receipt.nextAction, week: receipt.week ?? null };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  worker(process.argv[2], process.argv[3], process.argv[4] === 'true').then(result => {
    process.stdout.write(JSON.stringify(result) + '\n');
  }).catch(() => { process.stderr.write('Digest worker failed; preserve state and inspect configuration or journal integrity.\n'); process.exitCode = 1; });
}
