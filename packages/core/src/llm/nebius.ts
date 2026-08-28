import {
  Ledger,
  type ModelPrices,
  type ModelTier,
} from './cost.js';
import type {
  CapacitySnapshot,
  ChatMessage,
  ChatOptions,
  FunctionToolCall,
  LlmReply,
  ResponseFormat,
} from './types.js';

export interface NebiusClientConfig {
  apiKey: string;
  baseUrl: string;
  models: Readonly<Record<ModelTier, string>>;
  prices: ModelPrices;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  headers: HttpHeaders;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface HttpHeaders {
  get(name: string): string | null;
}

export interface HttpRequestInit {
  method: string;
  headers: Readonly<Record<string, string>>;
  body: string;
}

type Fetch = (input: string, init: HttpRequestInit) => Promise<HttpResponse>;
type Sleep = (milliseconds: number) => Promise<void>;

export interface NebiusClientDependencies {
  fetch?: Fetch;
  sleep?: Sleep;
  random?: () => number;
  now?: () => number;
}

interface CompletionResponse {
  choices?: Array<{
    finish_reason?: unknown;
    message?: { content?: unknown; tool_calls?: unknown };
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    completion_tokens_details?: { reasoning_tokens?: unknown };
  };
}

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 250;
const RETRY_DEADLINE_MS = 30_000;
const MAX_TOOL_CALLS = 128;
const MAX_TOOL_ARGUMENT_CHARS = 1_000_000;
const MAX_RATE_RESET_SEC = 86_400;
const MAX_DYNAMIC_SCALE = 100;
const MAX_PERCENTAGE = 100;
const TOOL_CALL_ID = /^[A-Za-z0-9_-]{1,128}$/;
const FUNCTION_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const UNSIGNED_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function defaultSleep(milliseconds: number): Promise<void> {
  const { setTimeout } = globalThis as unknown as {
    setTimeout(callback: () => void, delay: number): unknown;
  };
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function stripThinkPrefix(content: string): string {
  return content.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '');
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new NebiusResponseError(`Invalid ${field} in Nebius response`);
  }
  return value as number;
}

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

function wireMessages(messages: readonly ChatMessage[]): readonly unknown[] {
  return messages.map((message) => {
    if (message.role === 'assistant') {
      return {
        role: message.role,
        ...(message.content !== undefined ? { content: message.content } : {}),
        ...(message.toolCalls ? { tool_calls: message.toolCalls } : {}),
      };
    }
    if (message.role === 'tool') {
      return {
        role: message.role,
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    }
    return message;
  });
}

function wireResponseFormat(format: ResponseFormat): unknown {
  if (format.type === 'json_object') {
    return format;
  }
  return {
    type: format.type,
    json_schema: format.jsonSchema,
  };
}

function parseDecimalHeader(
  headers: HttpHeaders,
  name: string,
  maximum: number,
  integer = false,
): number | null {
  const raw = headers.get(name)?.trim();
  if (!raw || !UNSIGNED_DECIMAL.test(raw)) {
    return null;
  }
  const value = Number(raw);
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    value > maximum ||
    (integer && !Number.isSafeInteger(value))
  ) {
    return null;
  }
  return value;
}

function capacitySnapshot(headers: HttpHeaders): CapacitySnapshot {
  const requestId = headers.get('x-request-id')?.trim() ?? '';
  return Object.freeze({
    remainingRequests: parseDecimalHeader(
      headers,
      'x-ratelimit-remaining-requests',
      Number.MAX_SAFE_INTEGER,
      true,
    ),
    remainingTokens: parseDecimalHeader(
      headers,
      'x-ratelimit-remaining-tokens',
      Number.MAX_SAFE_INTEGER,
      true,
    ),
    resetRequestsSec: parseDecimalHeader(
      headers,
      'x-ratelimit-reset-requests',
      MAX_RATE_RESET_SEC,
    ),
    resetTokensSec: parseDecimalHeader(
      headers,
      'x-ratelimit-reset-tokens',
      MAX_RATE_RESET_SEC,
    ),
    dynamicRequestScale: parseDecimalHeader(
      headers,
      'x-ratelimit-dynamic-scale-requests',
      MAX_DYNAMIC_SCALE,
    ),
    dynamicTokenScale: parseDecimalHeader(
      headers,
      'x-ratelimit-dynamic-scale-tokens',
      MAX_DYNAMIC_SCALE,
    ),
    windowUsageRequests: parseDecimalHeader(
      headers,
      'x-ratelimit-dynamic-period-usage-requests',
      MAX_PERCENTAGE,
    ),
    windowUsageTokens: parseDecimalHeader(
      headers,
      'x-ratelimit-dynamic-period-usage-tokens',
      MAX_PERCENTAGE,
    ),
    retryAfterSec: parseDecimalHeader(
      headers,
      'retry-after',
      RETRY_DEADLINE_MS / 1_000,
    ),
    requestId: REQUEST_ID.test(requestId) ? requestId : null,
  });
}

function parseToolCalls(value: unknown): readonly FunctionToolCall[] {
  if (value === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(value)) {
    throw new NebiusResponseError(
      'Invalid choices[0].message.tool_calls in Nebius response',
    );
  }
  if (value.length > MAX_TOOL_CALLS) {
    throw new NebiusResponseError(
      `Nebius response contains at most ${MAX_TOOL_CALLS} tool calls`,
    );
  }

  const seenIds = new Set<string>();
  return Object.freeze(value.map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new NebiusResponseError(`Invalid tool call at index ${index}`);
    }
    const call = item as {
      id?: unknown;
      type?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };
    if (typeof call.id !== 'string' || !TOOL_CALL_ID.test(call.id)) {
      throw new NebiusResponseError(`Invalid tool call id at index ${index}`);
    }
    if (seenIds.has(call.id)) {
      throw new NebiusResponseError(`Duplicate tool call id at index ${index}`);
    }
    seenIds.add(call.id);
    if (call.type !== 'function') {
      throw new NebiusResponseError(`Invalid tool call type at index ${index}`);
    }
    if (
      typeof call.function?.name !== 'string' ||
      !FUNCTION_NAME.test(call.function.name)
    ) {
      throw new NebiusResponseError(
        `Invalid tool call function name at index ${index}`,
      );
    }
    const args = call.function.arguments;
    if (typeof args !== 'string' || args.length > MAX_TOOL_ARGUMENT_CHARS) {
      throw new NebiusResponseError(`Invalid tool call arguments at index ${index}`);
    }
    let parsedArgs: unknown;
    try {
      parsedArgs = JSON.parse(args);
    } catch (error) {
      throw new NebiusResponseError(
        `Invalid tool call arguments JSON at index ${index}`,
        { cause: error },
      );
    }
    if (
      typeof parsedArgs !== 'object' ||
      parsedArgs === null ||
      Array.isArray(parsedArgs)
    ) {
      throw new NebiusResponseError(
        `Tool call arguments must be a JSON object at index ${index}`,
      );
    }
    return Object.freeze({
      id: call.id,
      type: 'function' as const,
      function: Object.freeze({ name: call.function.name, arguments: args }),
    });
  }));
}

export class NebiusApiError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly body: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'NebiusApiError';
  }

  static fromResponse(status: number, body: string): NebiusApiError {
    if (status === 401) {
      return new NebiusApiError(
        `Nebius authentication failed: ${body}`,
        status,
        body,
      );
    }
    if (status === 404) {
      return new NebiusApiError(
        `Nebius model was not found: ${body}`,
        status,
        body,
      );
    }
    return new NebiusApiError(
      `Nebius request failed with status ${status}: ${body}`,
      status,
      body,
    );
  }
}

export class NebiusResponseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NebiusResponseError';
  }
}

export class NebiusClient {
  readonly ledger: Ledger;

  private readonly fetch: Fetch;
  private readonly sleep: Sleep;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(
    private readonly config: NebiusClientConfig,
    dependencies: NebiusClientDependencies = {},
  ) {
    const runtimeFetch = (globalThis as unknown as { fetch?: Fetch }).fetch;
    if (!dependencies.fetch && !runtimeFetch) {
      throw new Error('This runtime does not provide fetch');
    }
    this.fetch = dependencies.fetch ?? (runtimeFetch as Fetch);
    this.sleep = dependencies.sleep ?? defaultSleep;
    this.random = dependencies.random ?? Math.random;
    this.now = dependencies.now ?? Date.now;
    this.ledger = new Ledger(config.prices);
  }

  async chat(
    tier: ModelTier,
    messages: readonly ChatMessage[],
    options: ChatOptions = {},
  ): Promise<LlmReply> {
    const maxTokens = options.maxTokens ?? 4_096;
    if (!Number.isSafeInteger(maxTokens) || maxTokens < 2_000) {
      throw new RangeError('maxTokens must be an integer of at least 2000');
    }

    const body = {
      model: this.config.models[tier],
      messages: wireMessages(messages),
      max_tokens: maxTokens,
      temperature: options.temperature ?? 0,
      ...(options.reasoningEffort
        ? { reasoning_effort: options.reasoningEffort }
        : {}),
      ...(options.responseFormat
        ? { response_format: wireResponseFormat(options.responseFormat) }
        : {}),
      ...(options.tools ? { tools: options.tools } : {}),
      ...(options.toolChoice ? { tool_choice: options.toolChoice } : {}),
      ...(options.parallelToolCalls !== undefined
        ? { parallel_tool_calls: options.parallelToolCalls }
        : {}),
    };
    const requestUrl = endpoint(this.config.baseUrl);
    const request: HttpRequestInit = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    };

    const retryDeadline = this.now() + RETRY_DEADLINE_MS;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      let response: HttpResponse;
      try {
        response = await this.fetch(requestUrl, request);
      } catch (error) {
        if (attempt < MAX_RETRIES) {
          const delay = this.localBackoff(attempt);
          if (!(await this.waitForRetry(delay, retryDeadline))) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new NebiusApiError(
              `Nebius request retry deadline exceeded: ${detail}`,
              undefined,
              detail,
              { cause: error },
            );
          }
          continue;
        }
        const detail = error instanceof Error ? error.message : String(error);
        throw new NebiusApiError(
          `Nebius request failed after ${MAX_RETRIES + 1} attempts: ${detail}`,
          undefined,
          detail,
          { cause: error },
        );
      }

      if (response.ok) {
        return this.parseReply(tier, await response.json(), response.headers);
      }

      const responseBody = await response.text();
      const error = NebiusApiError.fromResponse(response.status, responseBody);
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_RETRIES) {
        throw error;
      }
      const retryAfter = response.status === 429
        ? parseDecimalHeader(
            response.headers,
            'retry-after',
            RETRY_DEADLINE_MS / 1_000,
          )
        : null;
      const delay = retryAfter === null
        ? this.localBackoff(attempt)
        : retryAfter * 1_000;
      if (!(await this.waitForRetry(delay, retryDeadline))) {
        throw error;
      }
    }

    throw new NebiusApiError('Nebius request failed unexpectedly', undefined, '');
  }

  private localBackoff(attempt: number): number {
    const jitter = 0.5 + this.random();
    return BASE_RETRY_DELAY_MS * 2 ** attempt * jitter;
  }

  private async waitForRetry(delay: number, deadline: number): Promise<boolean> {
    if (!Number.isFinite(delay) || delay < 0 || delay > deadline - this.now()) {
      return false;
    }
    await this.sleep(delay);
    return this.now() <= deadline;
  }

  private parseReply(
    tier: ModelTier,
    value: unknown,
    headers: HttpHeaders,
  ): LlmReply {
    if (typeof value !== 'object' || value === null) {
      throw new NebiusResponseError('Nebius returned a non-object response');
    }

    const response = value as CompletionResponse;
    const choice = response.choices?.[0];
    const rawContent = choice?.message?.content;
    const toolCalls = parseToolCalls(choice?.message?.tool_calls);
    if (rawContent === undefined) {
      throw new NebiusResponseError(
        'Nebius response is missing message content',
      );
    }
    if (
      rawContent !== null &&
      typeof rawContent !== 'string'
    ) {
      throw new NebiusResponseError(
        'Invalid choices[0].message.content in Nebius response',
      );
    }
    if (typeof rawContent !== 'string' && toolCalls.length === 0) {
      throw new NebiusResponseError(
        'Nebius response is missing message content or valid tool calls',
      );
    }

    const inTok = nonNegativeInteger(
      response.usage?.prompt_tokens,
      'usage.prompt_tokens',
    );
    const completionTok = nonNegativeInteger(
      response.usage?.completion_tokens,
      'usage.completion_tokens',
    );
    const reasoningTok = nonNegativeInteger(
      response.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      'usage.completion_tokens_details.reasoning_tokens',
    );
    if (reasoningTok > completionTok) {
      throw new NebiusResponseError(
        'Reasoning tokens exceed total completion tokens in Nebius response',
      );
    }

    const usage = {
      inTok,
      outTok: completionTok - reasoningTok,
      reasoningTok,
    };
    const entry = this.ledger.add(tier, usage);
    const finishReason = choice?.finish_reason;
    if (
      finishReason !== undefined &&
      finishReason !== null &&
      typeof finishReason !== 'string'
    ) {
      throw new NebiusResponseError('Invalid choices[0].finish_reason in Nebius response');
    }

    return {
      text: typeof rawContent === 'string' ? stripThinkPrefix(rawContent) : '',
      raw: typeof rawContent === 'string' ? rawContent : null,
      toolCalls,
      finishReason: finishReason ?? null,
      usage,
      usd: entry.usd,
      capacity: capacitySnapshot(headers),
    };
  }
}
