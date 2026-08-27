import { describe, expect, it, vi } from 'vitest';

import type { Diagnosis } from '../domain.js';
import {
  TavilyClient,
  TavilyConfigError,
  TavilyRequestError,
  ground,
  type TavilyHttpRequestInit,
  type TavilyHttpResponse,
} from './tavily.js';

function response(body: unknown, status = 200): TavilyHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

const BUILD_DIAGNOSIS: Diagnosis = {
  class: 'build',
  confidence: 0.9,
  signals: ['Could not resolve react-dom'],
  failingCmd: 'pnpm build',
  errorExcerpt: "Could not resolve package 'react-dom'",
};

describe('Tavily grounding', () => {
  it('posts the current search API shape and maps citations', async () => {
    const fetch = vi.fn().mockResolvedValue(response({
      results: [
        {
          title: 'React DOM upgrade notes',
          url: 'https://react.dev/blog/upgrade',
          content: 'The package export changed in this release.',
          score: 0.91,
        },
      ],
    }));
    const tavily = new TavilyClient('test-key', { fetch });

    const results = await tavily.search('react-dom export changed', { maxResults: 3 });

    expect(results).toEqual([
      {
        title: 'React DOM upgrade notes',
        url: 'https://react.dev/blog/upgrade',
        snippet: 'The package export changed in this release.',
      },
    ]);
    const [url, init] = fetch.mock.calls[0] as [string, TavilyHttpRequestInit];
    expect(url).toBe('https://api.tavily.com/search');
    expect(init.headers).toEqual({
      Authorization: 'Bearer test-key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body)).toEqual({
      query: 'react-dom export changed',
      max_results: 3,
      search_depth: 'basic',
      include_answer: false,
    });
  });

  it('includes lockfile-derived package versions in the grounding query', async () => {
    const citation = {
      title: 'React DOM upgrade notes',
      url: 'https://react.dev/blog/upgrade',
      snippet: 'The package export changed in this release.',
    };
    const search = vi.fn().mockResolvedValue([citation]);
    const lockfileDiff = [
      '+  react-dom@19.1.0:',
      '+      scheduler: 0.26.0',
      '-  react-dom@19.0.0:',
    ].join('\n');

    const result = await ground({ search }, BUILD_DIAGNOSIS, {
      tavilyEnabled: true,
      lockfileDiff,
    });

    expect(search).toHaveBeenCalledOnce();
    const query = search.mock.calls[0]?.[0] as string;
    expect(query).toContain('react-dom@19.1.0');
    expect(query).toContain('scheduler@0.26.0');
    expect(result).toMatchObject({ query, skipped: false, citations: [citation] });
  });

  it('pairs pnpm importer names with version bounds without leaking lockfile fields', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const lockfileDiff = [
      '+      @scope/widget:',
      '+        specifier: ^2.4.0',
      '+        version: 2.4.3',
    ].join('\n');

    await ground({ search }, BUILD_DIAGNOSIS, {
      tavilyEnabled: true,
      lockfileDiff,
    });

    const query = search.mock.calls[0]?.[0] as string;
    expect(query).toContain('@scope/widget@^2.4.0');
    expect(query).not.toContain('specifier@');
    expect(query).not.toContain('version@');
  });

  it('stops adding lockfile packages when the 2000-character query budget is full', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const earlyPackages = Array.from(
      { length: 500 },
      (_, index) => `+  package-${index}@1.2.3:`,
    ).join('\n');
    const lockfileDiff = `${earlyPackages}\n${'+ ignored-data'.repeat(100_000)}\n+  last-package@9.9.9:`;

    await ground({ search }, BUILD_DIAGNOSIS, {
      tavilyEnabled: true,
      lockfileDiff,
    });

    const query = search.mock.calls[0]?.[0] as string;
    expect(query.length).toBeLessThanOrEqual(2_000);
    expect(query).toContain('package-0@1.2.3');
    expect(query).not.toContain('last-package@9.9.9');
  });

  it('redacts credential assignments before sending the query', async () => {
    const search = vi.fn().mockResolvedValue([]);

    await ground(
      { search },
      {
        ...BUILD_DIAGNOSIS,
        errorExcerpt: 'SERVICE_API_KEY=private-value build failed',
      },
      { tavilyEnabled: true },
    );

    const query = search.mock.calls[0]?.[0] as string;
    expect(query).not.toContain('private-value');
    expect(query).toContain('[redacted credential]');
  });

  it('marks grounding skipped when Tavily is disabled', async () => {
    const search = vi.fn();

    await expect(
      ground({ search }, BUILD_DIAGNOSIS, { tavilyEnabled: false }),
    ).resolves.toEqual({
      query: '',
      citations: [],
      skipped: true,
      reason: 'disabled',
    });
    expect(search).not.toHaveBeenCalled();
  });

  it('marks classes that do not benefit from web grounding as skipped', async () => {
    const search = vi.fn();

    await expect(
      ground(
        { search },
        { ...BUILD_DIAGNOSIS, class: 'test-assertion' },
        { tavilyEnabled: true },
      ),
    ).resolves.toMatchObject({ skipped: true, reason: 'not-applicable' });
    expect(search).not.toHaveBeenCalled();
  });

  it('fails closed with a typed error when an API key is missing', async () => {
    const tavily = new TavilyClient(undefined, { fetch: vi.fn() });

    await expect(
      ground(tavily, BUILD_DIAGNOSIS, { tavilyEnabled: true }),
    ).rejects.toBeInstanceOf(TavilyConfigError);
  });

  it('does not expose response bodies in public request errors', async () => {
    const privateBody = 'token=private-source-value';
    const tavily = new TavilyClient('test-key', {
      fetch: vi.fn().mockResolvedValue(response(privateBody, 401)),
    });

    const error = await tavily.search('safe query').catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(TavilyRequestError);
    expect(error).toMatchObject({ status: 401 });
    expect((error as Error).message).not.toContain(privateBody);
    expect(error).not.toHaveProperty('body');
  });
});
