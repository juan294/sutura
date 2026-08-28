import { createHash } from 'node:crypto';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeLines(value: string): string {
  return value.replace(/\r\n?/gu, '\n').split('\n').map((line) => line.trimEnd()).join('\n').trim();
}

export function diffFingerprint(diff: string): string {
  return digest(normalizeLines(diff));
}

export function errorFingerprint(output: string): string {
  const stable = normalizeLines(output)
    .replace(/(?:file:\/\/)?\/workspace\//gu, '')
    .replace(/:\d+(?::\d+)?/gu, ':#')
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|s|seconds?)\b/giu, '#time')
    .replace(/\b\d+\b/gu, '#')
    .replace(/\s+/gu, ' ')
    .toLowerCase();
  return digest(stable);
}

export function failureSignatureCount(output: string): number {
  const signatures = output.split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(errorFingerprint);
  return new Set(signatures).size;
}
