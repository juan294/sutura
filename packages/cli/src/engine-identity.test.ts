import { expect, it } from 'vitest';
import { requireEngineSha } from './engine-identity.js';
it('does not derive an unbundled engine identity from environment or checkout source', () => {
  const previous = process.env.SUTURA_ENGINE_SHA;
  process.env.SUTURA_ENGINE_SHA = 'a'.repeat(40);
  try { expect(() => requireEngineSha()).toThrow(/clean.*engine|engine.*clean/u); }
  finally { if (previous === undefined) delete process.env.SUTURA_ENGINE_SHA; else process.env.SUTURA_ENGINE_SHA = previous; }
});
