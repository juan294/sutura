import { redactExternalText } from '../security/external-text.js';
import type { TraceEvent } from './types.js';

const MAX_TRACE_STRING = 500;
const MAX_SUMMARY_KEYS = 32;
const PRIVATE_KEYS = new Set([
  'reasoning', 'reasoningcontent', 'chainofthought', 'credential', 'credentials',
  'secret', 'password', 'apikey', 'accesstoken', 'refreshtoken', 'diff',
  'edits', 'source', 'sourcecode', 'fullsource', 'prompt', 'response', 'log',
]);

function publicString(value: string): string {
  const withoutThinking = value.replace(
    /<think>[\s\S]*?(?:<\/think>|$)/giu,
    '[hidden reasoning removed]',
  );
  const withoutCredentialValues = withoutThinking.replace(
    /\b(?:bearer\s+\S+|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password)\s*[=:]\s*[^\s,;]+)/giu,
    '[redacted]',
  );
  return redactExternalText(withoutCredentialValues).text
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .slice(0, MAX_TRACE_STRING);
}

function sanitizeSummaryValue(value: unknown, depth = 0): unknown {
  if (depth > 3) return '[bounded]';
  if (typeof value === 'string') return publicString(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_SUMMARY_KEYS).map((item) => sanitizeSummaryValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, MAX_SUMMARY_KEYS)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/gu, '');
      if (PRIVATE_KEYS.has(normalizedKey)) continue;
      result[publicString(key)] = sanitizeSummaryValue(item, depth + 1);
    }
    return result;
  }
  return String(value).slice(0, MAX_TRACE_STRING);
}

export function sanitizeTraceEvent(event: TraceEvent): TraceEvent {
  return sanitizeSummaryValue(event) as TraceEvent;
}
