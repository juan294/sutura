import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { acceptance } from './acceptance.js';
import { MODE_LABELS } from './render.js';
import { replayCatalog } from './replay.js';
import { validateCaseLabResult, type CaseLabResult } from './result.js';
import { createStaticServer, listen } from './serve.js';
import { buildSite } from './site.js';

const RELEASE = { version: '0.2.0', actionSha: 'a943ded4c734aed75c5c63f2b2dd63a2f44556c2' };
const NOW = () => new Date('2026-09-04T12:00:00.000Z');

let catalog: CaseLabResult[] = [];
let outDir = '';

beforeAll(async () => {
  catalog = await replayCatalog({ replayDir: mkdtempSync(join(tmpdir(), 'case-lab-site-replay-')), now: NOW });
  outDir = join(mkdtempSync(join(tmpdir(), 'case-lab-site-')), 'site');
  await buildSite({ outDir, catalog, release: RELEASE, apiBase: '' });
}, 120_000);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [relative(outDir, join(dir, entry.name))]);
}

describe('buildSite', () => {
  it('writes the complete file set with validated result documents', () => {
    expect(walk(outDir).sort()).toEqual([
      'case-lab.css',
      'case-lab.js',
      'catalog.json',
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

  it('refuses an invalid site root and a catalog missing a case', async () => {
    await expect(buildSite({ outDir: join(outDir, 'x'), catalog, release: RELEASE, siteRoot: 'bad' })).rejects.toThrow('siteRoot must start and end with /');
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
      'links-public',
    ]);
    const traversal = await fetch(`${baseUrl}..%2F..%2Fpackage.json`);
    expect([403, 404]).toContain(traversal.status);
    const missing = await fetch(`${baseUrl}nope.html`);
    expect(missing.status).toBe(404);
  });

  it('fails the acceptance record when a result document is tampered', { timeout: 60_000 }, async () => {
    const tamperedDir = join(mkdtempSync(join(tmpdir(), 'case-lab-tampered-')), 'site');
    await buildSite({ outDir: tamperedDir, catalog, release: RELEASE, clientBundle: '' });
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
