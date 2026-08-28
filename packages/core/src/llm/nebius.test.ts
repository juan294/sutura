import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import type {
  AssistantMessage,
  CapacitySnapshot,
  ChatMessage,
  ChatOptions,
  FunctionToolCall,
  FunctionToolDefinition,
  ResponseFormat,
  ToolChoice,
  ToolMessage,
} from '@sutura/core';

import { DEFAULT_MODEL_PRICES } from './cost.js';
import {
  NebiusApiError,
  NebiusClient,
  NebiusResponseError,
  type NebiusClientConfig,
  type HttpRequestInit,
  type HttpResponse,
} from './nebius.js';

const MODELS = {
  nano: 'nano-model',
  super: 'super-model',
  ultra: 'ultra-model',
};

const CONFIG: NebiusClientConfig = {
  apiKey: 'test-key',
  baseUrl: 'https://example.test/v1/',
  models: MODELS,
  prices: DEFAULT_MODEL_PRICES,
};

const MESSAGES = [{ role: 'user', content: 'Diagnose this.' }] as const;

function response(
  body: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): HttpResponse {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string) {
        return normalizedHeaders[name.toLowerCase()] ?? null;
      },
    },
    async json() {
      return body;
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

function successResponse(content = 'fixed', reasoningTokens = 0): HttpResponse {
  return response({
    choices: [{ finish_reason: 'stop', message: { content } }],
    usage: {
      prompt_tokens: 1_000,
      completion_tokens: 2_000,
      completion_tokens_details: { reasoning_tokens: reasoningTokens },
    },
  });
}

describe('NebiusClient', () => {
  it('exports the Token Factory protocol types from the package root', () => {
    expectTypeOf<ChatMessage>().toBeObject();
    expectTypeOf<AssistantMessage>().toBeObject();
    expectTypeOf<ToolMessage>().toBeObject();
    expectTypeOf<ChatOptions>().toBeObject();
    expectTypeOf<CapacitySnapshot>().toBeObject();
    expectTypeOf<FunctionToolCall>().toBeObject();
    expectTypeOf<FunctionToolDefinition>().toBeObject();
    expectTypeOf<ResponseFormat>().toBeObject();
    expectTypeOf<ToolChoice>().not.toBeNever();
  });

  it.each(['nano', 'super', 'ultra'] as const)(
    'routes the %s tier to its configured model id',
    async (tier) => {
      const fetch = vi.fn().mockResolvedValue(successResponse());
      const client = new NebiusClient(CONFIG, { fetch });

      await client.chat(tier, MESSAGES, {
        maxTokens: 2_048,
        temperature: 0.25,
        reasoningEffort: 'none',
        responseFormat: { type: 'json_object' },
      });

      expect(fetch).toHaveBeenCalledOnce();
      const [url, init] = fetch.mock.calls[0] as [string, HttpRequestInit];
      expect(url).toBe('https://example.test/v1/chat/completions');
      expect(init.headers).toEqual({
        Authorization: 'Bearer test-key',
        'Content-Type': 'application/json',
      });
      expect(JSON.parse(init.body as string)).toEqual({
        model: MODELS[tier],
        messages: MESSAGES,
        max_tokens: 2_048,
        temperature: 0.25,
        reasoning_effort: 'none',
        response_format: { type: 'json_object' },
      });
    },
  );

  it('defaults max_tokens to 4096 and temperature to zero', async () => {
    const fetch = vi.fn().mockResolvedValue(successResponse());
    const client = new NebiusClient(CONFIG, { fetch });

    await client.chat('nano', MESSAGES);

    const [, init] = fetch.mock.calls[0] as [string, HttpRequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      max_tokens: 4_096,
      temperature: 0,
    });
  });

  it('sends a strict JSON Schema request in Token Factory format', async () => {
    const fetch = vi.fn().mockResolvedValue(successResponse('{"fixed":true}'));
    const client = new NebiusClient(CONFIG, { fetch });
    const schema = {
      type: 'object',
      properties: { fixed: { type: 'boolean' } },
      required: ['fixed'],
      additionalProperties: false,
    } as const;

    await client.chat('nano', MESSAGES, {
      maxTokens: 2_048,
      responseFormat: {
        type: 'json_schema',
        jsonSchema: { name: 'repair_result', strict: true, schema },
      },
    });

    const [, init] = fetch.mock.calls[0] as [string, HttpRequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'repair_result', strict: true, schema },
      },
    });
  });

  it('sends required function tools and typed tool messages in Token Factory format', async () => {
    const fetch = vi.fn().mockResolvedValue(successResponse('done'));
    const client = new NebiusClient(CONFIG, { fetch });
    const messages = [
      { role: 'user', content: 'Read the file.' },
      {
        role: 'assistant',
        content: null,
        toolCalls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"src/a.ts"}' },
        }],
      },
      { role: 'tool', toolCallId: 'call_1', content: 'file contents' },
    ] as const;

    await client.chat('nano', messages, {
      maxTokens: 2_048,
      tools: [{
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a repository file',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
          strict: true,
        },
      }],
      toolChoice: 'required',
      parallelToolCalls: false,
    });

    const [, init] = fetch.mock.calls[0] as [string, HttpRequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      messages: [
        { role: 'user', content: 'Read the file.' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"src/a.ts"}' },
          }],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'file contents' },
      ],
      tools: [expect.objectContaining({
        type: 'function',
        function: expect.objectContaining({ name: 'read_file', strict: true }),
      })],
      tool_choice: 'required',
      parallel_tool_calls: false,
    });
  });

  it('rejects a reasoning budget below 2000 tokens before sending a request', async () => {
    const fetch = vi.fn().mockResolvedValue(successResponse());
    const client = new NebiusClient(CONFIG, { fetch });

    await expect(
      client.chat('nano', MESSAGES, { maxTokens: 1_999 }),
    ).rejects.toThrow(/maxTokens must be an integer of at least 2000/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('strips a think prefix from all returned content and meters reasoning output', async () => {
    const raw = '<think>hidden chain of thought</think>\nFinal answer';
    const fetch = vi.fn().mockResolvedValue(successResponse(raw, 16));
    const client = new NebiusClient(CONFIG, { fetch });

    const reply = await client.chat('nano', MESSAGES);

    expect(reply).toEqual({
      text: 'Final answer',
      raw: 'Final answer',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inTok: 1_000, outTok: 1_984, reasoningTok: 16 },
      usd: 0.00054,
      capacity: {
        remainingRequests: null,
        remainingTokens: null,
        resetRequestsSec: null,
        resetTokensSec: null,
        dynamicRequestScale: null,
        dynamicTokenScale: null,
        windowUsageRequests: null,
        windowUsageTokens: null,
        retryAfterSec: null,
        requestId: null,
      },
      model: 'nano-model',
      latencyMs: 0,
      requestId: null,
    });
    expect(client.ledger.entries).toHaveLength(1);
    expect(client.ledger.totalUsd()).toBe(0.00054);
  });

  it('drops a truncated think prefix from all returned content', async () => {
    const fetch = vi.fn().mockResolvedValue(successResponse('<think>hidden chain of thought'));
    const client = new NebiusClient(CONFIG, { fetch });

    const reply = await client.chat('nano', MESSAGES);

    expect(reply.text).toBe('');
    expect(reply.raw).toBe('');
    expect(JSON.stringify(reply)).not.toContain('hidden chain of thought');
  });

  it('accepts null content only with valid function calls and meters all completion tokens', async () => {
    const fetch = vi.fn().mockResolvedValue(response({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          content: null,
          tool_calls: [{
            id: 'call_abc-123',
            type: 'function',
            function: { name: 'inspect_diff', arguments: '{"compact":true}' },
          }],
        },
      }],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        completion_tokens_details: { reasoning_tokens: 7 },
      },
    }));
    const client = new NebiusClient(CONFIG, { fetch });

    const reply = await client.chat('nano', MESSAGES);

    expect(reply).toMatchObject({
      text: '',
      raw: null,
      finishReason: 'tool_calls',
      toolCalls: [{
        id: 'call_abc-123',
        type: 'function',
        function: { name: 'inspect_diff', arguments: '{"compact":true}' },
      }],
      usage: { inTok: 120, outTok: 23, reasoningTok: 7 },
    });
    expect(client.ledger.entries[0]).toMatchObject({
      outTok: 23,
      reasoningTok: 7,
    });
  });

  it('rejects null content without tool calls', async () => {
    const fetch = vi.fn().mockResolvedValue(response({
      choices: [{ finish_reason: 'stop', message: { content: null } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const client = new NebiusClient(CONFIG, { fetch });

    await expect(client.chat('nano', MESSAGES)).rejects.toThrow(
      /missing message content or valid tool calls/,
    );
  });

  it('rejects omitted content even when tool calls are present', async () => {
    const fetch = vi.fn().mockResolvedValue(response({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{}' },
          }],
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const client = new NebiusClient(CONFIG, { fetch });

    await expect(client.chat('nano', MESSAGES)).rejects.toThrow(
      /missing message content/,
    );
  });

  it.each([
    ['missing id', { type: 'function', function: { name: 'read_file', arguments: '{}' } }],
    ['invalid id', { id: 'bad id', type: 'function', function: { name: 'read_file', arguments: '{}' } }],
    ['invalid type', { id: 'call_1', type: 'custom', function: { name: 'read_file', arguments: '{}' } }],
    ['invalid name', { id: 'call_1', type: 'function', function: { name: 'read file', arguments: '{}' } }],
    ['invalid arguments type', { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: {} } }],
    ['invalid arguments JSON', { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{' } }],
    ['non-object arguments', { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '[]' } }],
  ])('rejects a tool call with %s', async (_label, toolCall) => {
    const fetch = vi.fn().mockResolvedValue(response({
      choices: [{
        finish_reason: 'tool_calls',
        message: { content: null, tool_calls: [toolCall] },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const client = new NebiusClient(CONFIG, { fetch });

    await expect(client.chat('nano', MESSAGES)).rejects.toBeInstanceOf(
      NebiusResponseError,
    );
  });

  it('rejects more than 128 tool calls', async () => {
    const toolCalls = Array.from({ length: 129 }, (_, index) => ({
      id: `call_${index}`,
      type: 'function',
      function: { name: 'read_file', arguments: '{}' },
    }));
    const fetch = vi.fn().mockResolvedValue(response({
      choices: [{
        finish_reason: 'tool_calls',
        message: { content: null, tool_calls: toolCalls },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const client = new NebiusClient(CONFIG, { fetch });

    await expect(client.chat('nano', MESSAGES)).rejects.toThrow(/at most 128/);
  });

  it('rejects duplicate tool call ids', async () => {
    const duplicateCall = {
      id: 'call_1',
      type: 'function',
      function: { name: 'read_file', arguments: '{}' },
    };
    const fetch = vi.fn().mockResolvedValue(response({
      choices: [{
        finish_reason: 'tool_calls',
        message: { content: null, tool_calls: [duplicateCall, duplicateCall] },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const client = new NebiusClient(CONFIG, { fetch });

    await expect(client.chat('nano', MESSAGES)).rejects.toThrow(
      /Duplicate tool call id/,
    );
  });

  it('preserves a length finish reason for bounded-output diagnostics', async () => {
    const fetch = vi.fn().mockResolvedValue(response({
      choices: [{ finish_reason: 'length', message: { content: '{}' } }],
      usage: {
        prompt_tokens: 1_000,
        completion_tokens: 2_000,
      },
    }));
    const client = new NebiusClient(CONFIG, { fetch });

    await expect(client.chat('super', MESSAGES)).resolves.toMatchObject({
      finishReason: 'length',
    });
  });

  it('retries a 429 response and succeeds after exponential backoff', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response('slow down', 429))
      .mockResolvedValueOnce(successResponse());
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new NebiusClient(CONFIG, { fetch, sleep, random: () => 0 });

    await expect(client.chat('nano', MESSAGES)).resolves.toMatchObject({
      text: 'fixed',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(125);
  });

  it('uses Retry-After before exponential jitter for a 429 response', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response('slow down', 429, { 'Retry-After': '2.5' }))
      .mockResolvedValueOnce(successResponse());
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new NebiusClient(CONFIG, { fetch, sleep, random: () => 0 });

    await client.chat('nano', MESSAGES);

    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(2_500);
  });

  it.each(['-1', 'NaN', '31', '1e100', 'tomorrow'])(
    'ignores invalid or excessive Retry-After value %s',
    async (retryAfter) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(response('slow down', 429, {
          'Retry-After': retryAfter,
        }))
        .mockResolvedValueOnce(successResponse());
      const sleep = vi.fn().mockResolvedValue(undefined);
      const client = new NebiusClient(CONFIG, { fetch, sleep, random: () => 0 });

      await client.chat('nano', MESSAGES);

      expect(sleep).toHaveBeenCalledWith(125);
    },
  );

  it('stops retries at one total 30-second deadline', async () => {
    const fetch = vi.fn().mockResolvedValue(response('slow down', 429, {
      'Retry-After': '20',
    }));
    let now = 1_000;
    const sleep = vi.fn().mockImplementation(async (milliseconds: number) => {
      now += milliseconds;
    });
    const client = new NebiusClient(CONFIG, {
      fetch,
      sleep,
      now: () => now,
      random: () => 0,
    });

    await expect(client.chat('nano', MESSAGES)).rejects.toMatchObject({
      status: 429,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('returns a frozen sanitized capacity snapshot for each response', async () => {
    const first = successResponse();
    first.headers = response({}, 200, {
      'x-ratelimit-remaining-requests': '599',
      'x-ratelimit-remaining-tokens': '399000',
      'x-ratelimit-reset-requests': '0.1',
      'x-ratelimit-reset-tokens': '1.25',
      'x-ratelimit-dynamic-scale-requests': '1.2',
      'x-ratelimit-dynamic-scale-tokens': '1.44',
      'x-ratelimit-dynamic-period-usage-requests': '80',
      'x-ratelimit-dynamic-period-usage-tokens': '50.5',
      'Retry-After': '2',
      'x-request-id': 'req_abc-123',
    }).headers;
    const second = successResponse();
    const fetch = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const client = new NebiusClient(CONFIG, { fetch });

    expect(client.capacitySnapshot()).toBeUndefined();
    const firstReply = await client.chat('nano', MESSAGES);
    expect(client.capacitySnapshot()).toBe(firstReply.capacity);
    const secondReply = await client.chat('nano', MESSAGES);

    expect(firstReply.capacity).toEqual({
      remainingRequests: 599,
      remainingTokens: 399_000,
      resetRequestsSec: 0.1,
      resetTokensSec: 1.25,
      dynamicRequestScale: 1.2,
      dynamicTokenScale: 1.44,
      windowUsageRequests: 80,
      windowUsageTokens: 50.5,
      retryAfterSec: 2,
      requestId: 'req_abc-123',
    });
    expect(Object.isFrozen(firstReply.capacity)).toBe(true);
    expect(secondReply.capacity).not.toBe(firstReply.capacity);
    expect(secondReply.capacity.remainingRequests).toBeNull();
    expect(client.capacitySnapshot()).toBe(secondReply.capacity);
  });

  it('drops malformed capacity headers from the snapshot', async () => {
    const result = successResponse();
    result.headers = response({}, 200, {
      'x-ratelimit-remaining-requests': '-1',
      'x-ratelimit-remaining-tokens': 'Infinity',
      'x-ratelimit-reset-requests': '86401',
      'x-ratelimit-dynamic-scale-requests': '101',
      'x-ratelimit-dynamic-period-usage-tokens': '100.1',
      'Retry-After': '31',
      'x-request-id': 'contains spaces',
    }).headers;
    const client = new NebiusClient(CONFIG, {
      fetch: vi.fn().mockResolvedValue(result),
    });

    const reply = await client.chat('nano', MESSAGES);

    expect(reply.capacity).toEqual({
      remainingRequests: null,
      remainingTokens: null,
      resetRequestsSec: null,
      resetTokensSec: null,
      dynamicRequestScale: null,
      dynamicTokenScale: null,
      windowUsageRequests: null,
      windowUsageTokens: null,
      retryAfterSec: null,
      requestId: null,
    });
  });

  it('stops after three retries of a retryable response', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async () => response('upstream unavailable', 503));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new NebiusClient(CONFIG, { fetch, sleep, random: () => 0 });

    await expect(client.chat('nano', MESSAGES)).rejects.toMatchObject({
      name: 'NebiusApiError',
      status: 503,
      body: 'upstream unavailable',
    });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('surfaces a 401 body verbatim in a typed authentication error', async () => {
    const body = '{"detail":"Invalid API key for this project"}';
    const fetch = vi
      .fn()
      .mockResolvedValue(response(body, 401));
    const client = new NebiusClient(CONFIG, { fetch });

    const error = await client.chat('nano', MESSAGES).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(NebiusApiError);
    expect(error).toMatchObject({ status: 401, body });
    expect((error as Error).message).toContain(body);
    expect((error as Error).message).toContain('authentication failed');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('distinguishes a missing model from an authentication failure', async () => {
    const body = '{"detail":"Model nano-model was not found"}';
    const fetch = vi
      .fn()
      .mockResolvedValue(response(body, 404));
    const client = new NebiusClient(CONFIG, { fetch });

    await expect(client.chat('nano', MESSAGES)).rejects.toThrow(
      `model was not found: ${body}`,
    );
  });
});
