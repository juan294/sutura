import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { build } from 'esbuild';

import { canonicalJson } from './canonical.js';
import { CASE_LAB_CASES, caseLabCase } from './cases.js';
import { CASE_LAB_LIMITS } from './limits.js';
import { PACKAGE_DIR } from './replay.js';
import {
  MODE_LABELS,
  OUTCOME_LABELS,
  renderIndexBody,
  renderPage,
  renderPendingBody,
  renderResultBody,
  resultPageTitle,
  type CatalogCard,
} from './render.js';
import { validateCaseLabResult, type CaseLabResult } from './result.js';

export interface BuildSiteOptions {
  readonly outDir: string;
  readonly catalog: readonly CaseLabResult[];
  readonly release: { readonly version: string; readonly actionSha: string };
  /** Root path of the site, with a trailing slash. */
  readonly siteRoot?: string;
  /** Origin of the dispatcher API; undefined builds a site with live runs off. Empty string means same origin. */
  readonly apiBase?: string;
  readonly cssPath?: string;
  readonly clientBundle?: string;
}

const CLIENT_ENTRY_CANDIDATES = ['client.ts', 'client.js'];

export async function bundleClient(): Promise<string> {
  const entry = CLIENT_ENTRY_CANDIDATES
    .map((name) => resolve(import.meta.dirname, name))
    .find((path) => existsSync(path));
  if (entry === undefined) throw new Error('client entry is missing beside the site module');
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    minify: false,
    legalComments: 'none',
    logLevel: 'silent',
  });
  const output = result.outputFiles[0];
  if (output === undefined) throw new Error('client bundle produced no output');
  return output.text;
}

function write(path: string, content: string, written: string[]): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
  writeFileSync(path, content, { encoding: 'utf8', mode: 0o644 });
  written.push(path);
}

function mainAttributes(page: string, siteRoot: string, apiBase: string | undefined): Record<string, string> {
  return {
    'data-page': page,
    'data-site-root': siteRoot,
    ...(apiBase === undefined ? {} : { 'data-api-base': apiBase }),
  };
}

/** Write the complete static site. The output directory is replaced. */
export async function buildSite(options: BuildSiteOptions): Promise<string[]> {
  const siteRoot = options.siteRoot ?? '/';
  if (!siteRoot.startsWith('/') || !siteRoot.endsWith('/')) throw new RangeError('siteRoot must start and end with /');
  const outDir = resolve(options.outDir);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true, mode: 0o755 });
  const written: string[] = [];
  const cards: CatalogCard[] = CASE_LAB_CASES.map((item) => {
    const result = options.catalog.find((candidate) => candidate.caseId === item.id);
    if (!result) throw new Error(`catalog is missing ${item.id}`);
    return { item, result: validateCaseLabResult(result) };
  });
  const css = readFileSync(options.cssPath ?? resolve(PACKAGE_DIR, 'assets/case-lab.css'), 'utf8');
  const client = options.clientBundle ?? await bundleClient();
  write(resolve(outDir, 'case-lab.css'), css, written);
  write(resolve(outDir, 'case-lab.js'), client, written);
  write(resolve(outDir, 'index.html'), renderPage({
    title: 'Sutura Case Lab',
    description: 'Five fixed cases that show how Sutura verifies a CI repair instead of trusting a green result.',
    siteRoot,
    script: 'case-lab.js',
    attributes: mainAttributes('index', siteRoot, options.apiBase),
    body: renderIndexBody({ cards, release: options.release, siteRoot, limits: CASE_LAB_LIMITS }),
  }), written);
  for (const card of cards) {
    const item = caseLabCase(card.result.caseId);
    write(resolve(outDir, 'replay', item.id, 'index.html'), renderPage({
      title: resultPageTitle(card.result, item),
      description: item.scenario,
      siteRoot,
      attributes: mainAttributes('replay', siteRoot, undefined),
      body: renderResultBody(card.result, item),
    }), written);
    write(resolve(outDir, 'replay', item.id, 'result.json'), `${canonicalJson(card.result)}\n`, written);
  }
  write(resolve(outDir, 'result', 'index.html'), renderPage({
    title: 'Sutura Case Lab · Live run',
    description: 'A live Sutura run started from the Case Lab.',
    siteRoot,
    script: 'case-lab.js',
    attributes: mainAttributes('result', siteRoot, options.apiBase),
    body: renderPendingBody({ requestId: 'pending', caseTitle: undefined, status: 'Loading the live result…' }),
  }), written);
  write(resolve(outDir, 'catalog.json'), `${canonicalJson({
    schemaVersion: 'sutura-case-lab-catalog-v1',
    release: options.release,
    limits: CASE_LAB_LIMITS,
    labels: { mode: MODE_LABELS, outcome: OUTCOME_LABELS },
    cases: cards.map(({ item, result }) => ({
      id: item.id,
      title: item.title,
      scenario: item.scenario,
      language: item.language,
      placeboCaseId: item.placeboCaseId,
      expectedOutcome: item.expectedOutcome,
      mode: result.mode,
      outcome: result.outcome,
      resultPath: `${siteRoot}replay/${item.id}/`,
      resultJson: `${siteRoot}replay/${item.id}/result.json`,
      resultHash: result.resultHash,
    })),
  })}\n`, written);
  return written;
}
