import { Buffer } from 'node:buffer';

import type { Candidate, Diagnosis, RepairFailureKind } from '../domain.js';
import type { Executor, ImageId, RunResult } from '../executor/types.js';
import type { CapacitySnapshot, ChatMessage, FunctionToolCall, TierLlm } from '../llm/types.js';
import { DEFAULT_MODEL_PRICES } from '../llm/cost.js';
import type { RepositoryPolicy } from '../policy/schema.js';
import { redactExternalJsonValue, redactExternalText } from '../security/external-text.js';
import { BudgetExceededError, type RepairBudget } from './repair-budget.js';
import {
  REPAIR_TOOL_DEFINITIONS,
  RepairToolRuntime,
  type RepairTestEvidence,
} from './repair-tools.js';
import type { RepairSourceContext } from './repair.js';

const MAX_AGENT_OUTPUT_TOKENS = 8_192;
const MINIMUM_AGENT_TURN_RESERVATION_USD = 0.05;
const MUTATING_TOOLS = new Set(['apply_patch', 'submit_candidate']);

export type RepairAgentOutcome =
  | {
      status: 'submitted';
      candidate: Candidate;
      imageId: ImageId;
      nodeId?: string;
      test: RepairTestEvidence;
    }
  | {
      status: 'checkpoint';
      candidate: Candidate;
      imageId: ImageId;
      nodeId?: string;
      test: RepairTestEvidence;
    }
  | { status: 'gave-up' | 'infra-stop'; reason: string; failureKind: RepairFailureKind };

export interface RepairAgentContext {
  llm: TierLlm<'super'>;
  executor: Executor;
  initialImageId: ImageId;
  diagnosis: Diagnosis;
  policy: RepositoryPolicy;
  budget: RepairBudget;
  trustedCommands: Readonly<Record<string, string>>;
  sourceContext: RepairSourceContext;
  branchId?: string;
  operationIdPrefix?: string;
  observeCapacity?: (capacity: CapacitySnapshot) => void;
  onOperationStart?: (operationId: string) => void;
  signal?: AbortSignal;
  observe?: (input: { result?: RunResult; imageId?: ImageId; parentImageId: ImageId; note: string }) => string;
}

function initialMessages(ctx: RepairAgentContext): ChatMessage[] {
  const evidence = redactExternalJsonValue({
    diagnosis: ctx.diagnosis,
    initialSources: ctx.sourceContext.sources,
    trustedCommandIds: Object.keys(ctx.trustedCommands),
  });
  return [
    {
      role: 'system',
      content: [
        'Repair the diagnosed CI failure using only the supplied tools.',
        'Call exactly the tools needed. tool_choice is required.',
        'Do not reveal hidden reasoning. Do not weaken tests or policy.',
        'Only submit after the latest trusted test passes.',
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify(evidence) },
  ];
}

function fingerprint(call: FunctionToolCall): string {
  return `${call.function.name}:${call.function.arguments}`;
}

function publicReason(value: string): string {
  return redactExternalText(value).text.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 300);
}

function worstCaseRequestUsd(messages: readonly ChatMessage[]): number {
  const requestBytes = Buffer.byteLength(JSON.stringify({
    messages,
    tools: REPAIR_TOOL_DEFINITIONS,
  }), 'utf8');
  const priced = (
    requestBytes * DEFAULT_MODEL_PRICES.super.input +
    MAX_AGENT_OUTPUT_TOKENS * DEFAULT_MODEL_PRICES.super.output
  ) / 1_000_000;
  return Math.max(
    MINIMUM_AGENT_TURN_RESERVATION_USD,
    Math.ceil(priced * 1_000_000) / 1_000_000,
  );
}

export async function runRepairAgent(ctx: RepairAgentContext): Promise<RepairAgentOutcome> {
  try {
    ctx.budget.reserveBranch();
  } catch (error) {
    return { status: 'gave-up', failureKind: 'budget', reason: publicReason(error instanceof Error ? error.message : String(error)) };
  }
  const tools = new RepairToolRuntime({
    executor: ctx.executor,
    initialImageId: ctx.initialImageId,
    diagnosis: ctx.diagnosis,
    policy: ctx.policy,
    budget: ctx.budget,
    trustedCommands: ctx.trustedCommands,
    sourceContext: ctx.sourceContext,
    ...(ctx.operationIdPrefix === undefined ? {} : { operationIdPrefix: ctx.operationIdPrefix }),
    ...(ctx.onOperationStart === undefined ? {} : { onOperationStart: ctx.onOperationStart }),
    ...(ctx.observe === undefined ? {} : { observe: ctx.observe }),
  });
  const messages = initialMessages(ctx);
  let previousInvalid = '';
  let repeatedInvalid = 0;
  let previousFailureState = '';
  let repeatedFailureState = 0;

  for (;;) {
    if (ctx.signal?.aborted) {
      return { status: 'gave-up', failureKind: 'sandbox', reason: 'Repair branch was cancelled' };
    }
    let reservation;
    try {
      reservation = ctx.budget.reserveModelTurn(worstCaseRequestUsd(messages));
    } catch (error) {
      return { status: 'gave-up', failureKind: 'budget', reason: publicReason(error instanceof Error ? error.message : String(error)) };
    }
    let reply;
    const controller = new AbortController();
    const timeoutMs = Math.max(
      1,
      Math.floor(ctx.budget.remainingElapsedTimeSec() * 1_000),
    );
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const requestSignal = ctx.signal === undefined
        ? controller.signal
        : AbortSignal.any([controller.signal, ctx.signal]);
      const request = ctx.llm.chat('super', messages, {
        maxTokens: MAX_AGENT_OUTPUT_TOKENS,
        temperature: 0.2,
        reasoningEffort: 'low',
        tools: REPAIR_TOOL_DEFINITIONS,
        toolChoice: 'required',
        parallelToolCalls: false,
        signal: requestSignal,
      });
      const elapsed = new Promise<never>((_resolve, reject) => {
        requestSignal.addEventListener(
          'abort',
          () => reject(controller.signal.aborted
            ? new BudgetExceededError('elapsedTimeSec')
            : new Error('Repair branch was cancelled')),
          { once: true },
        );
      });
      reply = await Promise.race([request, elapsed]);
      if (reply.capacity !== undefined) ctx.observeCapacity?.(reply.capacity);
      const actualUsd = reply.usd ?? reservation.reservedUsd;
      if (actualUsd > reservation.reservedUsd) {
        return { status: 'gave-up', failureKind: 'budget', reason: 'Model response exceeded its reserved worst-case cost' };
      }
      ctx.budget.settleModelTurn(reservation, actualUsd);
    } catch (error) {
      const reason = publicReason(error instanceof Error ? error.message : String(error));
      return error instanceof BudgetExceededError || controller.signal.aborted
        ? { status: 'gave-up', failureKind: 'budget', reason }
        : ctx.signal?.aborted
          ? { status: 'gave-up', failureKind: 'sandbox', reason: 'Repair branch was cancelled' }
        : { status: 'infra-stop', failureKind: 'provider', reason };
    } finally {
      clearTimeout(timeout);
    }
    const calls = reply.toolCalls ?? [];
    if (calls.length === 0 || (calls.length > 1 && calls.some(({ function: tool }) => MUTATING_TOOLS.has(tool.name)))) {
      const invalid = calls.length === 0 ? 'missing required tool call' : 'parallel mutating tool calls are forbidden';
      repeatedInvalid = previousInvalid === invalid ? repeatedInvalid + 1 : 1;
      previousInvalid = invalid;
      if (repeatedInvalid >= 2) return { status: 'gave-up', failureKind: 'invalid', reason: `Stopped after repeated ${invalid}` };
      messages.push({ role: 'user', content: invalid });
      continue;
    }
    messages.push({ role: 'assistant', content: null, toolCalls: calls });
    for (const call of calls) {
      let args: unknown;
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        args = null;
      }
      try {
        ctx.budget.reserveToolCall();
      } catch (error) {
        return { status: 'gave-up', failureKind: 'budget', reason: publicReason(error instanceof Error ? error.message : String(error)) };
      }
      const result = args === null
        ? { ok: false, kind: 'invalid' as const, message: 'Tool arguments must be valid JSON' }
        : await tools.execute(call.function.name, args);
      const toolMessage = publicReason(JSON.stringify({ ok: result.ok, kind: result.kind, message: result.message, exitCode: result.exitCode }));
      messages.push({ role: 'tool', toolCallId: call.id, content: toolMessage });
      if (result.submitted && result.candidate && result.imageId) {
        const state = tools.state();
        if (!state.latestTest) return { status: 'gave-up', failureKind: 'invalid', reason: 'Submission lacked test evidence' };
        return {
          status: 'submitted', candidate: result.candidate, imageId: result.imageId,
          ...(result.nodeId === undefined ? {} : { nodeId: result.nodeId }), test: state.latestTest,
        };
      }
      const invalidFingerprint = result.ok ? '' : `${fingerprint(call)}:${result.kind ?? 'invalid'}`;
      repeatedInvalid = invalidFingerprint && invalidFingerprint === previousInvalid ? repeatedInvalid + 1 : invalidFingerprint ? 1 : 0;
      previousInvalid = invalidFingerprint;
      if (repeatedInvalid >= 2) return { status: 'gave-up', failureKind: result.kind ?? 'invalid', reason: 'Stopped after repeated identical invalid tool calls' };
      const state = tools.state();
      if (
        call.function.name === 'run_test' &&
        result.exitCode !== undefined &&
        result.exitCode !== 0 &&
        state.cumulativeDiff &&
        state.latestTest
      ) {
        return {
          status: 'checkpoint',
          candidate: {
            id: ctx.branchId ?? 'repair-checkpoint',
            rationale: 'Intermediate repair checkpoint after a trusted failing test.',
            diff: state.cumulativeDiff,
          },
          imageId: state.editableImageId,
          ...(state.lastNodeId === undefined ? {} : { nodeId: state.lastNodeId }),
          test: state.latestTest,
        };
      }
      const executionFailed = result.exitCode !== undefined && result.exitCode !== 0;
      const failureState = result.ok && !executionFailed
        ? ''
        : `${state.cumulativeDiff}:${result.message}:${result.exitCode ?? 'none'}`;
      repeatedFailureState = failureState && failureState === previousFailureState ? repeatedFailureState + 1 : failureState ? 1 : 0;
      previousFailureState = failureState;
      if (repeatedFailureState >= 2) return { status: 'gave-up', failureKind: result.kind ?? 'sandbox', reason: 'Stopped after repeated repair state and failure' };
    }
  }
}
