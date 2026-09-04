/**
 * Pure HTML rendering for the Case Lab. This module runs in Node (site
 * generation) and in the browser (live result page), so it imports only
 * types and uses no Node API.
 */
import type { CaseLabCase, CaseLabOutcome } from './cases.js';
import type { CaseLabCaseFile, CaseLabMode, CaseLabResult, CaseLabResultLinks } from './result.js';

export const MODE_LABELS: Readonly<Record<CaseLabMode, string>> = Object.freeze({
  live: 'Live run',
  replay: 'Deterministic replay',
  recorded: 'Recorded live result',
});

export const OUTCOME_LABELS: Readonly<Record<CaseLabOutcome, string>> = Object.freeze({
  fixed: 'Fixed',
  'flaky-no-patch': 'Flaky, no patch',
  refused: 'Refused',
  'gave-up': 'Gave up',
  'infra-stop': 'Infrastructure stop',
});

const MODE_NOTES: Readonly<Record<CaseLabMode, string>> = Object.freeze({
  live: 'This result was produced by a live run through the public Case Lab path.',
  replay: 'This result was reproduced offline from a complete replay bundle captured on a live run, with no provider or sandbox access.',
  recorded: 'This result is a recorded live benchmark evaluation of the released Sutura version, not a run started from this page.',
});

export const LIVE_REQUEST_ID = /^cl-[0-9]{13}-[a-f0-9]{8}$/u;

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  );
}

function usd(value: number): string {
  return `USD ${value.toFixed(6)}`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function seconds(ms: number | undefined): string {
  return ms === undefined ? 'not recorded' : `${(ms / 1_000).toFixed(1)} s`;
}

function shortSha(sha: string): string {
  return sha.slice(0, 12);
}

function link(url: string | undefined, label: string, note?: string): string {
  if (url === undefined) return '';
  const suffix = note === undefined ? '' : ` <small>(${escapeHtml(note)})</small>`;
  return `<li><a href="${escapeHtml(url)}" rel="noopener">${escapeHtml(label)}</a>${suffix}</li>`;
}

function section(id: string, title: string, body: string): string {
  return `<section class="sheet" aria-labelledby="${id}-title">
  <h2 id="${id}-title">${escapeHtml(title)}</h2>
${body}
</section>`;
}

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const head = headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join('');
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('\n');
  return `<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table></div>`;
}

function badge(kind: string, text: string): string {
  return `<span class="badge badge-${escapeHtml(kind)}">${escapeHtml(text)}</span>`;
}

export function modeBadge(mode: CaseLabMode): string {
  return badge(`mode-${mode}`, MODE_LABELS[mode]);
}

export function outcomeBadge(outcome: CaseLabOutcome): string {
  return badge(`outcome-${outcome}`, OUTCOME_LABELS[outcome]);
}

/** Extension point for WS-2 issue #73: renders nothing until a case file carries counterfactual evidence. */
export function renderCounterfactual(caseFile: CaseLabCaseFile | undefined): string {
  const counterfactual = (caseFile as { counterfactual?: unknown } | undefined)?.counterfactual;
  if (counterfactual === undefined) return '';
  return '';
}

function renderHeader(result: CaseLabResult, item: CaseLabCase): string {
  const expectation = result.matchesExpectation
    ? 'Outcome matches the expected outcome.'
    : `Expected ${OUTCOME_LABELS[result.expectedOutcome]}; this result does not match. The failure is kept in the record.`;
  return `<header class="docket">
  <p class="eyebrow">Sutura Case Lab · ${escapeHtml(item.scenario)}</p>
  <h1>${escapeHtml(item.title)}</h1>
  <p class="badges">${modeBadge(result.mode)} ${outcomeBadge(result.outcome)}</p>
  <p class="mode-note">${escapeHtml(MODE_NOTES[result.mode])}</p>
  <p class="expectation">${escapeHtml(expectation)}</p>
  <dl class="identity">
    <dt>Release</dt><dd>v${escapeHtml(result.release.version)} · Action <code>${escapeHtml(result.release.actionSha)}</code></dd>
    <dt>Controller</dt><dd><code>${escapeHtml(result.identity.controllerSha)}</code></dd>${result.identity.demoSha === undefined ? '' : `
    <dt>Demo repository</dt><dd><code>${escapeHtml(result.identity.demoSha)}</code></dd>`}
    <dt>Request</dt><dd><code>${escapeHtml(result.requestId)}</code> · ${escapeHtml(result.createdAt)}</dd>
  </dl>
</header>`;
}

function renderEvidence(result: CaseLabResult, item: CaseLabCase): string {
  const file = result.caseFile;
  const rows: string[] = [];
  rows.push(`<li>Placebo case <code>${escapeHtml(item.placeboCaseId)}</code>: ${escapeHtml(item.description)}</li>`);
  if (file) {
    rows.push(`<li>Failing command: <code>${escapeHtml(file.diagnosis.failingCmd || 'not recorded')}</code></li>`);
    rows.push(`<li>Error excerpt: <code>${escapeHtml(file.diagnosis.errorExcerpt || 'not recorded')}</code></li>`);
    rows.push(`<li>Repository <code>${escapeHtml(file.repo)}</code> · run <code>${escapeHtml(file.runId)}</code> · runtime ${escapeHtml(file.runtime)}</li>`);
  }
  rows.push(link(result.links.ciRun, 'Failed CI run'));
  rows.push(link(result.links.pullRequest, 'Broken pull request'));
  rows.push(link(result.links.workflowRun, result.mode === 'live' ? 'Case Lab workflow run' : 'Recorded workflow run'));
  return section('evidence', 'Failed commit and CI evidence', `<ul>${rows.join('\n')}</ul>`);
}

function renderDiagnosis(file: CaseLabCaseFile | undefined): string {
  if (!file) return section('diagnosis', 'Nano diagnosis', '<p class="empty">No case file was published for this run.</p>');
  const grounding = file.diagnosis.grounding;
  const citations = grounding && !grounding.skipped && grounding.citations.length > 0
    ? `<h3>Grounding</h3><ul>${grounding.citations.map((citation) =>
      `<li><a href="${escapeHtml(citation.url)}" rel="noopener">${escapeHtml(citation.title)}</a></li>`).join('')}</ul>`
    : '';
  return section('diagnosis', 'Nano diagnosis and confidence', `<dl>
  <dt>Failure class</dt><dd>${escapeHtml(file.diagnosis.class)}</dd>
  <dt>Confidence</dt><dd>${percent(file.diagnosis.confidence)}</dd>
  <dt>Signals</dt><dd>${file.diagnosis.signals.length === 0 ? 'none' : `<ul>${file.diagnosis.signals.map((signal) => `<li><code>${escapeHtml(signal)}</code></li>`).join('')}</ul>`}</dd>
</dl>${citations}`);
}

function renderSearch(file: CaseLabCaseFile | undefined): string {
  if (!file) return '';
  const triage = `<p>Triage: ${escapeHtml(file.triage.status)} · reproduced ${file.triage.reproduced}/${file.triage.of} · stop reason ${escapeHtml(file.triage.stopReason)} · method <code>${escapeHtml(file.triage.methodVersion)}</code></p>`;
  const search = file.search ?? [];
  if (search.length === 0) {
    return section('search', 'ConTree search tree and branch status', `${triage}<p class="empty">No repair search branches were opened.</p>`);
  }
  const rows = search.map((node) => [
    `<code>${escapeHtml(node.nodeId)}</code>`,
    node.parentNodeId === undefined ? 'root' : `<code>${escapeHtml(node.parentNodeId)}</code>`,
    String(node.depth),
    escapeHtml(node.terminalReason ?? 'open'),
    String(node.testExitCode),
    node.policyValid ? 'valid' : 'violation',
    String(node.changedFiles),
    String(node.diffBytes),
  ]);
  return section('search', 'ConTree search tree and branch status', `${triage}${table(
    ['Node', 'Parent', 'Depth', 'Terminal reason', 'Test exit', 'Policy', 'Changed files', 'Diff bytes'],
    rows,
  )}`);
}

function renderCandidates(file: CaseLabCaseFile | undefined): string {
  if (!file) return '';
  if (file.race.length === 0) {
    return section('candidates', 'Super proposals and candidate patches', '<p class="empty">No candidate patch was proposed.</p>');
  }
  const selected = file.selectedCandidate?.id;
  const items = file.race.map((entry) => `<article class="candidate${entry.candidate.id === selected ? ' selected' : ''}">
  <h3>Candidate <code>${escapeHtml(entry.candidate.id)}</code>${entry.candidate.id === selected ? ' · selected' : ''}</h3>
  <p>${escapeHtml(entry.candidate.rationale)}</p>
  <p>Test exit ${entry.exitCode} · ${entry.held ? 'held its result' : 'did not hold'} · node <code>${escapeHtml(entry.nodeId)}</code>${entry.note === undefined ? '' : ` · ${escapeHtml(entry.note)}`}</p>
  <pre class="diff"><code>${escapeHtml(entry.candidate.diff)}</code></pre>
</article>`).join('\n');
  return section('candidates', 'Super proposals and candidate patches', items);
}

function renderRejections(file: CaseLabCaseFile | undefined): string {
  if (!file) return '';
  const selected = file.selectedCandidate?.id;
  const rejectedCandidates = file.race.filter((entry) => entry.candidate.id !== selected || file.audit?.approved === false);
  const failedChecks = (file.audit?.checks ?? []).filter((check) => !check.passed);
  if (rejectedCandidates.length === 0 && failedChecks.length === 0) {
    return section('rejections', 'Rejected patches and rejection reasons', '<p class="empty">No candidate was rejected.</p>');
  }
  const candidateRows = rejectedCandidates.map((entry) => [
    `<code>${escapeHtml(entry.candidate.id)}</code>`,
    entry.held ? 'held' : 'did not hold',
    String(entry.exitCode),
    escapeHtml(entry.note ?? ''),
  ]);
  const checkRows = failedChecks.map((check) => [
    `<code>${escapeHtml(check.name)}</code>`,
    escapeHtml(check.evidence ?? 'no evidence text'),
  ]);
  return section('rejections', 'Rejected patches and rejection reasons', `${candidateRows.length === 0 ? '' : table(['Candidate', 'Result', 'Test exit', 'Note'], candidateRows)}${checkRows.length === 0 ? '' : `<h3>Failed audit checks</h3>${table(['Check', 'Evidence'], checkRows)}`}${file.audit?.approved === false ? `<p>${escapeHtml(file.audit.reasoning)}</p>` : ''}`);
}

function renderAudit(file: CaseLabCaseFile | undefined): string {
  if (!file) return '';
  if (!file.audit) {
    return section('audit', 'Clean audit branch and Ultra verdict', '<p class="empty"><strong>Not run.</strong> No candidate survived for adversarial audit.</p>');
  }
  const rows = file.audit.checks.map((check) => [
    `<code>${escapeHtml(check.name)}</code>`,
    check.passed ? 'passed' : 'failed',
    escapeHtml(check.evidence ?? ''),
  ]);
  return section('audit', 'Clean audit branch and Ultra verdict', `<p>Verdict: <strong>${file.audit.approved ? 'approved' : 'rejected'}</strong> · policy <code>${escapeHtml(file.policy.policySha)}</code> at <code>${escapeHtml(file.policy.baseRef)}</code></p>${table(['Check', 'Result', 'Evidence'], rows)}<p>${escapeHtml(file.audit.reasoning)}</p>`);
}

function renderOutcome(result: CaseLabResult): string {
  return section('outcome', 'Final outcome', `<p class="badges">${outcomeBadge(result.outcome)} ${modeBadge(result.mode)}</p><p>Sutura never merges a generated repair. A ${escapeHtml(OUTCOME_LABELS[result.outcome].toLowerCase())} result still needs human review.</p>`);
}

function renderCost(result: CaseLabResult): string {
  const file = result.caseFile;
  const byRole = new Map<string, { calls: number; usd: number; inTok: number; outTok: number }>();
  for (const entry of file?.cost.entries ?? []) {
    const current = byRole.get(entry.role) ?? { calls: 0, usd: 0, inTok: 0, outTok: 0 };
    current.calls += 1;
    current.usd += entry.usd;
    current.inTok += entry.inTok;
    current.outTok += entry.outTok;
    byRole.set(entry.role, current);
  }
  const roleRows = [...byRole.entries()].map(([role, value]) => [
    escapeHtml(role), String(value.calls), String(value.inTok), String(value.outTok), usd(value.usd),
  ]);
  const stages = file?.stages ?? [];
  const cpu = stages.reduce((sum, stage) => sum + (stage.metrics.userCpuTimeSec ?? 0) + (stage.metrics.systemCpuTimeSec ?? 0), 0);
  const rss = stages.reduce((max, stage) => Math.max(max, stage.metrics.maxRssKb ?? 0), 0);
  const operations = stages.filter((stage) => stage.operationId !== undefined).length;
  const statusNote = result.cost.status === 'unavailable'
    ? '<p class="empty">Cost is unavailable: the run stopped before a ledger was recorded.</p>'
    : '';
  return section('cost', 'Token cost, provider cost, latency, and sandbox operations', `${statusNote}<dl>
  <dt>Inference cost</dt><dd>${usd(result.cost.inferenceUsd)}</dd>
  <dt>Sandbox cost</dt><dd>${usd(result.cost.sandboxUsd)}</dd>
  <dt>Elapsed</dt><dd>${seconds(result.elapsedMs)}</dd>
  <dt>CPU time</dt><dd>${cpu.toFixed(2)} s</dd>
  <dt>Peak memory</dt><dd>${rss === 0 ? 'not recorded' : `${Math.round(rss / 1_024)} MiB`}</dd>
  <dt>Sandbox stages</dt><dd>${stages.length} (${operations} with an operation id)</dd>
</dl>${roleRows.length === 0 ? '' : table(['Role', 'Calls', 'Input tokens', 'Output tokens', 'Cost'], roleRows)}`);
}

function renderLinks(links: CaseLabResultLinks, mode: CaseLabMode): string {
  const items = [
    link(links.workflowRun, mode === 'live' ? 'Case Lab workflow run' : 'Recorded workflow run'),
    link(links.ciRun, 'Failed CI run'),
    link(links.pullRequest, 'Broken pull request'),
    link(links.repairPullRequest, 'Repair pull request'),
    link(links.refusalComment, 'Refusal report'),
    link(links.check, 'GitHub check'),
    link(links.caseFileArtifact, 'HTML case file artifact', 'requires GitHub sign-in'),
    link(links.replayBundleArtifact, 'Replay bundle artifact', 'requires GitHub sign-in'),
    link(links.evidence, 'Evidence file'),
  ].filter((item) => item.length > 0);
  return section('links', 'Links', items.length === 0 ? '<p class="empty">No public links were recorded.</p>' : `<ul>${items.join('\n')}</ul>`);
}

function renderSource(result: CaseLabResult): string {
  if (result.recordedFrom) {
    return `<p class="source">Recorded from <code>${escapeHtml(result.recordedFrom.file)}</code> (result hash <code>${escapeHtml(shortSha(result.recordedFrom.resultHash))}…</code>) at ${escapeHtml(result.recordedFrom.recordedAt)}, subject <code>${escapeHtml(result.recordedFrom.subjectSha)}</code>.</p>`;
  }
  if (result.replayedFrom) {
    return `<p class="source">Replayed from bundle <code>${escapeHtml(shortSha(result.replayedFrom.bundleSha256))}…</code> captured at <a href="${escapeHtml(result.replayedFrom.capturedRunUrl)}" rel="noopener">${escapeHtml(result.replayedFrom.capturedRunUrl)}</a>.</p>`;
  }
  return '';
}

export function renderResultBody(result: CaseLabResult, item: CaseLabCase): string {
  const file = result.caseFile;
  return [
    renderHeader(result, item),
    renderEvidence(result, item),
    renderDiagnosis(file),
    renderSearch(file),
    renderCandidates(file),
    renderRejections(file),
    renderCounterfactual(file),
    renderAudit(file),
    renderOutcome(result),
    renderCost(result),
    renderLinks(result.links, result.mode),
    renderSource(result),
    `<p class="hash">Result hash <code>${escapeHtml(result.resultHash)}</code></p>`,
  ].join('\n');
}

export interface PageShellOptions {
  readonly title: string;
  readonly siteRoot: string;
  readonly body: string;
  readonly script?: string;
  readonly description: string;
  readonly attributes?: Readonly<Record<string, string>>;
}

export function renderPage(options: PageShellOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="description" content="${escapeHtml(options.description)}">
  <title>${escapeHtml(options.title)}</title>
  <link rel="stylesheet" href="${escapeHtml(options.siteRoot)}case-lab.css">
</head>
<body>
  <nav class="site-nav" aria-label="Case Lab"><a href="${escapeHtml(options.siteRoot)}">Sutura Case Lab</a> · <a href="https://github.com/juan294/sutura" rel="noopener">Repository</a></nav>
  <main id="main" class="case-lab"${Object.entries(options.attributes ?? {}).map(([name, value]) => ` ${escapeHtml(name)}="${escapeHtml(value)}"`).join('')}>
${options.body}
  </main>
  <footer class="site-footer">Sutura verifies the fix. It never merges a generated repair.</footer>${options.script === undefined ? '' : `
  <script src="${escapeHtml(options.siteRoot)}${escapeHtml(options.script)}" defer></script>`}
</body>
</html>
`;
}

export function resultPageTitle(result: CaseLabResult, item: CaseLabCase): string {
  return `${item.title} · ${MODE_LABELS[result.mode]} · ${OUTCOME_LABELS[result.outcome]}`;
}

export interface CatalogCard {
  readonly item: CaseLabCase;
  readonly result: CaseLabResult;
}

export function renderCaseCard(card: CatalogCard, siteRoot: string): string {
  const { item, result } = card;
  return `<article class="case-card" id="case-${escapeHtml(item.id)}">
  <h2>${escapeHtml(item.title)}</h2>
  <p>${escapeHtml(item.scenario)}</p>
  <p class="badges">${modeBadge(result.mode)} ${outcomeBadge(result.outcome)}</p>
  <p>Expected: ${escapeHtml(OUTCOME_LABELS[item.expectedOutcome])} · Language: ${escapeHtml(item.language)}</p>
  <p class="actions">
    <a class="button" href="${escapeHtml(siteRoot)}replay/${escapeHtml(item.id)}/">Open ${escapeHtml(MODE_LABELS[result.mode].toLowerCase())}</a>
    <button type="button" class="button button-live" data-case-id="${escapeHtml(item.id)}" disabled>Start live run</button>
  </p>
</article>`;
}

export interface IndexOptions {
  readonly cards: readonly CatalogCard[];
  readonly release: { readonly version: string; readonly actionSha: string };
  readonly siteRoot: string;
  readonly limits: { readonly maxRunsPerHour: number; readonly maxRunsPerDay: number; readonly maxConcurrentRuns: number };
}

export function renderIndexBody(options: IndexOptions): string {
  const liveNote = `A live run starts one real Sutura repair in the public demo repository when the public-demo gate is on: at most ${options.limits.maxConcurrentRuns} run at a time, ${options.limits.maxRunsPerHour} per hour, and ${options.limits.maxRunsPerDay} per day. Every case has a deterministic result you can open now.`;
  return `<header class="docket">
  <p class="eyebrow">Sutura · Verified self-healing CI</p>
  <h1>Sutura Case Lab</h1>
  <p>AI agents make CI green. Sutura proves whether they fixed the problem. Pick one of five fixed cases and read the full verified result: diagnosis, search tree, candidate patches, rejected patches, audit verdict, cost, and links to the GitHub evidence.</p>
  <p class="mode-note">${escapeHtml(liveNote)}</p>
  <p class="identity">Release v${escapeHtml(options.release.version)} · Action <code>${escapeHtml(options.release.actionSha)}</code></p>
  <p id="live-status" class="live-status" role="status" aria-live="polite"></p>
</header>
<section class="cases" aria-label="Cases">
${options.cards.map((card) => renderCaseCard(card, options.siteRoot)).join('\n')}
</section>
<section class="sheet" aria-labelledby="labels-title">
  <h2 id="labels-title">How results are labeled</h2>
  <dl>
    <dt>${escapeHtml(MODE_LABELS.live)}</dt><dd>${escapeHtml(MODE_NOTES.live)}</dd>
    <dt>${escapeHtml(MODE_LABELS.replay)}</dt><dd>${escapeHtml(MODE_NOTES.replay)}</dd>
    <dt>${escapeHtml(MODE_LABELS.recorded)}</dt><dd>${escapeHtml(MODE_NOTES.recorded)}</dd>
  </dl>
  <p>The Case Lab accepts only these five server-defined cases. It never accepts arbitrary repositories, refs, commands, patches, or text.</p>
</section>`;
}

export interface PendingState {
  readonly requestId: string;
  readonly caseTitle: string | undefined;
  readonly status: string;
  readonly runUrl?: string;
}

export function renderPendingBody(state: PendingState): string {
  return `<header class="docket">
  <p class="eyebrow">Sutura Case Lab · Live run</p>
  <h1>${escapeHtml(state.caseTitle ?? 'Live run')}</h1>
  <p class="badges">${modeBadge('live')}</p>
  <p class="mode-note">Request <code>${escapeHtml(state.requestId)}</code>. This page keeps the same address; refresh it at any time.</p>
  <p id="live-status" class="live-status" role="status" aria-live="polite">${escapeHtml(state.status)}</p>${state.runUrl === undefined ? '' : `
  <p><a href="${escapeHtml(state.runUrl)}" rel="noopener">Watch the workflow run on GitHub</a></p>`}
</header>`;
}

/** Browser-safe structural guard: enough to render safely; the full validator runs in Node. */
export function isRenderableResult(value: unknown, caseIds: readonly string[]): value is CaseLabResult {
  if (value === null || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return result.schemaVersion === 'sutura-case-lab-result-v1'
    && typeof result.caseId === 'string' && caseIds.includes(result.caseId)
    && (result.mode === 'live' || result.mode === 'replay' || result.mode === 'recorded')
    && typeof result.outcome === 'string' && Object.hasOwn(OUTCOME_LABELS, result.outcome)
    && typeof result.expectedOutcome === 'string' && Object.hasOwn(OUTCOME_LABELS, result.expectedOutcome)
    && typeof result.requestId === 'string'
    && typeof result.resultHash === 'string'
    && typeof result.createdAt === 'string'
    && result.links !== null && typeof result.links === 'object'
    && result.release !== null && typeof result.release === 'object'
    && result.identity !== null && typeof result.identity === 'object'
    && result.cost !== null && typeof result.cost === 'object';
}
