import type { RecordedError, RecordedErrorDetails } from './bundle.js';

function property(value: unknown, key: 'message' | 'name' | 'status'): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function fallbackMessage(error: unknown): string {
  try {
    return String(error);
  } catch {
    return 'Unknown error';
  }
}

export function recordedErrorResult(error: unknown): RecordedError {
  const rawMessage = property(error, 'message');
  const rawName = property(error, 'name');
  const rawStatus = property(error, 'status');
  const details: RecordedErrorDetails = {
    message: typeof rawMessage === 'string' ? rawMessage : fallbackMessage(error),
    name: typeof rawName === 'string' ? rawName : 'Error',
    ...(typeof rawStatus === 'number' && Number.isFinite(rawStatus)
      ? { status: rawStatus }
      : {}),
  };
  return { error: details };
}

function errorDetails(value: unknown): RecordedErrorDetails | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const outer = value as Record<string, unknown>;
  if (Object.keys(outer).length !== 1 || !Object.hasOwn(outer, 'error') ||
      typeof outer.error !== 'object' || outer.error === null || Array.isArray(outer.error)) {
    return null;
  }
  const details = outer.error as Record<string, unknown>;
  const keys = Object.keys(details);
  if (!keys.every((key) => key === 'message' || key === 'name' || key === 'status') ||
      keys.length < 2 || keys.length > 3 || typeof details.message !== 'string' ||
      typeof details.name !== 'string' ||
      (Object.hasOwn(details, 'status') &&
        (typeof details.status !== 'number' || !Number.isFinite(details.status)))) {
    return null;
  }
  return details as unknown as RecordedErrorDetails;
}

export function throwRecordedErrorResult(value: unknown): void {
  const details = errorDetails(value);
  if (!details) return;
  const error = new Error(details.message);
  error.name = details.name;
  if (details.status !== undefined) {
    (error as Error & { status: number }).status = details.status;
  }
  throw error;
}
