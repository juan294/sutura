import { prepareActionVerificationAuthorization } from './verification-authorization.js';
import { createGitHubApi } from './octokit.js';
import { GitHubAdapter } from './github.js';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DefaultArtifactClient } from '@actions/artifact';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { authorizeActionVerification, ContreeExecutor, OpenAiClient, TypeSafeClient, createTokenFactoryClient, executeExternalVerification, readTrustedPolicyAtCommit, snapshotCleanSourceAt, type Config, type ExternalVerificationResult, } from '@sutura/core';
import { GitRepository } from './repository.js';
import { verifyActionRequest, type ActionVerifyInputs } from './verify.js';
interface WorkflowIdentity {
  id: number;
  head_sha: string;
  repository: {
    full_name: string;
  };
  head_repository: {
    full_name: string;
  } | null;
  conclusion: string | null;
}
/** This authentication boundary accepts GET only, with no repository mutation port. */
export async function authenticateVerifyRun(api: {
  getWorkflowRun(input: {
    owner: string;
    repo: string;
    run_id: number;
  }): Promise<{
    data: WorkflowIdentity;
  }>;
}, owner: string, repo: string, runId: string, sourceSha: string): Promise<void> {
  if (!/^[1-9]\d*$/u.test(runId) || !Number.isSafeInteger(Number(runId)))
    throw Error('Verification run id is invalid');
  const { data } = await api.getWorkflowRun({ owner, repo, run_id: Number(runId) });
  const repository = `${owner}/${repo}`;
  if (data.id !== Number(runId) || data.head_sha !== sourceSha || data.repository.full_name !== repository || data.head_repository?.full_name !== repository || !['failure', 'timed_out'].includes(data.conclusion ?? '')) {
    throw Error('Verification requires an authenticated failed run at the exact source in this repository; fork and identity mismatches are refused');
  }
}
export interface ActionVerificationContext {
  owner: string;
  repo: string;
  runId: string;
  githubToken: string;
  config: Config;
  verificationPacket?: string;
  authorizeLongVerification?: string;
  callerRunId?: number;
  engineSha?: string;
  controllerStartedAt?: number;
}
export type ActionVerificationOutcome = Pick<ExternalVerificationResult, 'status'>;
async function execute(inputs: ActionVerifyInputs, context: ActionVerificationContext): Promise<ActionVerificationOutcome> {
  const controllerStartedAt = context.controllerStartedAt ?? Date.now();
  const octokit = github.getOctokit(context.githubToken);
  const authorization = context.verificationPacket ? await prepareActionVerificationAuthorization({ octokit, owner: context.owner, repo: context.repo, callerRunId: context.callerRunId ?? 0, packetInput: context.verificationPacket, packetDigestInput: context.authorizeLongVerification ?? '' }) : undefined;
  if (authorization && (authorization.packet.runId !== context.runId || authorization.packet.sourceSha !== inputs.sourceSha || authorization.packet.policyBaseSha !== inputs.policyBaseSha || authorization.packet.engineSha !== context.engineSha)) throw new Error('Supplied verification identity differs from authenticated dispatch packet');
  const nativeRun = authorization ? await new GitHubAdapter(createGitHubApi(octokit, context.owner, context.repo, { sourceAttempt: authorization.authority.actual.attempt }), { owner: context.owner, repo: context.repo, runId: context.runId, explicitAuthority: authorization.authority }).getFailingRun(context.runId) : undefined;
  const nativeStep = nativeRun?.failedSteps.find(step => step.diagnostics?.logSha256 === authorization?.packet.nativeLogSha256);
  if (authorization && !nativeStep?.diagnostics?.complete) throw new Error('Complete authenticated native step diagnostics differ from packet');
  if (!authorization) await authenticateVerifyRun(octokit.rest.actions, context.owner, context.repo, context.runId, inputs.sourceSha);
  const root = await mkdtemp(join(tmpdir(), 'sutura-verify-action-'));
  const repository = new GitRepository({ token: context.githubToken, workspaceRoot: root });
  let snapshot: Awaited<ReturnType<typeof snapshotCleanSourceAt>> | undefined;
  try {
    const name = `${context.owner}/${context.repo}`;
    const source = await repository.checkoutHead(name, inputs.sourceSha);
    const policySource = inputs.policyBaseSha === inputs.sourceSha ? source : await repository.checkoutHead(name, inputs.policyBaseSha);
    const trusted = await readTrustedPolicyAtCommit(policySource, inputs.policyBaseSha);
    const validated = verifyActionRequest(inputs, source, { policy: trusted.policy });
    if (authorization && validated.request.failingCommand !== authorization.packet.fullCommand) throw new Error('Supplied verification command differs from approved profile');
    snapshot = await snapshotCleanSourceAt(source, inputs.sourceSha);
    const config = context.config;
    if (!config.contreeToken || !config.contreeProject)
      throw Error('Verification needs ConTree configuration');
    const llm = createTokenFactoryClient({ apiKey: config.nebiusApiKey, models: config.models, routingProfileId: config.routingProfileId });
    const secondOpinion = config.openaiApiKey ? new OpenAiClient({ apiKey: config.openaiApiKey, ledger: llm.ledger }) : undefined;
    const typesafeAudit = config.typesafeApiKey ? new TypeSafeClient({ apiKey: config.typesafeApiKey, ledger: llm.ledger }) : undefined;
    const executor = new ContreeExecutor({ token: config.contreeToken, project: config.contreeProject, maxOps: config.maxOps });
    let grantBookkeeping: 'not-requested' | 'attempted' | 'recorded' = 'not-requested';
    const result = await executeExternalVerification({ mode: 'live', controllerStartedAt, ...(authorization && nativeStep?.diagnostics ? { nativeFailure: { command: authorization.packet.fullCommand, log: nativeStep.log, ...(nativeStep.truncated === undefined ? {} : { truncated: nativeStep.truncated }), diagnostics: nativeStep.diagnostics }, authorizeVerification: async plan => { await executor.verifyDeadlineSupport(plan.profile.providerTimeoutLimitKey, authorization.packet.providerMaxTimeoutSec); grantBookkeeping = 'attempted'; const capability = await authorizeActionVerification({ packet: authorization.packet, plan, authority: authorization.authority }); grantBookkeeping = 'recorded'; return capability; } } : {}), request: validated.request, policy: trusted.policy, executor, llm, ...(secondOpinion ? { secondOpinion } : {}), ...(typesafeAudit ? { typesafeAudit } : {}), sourceDir: snapshot.dir, snapshotSha256: snapshot.snapshotSha256, policySha256: trusted.sha === 'default' ? createHash('sha256').update(JSON.stringify(trusted.policy)).digest('hex') : trusted.sha, budgets: config.repairBudgets });
    const evidence = { schemaVersion: authorization ? 'sutura-action-verification-v2' : 'sutura-action-verification-v1', repository: name, runId: context.runId, sourceSha: inputs.sourceSha, policyBaseSha: inputs.policyBaseSha, snapshotSha256: snapshot.snapshotSha256, diffSha256: createHash('sha256').update(inputs.candidateDiff).digest('hex'), ...result, ...(authorization ? { sourceMutation: false, repairPublication: false, grantBookkeeping } : { repositoryMutation: false }) };
    const file = join(root, 'verification.json');
    await writeFile(file, JSON.stringify(evidence, null, 2), 'utf8');
    await new DefaultArtifactClient().uploadArtifact(`sutura-verification-${context.runId}`, [file], root);
    await core.summary.addHeading('Sutura supplied patch verification').addCodeBlock(JSON.stringify({ status: result.status, blockingGate: result.verification.blockingGate, challengeAssurance: result.verification.challengeAssurance, sourceSha: inputs.sourceSha, policyBaseSha: inputs.policyBaseSha }, null, 2), 'json').write();
    core.setOutput('verification-status', result.status);
    return { status: result.status };
  }
  finally {
    await snapshot?.cleanup();
    await rm(root, { recursive: true, force: true });
  }
}
export async function runActionVerification(inputs: ActionVerifyInputs, context: ActionVerificationContext, dependencies: {
  execute: typeof execute;
} = { execute }): Promise<ActionVerificationOutcome> {
  return dependencies.execute(inputs, context);
}
