import { artifactKey } from './cache-key.js';

const cache = new Map();
export function compile(name, context, source) {
  const key = artifactKey(name, context);
  if (!cache.has(key)) cache.set(key, `${context.mode}:${source}`.toUpperCase());
  return cache.get(key);
}
