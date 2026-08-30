import { createHash } from 'node:crypto';

import type {
  HttpHeaders,
  HttpRequestInit,
  HttpResponse,
  NebiusFetch,
} from '../llm/nebius.js';
import type {
  TavilyFetch,
  TavilyHttpRequestInit,
  TavilyHttpResponse,
} from '../diagnose/tavily.js';
import {
  binaryBody,
  boundedText,
  type RecordedBody,
  type RecordedHttpExchange,
  type ReplayRecorder,
} from './bundle.js';

const RESPONSE_HEADER_NAMES = [
  'content-length',
  'content-type',
  'retry-after',
  'set-cookie',
  'x-api-key',
  'x-ratelimit-dynamic-period-usage-requests',
  'x-ratelimit-dynamic-period-usage-tokens',
  'x-ratelimit-dynamic-scale-requests',
  'x-ratelimit-dynamic-scale-tokens',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-remaining-tokens',
  'x-ratelimit-reset-requests',
  'x-ratelimit-reset-tokens',
  'x-request-id',
] as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function objectHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  try {
    return Object.fromEntries(
      Object.entries(headers ?? {}).map(([name, value]) => [name, String(value)]),
    );
  } catch {
    return {};
  }
}

function webHeaders(headers: RequestInit['headers']): Record<string, string> {
  try {
    return Object.fromEntries(new Headers(headers).entries());
  } catch {
    return {};
  }
}

function selectedHeaders(headers: HttpHeaders): Record<string, string> {
  try {
    return Object.fromEntries(RESPONSE_HEADER_NAMES.flatMap((name) => {
      const value = headers.get(name);
      return value === null ? [] : [[name, value]];
    }));
  } catch {
    return {};
  }
}

function serializedJson(value: unknown): RecordedBody {
  try {
    return boundedText(JSON.stringify(value) ?? 'null');
  } catch (error) {
    return boundedText(JSON.stringify({ serializationError: errorMessage(error) }));
  }
}

function recordResponseOnce(
  recorder: ReplayRecorder,
  exchange: Omit<RecordedHttpExchange, 'sequence' | 'response' | 'latencyMs'>,
  startedAt: number,
  response: HttpResponse | TavilyHttpResponse,
  headers: Record<string, string>,
  sequence: number | null,
): (body: RecordedBody) => void {
  let recorded = false;
  return (body) => {
    if (recorded) return;
    recorded = true;
    recorder.recordHttp({
      ...exchange,
      response: { status: response.status, headers, body },
      latencyMs: Date.now() - startedAt,
    }, sequence);
  };
}

export function recordingNebiusFetch(
  recorder: ReplayRecorder,
  fetch: NebiusFetch,
): NebiusFetch {
  return async (input: string, init: HttpRequestInit): Promise<HttpResponse> => {
    const sequence = recorder.reserveHttpSequence();
    const startedAt = Date.now();
    const request = {
      boundary: 'nebius' as const,
      request: {
        method: init.method,
        url: input,
        headers: objectHeaders(init.headers),
        body: boundedText(init.body),
      },
    };
    let response: HttpResponse;
    try {
      response = await fetch(input, init);
    } catch (error) {
      recorder.recordHttp({
        ...request,
        response: { transportError: errorMessage(error) },
        latencyMs: Date.now() - startedAt,
      }, sequence);
      throw error;
    }
    const record = recordResponseOnce(
      recorder,
      request,
      startedAt,
      response,
      selectedHeaders(response.headers),
      sequence,
    );
    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      async json(): Promise<unknown> {
        try {
          const value = await response.json();
          record(serializedJson(value));
          return value;
        } catch (error) {
          record(boundedText(JSON.stringify({ bodyError: errorMessage(error) })));
          throw error;
        }
      },
      async text(): Promise<string> {
        try {
          const value = await response.text();
          record(boundedText(value));
          return value;
        } catch (error) {
          record(boundedText(JSON.stringify({ bodyError: errorMessage(error) })));
          throw error;
        }
      },
    };
  };
}

export function recordingTavilyFetch(
  recorder: ReplayRecorder,
  fetch: TavilyFetch,
): TavilyFetch {
  return async (
    input: string,
    init: TavilyHttpRequestInit,
  ): Promise<TavilyHttpResponse> => {
    const sequence = recorder.reserveHttpSequence();
    const startedAt = Date.now();
    const request = {
      boundary: 'tavily' as const,
      request: {
        method: init.method,
        url: input,
        headers: objectHeaders(init.headers),
        body: init.body === undefined ? null : boundedText(init.body),
      },
    };
    let response: TavilyHttpResponse;
    try {
      response = await fetch(input, init);
    } catch (error) {
      recorder.recordHttp({
        ...request,
        response: { transportError: errorMessage(error) },
        latencyMs: Date.now() - startedAt,
      }, sequence);
      throw error;
    }
    const record = recordResponseOnce(recorder, request, startedAt, response, {}, sequence);
    return {
      ok: response.ok,
      status: response.status,
      async json(): Promise<unknown> {
        try {
          const value = await response.json();
          record(serializedJson(value));
          return value;
        } catch (error) {
          record(boundedText(JSON.stringify({ bodyError: errorMessage(error) })));
          throw error;
        }
      },
    };
  };
}

async function streamBody(
  stream: ReadableStream<Uint8Array>,
): Promise<RecordedBody> {
  const hash = createHash('sha256');
  const reader = stream.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      if (result.value) {
        bytes += result.value.byteLength;
        hash.update(result.value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { stream: true, bytes, sha256: hash.digest('hex') };
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return typeof ReadableStream !== 'undefined' && value instanceof ReadableStream;
}

function captureContreeRequest(init: RequestInit): {
  init: RequestInit;
  body: Promise<RecordedBody>;
} {
  const body = init.body;
  if (body === null || body === undefined) return { init, body: Promise.resolve(null) };
  if (typeof body === 'string') return { init, body: Promise.resolve(boundedText(body)) };
  if (body instanceof URLSearchParams) {
    return { init, body: Promise.resolve(boundedText(body.toString())) };
  }
  if (body instanceof Blob) {
    return {
      init,
      body: body.arrayBuffer().then((value) => binaryBody(new Uint8Array(value))),
    };
  }
  if (body instanceof ArrayBuffer) {
    return { init, body: Promise.resolve(binaryBody(new Uint8Array(body))) };
  }
  if (ArrayBuffer.isView(body)) {
    return {
      init,
      body: Promise.resolve(binaryBody(
        new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
      )),
    };
  }
  if (isReadableStream(body)) {
    const [fetchBody, recordedBody] = body.tee();
    return {
      init: { ...init, body: fetchBody },
      body: streamBody(recordedBody),
    };
  }
  return { init, body: Promise.resolve(boundedText(String(body))) };
}

function responseBody(response: Response): Promise<RecordedBody> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  return response.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    return contentType.includes('json') || contentType.startsWith('text/')
      ? boundedText(new TextDecoder().decode(bytes))
      : binaryBody(bytes);
  });
}

export function recordingContreeFetch(
  recorder: ReplayRecorder,
  fetch: typeof globalThis.fetch,
): typeof globalThis.fetch {
  return async (input, init = {}): Promise<Response> => {
    const sequence = recorder.reserveHttpSequence();
    const startedAt = Date.now();
    let captured: ReturnType<typeof captureContreeRequest>;
    try {
      captured = captureContreeRequest(init);
    } catch {
      captured = { init, body: Promise.resolve(null) };
    }
    const capturedBody = captured.body.catch(() => null);
    const url = input instanceof Request ? input.url : String(input);
    let response: Response;
    try {
      response = await fetch(input, captured.init);
    } catch (error) {
      recorder.recordHttp({
        boundary: 'contree',
        request: {
          method: init.method ?? (input instanceof Request ? input.method : 'GET'),
          url,
          headers: webHeaders(init.headers),
          body: null,
        },
        response: { transportError: errorMessage(error) },
        latencyMs: Date.now() - startedAt,
      }, sequence);
      throw error;
    }
    try {
      const [requestBody, recordedResponseBody] = await Promise.all([
        capturedBody,
        responseBody(response.clone()),
      ]);
      recorder.recordHttp({
        boundary: 'contree',
        request: {
          method: init.method ?? (input instanceof Request ? input.method : 'GET'),
          url,
          headers: webHeaders(init.headers),
          body: requestBody,
        },
        response: {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: recordedResponseBody,
        },
        latencyMs: Date.now() - startedAt,
      }, sequence);
    } catch {
      // Replay capture must not change ConTree transport behavior.
    }
    return response;
  };
}
