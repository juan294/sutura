import { Buffer } from 'node:buffer';

import type { NebiusFetch, HttpResponse } from '../llm/nebius.js';
import type { TavilyFetch } from '../diagnose/tavily.js';
import { canonicalJson, firstJsonDifference } from './canonical-json.js';
import type {
  RawBody,
  RecordedBody,
  RecordedHttpBoundary,
  RecordedHttpExchange,
  ReplayBundle,
} from './bundle.js';

export class ReplayMismatchError extends Error {
  constructor(
    readonly sequence: number,
    readonly path: string,
    readonly expected: unknown,
    readonly actual: unknown,
  ) {
    super(
      `Replay exchange ${sequence} differs at ${path}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
    this.name = 'ReplayMismatchError';
  }
}

function jsonBody(value: RecordedBody, sequence: number, side: string): unknown {
  if (typeof value !== 'string') {
    throw new ReplayMismatchError(sequence, `$.${side}.body`, 'JSON text', value);
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function responseBytes(body: RecordedBody, sequence: number): Uint8Array {
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body && 'raw' in body) {
    const raw = body as RawBody;
    const bytes = Buffer.from(raw.data, 'base64');
    if (bytes.byteLength !== raw.bytes) {
      throw new ReplayMismatchError(sequence, '$.response.body.bytes', raw.bytes, bytes.byteLength);
    }
    return bytes;
  }
  if (body === null) return new Uint8Array();
  throw new ReplayMismatchError(sequence, '$.response.body', 'replayable text or raw bytes', body);
}

function assertRequest(
  exchange: RecordedHttpExchange,
  input: string,
  init: { method?: string; body?: string },
): void {
  const method = init.method ?? 'GET';
  if (method !== exchange.request.method) {
    throw new ReplayMismatchError(exchange.sequence, '$.method', exchange.request.method, method);
  }
  if (input !== exchange.request.url) {
    throw new ReplayMismatchError(exchange.sequence, '$.url', exchange.request.url, input);
  }
  const expected = jsonBody(exchange.request.body, exchange.sequence, 'request');
  let actual: unknown = init.body ?? null;
  if (typeof actual === 'string') {
    try {
      actual = JSON.parse(actual) as unknown;
    } catch {
      // Compare non-JSON bodies as text.
    }
  }
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    const difference = firstJsonDifference(expected, actual);
    throw new ReplayMismatchError(
      exchange.sequence,
      difference?.path ?? '$.body',
      difference?.expected ?? expected,
      difference?.actual ?? actual,
    );
  }
}

function recordedResponse(exchange: RecordedHttpExchange): HttpResponse {
  if ('transportError' in exchange.response) {
    throw new Error(exchange.response.transportError);
  }
  const bytes = responseBytes(exchange.response.body, exchange.sequence);
  let consumed = false;
  const consume = <T>(parse: (value: Uint8Array) => T): Promise<T> => {
    if (consumed) return Promise.reject(new TypeError('Body is unusable'));
    consumed = true;
    try {
      return Promise.resolve(parse(bytes));
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const headers = new Map(
    Object.entries(exchange.response.headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    ok: exchange.response.status >= 200 && exchange.response.status < 300,
    status: exchange.response.status,
    headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
    json: () => consume((value) => JSON.parse(new TextDecoder().decode(value)) as unknown),
    text: () => consume((value) => new TextDecoder().decode(value)),
  };
}

export function replayFetch(bundle: ReplayBundle, boundary: 'nebius'): NebiusFetch;
export function replayFetch(bundle: ReplayBundle, boundary: 'tavily'): TavilyFetch;
export function replayFetch(
  bundle: ReplayBundle,
  boundary: Exclude<RecordedHttpBoundary, 'contree'>,
): NebiusFetch | TavilyFetch {
  const exchanges = bundle.http
    .filter((exchange) => exchange.boundary === boundary)
    .toSorted((left, right) => left.sequence - right.sequence);
  let index = 0;
  const fetch = async (
    input: string,
    init: { method: string; headers: Readonly<Record<string, string>>; body?: string },
  ): Promise<HttpResponse> => {
    const exchange = exchanges[index];
    if (!exchange) {
      throw new ReplayMismatchError(index + 1, '$', 'recorded exchange', 'sequence exhausted');
    }
    index += 1;
    assertRequest(exchange, input, init);
    return recordedResponse(exchange);
  };
  return fetch as NebiusFetch | TavilyFetch;
}
