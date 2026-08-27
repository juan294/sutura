import { describe, expect, it } from 'vitest';

import { TavilyClient } from './tavily.js';

const LIVE = process.env.SUTURA_LIVE === '1';

describe.skipIf(!LIVE)('Tavily live search', () => {
  it('returns a relevant citation for a Vitest assertion error', async () => {
    const tavily = new TavilyClient(process.env.TAVILY_API_KEY);

    const citations = await tavily.search(
      'Vitest AssertionError expected value to equal received value debugging',
      { maxResults: 3 },
    );

    expect(citations.length).toBeGreaterThanOrEqual(1);
    expect(citations[0]).toMatchObject({
      title: expect.any(String),
      url: expect.stringMatching(/^https?:\/\//),
      snippet: expect.any(String),
    });
    expect(
      citations.some((citation) =>
        /vitest|assert|expect|test/i.test(`${citation.title} ${citation.snippet}`),
      ),
    ).toBe(true);
  });
});
