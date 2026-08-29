import type { ModelTier, TokenUsage } from './cost.js';
import type { FailureClass } from '../domain.js';
import type { ModelRouteDecision } from './router.js';

export type JsonSchema = Readonly<Record<string, unknown>>;

export interface SystemMessage {
  role: 'system';
  content: string;
}

export interface UserMessage {
  role: 'user';
  content: string;
}

export interface FunctionToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface AssistantMessage {
  role: 'assistant';
  content?: string | null;
  toolCalls?: readonly FunctionToolCall[];
}

export interface ToolMessage {
  role: 'tool';
  toolCallId: string;
  content: string;
}

export type ChatMessage =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolMessage;

export interface FunctionToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: JsonSchema;
    strict?: boolean;
  };
}

export type ToolChoice = 'none' | 'auto';

export type ResponseFormat =
  | { type: 'json_object' }
  | {
      type: 'json_schema';
      jsonSchema: {
        name: string;
        strict: true;
        schema: JsonSchema;
      };
    };

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  responseFormat?: ResponseFormat;
  tools?: readonly FunctionToolDefinition[];
  toolChoice?: ToolChoice;
  signal?: AbortSignal;
  routing?: {
    failureClass: FailureClass | null;
    diagnosisConfidence: number | null;
    remainingInferenceBudgetUsd: number;
  };
}

export interface CapacitySnapshot {
  readonly remainingRequests: number | null;
  readonly remainingTokens: number | null;
  readonly resetRequestsSec: number | null;
  readonly resetTokensSec: number | null;
  readonly dynamicRequestScale: number | null;
  readonly dynamicTokenScale: number | null;
  readonly windowUsageRequests: number | null;
  readonly windowUsageTokens: number | null;
  readonly retryAfterSec: number | null;
  readonly requestId: string | null;
}

export interface LlmReply {
  /** Empty for a valid tool-only response. */
  text: string;
  /** The provider's unmodified message content. */
  raw: string | null;
  toolCalls: readonly FunctionToolCall[];
  finishReason: string | null;
  usage: TokenUsage;
  usd: number;
  capacity: CapacitySnapshot;
  model: string;
  latencyMs: number;
  requestId: string | null;
}

export type TierLlmReply = { text: string } & Partial<Omit<LlmReply, 'text'>>;

export interface TierLlm<Tier extends ModelTier> {
  capacitySnapshot?(): CapacitySnapshot | undefined;
  modelId?(tier: Tier): string;
  modelQuote?(
    tier: Tier,
    messages: readonly ChatMessage[],
    options?: ChatOptions,
  ): ModelRouteDecision;
  chat(
    tier: Tier,
    messages: readonly ChatMessage[],
    options?: ChatOptions,
  ): Promise<TierLlmReply>;
}
