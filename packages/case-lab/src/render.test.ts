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

  it('never turns a non-https citation or link into an href', () => {
    const base = byId('javascript-repair');
    const file = base.caseFile!;
    const poisoned = {
      ...base,
      caseFile: {
        ...file,
        diagnosis: {
          ...file.diagnosis,
          grounding: { citations: [{ url: 'javascript:alert(1)', title: 'bad', snippet: '' }], query: 'q', reason: 'r', skipped: false },
        },
      },
      links: { ...base.links, workflowRun: 'javascript:alert(2)' },
    } as unknown as CaseLabResult;
    const html = renderResultBody(poisoned, caseLabCase('javascript-repair'));
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('link withheld: not an https URL');
    const pending = renderPendingBody({ requestId: 'cl-1788198872643-48b5c5d4', caseTitle: undefined, status: 's', runUrl: 'data:text/html,x' });
    expect(pending).not.toContain('href="data:');
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

  it('renders nothing when a case carries no counterfactual evidence', () => {
    expect(renderCounterfactual(undefined)).toBe('');
    expect(renderCounterfactual(byId('javascript-repair').caseFile)).toBe('');
    expect(renderResultBody(byId('javascript-repair'), caseLabCase('javascript-repair')))
      .not.toContain('counterfactual-title');
  });
});

const COUNTERFACTUAL = {
  acceptedCandidateId: 'repair-1',
  cost: { inferenceUsd: 0, sandboxOperations: 3, elapsedTimeSec: 6.2 },
  alternatives: [
    {
      id: 'loosen-type',
      intent: 'shortcut' as const,
      rationale: 'Casts the result to any instead of fixing the boundary.',
      diffHash: 'a'.repeat(64),
      nodeId: 'node-020',
      approved: false,
      testExitCode: 0,
      checks: [{ name: 'loosened-type' as const, passed: false, evidence: '+x as any' }],
      reasoning: 'REFUSED: deterministic checks found green-washing (loosened-type).',
      rejectedBy: {
        gate: 'mechanical' as const,
        rule: 'loosened-type',
        evidence: '+const total = x as any;',
      },
      cost: { inferenceUsd: 0, sandboxOperations: 1, elapsedTimeSec: 2 },
    },
    {
      id: 'wrong-boundary',
      intent: 'plausible' as const,
      rationale: 'Shifts the numerator, a plausible repair that is still wrong.',
      diffHash: 'b'.repeat(64),
      nodeId: 'node-021',
      approved: false,
      testExitCode: 1,
      checks: [],
      reasoning: 'REFUSED: the selected candidate did not pass its repair race.',
      rejectedBy: {
        gate: 'verification' as const,
        rule: 'verification-command',
        evidence: 'The diagnosed verification command exited 1',
      },
      cost: { inferenceUsd: 0, sandboxOperations: 2, elapsedTimeSec: 4.2 },
    },
  ],
};

describe('counterfactual side-by-side view', () => {
  function withCounterfactual(caseId: 'javascript-repair' | 'greenwash-trap', overrides = {}) {
    const result = byId(caseId);
    return {
      ...result,
      caseFile: { ...result.caseFile!, counterfactual: { ...COUNTERFACTUAL, ...overrides } },
    };
  }

  it('shows the accepted patch beside every rejected alternative with its gate and rule', () => {
    const html = renderCounterfactual(withCounterfactual('javascript-repair').caseFile);

    expect(html).toContain('counterfactual-title');
    expect(html).toContain('Accepted patch beside rejected alternatives');
    expect(html).toContain('counterfactual-accepted');
    expect(html).toContain('counterfactual-rejected');
    for (const alternative of COUNTERFACTUAL.alternatives) {
      expect(html).toContain(alternative.id);
      expect(html).toContain(alternative.rejectedBy.gate);
      expect(html).toContain(alternative.rejectedBy.rule);
    }
    expect(html).toContain('shortcut');
    expect(html).toContain('plausible');
    expect(html).toContain('3 sandbox operations');
  });

  it('explains why green is not sufficient from the recorded gates alone', () => {
    const html = renderCounterfactual(withCounterfactual('javascript-repair').caseFile);

    expect(html).toContain('2 of 2 alternative patches were rejected');
    expect(html).toContain('including 1 declared shortcut');
    expect(html).toContain('by mechanical, verification');
    expect(html).toContain('1 of them made the diagnosed command exit 0 and were still refused');
  });

  it('shows a correctly refused outcome beside the alternatives', () => {
    const html = renderCounterfactual(withCounterfactual('greenwash-trap', {
      acceptedCandidateId: 'no-such-candidate',
    }).caseFile);

    expect(html).toContain('Outcome Sutura reached');
    expect(html).toContain('No candidate patch was accepted.');
    expect(html).toContain('loosen-type');
  });

  it('appears in the full result body', () => {
    const html = renderResultBody(
      withCounterfactual('javascript-repair'),
      caseLabCase('javascript-repair'),
    );

    expect(html).toContain('counterfactual-title');
    expect(html).toContain('loosen-type');
  });

  it('escapes untrusted alternative text', () => {
    const html = renderCounterfactual(withCounterfactual('javascript-repair', {
      alternatives: [{
        ...COUNTERFACTUAL.alternatives[0]!,
        rationale: '<script>alert("cf")</script>',
        rejectedBy: {
          gate: 'mechanical' as const,
          rule: 'loosened-type',
          evidence: '<img src=x onerror=alert(1)>',
        },
      }],
    }).caseFile);

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('pages', () => {
  it('builds a titled, viewport-aware page with main attributes and a mode-labeled title', () => {
    const result = byId('greenwash-trap');
    const page = renderPage({
      title: resultPageTitle(result, caseLabCase('greenwash-trap')),
      description: 'x',
      siteRoot: '/',
      path: '/replay/greenwash-trap/',
      body: '<p>body</p>',
      attributes: { 'data-page': 'replay', 'data-site-root': '/' },
    });
    expect(page).toContain('<title>Greenwash trap · Recorded live result · Refused</title>');
    expect(page).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(page).toContain('<main id="main" class="case-lab" data-page="replay" data-site-root="/">');
    expect(page).not.toContain('<script');
    expect(page).not.toContain('rel="canonical"');
    expect(page).not.toContain('og:url');
    expect(page).not.toContain('name="robots"');
    expect(page).toContain('<meta property="og:image" content="/social-card.png">');
    expect(page).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
    const scripted = renderPage({ title: 't', description: 'd', siteRoot: '/x/', path: '/x/', body: '', script: 'case-lab.js' });
    expect(scripted).toContain('<script src="/x/case-lab.js" defer></script>');
  });

  it('emits canonical, social, robots, and escaped structured data when a site URL is known', () => {
    const page = renderPage({
      title: 'A "quoted" <title>',
      description: 'd & e',
      siteRoot: '/',
      path: '/result/',
      siteUrl: 'https://example.test',
      robots: 'noindex',
      ogType: 'article',
      body: '',
      jsonLd: [{ '@context': 'https://schema.org', '@type': 'WebPage', name: '</script><script>alert(1)</script>' }],
    });
    expect(page).toContain('<link rel="canonical" href="https://example.test/result/">');
    expect(page).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(page).toContain('<meta property="og:type" content="article">');
    expect(page).toContain('<meta property="og:title" content="A &quot;quoted&quot; &lt;title&gt;">');
    expect(page).toContain('<meta property="og:url" content="https://example.test/result/">');
    expect(page).toContain('<meta property="og:image" content="https://example.test/social-card.png">');
    expect(page).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(page).toContain('<meta name="twitter:description" content="d &amp; e">');
    expect(page).toContain('<meta name="theme-color" media="(prefers-color-scheme: light)" content="#fbfbf9">');
    expect(page).not.toContain('</script><script>alert(1)');
    const block = /<script type="application\/ld\+json">(.*?)<\/script>/u.exec(page)?.[1];
    expect(block).toContain('\\u003c/script>');
    expect(JSON.parse(block ?? '')).toEqual({ '@context': 'https://schema.org', '@type': 'WebPage', name: '</script><script>alert(1)</script>' });
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
