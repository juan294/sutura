import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { acceptance } from './acceptance.js';
import { CASE_LAB_CASES } from './cases.js';
import { MODE_LABELS } from './render.js';
import { replayCatalog } from './replay.js';
import { validateCaseLabResult, type CaseLabResult } from './result.js';
import { createStaticServer, listen } from './serve.js';
import { buildSite } from './site.js';

const RELEASE = { version: '0.2.0', actionSha: 'a943ded4c734aed75c5c63f2b2dd63a2f44556c2' };
const SITE_URL = 'https://sutura-case-lab.vercel.app';
const NOW = () => new Date('2026-09-04T12:00:00.000Z');

let catalog: CaseLabResult[] = [];
let outDir = '';

beforeAll(async () => {
  catalog = await replayCatalog({ replayDir: mkdtempSync(join(tmpdir(), 'case-lab-site-replay-')), now: NOW });
  outDir = join(mkdtempSync(join(tmpdir(), 'case-lab-site-')), 'site');
  await buildSite({ outDir, catalog, release: RELEASE, apiBase: '', siteUrl: SITE_URL });
}, 120_000);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [relative(outDir, join(dir, entry.name))]);
}

function jsonLdBlocks(html: string): Record<string, unknown>[] {
  return [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gu)]
    .map((match) => JSON.parse(match[1]!) as Record<string, unknown>);
}

const HTML_PAGES = ['index.html', 'result/index.html', ...CASE_LAB_CASES.map((item) => `replay/${item.id}/index.html`)];

describe('buildSite', () => {
  it('writes the complete file set with validated result documents', () => {
    expect(walk(outDir).sort()).toEqual([
      'case-lab.css',
      'case-lab.js',
      'catalog.json',
      'favicon.svg',
      'index.html',
      'replay/flaky-failure/index.html',
      'replay/flaky-failure/result.json',
      'replay/greenwash-trap/index.html',
      'replay/greenwash-trap/result.json',
      'replay/javascript-repair/index.html',
      'replay/javascript-repair/result.json',
      'replay/python-repair/index.html',
      'replay/python-repair/result.json',
      'replay/upstream-incident/index.html',
      'replay/upstream-incident/result.json',
      'result/index.html',
      'robots.txt',
      'sitemap.xml',
      'social-card.png',
    ]);
    for (const result of catalog) {
      const stored = validateCaseLabResult(JSON.parse(readFileSync(join(outDir, 'replay', result.caseId, 'result.json'), 'utf8')));
      expect(stored).toEqual(result);
      const page = readFileSync(join(outDir, 'replay', result.caseId, 'index.html'), 'utf8');
      expect(page).toContain(`<title>`);
      expect(page).toContain(`· ${MODE_LABELS[result.mode]} ·`);
      expect(page).toContain('data-page="replay"');
    }
    const index = readFileSync(join(outDir, 'index.html'), 'utf8');
    expect(index).toContain('data-page="index" data-site-root="/" data-api-base=""');
    expect(index.match(/class="case-card"/gu)).toHaveLength(5);
    const catalogJson = JSON.parse(readFileSync(join(outDir, 'catalog.json'), 'utf8')) as { cases: unknown[]; release: unknown; labels: unknown };
    expect(catalogJson.cases).toHaveLength(5);
    expect(catalogJson.release).toEqual(RELEASE);
    expect(catalogJson.labels).toEqual({
      mode: { live: 'Live run', replay: 'Deterministic replay', recorded: 'Recorded live result' },
      outcome: { fixed: 'Fixed', 'flaky-no-patch': 'Flaky, no patch', refused: 'Refused', 'gave-up': 'Gave up', 'infra-stop': 'Infrastructure stop' },
    });
  });

  it('ships a browser bundle that never assigns location-derived HTML and pulls in the case list', () => {
    const script = readFileSync(join(outDir, 'case-lab.js'), 'utf8');
    expect(script).not.toMatch(/innerHTML\s*=\s*(?:window\.)?location/u);
    expect(script).not.toContain('eval(');
    expect(script).toContain('raw.githubusercontent.com/juan294/sutura-demo/case-lab-results/results/');
    expect(script).toContain('upstream-incident');
    expect(script).toContain('function escapeHtml');
  });

  it('carries canonical, social, icon, and structured data on every page and noindex only on the live page', () => {
    for (const file of HTML_PAGES) {
      const page = readFileSync(join(outDir, file), 'utf8');
      const path = `/${file.replace(/index\.html$/u, '')}`;
      expect(page, file).toContain(`<link rel="canonical" href="${SITE_URL}${path}">`);
      expect(page, file).toContain(`<meta property="og:url" content="${SITE_URL}${path}">`);
      expect(page.match(/property="og:image"/gu), file).toHaveLength(1);
      expect(page, file).toContain(`<meta property="og:image" content="${SITE_URL}/social-card.png">`);
      expect(page, file).toContain('<meta name="twitter:card" content="summary_large_image">');
      expect(page, file).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
      expect(page.includes('<meta name="robots" content="noindex, nofollow">'), file).toBe(file === 'result/index.html');
    }
    const index = jsonLdBlocks(readFileSync(join(outDir, 'index.html'), 'utf8'));
    expect(index.map((block) => block['@type'])).toEqual(['WebSite', 'SoftwareApplication']);
    expect(index[0]).toMatchObject({ '@context': 'https://schema.org', name: 'Sutura Case Lab', url: `${SITE_URL}/` });
    expect(index[1]).toMatchObject({
      name: 'Sutura',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'GitHub Actions',
      license: 'https://opensource.org/licenses/MIT',
      codeRepository: 'https://github.com/juan294/sutura',
      softwareVersion: RELEASE.version,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      url: `${SITE_URL}/`,
    });
    for (const result of catalog) {
      const blocks = jsonLdBlocks(readFileSync(join(outDir, 'replay', result.caseId, 'index.html'), 'utf8'));
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({
        '@type': 'WebPage',
        url: `${SITE_URL}/replay/${result.caseId}/`,
        dateModified: result.createdAt,
        isPartOf: { '@type': 'WebSite', name: 'Sutura Case Lab', url: `${SITE_URL}/` },
      });
      expect(blocks[0]?.name).toContain(MODE_LABELS[result.mode]);
    }
    expect(jsonLdBlocks(readFileSync(join(outDir, 'result/index.html'), 'utf8'))).toEqual([]);
  });

  it('writes robots.txt and a six-entry sitemap that reference each other', () => {
    const robots = readFileSync(join(outDir, 'robots.txt'), 'utf8');
    expect(robots.split('\n')).toEqual(['User-agent: *', 'Allow: /', 'Disallow: /result/', 'Disallow: /api/', `Sitemap: ${SITE_URL}/sitemap.xml`, '']);
    const sitemap = readFileSync(join(outDir, 'sitemap.xml'), 'utf8');
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => match[1]);
    expect(locs).toEqual([`${SITE_URL}/`, ...CASE_LAB_CASES.map((item) => `${SITE_URL}/replay/${item.id}/`)]);
    expect(sitemap.match(/<lastmod>/gu)).toHaveLength(6);
    const newest = catalog.map((result) => result.createdAt).sort().at(-1);
    expect(sitemap).toContain(`<loc>${SITE_URL}/</loc><lastmod>${newest}</lastmod>`);
  });

  it('omits canonical, absolute Open Graph URLs, and the sitemap without a site URL', async () => {
    const plainDir = join(mkdtempSync(join(tmpdir(), 'case-lab-plain-')), 'site');
    await buildSite({ outDir: plainDir, catalog, release: RELEASE, clientBundle: '' });
    expect(existsSync(join(plainDir, 'sitemap.xml'))).toBe(false);
    expect(readFileSync(join(plainDir, 'robots.txt'), 'utf8')).not.toContain('Sitemap:');
    const index = readFileSync(join(plainDir, 'index.html'), 'utf8');
    expect(index).not.toContain('rel="canonical"');
    expect(index).not.toContain('og:url');
    expect(index).toContain('<meta property="og:image" content="/social-card.png">');
    expect(jsonLdBlocks(index).map((block) => block.url)).toEqual([undefined, undefined]);
  });

  it('refuses an invalid site root, an invalid site URL, and a catalog missing a case', async () => {
    await expect(buildSite({ outDir: join(outDir, 'x'), catalog, release: RELEASE, siteRoot: 'bad' })).rejects.toThrow('siteRoot must start and end with /');
    await expect(buildSite({ outDir: join(outDir, 'x'), catalog, release: RELEASE, siteUrl: `${SITE_URL}/` })).rejects.toThrow('siteUrl must not end with /');
    await expect(buildSite({ outDir: join(outDir, 'x'), catalog, release: RELEASE, siteUrl: 'sutura-case-lab.vercel.app' })).rejects.toThrow('siteUrl must be an absolute URL');
    await expect(buildSite({ outDir: join(outDir, 'x'), catalog, release: RELEASE, siteUrl: 'ftp://sutura-case-lab.vercel.app' })).rejects.toThrow('siteUrl must be a plain http(s) origin');
    await expect(buildSite({ outDir: join(outDir, 'y'), catalog: catalog.slice(1), release: RELEASE, clientBundle: '' })).rejects.toThrow('catalog is missing javascript-repair');
  });
});

describe('static server and acceptance', () => {
  let server: ReturnType<typeof createStaticServer>;
  let baseUrl = '';

  beforeAll(async () => {
    server = createStaticServer(outDir);
    baseUrl = `http://127.0.0.1:${await listen(server, 0)}/`;
  });

  afterAll(() => {
    server.close();
  });

  it('serves the site signed-out and passes the acceptance record', { timeout: 60_000 }, async () => {
    const record = await acceptance(baseUrl, { now: NOW, checkLinks: false });
    const failed = record.checks.filter((check) => !check.passed);
    expect(failed, JSON.stringify(failed)).toEqual([]);
    expect(record.passed).toBe(true);
    expect(record.checks.map((check) => check.name)).toEqual([
      'index-loads',
      'replay-javascript-repair',
      'replay-python-repair',
      'replay-flaky-failure',
      'replay-greenwash-trap',
      'replay-upstream-incident',
      'refusal-and-flaky',
      'mobile-css',
      'robots-txt',
      'sitemap-xml',
      'canonical',
      'result-noindex',
      'social-card',
      'links-public',
    ]);
    const traversal = await fetch(`${baseUrl}..%2F..%2Fpackage.json`);
    expect([403, 404]).toContain(traversal.status);
    const missing = await fetch(`${baseUrl}nope.html`);
    expect(missing.status).toBe(404);
    const card = await fetch(`${baseUrl}social-card.png`);
    expect(card.headers.get('content-type')).toBe('image/png');
    expect(card.headers.get('x-content-type-options')).toBe('nosniff');
    expect(card.headers.get('x-robots-tag')).toBeNull();
    const live = await fetch(`${baseUrl}result/`, { method: 'HEAD' });
    expect(live.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('fails the acceptance record when the build has no site URL', { timeout: 60_000 }, async () => {
    const plainDir = join(mkdtempSync(join(tmpdir(), 'case-lab-plain-')), 'site');
    await buildSite({ outDir: plainDir, catalog, release: RELEASE, clientBundle: '' });
    const plainServer = createStaticServer(plainDir);
    const port = await listen(plainServer, 0);
    try {
      const record = await acceptance(`http://127.0.0.1:${port}`, { now: NOW, checkLinks: false });
      expect(record.passed).toBe(false);
      const failed = Object.fromEntries(record.checks.filter((check) => !check.passed).map((check) => [check.name, check.detail]));
      expect(Object.keys(failed).sort()).toEqual(['canonical', 'robots-txt', 'sitemap-xml']);
      expect(failed['robots-txt']).toContain(`http://127.0.0.1:${port}/robots.txt: Sitemap line missing`);
      expect(failed['sitemap-xml']).toContain(`http://127.0.0.1:${port}/sitemap.xml: status 404`);
      expect(failed.canonical).toContain(`http://127.0.0.1:${port}/replay/flaky-failure/: canonical missing`);
    } finally {
      plainServer.close();
    }
  });

  it('fails the acceptance record when a result document is tampered', { timeout: 60_000 }, async () => {
    const tamperedDir = join(mkdtempSync(join(tmpdir(), 'case-lab-tampered-')), 'site');
    await buildSite({ outDir: tamperedDir, catalog, release: RELEASE, clientBundle: '', siteUrl: SITE_URL });
    const path = join(tamperedDir, 'replay/greenwash-trap/result.json');
    const stored = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    writeFileSync(path, JSON.stringify({ ...stored, outcome: 'fixed', expectedOutcome: 'fixed' }));
    const tamperedServer = createStaticServer(tamperedDir);
    const port = await listen(tamperedServer, 0);
    try {
      const record = await acceptance(`http://127.0.0.1:${port}`, { now: NOW, checkLinks: false });
      expect(record.passed).toBe(false);
      const failed = record.checks.filter((check) => !check.passed).map((check) => check.name);
      expect(failed).toContain('replay-greenwash-trap');
      expect(failed).toContain('refusal-and-flaky');
    } finally {
      tamperedServer.close();
    }
  });
});
