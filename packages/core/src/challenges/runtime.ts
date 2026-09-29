import { createHash } from 'node:crypto';
import type { Executor, ImageId, RunResult } from '../executor/types.js';
import type { HealLlm } from '../heal.js';
import type { RepositoryPolicy } from '../policy/schema.js';
import { policyAllowsSourceRead } from '../policy/evaluate.js';
import { canonicalJson } from '../replay/canonical-json.js';
import { BudgetExceededError } from '../engine/repair-budget.js';
import { redactExternalText } from '../security/external-text.js';
import { buildChallengeGenerationPrompt, classifyFrozenChallenges, freezeChallengeSet, type ChallengeKind, type FrozenChallengeSet, type ChallengeGenerationContext } from './generate.js';
import { buildObservationCommand, decodeObservation, evaluateObservation, freezeProbe, type FrozenProbe } from './protocol.js';
import { validateChallengeProposal } from './validate.js';
import type { ChallengeObservation, ChallengeQualification, ChallengeRunResult } from './runner.js';
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export interface RuntimeChallengeInput {
  /** Ports must be charged to the caller's shared run budget. */
  executor: Executor;
  llm: HealLlm;
  baselineImage: ImageId;
  policy: RepositoryPolicy;
  policyBaseSha: string | null;
  policyHash: string;
  baselineSnapshotHash: string;
  failureExcerpt: string;
  baselineSources: ChallengeGenerationContext['baselineSources'];
  observe?: (result: RunResult, parent: ImageId) => void;
}
export interface PreparedRuntimeChallenges {
  readonly mode: 'required' | 'optional' | 'disabled';
  readonly set: FrozenChallengeSet | null;
  readonly baseline: readonly ChallengeObservation[];
  readonly qualified: readonly ChallengeQualification[];
  readonly reason: string | null;
}
export interface ChallengePreparationDiagnostics {
  reason: string | null;
  retainedCount: number;
  excludedCount: number;
  qualifiedCount: number;
  excludedReasons: Array<{ reasonCode: string; count: number }>;
  disqualifiedReasons: Array<{ reasonCode: string; count: number }>;
}
/** Only controller-owned reason codes and counts leave the private challenge context. */
export function summarizeChallengePreparation(prepared: PreparedRuntimeChallenges): ChallengePreparationDiagnostics {
  const counts = (reasons: string[]) => [...new Set(reasons)].sort().map(reasonCode => ({
    reasonCode, count: reasons.filter(reason => reason === reasonCode).length,
  }));
  return {
    reason: prepared.reason,
    retainedCount: prepared.set?.challenges.length ?? 0,
    excludedCount: prepared.set?.excluded.length ?? 0,
    qualifiedCount: prepared.qualified.filter(item => item.qualified).length,
    excludedReasons: counts(prepared.set?.excluded.map(item => item.reasonCode) ?? []),
    disqualifiedReasons: counts(prepared.qualified.filter(item => !item.qualified).map(item => item.reasonCode)),
  };
}
// Probe handles hold controller-only assertions and cannot be serialized or supplied by a patch.
const handles = new WeakMap<PreparedRuntimeChallenges, ReadonlyMap<string, FrozenProbe>>();
async function repetitions(executor: Executor, image: ImageId, id: string, probe: FrozenProbe, subject: 'baseline' | 'candidate', observe?: RuntimeChallengeInput['observe']): Promise<ChallengeObservation[]> {
  const observations: ChallengeObservation[] = [];
  for (let repetition = 1; repetition <= 2; repetition++) {
    let observationSha256: string | undefined;
    try {
      const result = await executor.run(image, buildObservationCommand(probe), { cwd: '/workspace', timeoutSec: 10, network: 'disabled', env: { NODE_OPTIONS: '', NODE_PATH: '', PYTHONPATH: '', PYTHONNOUSERSITE: '1', TZ: 'UTC', LANG: 'C.UTF-8' } });
      observe?.(result, image);
      observationSha256 = digest(result.stdout);
      const verdict = evaluateObservation(probe, decodeObservation(result));
      observations.push({ challengeId: id, subject, repetition, status: verdict.status, reasonCode: verdict.status === 'passed' ? 'passed' : 'assertion-mismatch', observationSha256 });
    }
    catch (error) {
      if (error instanceof BudgetExceededError)
        throw error;
      observations.push({ challengeId: id, subject, repetition, status: 'insufficient', reasonCode: 'protocol-error', ...(observationSha256 === undefined ? {} : { observationSha256 }) });
    }
  }
  return observations;
}
/** Generate and qualify strictly before constructing any candidate. */
export async function prepareRuntimeChallenges(input: RuntimeChallengeInput): Promise<PreparedRuntimeChallenges> {
  const verification = input.policy.verification ?? { mode: 'optional' as const, contracts: [] };
  const base = { mode: verification.mode, set: null, baseline: [], qualified: [], reason: null };
  if (verification.mode === 'disabled' || verification.contracts.length === 0) {
    const prepared = { ...base, reason: verification.mode === 'disabled' ? null : 'missing-contract' };
    handles.set(prepared, new Map());
    return Object.freeze(prepared);
  }
  if (verification.contracts.some(contract => !policyAllowsSourceRead(contract.target.path, input.policy))) {
    const prepared = { ...base, reason: 'invalid-probe' };
    handles.set(prepared, new Map());
    return Object.freeze(prepared);
  }
  const sources = input.baselineSources.filter(s => policyAllowsSourceRead(s.path, input.policy));
  const contractExcerpts = verification.contracts.map(c => {
    const source = sources.find(s => s.path === c.target.path);
    const allowedInputsJson = c.kind === 'exact' ? c.examples.map(example => JSON.stringify(example.args))
      : c.kind === 'codec-round-trip' ? c.examples.map(example => JSON.stringify([example]))
        : c.kind === 'json-property' ? ['[]'] : undefined;
    return {
      contractId: c.id,
      path: c.target.path,
      excerpt: canonicalJson({ contract: c, relationId: 'equals' }),
      ...(allowedInputsJson === undefined ? {} : { allowedInputsJson }),
      citation: source ? {
        path: source.path,
        sha256: digest(source.content),
        startLine: source.startLine,
        endLine: source.startLine + source.content.trimEnd().split(/\r?\n/u).length - 1,
      } : null,
    };
  });
  const context: ChallengeGenerationContext = {
    failureExcerpt: input.failureExcerpt,
    baselineSources: sources,
    contractExcerpts,
    baselineSnapshotHash: input.baselineSnapshotHash,
    trustedPolicySha: input.policyHash,
  };
  const prompt = buildChallengeGenerationPrompt(context);
  const exampleContract = verification.contracts.find(c => contractExcerpts.some(e => e.contractId === c.id && e.citation !== null));
  const exampleExcerpt = contractExcerpts.find(e => e.contractId === exampleContract?.id);
  let exampleInputs: unknown[] = [];
  switch (exampleContract?.kind) {
    case 'ceiling-division': exampleInputs = [0, 1]; break;
    case 'cardinality': exampleInputs = [[]]; break;
    case 'codec-round-trip': exampleInputs = [exampleContract.examples[0]]; break;
    case 'exact': exampleInputs = exampleContract.examples[0]!.args; break;
  }
  const example = exampleExcerpt?.citation ? JSON.stringify({ challenges: [{
    id: 'probe-1', kind: 'preservation', contractRefs: [exampleExcerpt.citation],
    rationale: 'Preserve the cited contract', probeId: 'probe-1', inputs: exampleInputs,
    contractId: exampleExcerpt.contractId, relationId: 'equals',
  }] }) : null;
  prompt.messages[0] = { ...prompt.messages[0]!, role: 'system', content: redactExternalText(`${prompt.messages[0]!.content}
Return a JSON object with a challenges array. Choose at most three probes. Only equals is supported by this runtime. ${example === null ? '' : `A valid shape using the first cited contract is ${example}. Change kind to bug-regression only when the cited behavior fails on the baseline.`}`).text };
  const reply = await input.llm.chat('super', prompt.messages, { purpose: 'challenge-generation', maxTokens: 2048, temperature: 0, responseFormat: { type: 'json_object' } });
  let proposals: unknown[];
  try {
    const decoded = JSON.parse(reply.text) as {
      challenges?: unknown;
    };
    if (!Array.isArray(decoded.challenges))
      throw Error('missing challenges');
    proposals = decoded.challenges;
  }
  catch {
    const prepared = { ...base, reason: 'invalid-probe' };
    handles.set(prepared, new Map());
    return Object.freeze(prepared);
  }
  const set = freezeChallengeSet({ proposals, policy: verification, baselineSnapshotHash: input.baselineSnapshotHash, trustedPolicySha: input.policyHash, contextHash: prompt.contextHash, promptHash: digest(canonicalJson(prompt.messages)) });
  const baseline: ChallengeObservation[] = [];
  const qualified: ChallengeQualification[] = [];
  const probes = new Map<string, FrozenProbe>();
  const observedKinds = new Map<string, ChallengeKind>();
  let reason: string | null = set.excluded.some(x => x.reasonCode !== 'retention-limit') ? 'invalid-probe' : null;
  for (const challenge of set.challenges) {
    const validated = validateChallengeProposal(challenge, { policy: input.policy, sourceHashes: new Map(sources.map(s => [s.path, digest(s.content)])), trustedContractIds: new Set(verification.contracts.map(c => c.id)) });
    if (!validated.ok || challenge.relationId !== 'equals') {
      reason = 'invalid-probe';
      qualified.push({ challengeId: challenge.id, qualified: false, reasonCode: validated.ok ? 'unsupported-relation' : validated.reasonCode, observations: [] });
      continue;
    }
    let probe: FrozenProbe;
    try {
      probe = freezeProbe(verification, input.policyBaseSha === null ? { policyBaseSha: null, policyHash: input.policyHash, localSnapshotSha256: input.baselineSnapshotHash } : { policyBaseSha: input.policyBaseSha, policyHash: input.policyHash }, { contractId: challenge.contractId, args: challenge.inputs });
    }
    catch (error) {
      reason = 'invalid-probe';
      qualified.push({ challengeId: challenge.id, qualified: false, reasonCode: error instanceof Error && error.message.startsWith('input outside') ? 'input-outside-domain' : 'invalid-probe', observations: [] });
      continue;
    }
    const observations = await repetitions(input.executor, input.baselineImage, challenge.id, probe, 'baseline', input.observe);
    baseline.push(...observations);
    // The model suggests inputs; only trusted baseline assertions classify their behavior.
    let observedKind: ChallengeKind | null = null;
    if (observations.every(o => o.status === 'passed')) observedKind = 'preservation';
    else if (observations.every(o => o.status === 'failed' && o.reasonCode === 'assertion-mismatch')) observedKind = 'bug-regression';
    const ok = observedKind !== null;
    qualified.push({ challengeId: challenge.id, qualified: ok, reasonCode: ok ? 'qualified' : 'baseline-not-qualified', observations });
    if (observedKind !== null) {
      observedKinds.set(challenge.id, observedKind);
      probes.set(challenge.id, probe);
    } else {
      reason = 'invalid-probe';
    }
  }
  if (probes.size === 0)
    reason ??= 'missing-contract';
  const prepared = { mode: verification.mode, set: classifyFrozenChallenges(set, observedKinds), baseline, qualified, reason };
  // Deep-freeze public preparation records; assertions remain in the private map.
  const freeze = (value: unknown): void => { if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  } };
  freeze(prepared);
  handles.set(prepared, probes);
  return prepared;
}
/** Every candidate reuses the exact qualified baseline; failed checks are never removed. */
export async function runRuntimeChallenges(prepared: PreparedRuntimeChallenges, executor: Executor, candidateImage: ImageId, observe?: RuntimeChallengeInput['observe']): Promise<ChallengeRunResult> {
  const probes = handles.get(prepared);
  if (!probes)
    throw Error('Challenge context was not prepared by this controller');
  const observations = [...prepared.baseline];
  const qualified = prepared.qualified.map(q => ({ ...q, observations: [...q.observations] }));
  if (prepared.reason || probes.size === 0)
    return { status: 'insufficient', reasonCode: prepared.reason ?? 'no-frozen-challenges', qualified, observations };
  for (const [id, probe] of probes) {
    const checks = await repetitions(executor, candidateImage, id, probe, 'candidate', observe);
    observations.push(...checks);
    qualified.find(q => q.challengeId === id)!.observations.push(...checks);
  }
  const candidate = observations.filter(o => o.subject === 'candidate');
  const status = candidate.some(o => o.status === 'insufficient') ? 'insufficient' : candidate.some(o => o.status === 'failed') ? 'failed' : 'passed';
  return { status, reasonCode: status === 'passed' ? 'passed' : status === 'failed' ? 'assertion-mismatch' : 'protocol-error', qualified, observations };
}
