import { consumeVerificationAllowance, verificationOperationPermit, type FinalVerificationPhase, type VerificationAllowance } from '../engine/verification-allowance.js';
import { randomUUID } from 'node:crypto';
import { BudgetExceededError, type RepairBudget, type RepairCapacityReservation } from '../engine/repair-budget.js';
import type { Executor, RunOptions } from '../executor/types.js';
import type { HealLlm } from '../heal.js';
import type { ChatMessage, ChatOptions, TierLlm } from '../llm/types.js';
import type { ModelPrice, ModelTier } from '../llm/cost.js';
import type { RepositoryPolicy } from '../policy/schema.js';

// A bounded audit request is reserved before repair. Larger requests abstain;
// no candidate or evidence is truncated to fit the reservation.
const AUDIT_REQUEST_BYTES = 32_000;
const AUDIT_OUTPUT_TOKENS = 4_096;
export function modelReservationUsd(bytes: number, tokens: number, price: ModelPrice): number {
  if (![price.input, price.output].every((value) => Number.isFinite(value) && value >= 0)) throw new Error('Invalid model price quote');
  return Math.max(0.000001, Math.ceil((bytes * price.input + tokens * price.output)) / 1_000_000);
}

interface BudgetedPortsInput {
  budget: RepairBudget;
  llm: HealLlm;
  executor: Executor;
  signal?: AbortSignal;
  /** Stable controller run prefix makes fresh recordings exactly replayable. */
  operationIdPrefix?: string;
}

export interface RecoveryAuditPorts {
  finalVerification?: boolean;
  executor: Executor;
  llm: HealLlm;
  beginAdjudication?(): void;
  finishAdjudication?(): void;
  remainingAdjudicationTimeSec?(): number;
  cancellationTimeSec?(): number;
  beginFinalVerification?(candidate: { imageId: string; diffSha256: string }): void;
  vetoBudget?: {
    reserveSecondOpinion: RepairBudget['reserveSecondOpinion']; settleSecondOpinion: RepairBudget['settleSecondOpinion'];
    reserveTypeSafeAudit: RepairBudget['reserveTypeSafeAudit']; settleTypeSafeAudit: RepairBudget['settleTypeSafeAudit'];
    remainingElapsedTimeSec(): number;
  };
  remainingTimeSec(): number;
  finish(): void;
}

/** Enforce a local deadline even if a provider ignores AbortSignal. */
export async function withinRecoveryDeadline<T>(
  seconds: number,
  signal: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>,
  cancel?: () => Promise<unknown>,
  timeoutError?: BudgetExceededError,
): Promise<T> {
  if (signal?.aborted) throw new Error('Recovery was cancelled');
  if (seconds <= 0) throw new BudgetExceededError('elapsedTimeSec');
  const timeoutController = new AbortController();
  const combined = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;
  const timer = setTimeout(() => timeoutController.abort(), Math.max(1, Math.floor(seconds * 1000)));
  let removeListener = () => {};
  try {
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () => {
        // Cancellation identifies the exact submitted operation. Retain the spent
        // reservation even when remote terminal confirmation is unavailable.
        if (cancel) void Promise.resolve().then(cancel).catch(() => {});
        reject(timeoutController.signal.aborted ? timeoutError ?? new BudgetExceededError('elapsedTimeSec') : new Error('Recovery was cancelled'));
      };
      removeListener = () => combined.removeEventListener('abort', onAbort);
      combined.addEventListener('abort', onAbort, { once: true });
    });
    return await Promise.race([work(combined), aborted]);
  } finally {
    clearTimeout(timer);
    removeListener();
  }
}

interface FinalAuditControl {
  allowance: VerificationAllowance;
  phase(): FinalVerificationPhase | undefined;
  operation(kind: RunOptions['verificationKind']): { remaining: number; maximum: number };
  modelRemaining(): number;
}

function ports(input: BudgetedPortsInput, reservation?: RepairCapacityReservation, final?: FinalAuditControl): { executor: Executor; llm: HealLlm } {
  const delegate = input.llm as TierLlm<ModelTier>;
  const operationIdPrefix = input.operationIdPrefix ?? `recovery-${randomUUID()}`;
  let operationIndex = 0;
  let fullOperationStarted = false;
  const executor: Executor = {
    importImage: (ref) => input.executor.importImage(ref),
    snapshot: (dir, base, options) => input.executor.snapshot(dir, base, options),
    operationCapacity: () => input.executor.operationCapacity(),
    cancel: (id) => input.executor.cancel(id),
    async run(parent, command, options?: RunOptions) {
      if (input.signal?.aborted) throw new Error('Recovery was cancelled');
      input.budget.reserveSandboxOperation(reservation);
      const operationId = options?.operationId ?? `${operationIdPrefix}-op-${String(++operationIndex).padStart(3, '0')}`;
      const phase = final?.phase();
      if (final && !phase) throw new Error('Final verification is not active');
      const allocation = final?.operation(options?.verificationKind);
      const remaining = allocation?.remaining ?? input.budget.remainingElapsedTimeSec(reservation);
      const operationLimit = Math.min(options?.timeoutSec ?? 120, allocation?.maximum ?? Infinity);
      const seconds = Math.min(operationLimit, remaining);
      // Preserve the same catch/stop path while naming the limit that fired.
      const timeoutError = operationLimit < remaining
        ? Object.assign(new BudgetExceededError('elapsedTimeSec'), {
          message: `Sandbox operation ${operationId} exceeded its per-operation deadline of ${seconds} seconds`,
          operationId, timeoutSec: seconds,
        }) : undefined;
      const permit = phase && !fullOperationStarted
        ? verificationOperationPermit(phase, parent, command, seconds) : undefined;
      if (phase) fullOperationStarted = true;
      return withinRecoveryDeadline(seconds, input.signal, () => input.executor.run(parent, command, {
        ...options, ...(permit === undefined ? {} : { verificationPermit: permit }), operationId, network: 'disabled', timeoutSec: seconds,
      }), () => input.executor.cancel(operationId), timeoutError);
    },
    async runMany(parent, commands, options) {
      const results = [];
      for (const command of commands) results.push(await executor.run(parent, command, options));
      return results;
    },
  };
  const llm: HealLlm = {
    ...(delegate.modelQuote ? { modelQuote: (...args: Parameters<NonNullable<typeof delegate.modelQuote>>) => delegate.modelQuote!(...args) } : {}),
    ...(delegate.modelId ? { modelId: (tier: ModelTier) => delegate.modelId!(tier) } : {}),
    ...(delegate.capacitySnapshot ? { capacitySnapshot: () => delegate.capacitySnapshot!() } : {}),
    async chat(tier, messages: readonly ChatMessage[], options?: ChatOptions) {
      if (final && (!final.phase() || final.modelRemaining() <= 0)) throw new BudgetExceededError('elapsedTimeSec');
      const signals = [input.signal, options?.signal].filter((value): value is AbortSignal => value !== undefined);
      const signal = signals.length ? AbortSignal.any(signals) : undefined;
      if (signal?.aborted) throw new Error('Recovery was cancelled');
      const tokens = options?.maxTokens ?? AUDIT_OUTPUT_TOKENS;
      // Bound only provider-visible content. Routing state can contain cyclic
      // controller identities and must never be serialized or charged as text.
      // The fixed allowance covers provider envelope keys/model identifiers.
      const bytes = 1_024 + Buffer.byteLength(JSON.stringify({
        messages,
        max_tokens: tokens,
        temperature: options?.temperature ?? 0,
        ...(options?.topP === undefined ? {} : { top_p: options.topP }),
        ...(options?.thinkingMode === undefined ? {} : { thinkingMode: options.thinkingMode }),
        ...(options?.reasoningEffort === undefined ? {} : { reasoning_effort: options.reasoningEffort }),
        ...(options?.responseFormat === undefined ? {} : { response_format: options.responseFormat }),
        ...(options?.tools === undefined ? {} : { tools: options.tools }),
        ...(options?.toolChoice === undefined ? {} : { tool_choice: options.toolChoice }),
      }));
      if (reservation && (tier !== 'ultra' || bytes > AUDIT_REQUEST_BYTES || tokens > AUDIT_OUTPUT_TOKENS)) throw new BudgetExceededError('inferenceCostUsd');
      const selected = options?.quotedRoute ?? delegate.modelQuote?.(tier, messages, options);
      const quote = selected === undefined ? undefined : Object.freeze({ ...selected, price: Object.freeze({ ...selected.price }) });
      if (!quote) throw new Error('Model price quote is unavailable');
      const turn = input.budget.reserveModelTurn(modelReservationUsd(bytes, tokens, quote.price), reservation);
      const reply = await withinRecoveryDeadline(final?.modelRemaining() ?? input.budget.remainingElapsedTimeSec(reservation), signal,
        (boundedSignal) => delegate.chat(tier, messages, { ...options, maxTokens: tokens, quotedRoute: quote, signal: boundedSignal }));
      if ((reply.usd ?? turn.reservedUsd) > turn.reservedUsd) throw new BudgetExceededError('inferenceCostUsd');
      input.budget.settleModelTurn(turn, reply.usd ?? turn.reservedUsd);
      return reply;
    },
  };
  return { executor, llm };
}

export function budgetedRecoveryPorts(input: BudgetedPortsInput): { executor: Executor; llm: HealLlm } {
  return ports(input);
}

export function reserveRecoveryAudit(input: BudgetedPortsInput & { policy: RepositoryPolicy; verificationAllowance?: VerificationAllowance }): RecoveryAuditPorts {
  const quote = input.llm.modelQuote?.('ultra', [], { maxTokens: AUDIT_OUTPUT_TOKENS });
  if (!quote) throw new Error('Audit model price quote is unavailable');
  const perTurn = modelReservationUsd(AUDIT_REQUEST_BYTES, AUDIT_OUTPUT_TOKENS, quote.price);
  const reservation = input.budget.reserveCapacity({ modelTurns: 2, sandboxOperations: 1 + input.policy.requiredCommands.length * 2 + (input.policy.verification?.mode === 'disabled' ? 0 : ((input.policy.verification?.contracts.length ?? 0) > 0 ? 6 : 0)), inferenceCostUsd: perTurn * 2, elapsedTimeSec: input.verificationAllowance ? 0 : 60 });
  let active = true;
  let phase: FinalVerificationPhase | undefined;
  const allowance = input.verificationAllowance;
  const remaining = () => input.budget.remainingElapsedTimeSec(reservation);
  let policyCalls = input.policy.requiredCommands.length * 2;
  let challengeCalls = input.policy.verification?.mode !== 'disabled' && (input.policy.verification?.contracts.length ?? 0) > 0 ? 6 : 0;
  let fullStarted = false;
  let adjudication: 'pending' | 'active' | 'complete' = 'pending';
  let adjudicationStartRemaining = 0;
  const modelRemaining = () => allowance && adjudication === 'active' ? Math.max(0, Math.min(
    allowance.packet.adjudicationSec - (adjudicationStartRemaining - remaining()),
    remaining() - policyCalls * allowance.packet.policyTimeoutSec,
  )) : 0;
  const final: FinalAuditControl | undefined = allowance ? { allowance, phase: () => phase, modelRemaining,
    operation(kind) {
      const packet = allowance.packet;
      if (kind === 'full' && !fullStarted && adjudication === 'pending') fullStarted = true;
      else if (kind === 'challenge' && fullStarted && adjudication === 'pending' && challengeCalls > 0) challengeCalls--;
      else if (kind === 'policy' && adjudication === 'complete' && policyCalls > 0) policyCalls--;
      else throw new BudgetExceededError('sandboxOperations');
      const hold = policyCalls * packet.policyTimeoutSec + (adjudication === 'pending' ? packet.adjudicationSec + challengeCalls * packet.challengeTimeoutSec : 0);
      return { remaining: Math.max(0, remaining() - hold), maximum: kind === 'full' ? packet.fullTimeoutSec : kind === 'challenge' ? packet.challengeTimeoutSec : packet.policyTimeoutSec };
    },
  } : undefined;
  return {
    ...ports({ ...input, operationIdPrefix: `${input.operationIdPrefix ?? `recovery-${randomUUID()}`}-audit` }, reservation, final),
    ...(final === undefined ? {} : {
      finalVerification: true,
      beginAdjudication() {
        if (!fullStarted || adjudication !== 'pending') throw new BudgetExceededError('elapsedTimeSec');
        adjudication = 'active'; challengeCalls = 0; adjudicationStartRemaining = remaining();
        if (modelRemaining() <= 0) throw new BudgetExceededError('elapsedTimeSec');
      },
      finishAdjudication() {
        const valid = modelRemaining() > 0;
        adjudication = 'complete';
        if (!valid) throw new BudgetExceededError('elapsedTimeSec');
      },
      remainingAdjudicationTimeSec: modelRemaining,
      cancellationTimeSec: () => Math.min(final.allowance.packet.cancellationSec, remaining()),
      beginFinalVerification(candidate: { imageId: string; diffSha256: string }) {
        phase = consumeVerificationAllowance(final.allowance, candidate);
        input.budget.transferToFinalVerification(reservation, phase);
      },
      vetoBudget: {
        reserveSecondOpinion: (usd: number) => input.budget.reserveSecondOpinion(usd, reservation),
        settleSecondOpinion: input.budget.settleSecondOpinion.bind(input.budget),
        reserveTypeSafeAudit: (usd: number) => input.budget.reserveTypeSafeAudit(usd, reservation),
        settleTypeSafeAudit: input.budget.settleTypeSafeAudit.bind(input.budget),
        remainingElapsedTimeSec: () => input.budget.remainingElapsedTimeSec(reservation),
      },
    }),
    remainingTimeSec: () => input.budget.remainingElapsedTimeSec(reservation),
    finish() {
      if (active) {
        input.budget.releaseCapacity(reservation);
        active = false;
      }
    },
  };
}
