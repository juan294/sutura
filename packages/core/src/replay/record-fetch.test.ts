import { describe, expect, it, vi } from 'vitest';

import { ReplayRecorder } from './bundle.js';
import {
  recordingContreeFetch,
  recordingNebiusFetch,
  recordingTavilyFetch,
} from './record-fetch.js';

const CONFIG = {
  triageN: 1, raceK: 1,
  models: { nano: 'nano', super: 'super', ultra: 'ultra' },
  routingProfileId: 'test', maxOps: 1,
} as const;

const headers = {
  get(name: string): string | null {
    return name.toLowerCase() === 'content-type' ? 'application/json' : null;
  },
};

describe('recording transport adapters', () => {
  it('preserves response consumption and sequences exchanges across boundaries', async () => {
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    const nebiusJson = vi.fn(async () => ({ answer: 42 }));
    const nebius = recordingNebiusFetch(recorder, vi.fn(async () => ({
      ok: true,
      status: 200,
      headers,
      json: nebiusJson,
      text: async () => 'unused',
    })));
    const tavily = recordingTavilyFetch(recorder, vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    })));
    const contree = recordingContreeFetch(recorder, vi.fn(async () => new Response(
      JSON.stringify({ status: 'SUCCESS' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));

    const nebiusResponse = await nebius('https://example.test/nebius', {
      method: 'POST', headers: {}, body: '{}',
    });
    expect(await nebiusResponse.json()).toEqual({ answer: 42 });
    expect(nebiusJson).toHaveBeenCalledOnce();

    const tavilyResponse = await tavily('https://example.test/tavily', {
      method: 'POST', headers: {}, body: '{}',
    });
    expect(await tavilyResponse.json()).toEqual({ results: [] });

    const contreeResponse = await contree('https://example.test/contree', {
      method: 'GET', headers: { Authorization: 'Bearer test' },
    });
    expect(await contreeResponse.json()).toEqual({ status: 'SUCCESS' });

    expect(recorder.finish('fixed').http.map(({ boundary, sequence }) => ({ boundary, sequence })))
      .toEqual([
        { boundary: 'nebius', sequence: 1 },
        { boundary: 'tavily', sequence: 2 },
        { boundary: 'contree', sequence: 3 },
      ]);
  });

  it('records a transport error and rethrows the same rejection', async () => {
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    const failure = new Error('socket closed');
    const wrapped = recordingNebiusFetch(recorder, vi.fn(async () => {
      throw failure;
    }));

    await expect(wrapped('https://example.test/nebius', {
      method: 'POST', headers: {}, body: '{}',
    })).rejects.toBe(failure);
    expect(recorder.finish('infra-stop').http[0]?.response).toEqual({
      transportError: 'socket closed',
    });
  });

  it('records a Tavily non-2xx response even when its body is not consumed', async () => {
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    const wrapped = recordingTavilyFetch(recorder, vi.fn(async () => new Response(
      '{"error":"rate limited"}',
      { status: 429, headers: { 'content-type': 'application/json' } },
    )));

    const response = await wrapped('https://example.test/tavily', {
      method: 'POST', headers: {}, body: '{}',
    });

    expect(response.status).toBe(429);
    expect(recorder.finish('gave-up').http[0]).toMatchObject({
      boundary: 'tavily',
      response: {
        status: 429,
        body: {
          raw: true,
          encoding: 'base64',
          data: Buffer.from('{"error":"rate limited"}').toString('base64'),
        },
      },
    });
  });

  it.each(['nebius', 'tavily'] as const)(
    'records raw %s response bytes when JSON parsing fails',
    async (boundary) => {
      const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
      const innerResponse = new Response('{not-json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      const response = boundary === 'nebius'
        ? await recordingNebiusFetch(recorder, vi.fn(async () => innerResponse))(
            'https://example.test/nebius', { method: 'POST', headers: {}, body: '{}' },
          )
        : await recordingTavilyFetch(recorder, vi.fn(async () => innerResponse))(
            'https://example.test/tavily', { method: 'POST', headers: {}, body: '{}' },
          );

      await expect(response.json()).rejects.toBeInstanceOf(SyntaxError);
      expect(recorder.finish('infra-stop').http[0]?.response).toMatchObject({
        status: 200,
        body: {
          raw: true,
          encoding: 'base64',
          data: Buffer.from('{not-json').toString('base64'),
        },
      });
    },
  );

  it('redacts secrets from raw invalid-JSON response bytes', async () => {
    const recorder = new ReplayRecorder(
      '77001', 'acme/widget', 'a'.repeat(40), CONFIG, ['nb-secret'],
    );
    const wrapped = recordingNebiusFetch(recorder, vi.fn(async () => new Response(
      'nb-secret {not-json',
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));

    const response = await wrapped('https://example.test/nebius', {
      method: 'POST', headers: {}, body: '{}',
    });
    await expect(response.json()).rejects.toBeInstanceOf(SyntaxError);

    const bundle = recorder.finish('infra-stop');
    const recorded = bundle.http[0]?.response;
    expect(JSON.stringify(bundle)).not.toContain('nb-secret');
    expect(recorded).toMatchObject({ body: { raw: true, encoding: 'base64' } });
    if (recorded && 'status' in recorded && recorded.body && typeof recorded.body !== 'string'
      && 'raw' in recorded.body) {
      expect(Buffer.from(recorded.body.data, 'base64').toString('utf8'))
        .toContain('[redacted secret]');
    }
  });

  it('keeps non-UTF-8 invalid-JSON response bytes replayable', async () => {
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    const wrapped = recordingNebiusFetch(recorder, vi.fn(async () => new Response(
      new Uint8Array([0xff]),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));

    const response = await wrapped('https://example.test/nebius', {
      method: 'POST', headers: {}, body: '{}',
    });
    await expect(response.json()).rejects.toBeInstanceOf(SyntaxError);

    expect(recorder.finish('infra-stop').http[0]?.response).toMatchObject({
      body: { raw: true, encoding: 'base64', data: '/w==' },
    });
  });

  it('records a ConTree request body before rethrowing a fetch rejection', async () => {
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    const failure = new Error('socket closed');
    const wrapped = recordingContreeFetch(recorder, vi.fn(async () => {
      throw failure;
    }));

    await expect(wrapped('https://example.test/contree', {
      method: 'POST', body: 'request-payload',
    })).rejects.toBe(failure);
    expect(recorder.finish('infra-stop').http[0]).toMatchObject({
      request: { body: 'request-payload' },
      response: { transportError: 'socket closed' },
    });
  });

  it('marks a failed ConTree request-body capture incomplete', async () => {
    class BrokenBlob extends Blob {
      override arrayBuffer(): Promise<ArrayBuffer> {
        return Promise.reject(new Error('blob unavailable'));
      }
    }
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    const wrapped = recordingContreeFetch(
      recorder,
      vi.fn(async () => new Response('{"ok":true}', {
        headers: { 'content-type': 'application/json' },
      })),
    );

    await expect(wrapped('https://example.test/contree', {
      method: 'POST', body: new BrokenBlob(['request-payload']),
    })).resolves.toBeInstanceOf(Response);
    expect(recorder.finish('fixed').completeness).toMatchObject({
      complete: false,
      overflowedBoundaries: ['http'],
    });
  });

  it('returns the ConTree response when replay body capture fails', async () => {
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    const response = new Response('{"ok":true}', {
      headers: { 'content-type': 'application/json' },
    });
    Object.defineProperty(response, 'clone', {
      value: () => { throw new Error('clone unavailable'); },
    });
    const wrapped = recordingContreeFetch(recorder, vi.fn(async () => response));

    await expect(wrapped('https://example.test/contree')).resolves.toBe(response);
  });

  it('keeps HTTP invocation sequence when responses finish out of order', async () => {
    let resolveFirst: ((response: {
      ok: boolean; status: number; headers: typeof headers;
      json(): Promise<unknown>; text(): Promise<string>;
    }) => void) | undefined;
    let resolveSecond: typeof resolveFirst;
    const inner = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    const recorder = new ReplayRecorder('77001', 'acme/widget', 'a'.repeat(40), CONFIG);
    const wrapped = recordingNebiusFetch(recorder, inner);
    const response = (id: number) => ({
      ok: true, status: 200, headers,
      json: async () => ({ id }), text: async () => String(id),
    });

    const first = wrapped('https://example.test/1', { method: 'POST', headers: {}, body: '{}' });
    const second = wrapped('https://example.test/2', { method: 'POST', headers: {}, body: '{}' });
    resolveSecond?.(response(2));
    await (await second).json();
    resolveFirst?.(response(1));
    await (await first).json();

    expect(recorder.finish('fixed').http.map(({ sequence, request }) => ({
      sequence, url: request.url,
    }))).toEqual([
      { sequence: 1, url: 'https://example.test/1' },
      { sequence: 2, url: 'https://example.test/2' },
    ]);
  });
});
