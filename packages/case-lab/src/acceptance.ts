import { CASE_LAB_CASES } from './cases.js';
import { MODE_LABELS } from './render.js';
import { validateCaseLabResult, type CaseLabResult } from './result.js';

export const ACCEPTANCE_SCHEMA_VERSION = 'sutura-case-lab-acceptance-v1' as const;
const RESULTS_BASE = 'https://raw.githubusercontent.com/juan294/sutura-demo/case-lab-results/results/';
const LINK_TIMEOUT_MS = 10_000;
const LINK_CONCURRENCY = 5;

export interface AcceptanceCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface AcceptanceRecord {
  readonly schemaVersion: typeof ACCEPTANCE_SCHEMA_VERSION;
  readonly baseUrl: string;
  readonly checkedAt: string;
  readonly checks: readonly AcceptanceCheck[];
  readonly passed: boolean;
}

export interface AcceptanceOptions {
  /** Check that every GitHub link in the results answers without authentication. Off keeps the run offline. */
  readonly checkLinks?: boolean;
  readonly liveResultId?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

/** Signed-out requests only: no cookies, no authorization header, nothing cached. */
async function get(fetchImpl: typeof fetch, url: string, method: 'GET' | 'HEAD' = 'GET'): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINK_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { method, redirect: 'follow', signal: controller.signal, credentials: 'omit', cache: 'no-store' } as RequestInit);
  } finally {
    clearTimeout(timer);
  }
}

function signedOutHeaders(response: Response): string[] {
  const problems: string[] = [];
  if (response.headers.get('set-cookie')) problems.push('sets a cookie');
  if (response.headers.get('www-authenticate')) problems.push('demands authentication');
  return problems;
}

async function mapLimited<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index]!;
      index += 1;
      results.push(await worker(current));
    }
  }));
  return results;
}

export async function acceptance(baseUrl: string, options: AcceptanceOptions = {}): Promise<AcceptanceRecord> {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const checks: AcceptanceCheck[] = [];
  const results = new Map<string, CaseLabResult>();

  function record(name: string, passed: boolean, detail: string): void {
    checks.push({ name, passed, detail });
  }

  try {
    const index = await get(fetchImpl, base);
    const html = await index.text();
    const problems = signedOutHeaders(index);
    const missing = CASE_LAB_CASES.filter((item) => !html.includes(`replay/${item.id}/`)).map((item) => item.id);
    const hasRelease = /Release v\d+\.\d+\.\d+ · Action <code>[a-f0-9]{40}<\/code>/u.test(html);
    const hasViewport = html.includes('<meta name="viewport" content="width=device-width, initial-scale=1">');
    const passed = index.status === 200 && problems.length === 0 && missing.length === 0 && hasRelease && hasViewport;
    record('index-loads', passed, passed
      ? 'index lists five cases and the release identity'
      : `status ${index.status}; ${problems.join(', ') || 'no auth problems'}; missing ${missing.join(', ') || 'none'}; release ${hasRelease}; viewport ${hasViewport}`);
  } catch (error) {
    record('index-loads', false, error instanceof Error ? error.message : String(error));
  }

  for (const item of CASE_LAB_CASES) {
    const name = `replay-${item.id}`;
    try {
      const page = await get(fetchImpl, `${base}replay/${item.id}/`);
      const html = await page.text();
      const json = await get(fetchImpl, `${base}replay/${item.id}/result.json`);
      const problems = [...signedOutHeaders(page), ...signedOutHeaders(json)];
      const result = validateCaseLabResult(await json.json());
      results.set(item.id, result);
      const label = MODE_LABELS[result.mode];
      const titled = html.includes(`<title>${item.title} · ${label} · `);
      const badged = html.includes(`>${label}</span>`);
      const viewport = html.includes('<meta name="viewport" content="width=device-width, initial-scale=1">');
      const sameCase = result.caseId === item.id;
      const passed = page.status === 200 && json.status === 200 && problems.length === 0 && titled && badged && viewport && sameCase;
      record(name, passed, passed
        ? `${label}; outcome ${result.outcome}; hash ${result.resultHash.slice(0, 12)}`
        : `page ${page.status}; json ${json.status}; ${problems.join(', ') || 'no auth problems'}; title ${titled}; badge ${badged}; viewport ${viewport}; case ${sameCase}`);
    } catch (error) {
      record(name, false, error instanceof Error ? error.message : String(error));
    }
  }

  const trap = results.get('greenwash-trap');
  const flaky = results.get('flaky-failure');
  const refusalPassed = trap?.outcome === 'refused' && trap.caseFile?.audit?.approved === false;
  const flakyPassed = flaky?.outcome === 'flaky-no-patch' && flaky.caseFile?.race.length === 0;
  record('refusal-and-flaky', refusalPassed === true && flakyPassed === true,
    `greenwash-trap ${trap?.outcome ?? 'missing'} (audit approved: ${String(trap?.caseFile?.audit?.approved)}); flaky-failure ${flaky?.outcome ?? 'missing'}`);

  try {
    const css = await get(fetchImpl, `${base}case-lab.css`);
    const text = await css.text();
    const passed = css.status === 200 && text.includes('@media (max-width: 719px)') && text.includes('overflow-x: auto');
    record('mobile-css', passed, passed ? 'breakpoint and horizontal scroll containers present' : `status ${css.status}`);
  } catch (error) {
    record('mobile-css', false, error instanceof Error ? error.message : String(error));
  }

  if (options.checkLinks === true) {
    const links = [...new Set([...results.values()].flatMap((result) => Object.values(result.links)))];
    const outcomes = await mapLimited(links, LINK_CONCURRENCY, async (url) => {
      try {
        const response = await get(fetchImpl, url, 'HEAD');
        return { url, ok: response.status === 200, status: response.status };
      } catch (error) {
        return { url, ok: false, status: error instanceof Error ? error.message : String(error) };
      }
    });
    const failed = outcomes.filter((outcome) => !outcome.ok);
    record('links-public', failed.length === 0, failed.length === 0
      ? `${outcomes.length} links answered 200 without authentication`
      : failed.map((outcome) => `${outcome.url} -> ${outcome.status}`).join('; '));
  } else {
    record('links-public', true, 'skipped: link checks disabled for an offline run');
  }

  if (options.liveResultId !== undefined) {
    const name = `live-result-${options.liveResultId}`;
    try {
      const response = await get(fetchImpl, `${RESULTS_BASE}${options.liveResultId}.json`);
      const result = validateCaseLabResult(await response.json());
      const run = result.links.workflowRun === undefined ? undefined : await get(fetchImpl, result.links.workflowRun, 'HEAD');
      const passed = response.status === 200 && result.mode === 'live' && result.requestId === options.liveResultId && run?.status === 200;
      record(name, passed, passed ? `live ${result.caseId} ${result.outcome}` : `status ${response.status}; mode ${result.mode}; run ${run?.status ?? 'missing'}`);
    } catch (error) {
      record(name, false, error instanceof Error ? error.message : String(error));
    }
  }

  return {
    schemaVersion: ACCEPTANCE_SCHEMA_VERSION,
    baseUrl: base,
    checkedAt: now().toISOString(),
    checks,
    passed: checks.every((check) => check.passed),
  };
}
