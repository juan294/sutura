import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { caseLabCase } from './cases.js';
import { replayCatalog } from './replay.js';
import {
  MODE_LABELS,
  OUTCOME_LABELS,
  escapeHtml,
  isRenderableResult,
  renderCounterfactual,
  renderIndexBody,
  renderPage,
  renderPendingBody,
  renderResultBody,
  resultPageTitle,
} from './render.js';
import { createCaseLabResult, type CaseLabResult } from './result.js';

const SECTION_IDS = ['evidence', 'diagnosis', 'search', 'candidates', 'rejections', 'audit', 'outcome', 'cost', 'links'];
const EMPTY_REPLAY_DIR = mkdtempSync(join(tmpdir(), 'case-lab-render-'));
const NOW = () => new Date('2026-09-04T12:00:00.000Z');

let catalog: CaseLabResult[] = [];

beforeAll(async () => {
  catalog = await replayCatalog({ replayDir: EMPTY_REPLAY_DIR, now: NOW });
}, 60_000);

function byId(caseId: string): CaseLabResult {
  const result = catalog.find((item) => item.caseId === caseId);
  if (!result) throw new Error(caseId);
  return result;
}

describe('renderResultBody', () => {
  it('renders every section for a fixed, a refused, a flaky, and an infra-stop result', () => {
    for (const caseId of ['javascript-repair', 'greenwash-trap', 'flaky-failure', 'python-repair']) {
      const result = byId(caseId);
      const html = renderResultBody(result, caseLabCase(caseId));
      for (const id of SECTION_IDS) expect(html, `${caseId} ${id}`).toContain(`aria-labelledby="${id}-title"`);
      expect(html).toContain(`>${MODE_LABELS[result.mode]}</span>`);
      expect(html).toContain(`>${OUTCOME_LABELS[result.outcome]}</span>`);
      expect(html).toContain(result.release.actionSha);
      expect(html).toContain(result.resultHash);
    }
  });

  it('shows the selected patch, the failed audit checks, and the refusal reasoning', () => {
    const fixed = renderResultBody(byId('javascript-repair'), caseLabCase('javascript-repair'));
    expect(fixed).toContain('class="candidate selected"');
    expect(fixed).toContain('Verdict: <strong>approved</strong>');
    expect(fixed).toContain('Outcome matches the expected outcome.');
    const refused = byId('greenwash-trap');
    const refusedHtml = renderResultBody(refused, caseLabCase('greenwash-trap'));
    expect(refusedHtml).toContain('Verdict: <strong>rejected</strong>');
    expect(refusedHtml).toContain('<h3>Failed audit checks</h3>');
    expect(refusedHtml).toContain(escapeHtml(refused.caseFile?.audit?.reasoning ?? 'missing'));
    const infra = renderResultBody(byId('python-repair'), caseLabCase('python-repair'));
    expect(infra).toContain('Expected Fixed; this result does not match. The failure is kept in the record.');
  });

  it('escapes every dynamic value, including a script tag inside a diff', () => {
    const base = byId('javascript-repair');
    const poisoned = createCaseLabResult({
      ...base,
      caseFile: {
        ...base.caseFile!,
        race: [{
          ...base.caseFile!.race[0]!,
          candidate: { ...base.caseFile!.race[0]!.candidate, diff: '<script>alert(1)</script>', rationale: '"quoted" & <b>' },
        }],
      },
    });
    const html = renderResultBody(poisoned, caseLabCase('javascript-repair'));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;quoted&quot; &amp; &lt;b&gt;');
  });

  it('renders a result without a case file honestly', () => {
    const base = byId('flaky-failure');
    const bare = createCaseLabResult({
      ...base, mode: 'live', requestId: 'cl-1788198872643-48b5c5d4', caseFile: undefined, recordedFrom: undefined,
      cost: { inferenceUsd: 0, sandboxUsd: 0, status: 'unavailable' },
    } as never);
    const html = renderResultBody(bare, caseLabCase('flaky-failure'));
    expect(html).toContain('No case file was published for this run.');
    expect(html).toContain('Cost is unavailable');
    expect(html).toContain(`>${MODE_LABELS.live}</span>`);
  });

  it('leaves the counterfactual slot empty until WS-2 fills it', () => {
    expect(renderCounterfactual(undefined)).toBe('');
    expect(renderCounterfactual(byId('javascript-repair').caseFile)).toBe('');
  });
});

describe('pages', () => {
  it('builds a titled, viewport-aware page with main attributes and a mode-labeled title', () => {
    const result = byId('greenwash-trap');
    const page = renderPage({
      title: resultPageTitle(result, caseLabCase('greenwash-trap')),
      description: 'x',
      siteRoot: '/',
      body: '<p>body</p>',
      attributes: { 'data-page': 'replay', 'data-site-root': '/' },
    });
    expect(page).toContain('<title>Greenwash trap · Recorded live result · Refused</title>');
    expect(page).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(page).toContain('<main id="main" class="case-lab" data-page="replay" data-site-root="/">');
    expect(page).not.toContain('<script');
    const scripted = renderPage({ title: 't', description: 'd', siteRoot: '/x/', body: '', script: 'case-lab.js' });
    expect(scripted).toContain('<script src="/x/case-lab.js" defer></script>');
  });

  it('renders the index with five cards and the three labels', () => {
    const html = renderIndexBody({
      cards: catalog.map((result) => ({ item: caseLabCase(result.caseId), result })),
      release: { version: '0.2.0', actionSha: 'a'.repeat(40) },
      siteRoot: '/',
      limits: { maxRunsPerHour: 4, maxRunsPerDay: 8, maxConcurrentRuns: 1 },
    });
    for (const result of catalog) expect(html).toContain(`href="/replay/${result.caseId}/"`);
    expect(html.match(/button-live/gu)).toHaveLength(5);
    expect(html).toContain('disabled>Start live run');
    for (const label of Object.values(MODE_LABELS)) expect(html).toContain(`<dt>${label}</dt>`);
    expect(html).toContain('Release v0.2.0');
  });

  it('renders a pending live page', () => {
    const html = renderPendingBody({ requestId: 'cl-1788198872643-48b5c5d4', caseTitle: undefined, status: 'Waiting', runUrl: 'https://github.com/juan294/sutura-demo/actions/runs/1' });
    expect(html).toContain('Waiting');
    expect(html).toContain('Watch the workflow run on GitHub');
    expect(html).toContain(`>${MODE_LABELS.live}</span>`);
  });
});

describe('isRenderableResult', () => {
  it('accepts a real result and rejects malformed input', () => {
    const ids = catalog.map((item) => item.caseId);
    expect(isRenderableResult(JSON.parse(JSON.stringify(byId('flaky-failure'))), ids)).toBe(true);
    expect(isRenderableResult(null, ids)).toBe(false);
    expect(isRenderableResult({ ...byId('flaky-failure'), caseId: 'other' }, ids)).toBe(false);
    expect(isRenderableResult({ ...byId('flaky-failure'), outcome: 'green' }, ids)).toBe(false);
    expect(isRenderableResult({ ...byId('flaky-failure'), mode: 'fake' }, ids)).toBe(false);
  });
});
