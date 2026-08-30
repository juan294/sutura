import { readFile } from 'node:fs/promises';

import type {
  RecordedBody,
  RecordedHttpBoundary,
  RecordedHttpExchange,
  ReplayBundle,
} from '../../replay/bundle.js';

let bundlePromise: Promise<ReplayBundle> | undefined;

export function capturedDogfoodReplayBundle(): Promise<ReplayBundle> {
  bundlePromise ??= readFile(new URL(
    '../../../../action/src/__fixtures__/captured/33321106629/bundle.json',
    import.meta.url,
  ), 'utf8').then((value) => JSON.parse(value) as ReplayBundle);
  return bundlePromise;
}

export function decodedRecordedBody(body: RecordedBody): string {
  if (typeof body === 'string') return body;
  if (body && 'raw' in body) {
    return Buffer.from(body.data, 'base64').toString('utf8');
  }
  throw new Error('Captured replay body is unavailable');
}

export type SuccessfulRecordedHttpExchange = Omit<RecordedHttpExchange, 'response'> & {
  response: Extract<RecordedHttpExchange['response'], { status: number }>;
};

export function successfulCapturedHttp(
  bundle: ReplayBundle,
  boundary: RecordedHttpBoundary,
): SuccessfulRecordedHttpExchange[] {
  return bundle.http.flatMap((exchange) =>
    exchange.boundary === boundary && 'status' in exchange.response
      ? [exchange as SuccessfulRecordedHttpExchange]
      : []
  );
}
