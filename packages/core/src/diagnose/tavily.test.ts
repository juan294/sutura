import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import type { Diagnosis } from '../domain.js';
import {
  TavilyClient,
  TavilyConfigError,
  TavilyRequestError,
  ground,
  promoteUpstreamDependencyDiagnosis,
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

async function syntheticFixture(name: 'search' | 'extract'): Promise<unknown> {
  return JSON.parse(await readFile(
    new URL(`../__fixtures__/captured/tavily/${name}.synthetic.json`, import.meta.url),
    'utf8',
  ));
}

const BUILD_DIAGNOSIS: Diagnosis = {
  class: 'build',
  confidence: 0.9,
  signals: ['Could not resolve react-dom'],
  failingCmd: 'pnpm build',
  errorExcerpt: "Could not resolve package 'react-dom'",
};

describe('Tavily grounding', () => {
  it('uses the labeled synthetic search fixture until Phase 5 capture', async () => {
    const fetch = vi.fn().mockResolvedValue(response(await syntheticFixture('search')));
    const tavily = new TavilyClient('test-key', { fetch });

    await expect(tavily.search('synthetic query')).resolves.toHaveLength(1);
  });

  it('uses the labeled synthetic extract fixture until Phase 5 capture', async () => {
    const body = await syntheticFixture('extract') as { results: Array<{ url: string }> };
    const fetch = vi.fn().mockResolvedValue(response(body));
    const tavily = new TavilyClient('test-key', { fetch });

    await expect(tavily.extract([body.results[0]?.url ?? ''], 'synthetic query'))
      .resolves.toHaveLength(1);
  });

  it.each([0, 21, 1.5, Number.NaN])(
    'rejects invalid search maxResults %s before transport',
    async (maxResults) => {
      const fetch = vi.fn();
      await expect(new TavilyClient('test-key', { fetch }).search('query', { maxResults }))
        .rejects.toThrow(/maxResults must be an integer/u);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('rejects empty search input and missing credentials before transport', async () => {
    const fetch = vi.fn();
    await expect(new TavilyClient(' ', { fetch }).search('query'))
      .rejects.toBeInstanceOf(TavilyConfigError);
    await expect(new TavilyClient('test-key', { fetch }).search('  '))
      .rejects.toThrow(/query must not be empty/u);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['transport', () => Promise.reject(new Error('synthetic transport failure')), /search request failed/u],
    ['status', () => Promise.resolve(response({}, 503)), /status 503/u],
    ['invalid JSON', () => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError('synthetic')) }), /invalid response/u],
    ['null body', () => Promise.resolve(response(null)), /invalid response/u],
    ['missing results', () => Promise.resolve(response({})), /invalid response/u],
  ] as const)('rejects synthetic search %s', async (_label, implementation, message) => {
    const tavily = new TavilyClient('test-key', { fetch: vi.fn(implementation) });
    await expect(tavily.search('query')).rejects.toThrow(message);
  });

  it('filters malformed search citations and bounds accepted snippets', async () => {
    const content = 'x'.repeat(2_001);
    const tavily = new TavilyClient('test-key', { fetch: vi.fn().mockResolvedValue(response({
      results: [null, {}, { title: 'bad', url: 'file:///tmp/x', content }, {
        title: 'valid', url: 'https://example.test', content,
      }],
    })) });
    await expect(tavily.search('query')).resolves.toEqual([{
      title: 'valid', url: 'https://example.test', snippet: 'x'.repeat(2_000),
    }]);
  });

  it('rejects invalid extract inputs and missing credentials before transport', async () => {
    const fetch = vi.fn();
    const githubUrl = 'https://github.com/example/project';
    await expect(new TavilyClient(' ', { fetch }).extract([githubUrl], 'query'))
      .rejects.toBeInstanceOf(TavilyConfigError);
    await expect(new TavilyClient('test-key', { fetch }).extract([], 'query'))
      .rejects.toThrow(/1 to 10 GitHub URLs/u);
    await expect(new TavilyClient('test-key', { fetch }).extract(
      Array.from({ length: 11 }, (_, index) => `${githubUrl}/${index}`),
      'query',
    )).rejects.toThrow(/1 to 10 GitHub URLs/u);
    await expect(new TavilyClient('test-key', { fetch }).extract([githubUrl], ' '))
      .rejects.toThrow(/query must not be empty/u);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['transport', () => Promise.reject(new Error('synthetic transport failure')), /extract request failed/u],
    ['status', () => Promise.resolve(response({}, 503)), /status 503/u],
    ['invalid JSON', () => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError('synthetic')) }), /invalid response/u],
    ['null body', () => Promise.resolve(response(null)), /invalid response/u],
    ['missing results', () => Promise.resolve(response({})), /invalid response/u],
  ] as const)('rejects synthetic extract %s', async (_label, implementation, message) => {
    const tavily = new TavilyClient('test-key', { fetch: vi.fn(implementation) });
    await expect(tavily.extract(['https://github.com/example/project'], 'query'))
      .rejects.toThrow(message);
  });

  it('rejects invalid package identities before npm transport', async () => {
    const fetch = vi.fn();
    const tavily = new TavilyClient('test-key', { fetch });
    await expect(tavily.packageRepository('bad name', '1.0.0')).rejects.toThrow(/valid/u);
    await expect(tavily.packageRepository('valid-name', 'latest')).rejects.toThrow(/valid/u);
    expect(fetch).not.toHaveBeenCalled();
  });
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
    expect(JSON.parse(init.body ?? '')).toEqual({
      query: 'react-dom export changed',
      max_results: 3,
      search_depth: 'basic',
      include_answer: false,
    });
  });

  it('extracts a bounded official GitHub release citation', async () => {
    const fetch = vi.fn().mockResolvedValue(response({
      results: [{
        url: 'https://github.com/chalk/chalk/releases/tag/v5.0.0',
        raw_content: '# v5.0.0\nThis package is now ESM.',
      }],
      failed_results: [],
    }));
    const tavily = new TavilyClient('test-key', { fetch });

    await expect(tavily.extract(
      ['https://github.com/chalk/chalk/releases/tag/v5.0.0'],
      'chalk 5.0.0 breaking changes',
    )).resolves.toEqual([{
      title: 'GitHub release: v5.0.0',
      url: 'https://github.com/chalk/chalk/releases/tag/v5.0.0',
      snippet: '# v5.0.0\nThis package is now ESM.',
    }]);
    expect(JSON.parse((fetch.mock.calls[0]?.[1] as TavilyHttpRequestInit).body ?? '')).toMatchObject({
      urls: ['https://github.com/chalk/chalk/releases/tag/v5.0.0'],
      query: 'chalk 5.0.0 breaking changes',
      chunks_per_source: 3,
    });
  });

  it('resolves GitHub ownership from exact npm registry metadata', async () => {
    const fetch = vi.fn().mockResolvedValue(response({
      name: '@scope/widget',
      version: '2.4.0',
      repository: { type: 'git', url: 'git+https://github.com/acme/widget.git' },
    }));
    const tavily = new TavilyClient('test-key', { fetch });

    await expect(tavily.packageRepository('@scope/widget', '2.4.0')).resolves.toBe(
      'https://github.com/acme/widget',
    );
    expect(fetch).toHaveBeenCalledWith(
      'https://registry.npmjs.org/%40scope%2Fwidget/2.4.0',
      { method: 'GET', headers: { Accept: 'application/json' } },
    );
  });

  it('rejects registry metadata for a different package identity', async () => {
    const fetch = vi.fn().mockResolvedValue(response({
      name: 'widget',
      version: '2.4.0',
      repository: 'https://github.com/attacker/widget',
    }));
    const tavily = new TavilyClient('test-key', { fetch });

    await expect(tavily.packageRepository('@scope/widget', '2.4.0')).resolves.toBeNull();
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

  it('uses exact dependency hints and extracts a matching official release', async () => {
    const search = vi.fn().mockResolvedValue([{
      title: 'Unrelated same-name repository',
      url: 'https://github.com/attacker/chalk/issues/1',
      snippet: 'Untrusted search result.',
    }]);
    const packageRepository = vi.fn().mockResolvedValue('https://github.com/chalk/chalk');
    const extract = vi.fn().mockResolvedValue([{
      title: 'GitHub release: v5.0.0',
      url: 'https://github.com/chalk/chalk/releases/tag/v5.0.0',
      snippet: 'Chalk v5.0.0 is now ESM.',
    }]);

    const result = await ground(
      { search, extract, packageRepository },
      { ...BUILD_DIAGNOSIS, errorExcerpt: 'TypeError: chalk.green is not a function' },
      { tavilyEnabled: true, dependencyHints: ['chalk@5.0.0', 'invalid hint'] },
    );

    expect(result.query).toMatch(/^chalk@5\.0\.0 /u);
    expect(search).toHaveBeenCalledOnce();
    expect(packageRepository).toHaveBeenCalledWith('chalk', '5.0.0');
    expect(extract).toHaveBeenCalledWith(
      [
        'https://github.com/chalk/chalk/releases/tag/v5.0.0',
        'https://github.com/chalk/chalk/blob/main/docs/v5-UPGRADE-GUIDE.md',
      ],
      'chalk 5.0.0 breaking changes migration',
    );
    expect(result.citations).toContainEqual(expect.objectContaining({
      url: 'https://github.com/chalk/chalk/releases/tag/v5.0.0',
    }));
  });

  it('keeps primary citations when optional release extraction fails', async () => {
    const citation = {
      title: 'Chalk migration discussion',
      url: 'https://github.com/chalk/chalk/issues/532',
      snippet: 'Chalk became ESM.',
    };
    const search = vi.fn().mockResolvedValue([citation]);

    await expect(ground(
      {
        search,
        extract: vi.fn(),
        packageRepository: vi.fn().mockRejectedValue(new Error('registry unavailable')),
      },
      { ...BUILD_DIAGNOSIS, errorExcerpt: 'TypeError: chalk.green is not a function' },
      { tavilyEnabled: true, dependencyHints: ['chalk@5.0.0'] },
    )).resolves.toMatchObject({ citations: [citation], skipped: false });
    expect(search).toHaveBeenCalledOnce();
  });

  it('does not enrich an unrelated dependency on a substring match', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const packageRepository = vi.fn();
    const extract = vi.fn();

    await ground(
      { search, packageRepository, extract },
      { ...BUILD_DIAGNOSIS, errorExcerpt: 'The build forgot to emit an artifact' },
      { tavilyEnabled: true, dependencyHints: ['got@12.0.0', 'chalk@5.0.0'] },
    );

    expect(search).toHaveBeenCalledOnce();
    expect(packageRepository).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
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

  it('grounds a named package member TypeError that can signal import interop drift', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const diagnosis: Diagnosis = {
      class: 'test-bug',
      confidence: 0.49,
      signals: ['TypeError: chalk.green is not a function'],
      failingCmd: 'vitest run',
      errorExcerpt: 'TypeError: chalk.green is not a function',
    };

    await expect(
      ground({ search }, diagnosis, { tavilyEnabled: true }),
    ).resolves.toMatchObject({ skipped: false });
    expect(search).toHaveBeenCalledWith(
      'TypeError: chalk.green is not a function',
      { maxResults: 5 },
    );
  });

  it('grounds a bare package TypeError that can signal import interop drift', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const diagnosis: Diagnosis = {
      class: 'test-bug',
      confidence: 0.49,
      signals: ['TypeError: got is not a function'],
      failingCmd: 'vitest run',
      errorExcerpt: 'TypeError: got is not a function',
    };

    await expect(
      ground({ search }, diagnosis, { tavilyEnabled: true }),
    ).resolves.toMatchObject({ skipped: false });
    expect(search).toHaveBeenCalledWith(
      'TypeError: got is not a function',
      { maxResults: 5 },
    );
  });

  it('promotes a bare installed-package call failure to an upstream diagnosis', () => {
    const diagnosis: Diagnosis = {
      class: 'test-bug',
      confidence: 0.49,
      signals: ['llm:test-bug'],
      failingCmd: 'vitest run',
      errorExcerpt: 'TypeError: got is not a function',
    };

    expect(promoteUpstreamDependencyDiagnosis(diagnosis, ['got@12.0.0'])).toMatchObject({
      class: 'dep-upstream-breaking',
      confidence: 0.8,
      signals: ['llm:test-bug', 'mechanical:dep-upstream-breaking'],
    });
    expect(promoteUpstreamDependencyDiagnosis(diagnosis, ['chalk@5.0.0'])).toBe(diagnosis);

    expect(promoteUpstreamDependencyDiagnosis({
      ...diagnosis,
      errorExcerpt: 'TypeError: fetch is not a function',
    }, ['node-fetch@3.0.0'])).toMatchObject({ class: 'dep-upstream-breaking' });

    expect(promoteUpstreamDependencyDiagnosis({
      ...diagnosis,
      class: 'test-assertion',
      errorExcerpt: 'TypeError: chalk.green is not a function',
    }, ['chalk@5.0.0'])).toMatchObject({ class: 'dep-upstream-breaking' });
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
