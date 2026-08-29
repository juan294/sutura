import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import type { Candidate } from '../domain.js';
import type { ChatMessage, ChatOptions, JsonSchema } from '../llm/types.js';
import { policyAllowsPatchPath } from '../policy/evaluate.js';
import { assertExternalEditableText, redactExternalJsonValue } from '../security/external-text.js';
import type { RepairAgentContext, RepairAgentOutcome } from './repair-agent.js';
import { publicRepairReason, requestRepairModel } from './repair-model-call.js';
import { RepairToolRuntime, type RepairToolResult } from './repair-tools.js';
import { isRepairPathAdmissible } from './patch-rules.js';
import {
  anchoredEditsDiff,
  indexRepairSourceLines,
  REPAIR_EDIT_FIELDS,
  REPAIR_PROPOSAL_FIELDS,
  REPAIR_PROPOSAL_LIMITS,
  SUPER_REPAIR_MAX_TOKENS,
} from './repair.js';

const REPAIR_ATTEMPT_MINIMUM_INFERENCE_USD = 0.05;

export const REPAIR_ATTEMPT_COSTS = Object.freeze({
  modelTurns: 1,
  toolCalls: 3,
  branches: 1,
  sandboxOperations: 2,
});

export interface RepairAttemptFeedback {
  candidateDiff: string;
  testOutput: string;
  errorFingerprint: string;
}

export interface ControlledRepairAttemptContext extends RepairAgentContext {
  feedback?: RepairAttemptFeedback;
  proposalTemplate?: ControlledRepairProposalTemplate;
  proposalContract?: RepairProposalContract;
}

interface RepairProposal {
  id: string;
  rationale: string;
  edits: unknown[];
}

interface SourceEvidence {
  path: string;
  startLine: number;
  endLine: number;
  truncated: boolean;
  editable: boolean;
  lines: Array<{ line: number; text: string }>;
}

export interface RepairProposalContract {
  messages: ChatMessage[];
  schema: JsonSchema;
  requestBytes: number;
}

export interface ControlledRepairProposalTemplate {
  contract(feedback?: RepairAttemptFeedback): RepairProposalContract;
}

export class RepairProposalPreparationError extends Error {
  constructor(
    readonly failureKind: 'invalid' | 'policy',
    message: string,
  ) {
    super(message);
    this.name = 'RepairProposalPreparationError';
  }
}

const PROPOSAL_FIELD_NAMES = new Set<string>(Object.values(REPAIR_PROPOSAL_FIELDS));
const REPAIR_PROPOSAL_EXAMPLE = Object.freeze({
  [REPAIR_PROPOSAL_FIELDS.id]: 'short-id',
  [REPAIR_PROPOSAL_FIELDS.rationale]: 'short reason',
  [REPAIR_PROPOSAL_FIELDS.edits]: [{
    [REPAIR_EDIT_FIELDS.path]: 'supplied/path.ts',
    [REPAIR_EDIT_FIELDS.startLine]: 1,
    [REPAIR_EDIT_FIELDS.endLine]: 1,
    [REPAIR_EDIT_FIELDS.replacement]: 'complete replacement',
  }],
});

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sourceEvidence(ctx: Pick<ControlledRepairAttemptContext, 'diagnosis' | 'policy' | 'sourceContext'>): SourceEvidence[] {
  return ctx.sourceContext.sources.flatMap((source) => {
    assertExternalEditableText(source.content);
    let lines: ReturnType<typeof indexRepairSourceLines>;
    try {
      lines = indexRepairSourceLines(source);
    } catch (error) {
      throw new RepairProposalPreparationError(
        'invalid', error instanceof Error ? error.message : String(error),
      );
    }
    if (lines.length === 0) return [];
    return [{
      path: source.path,
      startLine: source.startLine,
      endLine: lines.at(-1)!.line,
      truncated: source.truncated,
      editable: isRepairPathAdmissible(source.path, ctx.diagnosis) &&
        policyAllowsPatchPath(source.path, ctx.policy),
      lines: lines.map(({ line, text }) => ({ line, text })),
    }];
  });
}

function proposalSchema(sources: readonly SourceEvidence[]): JsonSchema {
  const editSchemas = sources.map((source) => ({
    type: 'object',
    properties: {
      [REPAIR_EDIT_FIELDS.path]: { type: 'string', const: source.path },
      [REPAIR_EDIT_FIELDS.startLine]: { type: 'integer', minimum: source.startLine, maximum: source.endLine },
      [REPAIR_EDIT_FIELDS.endLine]: { type: 'integer', minimum: source.startLine, maximum: source.endLine },
      [REPAIR_EDIT_FIELDS.replacement]: { type: 'string', maxLength: REPAIR_PROPOSAL_LIMITS.replacementCodePoints },
    },
    required: Object.values(REPAIR_EDIT_FIELDS),
    additionalProperties: false,
  }));
  return {
    type: 'object',
    properties: {
      [REPAIR_PROPOSAL_FIELDS.id]: { type: 'string', minLength: 1, maxLength: REPAIR_PROPOSAL_LIMITS.idCodePoints, pattern: '\\S' },
      [REPAIR_PROPOSAL_FIELDS.rationale]: { type: 'string', minLength: 1, maxLength: REPAIR_PROPOSAL_LIMITS.rationaleCodePoints, pattern: '\\S' },
      [REPAIR_PROPOSAL_FIELDS.edits]: {
        type: 'array',
        minItems: 1,
        maxItems: REPAIR_PROPOSAL_LIMITS.edits,
        items: editSchemas.length === 1 ? editSchemas[0] : { oneOf: editSchemas },
      },
    },
    required: Object.values(REPAIR_PROPOSAL_FIELDS),
    additionalProperties: false,
  };
}

export function prepareControlledRepairProposalTemplate(
  ctx: Pick<ControlledRepairAttemptContext, 'diagnosis' | 'policy' | 'sourceContext'>,
): ControlledRepairProposalTemplate {
  const sources = sourceEvidence(ctx);
  if (sources.length === 0) {
    throw new RepairProposalPreparationError(
      'invalid', 'No non-empty anchorable repair source was available',
    );
  }
  const editableSources = sources.filter(({ editable }) => editable);
  if (editableSources.length === 0) {
    throw new RepairProposalPreparationError(
      'policy', 'No policy-admissible bounded repair source was available',
    );
  }
  const schema = proposalSchema(editableSources);
  const evidence = {
    diagnosis: redactExternalJsonValue(ctx.diagnosis),
    sources,
    trustedCommandId: 'diagnosed',
  };
  const systemMessage: ChatMessage = {
    role: 'system',
    content: [
      'Return one complete replacement repair proposal as strict JSON.',
      `Return exactly this shape: ${JSON.stringify(REPAIR_PROPOSAL_EXAMPLE)}`,
      'Use only a path permitted by the response schema and its numbered inclusive line range. Never reuse a line number from another path or a stack trace.',
      'For each edit, new must be the complete replacement text for startLine through endLine, without the supplied line number.',
      ctx.diagnosis.class === 'test-bug'
        ? 'Repair the diagnosed test defect; do not change policy.'
        : 'The failing assertion declares required behavior. Repair production source; do not change tests or policy.',
      'Use an empty new value only to delete the selected lines.',
      'Repair the diagnosed cause with the smallest direct edit.',
      'Do not include analysis or markdown.',
      'A previousAttempt is feedback only; this proposal will be applied to the clean baseline.',
    ].join('\n'),
  };
  const cache = new Map<string, RepairProposalContract>();
  return {
    contract(feedback) {
      const redactedFeedback = feedback === undefined
        ? undefined
        : redactExternalJsonValue(feedback);
      const key = redactedFeedback === undefined
        ? 'baseline'
        : digest(JSON.stringify(redactedFeedback));
      const existing = cache.get(key);
      if (existing !== undefined) return existing;
      const messages: ChatMessage[] = [
        systemMessage,
        {
          role: 'user',
          content: JSON.stringify({
            ...evidence,
            ...(redactedFeedback === undefined ? {} : { previousAttempt: redactedFeedback }),
          }),
        },
      ];
      const contract = {
        schema,
        messages,
        requestBytes: Buffer.byteLength(JSON.stringify({ messages, responseSchema: schema }), 'utf8'),
      };
      cache.set(key, contract);
      return contract;
    },
  };
}

function proposalContract(ctx: ControlledRepairAttemptContext): RepairProposalContract {
  if (ctx.proposalContract !== undefined) return ctx.proposalContract;
  const template = ctx.proposalTemplate ?? prepareControlledRepairProposalTemplate(ctx);
  return template.contract(ctx.feedback);
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
  const id = record[REPAIR_PROPOSAL_FIELDS.id];
  const rationale = record[REPAIR_PROPOSAL_FIELDS.rationale];
  const edits = record[REPAIR_PROPOSAL_FIELDS.edits];
  if (
    Object.keys(record).some((key) => !PROPOSAL_FIELD_NAMES.has(key)) ||
    typeof id !== 'string' || !/\S/u.test(id) ||
    [...id].length > REPAIR_PROPOSAL_LIMITS.idCodePoints ||
    typeof rationale !== 'string' || !/\S/u.test(rationale) ||
    [...rationale].length > REPAIR_PROPOSAL_LIMITS.rationaleCodePoints ||
    !Array.isArray(edits) || edits.length === 0 ||
    edits.length > REPAIR_PROPOSAL_LIMITS.edits
  ) throw new TypeError('Repair proposal does not match the strict schema');
  return { id, rationale, edits };
}

function worstCaseRequestUsd(
  requestBytes: number, inputPrice: number, outputPrice: number,
): number {
  const priced = (requestBytes * inputPrice + SUPER_REPAIR_MAX_TOKENS * outputPrice) / 1_000_000;
  return Math.max(REPAIR_ATTEMPT_MINIMUM_INFERENCE_USD, Math.ceil(priced * 1_000_000) / 1_000_000);
}

function proposalOptions(ctx: ControlledRepairAttemptContext, schema: JsonSchema): ChatOptions {
  return {
    maxTokens: SUPER_REPAIR_MAX_TOKENS,
    temperature: 1,
    reasoningEffort: 'low',
    responseFormat: {
      type: 'json_schema',
      jsonSchema: { name: 'sutura_repair_proposal', strict: true, schema },
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
  const { messages, schema, requestBytes } = proposalContract(ctx);
  const options = proposalOptions(ctx, schema);
  const quote = ctx.llm.modelQuote?.('super', messages, options);
  if (quote === undefined) throw new Error('Repair model routing quote is unavailable');
  return worstCaseRequestUsd(requestBytes, quote.price.input, quote.price.output);
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
  let contract: RepairProposalContract;
  try {
    contract = proposalContract(ctx);
  } catch (error) {
    return {
      status: 'gave-up',
      failureKind: error instanceof RepairProposalPreparationError ? error.failureKind : 'policy',
      reason: publicRepairReason(error instanceof Error ? error.message : String(error)),
    };
  }
  const { messages, schema, requestBytes } = contract;
  const options = proposalOptions(ctx, schema);
  const response = await requestRepairModel({
    llm: ctx.llm, budget: ctx.budget, messages, options,
    worstCaseUsd: (price) => worstCaseRequestUsd(requestBytes, price.input, price.output),
    ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
    ...(ctx.observeCapacity === undefined ? {} : { observeCapacity: ctx.observeCapacity }),
  });
  if (!response.ok) return response.outcome;
  const { reply } = response;
  if (reply.finishReason === 'length') {
    return {
      status: 'gave-up', failureKind: 'completion-limit',
      reason: 'Repair proposal reached the provider completion-token limit',
    };
  }
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
