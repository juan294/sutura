import { describe, expect, it } from 'vitest';

import { canonicalJson } from './canonical-json.js';

describe('canonicalJson', () => {
  it('sorts object keys recursively without changing array order', () => {
    expect(canonicalJson({ z: 1, a: { d: 2, c: [3, 1] } }))
      .toBe('{"a":{"c":[3,1],"d":2},"z":1}');
  });

  it('rejects values that JSON cannot represent deterministically', () => {
    expect(() => canonicalJson({ value: undefined })).toThrow(/undefined/u);
    expect(() => canonicalJson(Number.NaN)).toThrow(/finite/u);
  });
});
