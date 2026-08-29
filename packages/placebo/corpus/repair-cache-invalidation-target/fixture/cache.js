const cache = new Map();

export function bundle(entry, target, source) {
  const key = `${entry}:${target}`;
  if (!cache.has(key)) cache.set(key, `${target}:${source}`);
  return cache.get(key);
}
