import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_MODEL_PRICES } from './cost.js';
import {
  NebiusApiError,
  NebiusClient,
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

function response(body: unknown, status = 200): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
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

  it('rejects a reasoning budget below 2000 tokens before sending a request', async () => {
    const fetch = vi.fn().mockResolvedValue(successResponse());
    const client = new NebiusClient(CONFIG, { fetch });

    await expect(
      client.chat('nano', MESSAGES, { maxTokens: 1_999 }),
    ).rejects.toThrow(/maxTokens must be an integer of at least 2000/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('strips a think prefix, preserves raw content, and meters reasoning output', async () => {
    const raw = '<think>hidden chain of thought</think>\nFinal answer';
    const fetch = vi.fn().mockResolvedValue(successResponse(raw, 16));
    const client = new NebiusClient(CONFIG, { fetch });

    const reply = await client.chat('nano', MESSAGES);

    expect(reply).toEqual({
      text: 'Final answer',
      raw,
      finishReason: 'stop',
      usage: { inTok: 1_000, outTok: 1_984, reasoningTok: 16 },
      usd: 0.00054,
    });
    expect(client.ledger.entries).toHaveLength(1);
    expect(client.ledger.totalUsd()).toBe(0.00054);
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
