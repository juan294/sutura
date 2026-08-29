import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import type { Candidate } from '../domain.js';
import type { ChatMessage, ChatOptions, JsonSchema } from '../llm/types.js';
import { assertExternalEditableText, redactExternalJsonValue } from '../security/external-text.js';
import type { RepairAgentContext, RepairAgentOutcome } from './repair-agent.js';
import { publicRepairReason, requestRepairModel } from './repair-model-call.js';
import { RepairToolRuntime, type RepairToolResult } from './repair-tools.js';
import { anchoredEditsDiff, REPAIR_PROPOSAL_LIMITS } from './repair.js';

const MAX_PROPOSAL_TOKENS = 8_192;
const REPAIR_ATTEMPT_MINIMUM_INFERENCE_USD = 0.05;

export const REPAIR_ATTEMPT_COSTS = Object.freeze({
  modelTurns: 1,
  toolCalls: 3,
  branches: 1,
  sandboxOperations: 2,
});

const REPAIR_PROPOSAL_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1, maxLength: REPAIR_PROPOSAL_LIMITS.idCodePoints, pattern: '\\S' },
    rationale: { type: 'string', minLength: 1, maxLength: REPAIR_PROPOSAL_LIMITS.rationaleCodePoints, pattern: '\\S' },
    edits: {
      type: 'array',
      minItems: 1,
      maxItems: REPAIR_PROPOSAL_LIMITS.edits,
      items: {
        type: 'object',
        properties: {
          path: { type: 'string', minLength: 1, maxLength: REPAIR_PROPOSAL_LIMITS.pathCodePoints, pattern: '\\S' },
          startLine: { type: 'integer', minimum: 1, maximum: REPAIR_PROPOSAL_LIMITS.line },
          endLine: { type: 'integer', minimum: 1, maximum: REPAIR_PROPOSAL_LIMITS.line },
          new: { type: 'string', maxLength: REPAIR_PROPOSAL_LIMITS.replacementCodePoints },
        },
        required: ['path', 'startLine', 'endLine', 'new'],
        additionalProperties: false,
      },
    },
  },
  required: ['id', 'rationale', 'edits'],
  additionalProperties: false,
};

export interface RepairAttemptFeedback {
  candidateDiff: string;
  testOutput: string;
  errorFingerprint: string;
}

export interface ControlledRepairAttemptContext extends RepairAgentContext {
  feedback?: RepairAttemptFeedback;
}

interface RepairProposal {
  id: string;
  rationale: string;
  edits: unknown[];
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function proposalMessages(ctx: ControlledRepairAttemptContext): ChatMessage[] {
  for (const source of ctx.sourceContext.sources) assertExternalEditableText(source.content);
  const evidence = redactExternalJsonValue({
    diagnosis: ctx.diagnosis,
    sources: ctx.sourceContext.sources,
    trustedCommandId: 'diagnosed',
    ...(ctx.feedback === undefined ? {} : { previousAttempt: ctx.feedback }),
  });
  return [
    {
      role: 'system',
      content: [
        'Return one complete replacement repair proposal as strict JSON.',
        'Use only exact supplied source paths and inclusive line ranges inside supplied excerpts.',
        'For each edit, new must be the complete replacement text for startLine through endLine, not a partial expression.',
        'Use an empty new value only to delete the selected lines.',
        'Repair the diagnosed cause with the smallest direct edit.',
        'Do not change tests or policy. Do not include analysis or markdown.',
        'A previousAttempt is feedback only; this proposal will be applied to the clean baseline.',
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify(evidence) },
  ];
}

function parseProposal(text: string): RepairProposal {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new SyntaxError('Repair proposal must be valid JSON', { cause: error });
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Repair proposal must be an object');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !['id', 'rationale', 'edits'].includes(key)) ||
    typeof record.id !== 'string' || !/\S/u.test(record.id) ||
    [...record.id].length > REPAIR_PROPOSAL_LIMITS.idCodePoints ||
    typeof record.rationale !== 'string' || !/\S/u.test(record.rationale) ||
    [...record.rationale].length > REPAIR_PROPOSAL_LIMITS.rationaleCodePoints ||
    !Array.isArray(record.edits) || record.edits.length === 0 ||
    record.edits.length > REPAIR_PROPOSAL_LIMITS.edits
  ) throw new TypeError('Repair proposal does not match the strict schema');
  return { id: record.id, rationale: record.rationale, edits: record.edits };
}

function worstCaseRequestUsd(messages: readonly ChatMessage[], inputPrice: number, outputPrice: number): number {
  const requestBytes = Buffer.byteLength(JSON.stringify({ messages, responseSchema: REPAIR_PROPOSAL_SCHEMA }), 'utf8');
  const priced = (requestBytes * inputPrice + MAX_PROPOSAL_TOKENS * outputPrice) / 1_000_000;
  return Math.max(REPAIR_ATTEMPT_MINIMUM_INFERENCE_USD, Math.ceil(priced * 1_000_000) / 1_000_000);
}

function proposalOptions(ctx: ControlledRepairAttemptContext): ChatOptions {
  return {
    maxTokens: MAX_PROPOSAL_TOKENS,
    temperature: 0.4,
    reasoningEffort: 'low',
    responseFormat: {
      type: 'json_schema',
      jsonSchema: { name: 'sutura_repair_proposal', strict: true, schema: REPAIR_PROPOSAL_SCHEMA },
    },
    routing: {
      failureClass: ctx.diagnosis.class,
      diagnosisConfidence: ctx.diagnosis.confidence,
      remainingInferenceBudgetUsd: Math.max(0, ctx.budget.limits.inferenceCostUsd - ctx.budget.snapshot().inferenceCostUsd),
    },
  };
}

export function controlledRepairAttemptReservationUsd(
  ctx: ControlledRepairAttemptContext,
): number {
  const messages = proposalMessages(ctx);
  const options = proposalOptions(ctx);
  const quote = ctx.llm.modelQuote?.('super', messages, options);
  if (quote === undefined) throw new Error('Repair model routing quote is unavailable');
  return worstCaseRequestUsd(messages, quote.price.input, quote.price.output);
}

export async function runControlledRepairAttempt(
  ctx: ControlledRepairAttemptContext,
): Promise<RepairAgentOutcome> {
  try {
    ctx.budget.reserveBranch();
  } catch (error) {
    return { status: 'gave-up', failureKind: 'budget', reason: publicRepairReason(error instanceof Error ? error.message : String(error)) };
  }
  if (ctx.signal?.aborted) {
    return { status: 'gave-up', failureKind: 'sandbox', reason: 'Repair branch was cancelled' };
  }
  if (ctx.sourceContext.sources.length === 0) {
    return { status: 'gave-up', failureKind: 'invalid', reason: 'No bounded editable repair source was available' };
  }
  let messages: ChatMessage[];
  try {
    messages = proposalMessages(ctx);
  } catch (error) {
    return { status: 'gave-up', failureKind: 'policy', reason: publicRepairReason(error instanceof Error ? error.message : String(error)) };
  }
  const options = proposalOptions(ctx);
  const response = await requestRepairModel({
    llm: ctx.llm, budget: ctx.budget, messages, options,
    worstCaseUsd: (price) => worstCaseRequestUsd(messages, price.input, price.output),
    ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
    ...(ctx.observeCapacity === undefined ? {} : { observeCapacity: ctx.observeCapacity }),
  });
  if (!response.ok) return response.outcome;
  const { reply } = response;
  let proposal: RepairProposal;
  let proposalDiff: string;
  try {
    proposal = parseProposal(reply.text);
    proposalDiff = anchoredEditsDiff(proposal.edits, ctx.sourceContext);
  } catch (error) {
    return { status: 'gave-up', failureKind: 'invalid', reason: publicRepairReason(error instanceof Error ? error.message : String(error)) };
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
  const execute = async (id: string, name: string, args: unknown): Promise<RepairToolResult> => {
    try {
      ctx.budget.reserveToolCall();
    } catch (error) {
      return { ok: false, kind: 'budget', message: publicRepairReason(error instanceof Error ? error.message : String(error)) };
    }
    ctx.trace?.record({
      type: 'tool-request', stage: 'candidate', toolCallId: id, toolName: name,
      argumentSummary: name === 'apply_patch'
        ? { form: 'anchored-line-ranges', proposalId: proposal.id, proposalHash: digest(JSON.stringify(proposal)), diffHash: digest(proposalDiff) }
        : name === 'run_test'
          ? { commandId: 'diagnosed' }
          : { candidateId: proposal.id, diffHash: digest(tools.state().cumulativeDiff) },
      ...(ctx.branchId === undefined ? {} : { childNodeId: ctx.branchId }),
    });
    const result = await tools.execute(name, args);
    ctx.trace?.record({
      type: 'tool-result', stage: 'candidate', toolCallId: id, toolName: name,
      resultSummary: JSON.stringify({ ok: result.ok, kind: result.kind ?? null, exitCode: result.exitCode ?? null, messageHash: digest(result.message) }),
      ...(ctx.branchId === undefined ? {} : { childNodeId: ctx.branchId }),
    });
    return result;
  };
  if (ctx.signal?.aborted) return { status: 'gave-up', failureKind: 'sandbox', reason: 'Repair branch was cancelled' };
  const applied = await execute(`${ctx.branchId ?? 'repair'}-apply`, 'apply_patch', { diff: proposalDiff });
  if (!applied.ok || applied.exitCode !== 0) {
    return { status: 'gave-up', failureKind: applied.kind ?? 'invalid', reason: 'Repair proposal patch was not accepted' };
  }
  if (ctx.signal?.aborted) return { status: 'gave-up', failureKind: 'sandbox', reason: 'Repair branch was cancelled' };
  const tested = await execute(`${ctx.branchId ?? 'repair'}-test`, 'run_test', { commandId: 'diagnosed' });
  if (ctx.signal?.aborted) return { status: 'gave-up', failureKind: 'sandbox', reason: 'Repair branch was cancelled' };
  const state = tools.state();
  if (!tested.ok || tested.exitCode === undefined || state.latestTest === undefined) {
    return { status: 'gave-up', failureKind: tested.kind ?? 'sandbox', reason: 'Automatic trusted test did not produce valid evidence' };
  }
  const candidate: Candidate = { id: proposal.id, rationale: proposal.rationale, diff: state.cumulativeDiff };
  if (tested.exitCode !== 0) {
    return {
      status: 'checkpoint', candidate, imageId: state.editableImageId,
      ...(state.lastNodeId === undefined ? {} : { nodeId: state.lastNodeId }), test: state.latestTest,
    };
  }
  const submitted = await execute(`${ctx.branchId ?? 'repair'}-submit`, 'submit_candidate', {
    id: proposal.id, rationale: proposal.rationale,
  });
  if (!submitted.ok || !submitted.submitted || !submitted.candidate || !submitted.imageId) {
    return { status: 'gave-up', failureKind: submitted.kind ?? 'invalid', reason: 'Automatic candidate submission failed' };
  }
  ctx.trace?.record({
    type: 'candidate-submitted', stage: 'candidate', candidateId: submitted.candidate.id,
    summary: submitted.candidate.rationale,
    ...(ctx.branchId === undefined ? {} : { childNodeId: ctx.branchId }),
  });
  return {
    status: 'submitted', candidate: submitted.candidate, imageId: submitted.imageId,
    ...(submitted.nodeId === undefined ? {} : { nodeId: submitted.nodeId }), test: state.latestTest,
  };
}
