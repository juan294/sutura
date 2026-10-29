declare const __SUTURA_ENGINE_SHA__: string | null;
/** A build-time identity, independent of the consumer checkout and ambient environment. */
export function requireEngineSha(): string {
  const sha = typeof __SUTURA_ENGINE_SHA__ === 'undefined' ? null : __SUTURA_ENGINE_SHA__;
  if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/u.test(sha)) throw new Error('Long verification requires an exact clean-build engine identity; prepare a clean verified CLI build');
  return sha;
}
