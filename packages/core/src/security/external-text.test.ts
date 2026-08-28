import { describe, expect, it } from 'vitest';

import {
  assertExternalEditableText,
  redactExternalText,
} from './external-text.js';

describe('redactExternalText', () => {
  it('redacts credentials while preserving useful path and error structure', () => {
    const input = [
      'src/client.ts:12 request failed',
      'Authorization:\n  Bearer bearer-secret-value',
      'SERVICE_API_KEY=assignment-secret',
      'fetch https://user:password@example.test/private',
      '-----BEGIN PRIVATE KEY-----',
      'private-key-material',
      '-----END PRIVATE KEY-----',
    ].join('\n');

    const result = redactExternalText(input);

    expect(result.text).toContain('src/client.ts:12 request failed');
    expect(result.text).toContain('example.test/private');
    expect(result.text).not.toMatch(/bearer-secret|assignment-secret|user:password|private-key-material/u);
    expect(result.count).toBe(4);
  });

  it('redacts known keys that were split by line wrapping', () => {
    const result = redactExternalText(
      'provider returned github_pat_abcDEF1234567890\nABCDEF1234567890xyz',
    );

    expect(result.count).toBe(1);
    expect(result.text).not.toContain('abcDEF1234567890');
  });

  it('redacts lowercase credential keys in serialized objects', () => {
    const result = redactExternalText('{"api_key":"object-secret"}');

    expect(result.count).toBe(1);
    expect(result.text).not.toContain('object-secret');
  });

  it.each([
    'TOKEN=plain-secret',
    'SECRET="wrapped secret"',
    'token=plain-secret',
    'api_key="wrapped secret"',
  ])('redacts basic environment assignment %s', (input) => {
    const result = redactExternalText(input);

    expect(result.count).toBe(1);
    expect(result.text).not.toContain('plain-secret');
    expect(result.text).not.toContain('wrapped secret');
  });

  it('does not redact ordinary code and security vocabulary', () => {
    const input = [
      'const token = cursor.next();',
      'export const API_TOKEN = process.env.API_TOKEN;',
      'expect(passwordField).toBeVisible();',
      'The authorization policy rejected the request.',
      'https://example.test/public/path',
    ].join('\n');

    expect(redactExternalText(input)).toEqual({ text: input, count: 0 });
  });

  it('rejects editable source without returning the removed value', () => {
    expect(() =>
      assertExternalEditableText('export const config={"token":"do-not-return-this"};'),
    ).toThrow('editable external text contains 1 credential pattern');
    try {
      assertExternalEditableText('export const config={"token":"do-not-return-this"};');
    } catch (error) {
      expect(String(error)).not.toContain('do-not-return-this');
    }
  });
});
