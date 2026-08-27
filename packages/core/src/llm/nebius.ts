import {
  Ledger,
  type ModelPrices,
  type ModelTier,
  type TokenUsage,
} from './cost.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  responseFormat?: { type: 'json_object' };
}

export interface LlmReply {
  text: string;
  raw: string;
  finishReason: string | null;
  usage: TokenUsage;
  usd: number;
}

export interface NebiusClientConfig {
  apiKey: string;
  baseUrl: string;
  models: Readonly<Record<ModelTier, string>>;
  prices: ModelPrices;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
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
}

interface CompletionResponse {
  choices?: Array<{
    finish_reason?: unknown;
    message?: { content?: unknown };
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    completion_tokens_details?: { reasoning_tokens?: unknown };
  };
}

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 250;

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
      messages,
      max_tokens: maxTokens,
      temperature: options.temperature ?? 0,
      ...(options.reasoningEffort
        ? { reasoning_effort: options.reasoningEffort }
        : {}),
      ...(options.responseFormat
        ? { response_format: options.responseFormat }
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

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      let response: HttpResponse;
      try {
        response = await this.fetch(requestUrl, request);
      } catch (error) {
        if (attempt < MAX_RETRIES) {
          await this.backoff(attempt);
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
        return this.parseReply(tier, await response.json());
      }

      const responseBody = await response.text();
      const error = NebiusApiError.fromResponse(response.status, responseBody);
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_RETRIES) {
        throw error;
      }
      await this.backoff(attempt);
    }

    throw new NebiusApiError('Nebius request failed unexpectedly', undefined, '');
  }

  private async backoff(attempt: number): Promise<void> {
    const jitter = 0.5 + this.random();
    await this.sleep(BASE_RETRY_DELAY_MS * 2 ** attempt * jitter);
  }

  private parseReply(tier: ModelTier, value: unknown): LlmReply {
    if (typeof value !== 'object' || value === null) {
      throw new NebiusResponseError('Nebius returned a non-object response');
    }

    const response = value as CompletionResponse;
    const choice = response.choices?.[0];
    const raw = choice?.message?.content;
    if (typeof raw !== 'string') {
      throw new NebiusResponseError('Nebius response is missing message content');
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
      text: stripThinkPrefix(raw),
      raw,
      finishReason: finishReason ?? null,
      usage,
      usd: entry.usd,
    };
  }
}
