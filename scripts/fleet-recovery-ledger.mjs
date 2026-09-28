import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SHA = /^[a-f0-9]{40}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const STATES = ['sutura-green', 'sutura-proposed', 'agent-fallback-green', 'resolved-externally', 'unresolved', 'unknown'];

function validSha(value) {
  return typeof value === 'string' && SHA.test(value);
}

function sameSource(source, monitor) {
  return String(monitor.sourceRunId) === String(source.id) &&
    monitor.sourceCommit === source.headSha;
}

function matchingGreen(source, green) {
  return green?.conclusion === 'success' && green.workflowId === source.workflowId &&
    green.branch === source.branch && validSha(green.headSha) &&
    Date.parse(green.startedAt ?? '') > Date.parse(source.completedAt ?? '') &&
    Date.parse(green.completedAt ?? '') > Date.parse(source.completedAt ?? '');
}

function matchingRepair(source, pr, ci) {
  return Number.isSafeInteger(pr?.number) && pr.number > 0 &&
    String(pr.sourceRunId) === String(source.id) && pr.sourceSha === source.headSha &&
    pr.baseBranch === source.branch && validSha(pr.headSha) && DIGEST.test(pr.diffSha ?? '') &&
    ci?.conclusion === 'success' && ci.workflowId === source.workflowId &&
    ci.headSha === pr.headSha && ci.branch === `sutura/fix-${source.id}`;
}

function matchingActor(source, green, actor) {
  return actor?.authenticated === true &&
    typeof actor.sessionId === 'string' && actor.sessionId.length > 0 &&
    typeof actor.actorId === 'string' && actor.actorId.length > 0 &&
    actor.repositoryId === source.repositoryId &&
    String(actor.sourceRunId) === String(source.id) &&
    actor.workflowId === source.workflowId && actor.branch === source.branch &&
    actor.integrationSha === green.headSha;
}

export function classifyFleetIncident({ source, monitor = null, repairPr = null, repairCi = null,
  nextGreen = null, actor = null, coverage = null, lookupError = null }) {
  if (!source || !Number.isSafeInteger(source.repositoryId) || !Number.isSafeInteger(source.id)) {
    throw new Error('Incident requires exact numeric repository and source-run IDs');
  }
  const incident = {
    schemaVersion: 'sutura-fleet-incident-v2',
    repositoryId: source.repositoryId,
    sourceRunId: source.id,
    sourceAttempt: source.attempt ?? 1,
    workflowId: source.workflowId,
    branch: source.branch,
    sourceSha: source.headSha,
    sourceConclusion: source.conclusion,
    sourceCompletedAt: source.completedAt,
    sourceCreatedAt: source.createdAt ?? source.completedAt,
    sourceRunUrl: source.url ?? null,
    actionSha: validSha(monitor?.actionSha) ? monitor.actionSha : null,
    cause: monitor?.outcome ?? 'monitor-unavailable',
    costCoverage: monitor?.costStatus === 'measured' ? 'measured' : 'unavailable',
    inferenceCostUsd: monitor?.costStatus === 'measured' ? monitor.inferenceCostUsd : null,
    sandboxCostUsd: monitor?.costStatus === 'measured' ? monitor.sandboxCostUsd : null,
    monitorRunId: monitor?.id ?? null,
    repairPrNumber: repairPr?.number ?? null,
    repairPrUrl: repairPr?.url ?? null,
    repairHeadSha: repairPr?.headSha ?? null,
    repairDiffSha: repairPr?.diffSha ?? null,
    integrationSha: repairPr?.integrationSha ?? null,
    repairCiRunId: repairCi?.id ?? null,
    repairCiRunUrl: repairCi?.url ?? null,
    targetGreenRunId: nextGreen?.id ?? null,
    targetGreenRunUrl: nextGreen?.url ?? null,
    coverage,
  };
  let state = 'unresolved';
  let reason = 'no-same-workflow-branch-green';
  const validSource = ['failure', 'timed_out'].includes(source.conclusion) &&
    validSha(source.headSha) && typeof source.branch === 'string' &&
    Number.isSafeInteger(source.workflowId) && Number.isFinite(Date.parse(source.completedAt ?? ''));
  if (!validSource) {
    state = 'unknown'; reason = 'invalid-source-identity';
  } else if (lookupError) {
    state = 'unknown'; reason = lookupError;
  } else if (monitor?.outcome === 'unknown' || (monitor && !sameSource(source, monitor))) {
    state = 'unknown'; reason = monitor?.evidenceError ?? 'ambiguous-monitor-link';
  } else if (!monitor) {
    state = 'unknown'; reason = 'monitor-evidence-unavailable';
  } else if (matchingRepair(source, repairPr, repairCi) &&
      monitor?.outcome === 'fixed' && monitor?.workflowConclusion !== 'failure' &&
      repairPr.merged === true && validSha(repairPr.integrationSha) &&
      matchingGreen(source, nextGreen) && nextGreen.headSha === repairPr.integrationSha) {
    state = 'sutura-green'; reason = 'exact-repair-ci-integration-and-green';
  } else if (monitor?.outcome === 'fixed' && repairPr?.merged === true && nextGreen &&
      nextGreen.headSha !== repairPr.integrationSha) {
    state = 'unknown'; reason = 'branch-head-changed-before-repair-green-proof';
  } else if (matchingGreen(source, nextGreen)) {
    state = matchingActor(source, nextGreen, actor)
      ? 'agent-fallback-green' : 'resolved-externally';
    reason = state === 'agent-fallback-green' ? 'authenticated-fallback' : 'actor-or-repair-link-unproven';
  } else if (monitor?.outcome === 'fixed' && matchingRepair(source, repairPr, repairCi)) {
    state = 'sutura-proposed'; reason = repairPr.merged ? 'target-green-pending' : 'integration-pending';
  }
  return { ...incident, state, reason };
}

function identity(incident) {
  return `${incident.repositoryId}:${incident.sourceRunId}:${incident.sourceAttempt ?? 1}`;
}

function runWindowAt(run) {
  return Date.parse(run.createdAt ?? run.completedAt ?? '');
}

function strength(incident) {
  if (incident.state !== 'unknown' && incident.monitorRunId === null) return 0;
  return {
    'sutura-green': 5, 'agent-fallback-green': 5,
    'sutura-proposed': 4, 'resolved-externally': 4,
    unresolved: 2, unknown: 0,
  }[incident.state] ?? 0;
}

export function mergeObservations(observations) {
  const selected = new Map();
  for (const observation of observations) {
    const incident = observation.incident ?? observation;
    if (incident.schemaVersion !== 'sutura-fleet-incident-v2') continue;
    const key = identity(incident);
    const previous = selected.get(key);
    if (!previous || strength(incident) > strength(previous) ||
        (strength(incident) === strength(previous) &&
          String(observation.observedAt ?? '') > String(previous.observedAt ?? ''))) {
      selected.set(key, { ...incident, observedAt: observation.observedAt ?? incident.observedAt ?? null });
    }
  }
  return [...selected.values()].sort((a, b) => a.repositoryId - b.repositoryId ||
    a.sourceRunId - b.sourceRunId || a.sourceAttempt - b.sourceAttempt);
}

export async function persistObservation(directory, incident, observedAt = new Date().toISOString()) {
  if (incident.schemaVersion !== 'sutura-fleet-incident-v2') throw new Error('Incident schema is invalid');
  const record = { schemaVersion: 'sutura-fleet-observation-v1', observedAt, incident };
  const bytes = `${JSON.stringify(record)}\n`;
  const hash = createHash('sha256').update(bytes).digest('hex');
  await mkdir(directory, { recursive: true });
  const destination = join(directory, `${incident.repositoryId}-${incident.sourceRunId}-${incident.sourceAttempt ?? 1}-${hash}.json`);
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
  return { path: destination, sha256: hash };
}

export async function readObservations(directory) {
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const records = [];
  for (const name of names.filter((value) => /^\d+-\d+-\d+-[a-f0-9]{64}\.json$/u.test(value)).sort()) {
    const bytes = await readFile(join(directory, name));
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (!name.endsWith(`-${hash}.json`)) throw new Error(`Observation hash mismatch: ${name}`);
    const record = JSON.parse(bytes.toString('utf8'));
    if (record.schemaVersion !== 'sutura-fleet-observation-v1') throw new Error(`Observation schema invalid: ${name}`);
    records.push(record);
  }
  return records;
}

export function summarizeRecovery(incidents) {
  const states = Object.fromEntries(STATES.map((state) => [state, 0]));
  const causes = { 'flaky-no-patch': 0, refused: 0, 'gave-up': 0, 'infra-stop': 0, unknown: 0 };
  const cohorts = {};
  let measuredCostUsd = 0;
  let measuredCostCount = 0;
  for (const incident of incidents) {
    if (Object.hasOwn(states, incident.state)) states[incident.state] += 1;
    if (Object.hasOwn(causes, incident.cause)) causes[incident.cause] += 1;
    if (incident.costCoverage === 'measured' &&
        Number.isFinite(incident.inferenceCostUsd) && Number.isFinite(incident.sandboxCostUsd)) {
      measuredCostUsd += incident.inferenceCostUsd + incident.sandboxCostUsd;
      measuredCostCount += 1;
    }
    const cohort = validSha(incident.actionSha) ? incident.actionSha : 'unavailable';
    cohorts[cohort] = (cohorts[cohort] ?? 0) + 1;
  }
  return {
    schemaVersion: 'sutura-fleet-recovery-summary-v2',
    incidents: incidents.length, states, causes, actionCohorts: cohorts,
    attempted: incidents.filter(({ monitorRunId }) => monitorRunId !== null).length,
    verifiedRepairPrs: incidents.filter(({ state }) => ['sutura-green', 'sutura-proposed'].includes(state)).length,
    costCoverage: { measured: measuredCostCount, unavailable: incidents.length - measuredCostCount },
    measuredCostUsd: Math.round(measuredCostUsd * 1_000_000) / 1_000_000,
  };
}

export function publicRecoverySummary(summary) {
  return {
    schemaVersion: summary.schemaVersion,
    incidents: summary.incidents,
    attempted: summary.attempted,
    verifiedRepairPrs: summary.verifiedRepairPrs,
    states: structuredClone(summary.states),
    causes: structuredClone(summary.causes),
    actionCohorts: structuredClone(summary.actionCohorts),
    costCoverage: structuredClone(summary.costCoverage),
    measuredCostUsd: summary.measuredCostUsd,
  };
}

function firstGreen(runs, source) {
  return runs.filter((run) => matchingGreen(source, run))
    .sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt))[0] ?? null;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function monitorForSource(events, source) {
  const matches = events.filter((event) =>
    String(event.sourceRunId) === String(source.id) &&
    (event.sourceCommit === null || event.sourceCommit === undefined || event.sourceCommit === source.headSha) &&
    Date.parse(event.startedAt ?? '') >= Date.parse(source.completedAt ?? '') &&
    (!source.nextAttemptStartedAt || Date.parse(event.startedAt) < Date.parse(source.nextAttemptStartedAt)));
  if (matches.length === 1) return { ...matches[0], id: matches[0].runId };
  if (matches.length > 1) return { outcome: 'unknown', evidenceError: 'ambiguous-monitor-runs' };
  return null;
}

function windowMetrics(runs, start, end) {
  const windowRuns = runs.filter((run) => {
    const at = runWindowAt(run);
    return at >= start && at < end;
  });
  const failures = windowRuns.filter((run) => ['failure', 'timed_out'].includes(run.conclusion));
  const recoveries = failures.flatMap((run) => {
    const green = firstGreen(windowRuns, run);
    if (!green) return [];
    const intervening = windowRuns.filter((candidate) => candidate.workflowId === run.workflowId &&
      candidate.branch === run.branch && Date.parse(candidate.completedAt) > Date.parse(run.completedAt) &&
      Date.parse(candidate.completedAt) <= Date.parse(green.completedAt));
    return [{ durationSec: (Date.parse(green.completedAt) - Date.parse(run.completedAt)) / 1000,
      runsToGreen: intervening.length,
      observedHeadShasToGreen: new Set(intervening.map(({ headSha }) => headSha)).size }];
  });
  const durations = recoveries.map(({ durationSec }) => durationSec).sort((a, b) => a - b);
  const completedRuns = windowRuns.filter(({ conclusion }) => typeof conclusion === 'string').length;
  return {
    completedRuns, incidents: failures.length,
    incidentRate: completedRuns ? failures.length / completedRuns : null,
    resolved: durations.length,
    censored: failures.length - durations.length,
    medianRecoverySec: median(durations),
    p95RecoverySec: durations.length ? durations[Math.ceil(durations.length * 0.95) - 1] : null,
    runsToGreenMedian: median(recoveries.map(({ runsToGreen }) => runsToGreen)),
    observedHeadShasToGreenMedian: median(recoveries.map(({ observedHeadShasToGreen }) => observedHeadShasToGreen)),
    recoveryDurationsSec: durations,
    runsToGreenValues: recoveries.map(({ runsToGreen }) => runsToGreen) };
}

function baselineFor(repository, workflow, activationAt, activationUpperBoundAt, runs) {
  if (!activationAt) return { repository, workflowId: workflow.id, status: 'unmeasured',
    reason: 'activation-date-unavailable', incidents: null };
  const activation = Date.parse(activationAt);
  const start = activation - 45 * 24 * 60 * 60 * 1000;
  return { repository, workflowId: workflow.id,
    status: activationUpperBoundAt && Date.parse(activationUpperBoundAt) > activation ? 'censored' : 'measured',
    startedAt: new Date(start).toISOString(), endedAt: activationAt,
    activationUpperBoundAt: activationUpperBoundAt ?? activationAt,
    ...windowMetrics(runs, start, activation) };
}

export async function collectRecoveryLedger(config, client, monitorEvents, now = new Date()) {
  const installations = [];
  const incidents = [];
  const baselines = [];
  const postWindows = [];
  const unmeasuredRepositories = new Set();
  for (const repository of [...config.repositories].sort()) {
    let installation;
    try {
      installation = await client.inspectRepository(repository);
    } catch {
      installations.push({ repository, state: 'inaccessible', reason: 'repository-api-error' });
      unmeasuredRepositories.add(repository);
      continue;
    }
    installations.push({ repository, ...installation });
    if (installation.state === 'inaccessible') {
      unmeasuredRepositories.add(repository);
      continue;
    }
    if (!installation.workflows?.length) continue;
    const activationAt = installation.activationAt;
    const since = activationAt
      ? new Date(Math.min(Date.parse(config.startedAt), Date.parse(activationAt) - 45 * 86400_000)).toISOString()
      : config.startedAt;
    for (const workflow of installation.workflows) {
      let runs;
      try {
        runs = await client.listCiRuns(repository, workflow, since);
      } catch {
        unmeasuredRepositories.add(repository);
        baselines.push({ repository, workflowId: workflow.id, status: 'unmeasured',
          reason: 'ci-pagination-or-api-error', incidents: null });
        continue;
      }
      baselines.push(baselineFor(repository, workflow, activationAt, installation.activationUpperBoundAt, runs));
      const postStart = Math.max(Date.parse(config.startedAt), Date.parse(activationAt ?? config.startedAt));
      postWindows.push({ repository, workflowId: workflow.id,
        startedAt: new Date(postStart).toISOString(), endedAt: now.toISOString(),
        ...windowMetrics(runs, postStart, now.getTime() + 1) });
      const failures = runs.filter((run) => ['failure', 'timed_out'].includes(run.conclusion) &&
        runWindowAt(run) >= postStart && runWindowAt(run) <= now.getTime());
      for (const source of failures) {
        const nextAttemptStartedAt = runs.filter((run) => run.id === source.id &&
          run.attempt > source.attempt).sort((a, b) => a.attempt - b.attempt)[0]?.startedAt ?? null;
        const normalizedSource = { ...source, nextAttemptStartedAt,
          repositoryId: installation.repositoryId, workflowId: workflow.id };
        const monitor = monitorForSource(monitorEvents.filter((event) => event.repository === repository), normalizedSource);
        let repairPr = null;
        let lookupError = null;
        if (monitor?.outcome === 'fixed') {
          try {
            repairPr = await client.findRepairPr(repository, source);
          } catch {
            lookupError = 'repair-pr-api-or-ambiguity';
          }
        }
        const repairCi = repairPr && runs.find((run) => run.workflowId === workflow.id &&
          run.headSha === repairPr.headSha && run.branch === `sutura/fix-${source.id}` &&
          run.conclusion === 'success') || null;
        const nextGreen = firstGreen(runs, normalizedSource);
        let actor = null;
        if (nextGreen && typeof client.findAuthenticatedActor === 'function') {
          try {
            actor = await client.findAuthenticatedActor(repository, normalizedSource, nextGreen);
          } catch {
            // No unauthenticated actor claim is made when the source is unavailable.
          }
        }
        incidents.push(classifyFleetIncident({ source: normalizedSource, monitor, repairPr,
          repairCi, nextGreen, actor,
          lookupError,
          coverage: { ciPagesComplete: true, monitorObserved: monitor !== null } }));
      }
    }
  }
  const scope = { startedAt: config.startedAt,
    repositories: config.repositories.map((repository) => {
      const installation = installations.find((item) => item.repository === repository);
      return { repository, repositoryId: installation?.repositoryId ?? null,
        activationAt: installation?.activationAt ?? null,
        workflowIds: installation?.workflows?.map(({ id }) => id) ?? [] };
    }) };
  return { installations, incidents, baselines, postWindows, scope, summary: summarizeRecovery(incidents),
    coverage: { complete: unmeasuredRepositories.size === 0,
      unmeasuredRepositories: unmeasuredRepositories.size,
      actorProvenanceAvailable: typeof client.findAuthenticatedActor === 'function',
      baselineComplete: baselines.every((item) => item.status === 'measured') } };
}

async function writeAtomic(path, content) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function aggregateWindow(rows) {
  const measured = rows.filter(({ incidents }) => Number.isSafeInteger(incidents));
  const completedRuns = measured.reduce((sum, row) => sum + (row.completedRuns ?? 0), 0);
  const incidents = measured.reduce((sum, row) => sum + row.incidents, 0);
  const durations = measured.flatMap(({ recoveryDurationsSec }) => recoveryDurationsSec ?? []).sort((a, b) => a - b);
  return { workflows: measured.length, completedRuns, incidents,
    incidentRate: completedRuns ? incidents / completedRuns : null,
    resolved: measured.reduce((sum, row) => sum + (row.resolved ?? 0), 0),
    censored: measured.reduce((sum, row) => sum + (row.censored ?? 0), 0),
    medianRecoverySec: median(durations),
    p95RecoverySec: durations.length ? durations[Math.ceil(durations.length * 0.95) - 1] : null,
    runsToGreenMedian: median(measured.flatMap(({ runsToGreenValues }) => runsToGreenValues ?? [])) };
}

export async function writeRecoveryLedger(result, outputDirectory, observedAt = new Date().toISOString()) {
  await mkdir(outputDirectory, { recursive: true });
  const journal = join(outputDirectory, 'observations-v2');
  for (const incident of result.incidents) await persistObservation(journal, incident, observedAt);
  let scope = result.scope;
  let priorScope = null;
  if (scope) {
    try {
      priorScope = JSON.parse(await readFile(join(outputDirectory, 'scope-v2.json'), 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    scope = { ...scope, repositories: scope.repositories.map((entry) => {
      const prior = priorScope?.repositories?.find((item) => item.repository === entry.repository);
      return entry.repositoryId === null && prior
        ? { ...entry, repositoryId: prior.repositoryId, workflowIds: prior.workflowIds,
          activationAt: entry.activationAt ?? prior.activationAt }
        : entry;
    }) };
  }
  const allowed = scope ? new Map(scope.repositories.filter(({ repositoryId }) =>
    Number.isSafeInteger(repositoryId)).map((entry) => [entry.repositoryId, entry])) : null;
  const currentIncidents = new Map(result.incidents.map((incident) => [identity(incident), incident]));
  const incidents = mergeObservations(await readObservations(journal)).filter((incident) => {
    if (!allowed) return true;
    const entry = allowed.get(incident.repositoryId);
    const windowAt = currentIncidents.get(identity(incident))?.sourceCreatedAt ??
      incident.sourceCreatedAt ?? incident.sourceCompletedAt;
    return entry && entry.workflowIds.includes(incident.workflowId) &&
      Date.parse(windowAt) >= Math.max(Date.parse(scope.startedAt),
        Date.parse(entry.activationAt ?? scope.startedAt));
  });
  const unchangedScope = scope && priorScope && JSON.stringify(scope) === JSON.stringify(priorScope);
  const legacyWindowUnknown = result.coverage.complete
    ? incidents.filter((incident) => !currentIncidents.has(identity(incident)) && !incident.sourceCreatedAt).length : 0;
  const missingPreviouslyObserved = unchangedScope && result.coverage.complete
    ? incidents.filter((incident) => !currentIncidents.has(identity(incident))).length : 0;
  const summary = {
    ...publicRecoverySummary(summarizeRecovery(incidents)),
    observedAt,
    baseline: {
      workflows: result.baselines.length,
      measured: result.baselines.filter(({ status }) => status === 'measured').length,
      censored: result.baselines.filter(({ status }) => status === 'censored').length,
      unmeasured: result.baselines.filter(({ status }) => status === 'unmeasured').length,
      incidents: result.baselines.reduce((sum, item) => sum + (item.incidents ?? 0), 0),
      resolved: result.baselines.reduce((sum, item) => sum + (item.resolved ?? 0), 0),
    },
    comparison: {
      before: aggregateWindow(result.baselines),
      after: aggregateWindow(result.postWindows ?? []),
    },
    coverage: {
      complete: result.coverage.complete && missingPreviouslyObserved === 0 && legacyWindowUnknown === 0,
      unmeasuredRepositories: result.coverage.unmeasuredRepositories,
      missingPreviouslyObserved,
      legacyWindowUnknown,
      actorProvenanceAvailable: result.coverage.actorProvenanceAvailable === true,
      baselineComplete: result.coverage.baselineComplete,
    },
  };
  await writeAtomic(join(outputDirectory, 'incidents-v2.jsonl'),
    incidents.map((incident) => JSON.stringify(incident)).join('\n') + (incidents.length ? '\n' : ''));
  await writeAtomic(join(outputDirectory, 'installations-v2.json'), `${JSON.stringify(result.installations, null, 2)}\n`);
  await writeAtomic(join(outputDirectory, 'baselines-v2.json'), `${JSON.stringify(result.baselines, null, 2)}\n`);
  await writeAtomic(join(outputDirectory, 'post-windows-v2.json'), `${JSON.stringify(result.postWindows ?? [], null, 2)}\n`);
  if (scope) await writeAtomic(join(outputDirectory, 'scope-v2.json'), `${JSON.stringify(scope, null, 2)}\n`);
  await writeAtomic(join(outputDirectory, 'recovery-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}
