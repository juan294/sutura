import { describe, expect, it, vi } from 'vitest';

import {
  capturedDogfoodReplayBundle,
  decodedRecordedBody,
  successfulCapturedHttp,
} from '../__fixtures__/captured/live-dogfood-replay.test-helper.js';
import { JsonExtractionError, extractJson } from './json.js';

interface Verdict {
  approved: boolean;
}

function validateVerdict(value: unknown): Verdict {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('approved' in value) ||
    typeof value.approved !== 'boolean'
  ) {
    throw new Error('approved must be a boolean');
  }

  return { approved: value.approved };
}

describe('extractJson', () => {
  it('extracts the captured workflow 33321172589 diagnosis JSON', async () => {
    const bundle = await capturedDogfoodReplayBundle();
    const body = successfulCapturedHttp(bundle, 'nebius')[0]?.response.body;
    if (body === undefined) throw new Error('Captured Nebius response body is unavailable');
    const response = JSON.parse(decodedRecordedBody(body)) as {
      choices: Array<{ message: { content: string } }>;
    };

    const diagnosis = extractJson(response.choices[0]!.message.content, (value) => value as {
      class: string;
      confidence: number;
    });

    expect(diagnosis).toMatchObject({ class: 'test-assertion', confidence: 0.96 });
  });

  it('recovers an object wrapped in prose and think output', () => {
    const reply = {
      text: 'The answer follows.\n<think>private reasoning</think>\n{"approved":true}\nDone.',
    };

    expect(extractJson(reply, validateVerdict)).toEqual({ approved: true });
  });

  it('ignores an unmatched prose quote before a JSON object', () => {
    const reply = 'Prefix with an unmatched " quote before JSON\n{"approved":true}';

    expect(extractJson(reply, validateVerdict)).toEqual({ approved: true });
  });

  it('handles braces and escaped quotes inside JSON strings', () => {
    const reply = 'Result: {"approved":true,"note":"a {brace} and \\"quote\\""}';

    expect(extractJson(reply, validateVerdict)).toEqual({ approved: true });
  });

  it('recovers a valid nested object from a malformed outer object', () => {
    const reply = '{"wrapper":[{"approved":true}}';

    expect(extractJson(reply, validateVerdict)).toEqual({ approved: true });
  });

  it('does not bypass validation through a nested object in valid JSON', () => {
    const reply = '{"wrapper":{"approved":true}}';

    expect(() => extractJson(reply, validateVerdict)).toThrow(JsonExtractionError);
  });

  it('re-prompts once with the validation error and validates the repair', async () => {
    const repair = vi.fn().mockResolvedValue('{"approved":false}');

    await expect(
      extractJson('{"approved":"yes"}', validateVerdict, repair),
    ).resolves.toEqual({ approved: false });
    expect(repair).toHaveBeenCalledOnce();
    expect(repair).toHaveBeenCalledWith(
      expect.stringContaining('approved must be a boolean'),
    );
  });

  it('throws after one invalid repair without a second callback', async () => {
    const repair = vi.fn().mockResolvedValue('{"approved":"still invalid"}');

    await expect(
      extractJson('not JSON', validateVerdict, repair),
    ).rejects.toThrow(JsonExtractionError);
    expect(repair).toHaveBeenCalledOnce();
  });

  it('wraps a synchronous repair callback failure in the async contract', async () => {
    const repair = vi.fn(() => {
      throw new Error('repair transport failed');
    });

    const result = extractJson('not JSON', validateVerdict, repair);

    await expect(result).rejects.toThrow(
      new JsonExtractionError(
        'JSON repair request failed: repair transport failed',
      ),
    );
    expect(repair).toHaveBeenCalledOnce();
  });

  it('throws a typed error for an invalid reply without repair', () => {
    expect(() => extractJson('not JSON', validateVerdict)).toThrow(
      JsonExtractionError,
    );
  });
});
