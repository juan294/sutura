import type { Diagnosis, Grounding } from '../domain.js';
import type { HttpRequestInit, HttpResponse } from '../llm/nebius.js';

const DEFAULT_BASE_URL = 'https://api.tavily.com';
const WEB_HELPFUL_CLASSES = new Set(['dep-upstream-breaking', 'env-config', 'build']);
const MEMBER_NOT_FUNCTION = /\bTypeError:\s+[@\w./-]+\.[\w$]+\s+is not a function\b/i;
const VERSION_PATTERN_SOURCE = '[~^]?\\d+\\.\\d+\\.\\d+(?:-[\\w.-]+)?';
const NESTED_SPECIFIER = new RegExp(
  `^specifier:\\s*(?<version>${VERSION_PATTERN_SOURCE})$`,
  'i',
);
const PACKAGE_VERSION_KEY = new RegExp(
  `^["']?(?<package>@?[a-z0-9][\\w./-]*)@(?<version>${VERSION_PATTERN_SOURCE})["']?:$`,
  'i',
);
const PACKAGE_VERSION_VALUE = new RegExp(
  `^["']?(?<package>@?[a-z0-9][\\w./-]*)["']?:\\s*(?<version>${VERSION_PATTERN_SOURCE})$`,
  'i',
);
const MAX_QUERY_CHARACTERS: number = '2_000';
const MAX_ERROR_QUERY_CHARACTERS = 1_000;

export type TavilyHttpResponse = Pick<HttpResponse, 'ok' | 'status' | 'json'>;
export type TavilyHttpRequestInit = HttpRequestInit;

type TavilyFetch = (
  input: string,
  init: TavilyHttpRequestInit,
) => Promise<TavilyHttpResponse>;

export interface TavilyClientDependencies {
  fetch?: TavilyFetch;
  baseUrl?: string;
}

export interface TavilySearchOptions {
  maxResults?: number;
}

export type TavilyCitation = Grounding['citations'][number];

export interface TavilySearch {
  search(query: string, options?: TavilySearchOptions): Promise<TavilyCitation[]>;
}

export interface GroundOptions {
  tavilyEnabled: boolean;
  lockfileDiff?: string;
}

export class TavilyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TavilyConfigError';
  }
}

export class TavilyRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'TavilyRequestError';
  }
}

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/search`;
}

function isCitation(value: unknown): value is {
  title: string;
  url: string;
  content: string;
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    typeof result.title === 'string' &&
    typeof result.url === 'string' &&
    /^https?:\/\//.test(result.url) &&
    typeof result.content === 'string'
  );
}

export class TavilyClient implements TavilySearch {
  private readonly apiKey: string | undefined;
  private readonly fetch: TavilyFetch;
  private readonly baseUrl: string;

  constructor(
    apiKey: string | undefined,
    dependencies: TavilyClientDependencies = {},
  ) {
    const runtimeFetch = (globalThis as unknown as { fetch?: TavilyFetch }).fetch;
    if (!dependencies.fetch && !runtimeFetch) {
      throw new TavilyConfigError('This runtime does not provide fetch');
    }
    this.apiKey = apiKey?.trim() || undefined;
    this.fetch = dependencies.fetch ?? (runtimeFetch as TavilyFetch);
    this.baseUrl = dependencies.baseUrl ?? DEFAULT_BASE_URL;
  }

  async search(
    query: string,
    { maxResults = 5 }: TavilySearchOptions = {},
  ): Promise<TavilyCitation[]> {
    if (!this.apiKey?.trim()) {
      throw new TavilyConfigError('Tavily grounding requires TAVILY_API_KEY');
    }
    if (!Number.isSafeInteger(maxResults) || maxResults < 1 || maxResults > 20) {
      throw new RangeError('maxResults must be an integer from 1 to 20');
    }
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      throw new RangeError('query must not be empty');
    }

    let response: TavilyHttpResponse;
    try {
      response = await this.fetch(endpoint(this.baseUrl), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: normalizedQuery,
          max_results: maxResults,
          search_depth: 'basic',
          include_answer: false,
        }),
      });
    } catch {
      throw new TavilyRequestError('Tavily search request failed');
    }

    if (!response.ok) {
      throw new TavilyRequestError(
        `Tavily search request failed with status ${response.status}`,
        response.status,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new TavilyRequestError('Tavily search returned an invalid response');
    }
    if (typeof body !== 'object' || body === null) {
      throw new TavilyRequestError('Tavily search returned an invalid response');
    }

    const results = (body as { results?: unknown }).results;
    if (!Array.isArray(results)) {
      throw new TavilyRequestError('Tavily search returned an invalid response');
    }

    return results.filter(isCitation).map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.content.slice(0, 2_000),
    }));
  }
}

function packageVersions(lockfileDiff: string, characterBudget: number): string[] {
  const versions = new Set<string>();
  let pendingPackage: { name: string; indent: number } | undefined;
  let usedCharacters = 0;

  function addVersion(value: string): boolean {
    if (versions.has(value)) {
      return true;
    }
    const cost = value.length + (versions.size === 0 ? 0 : 1);
    if (cost > characterBudget - usedCharacters) {
      return false;
    }
    versions.add(value);
    usedCharacters += cost;
    return true;
  }

  for (let cursor = 0; cursor <= lockfileDiff.length; ) {
    const nextNewline = lockfileDiff.indexOf('\n', cursor);
    const end = nextNewline === -1 ? lockfileDiff.length : nextNewline;
    const rawLine = lockfileDiff.slice(cursor, end).replace(/\r$/, '');
    cursor = nextNewline === -1 ? lockfileDiff.length + 1 : end + 1;
    if (!rawLine.startsWith('+') || rawLine.startsWith('+++')) {
      continue;
    }
    const addedLine = rawLine.slice(1);
    const indent = /^\s*/.exec(addedLine)?.[0].length ?? 0;
    const line = addedLine.trim();
    const nestedVersion = NESTED_SPECIFIER.exec(line);
    if (
      pendingPackage &&
      indent > pendingPackage.indent &&
      nestedVersion?.groups?.version
    ) {
      if (!addVersion(`${pendingPackage.name}@${nestedVersion.groups.version}`)) {
        break;
      }
      continue;
    }
    if (pendingPackage && indent <= pendingPackage.indent) {
      pendingPackage = undefined;
    }

    const keyMatch = PACKAGE_VERSION_KEY.exec(line);
    const valueMatch = PACKAGE_VERSION_VALUE.exec(line);
    const match = keyMatch ?? valueMatch;
    if (
      match?.groups?.package &&
      match.groups.version &&
      !['specifier', 'version'].includes(match.groups.package.toLowerCase())
    ) {
      if (!addVersion(`${match.groups.package}@${match.groups.version}`)) {
        break;
      }
      continue;
    }

    const packageStart = /^["']?(?<package>@?[a-z0-9][\w./-]*)["']?:$/i.exec(line);
    if (packageStart?.groups?.package) {
      pendingPackage = { name: packageStart.groups.package, indent };
    }
  }

  return [...versions];
}

function redactSecrets(value: string): string {
  return value
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(
      /\b(?:[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)|api[_-]?key|token|secret|password)\s*[=:]\s*[^\s,;]+/gi,
      '[redacted credential]',
    );
}

function groundingQuery(diagnosis: Diagnosis, lockfileDiff = ''): string {
  const safeExcerpt = redactSecrets(diagnosis.errorExcerpt.trim())
    .replace(/\s+/g, ' ')
    .slice(0, MAX_ERROR_QUERY_CHARACTERS);
  const packageBudget = MAX_QUERY_CHARACTERS - safeExcerpt.length - 1;
  const packages = packageVersions(lockfileDiff, Math.max(0, packageBudget));
  return [safeExcerpt, ...packages]
    .filter(Boolean)
    .join(' ')
    .slice(0, MAX_QUERY_CHARACTERS);
}

export async function ground(
  tavily: TavilySearch,
  diagnosis: Diagnosis,
  options: GroundOptions,
): Promise<Grounding> {
  if (!options.tavilyEnabled) {
    return { query: '', citations: [], skipped: true, reason: 'disabled' };
  }
  const webHelpful = WEB_HELPFUL_CLASSES.has(diagnosis.class) ||
    (diagnosis.class === 'test-bug' && MEMBER_NOT_FUNCTION.test(diagnosis.errorExcerpt));
  if (!webHelpful) {
    return { query: '', citations: [], skipped: true, reason: 'not-applicable' };
  }

  const query = groundingQuery(diagnosis, options.lockfileDiff);
  const citations = await tavily.search(query, { maxResults: 5 });
  return { query, citations, skipped: false };
}
