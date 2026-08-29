import { createHash } from 'node:crypto';

export const SHA_PATTERN = /^[a-f0-9]{40}$/u;
export const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function contentHash(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function exactSha(value, label) {
  if (typeof value !== 'string' || !SHA_PATTERN.test(value)) {
    throw new Error(`${label} must be an exact lowercase 40-character commit`);
  }
  return value;
}

export function nonnegativeNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite nonnegative number`);
  }
  return value;
}

export function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative integer`);
  }
  return value;
}

export function publicGitHubUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a public GitHub URL`);
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password) {
    throw new Error(`${label} must be a public GitHub URL`);
  }
  return url.toString();
}
