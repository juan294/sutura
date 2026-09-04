/// <reference lib="dom" />
/**
 * Browser entry for the Case Lab. It runs on the index page (live dispatch)
 * and on the result page (live result lookup). Everything it renders goes
 * through the escaping renderer; it never inserts unescaped input.
 */
import { CASE_LAB_CASES, CASE_LAB_CASE_IDS, type CaseLabCase } from './cases.js';
import {
  isRenderableResult,
  LIVE_REQUEST_ID,
  renderPendingBody,
  renderResultBody,
  resultPageTitle,
} from './render.js';

const RESULTS_BASE = 'https://raw.githubusercontent.com/juan294/sutura-demo/case-lab-results/results/';
const RUNS_API = 'https://api.github.com/repos/juan294/sutura-demo/actions/workflows/case-lab.yml/runs?per_page=30';
const POLL_MS = 15_000;
const MAX_POLLS = 200;

interface RunSummary {
  display_title?: unknown;
  status?: unknown;
  conclusion?: unknown;
  html_url?: unknown;
}

function caseById(id: string): CaseLabCase | undefined {
  return CASE_LAB_CASES.find((item) => item.id === id);
}

function setStatus(text: string): void {
  const status = document.getElementById('live-status');
  if (status) status.textContent = text;
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

async function enableLiveButtons(apiBase: string): Promise<void> {
  try {
    const health = await fetchJson(`${apiBase}/api/health`);
    const enabled = health.status === 200 && typeof health.body === 'object' && health.body !== null
      && (health.body as { enabled?: unknown }).enabled === true;
    if (!enabled) {
      setStatus('Live runs are disabled right now. Every case has a deterministic result you can open.');
      return;
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('button.button-live')) {
      button.disabled = false;
      button.addEventListener('click', () => {
        void startLiveRun(apiBase, button.dataset.caseId ?? '', button);
      });
    }
    setStatus('Live runs are enabled. Each start dispatches one real Sutura run in the public demo repository.');
  } catch {
    setStatus('Live runs are unavailable right now. Every case has a deterministic result you can open.');
  }
}

async function startLiveRun(apiBase: string, caseId: string, button: HTMLButtonElement): Promise<void> {
  if (!(CASE_LAB_CASE_IDS as readonly string[]).includes(caseId)) return;
  button.disabled = true;
  setStatus(`Starting ${caseById(caseId)?.title ?? caseId}…`);
  try {
    const { status, body } = await fetchJson(`${apiBase}/api/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseId }),
    });
    const response = (body ?? {}) as { requestId?: unknown; resultPath?: unknown; error?: unknown; retryAfterSeconds?: unknown };
    if (status === 202 && typeof response.requestId === 'string' && LIVE_REQUEST_ID.test(response.requestId)) {
      window.location.assign(`${siteRoot()}result/?id=${encodeURIComponent(response.requestId)}`);
      return;
    }
    const reason = typeof response.error === 'string' ? response.error : `HTTP ${status}`;
    const retry = typeof response.retryAfterSeconds === 'number' ? ` Try again in about ${Math.ceil(response.retryAfterSeconds / 60)} minutes.` : '';
    setStatus(`Live run refused: ${reason}.${retry} The deterministic result stays available.`);
  } catch {
    setStatus('Live run could not be started. The deterministic result stays available.');
  } finally {
    button.disabled = false;
  }
}

function siteRoot(): string {
  return document.querySelector('main')?.dataset.siteRoot ?? '/';
}

async function loadLiveResult(requestId: string, main: HTMLElement): Promise<void> {
  const { status, body } = await fetchJson(`${RESULTS_BASE}${requestId}.json`);
  if (status !== 200) return;
  if (!isRenderableResult(body, CASE_LAB_CASE_IDS) || body.requestId !== requestId || body.mode !== 'live') {
    setStatus('A result was published but it is not a valid live Case Lab result for this request.');
    return;
  }
  const item = caseById(body.caseId);
  if (!item) return;
  main.innerHTML = renderResultBody(body, item);
  document.title = resultPageTitle(body, item);
  throw new Error('done');
}

async function pollRun(requestId: string, main: HTMLElement): Promise<void> {
  let runUrl: string | undefined;
  let caseTitle: string | undefined;
  for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
    try {
      await loadLiveResult(requestId, main);
    } catch (error) {
      if (error instanceof Error && error.message === 'done') return;
    }
    let statusText = 'Waiting for the workflow to publish the result…';
    try {
      const { status, body } = await fetchJson(RUNS_API);
      const runs = status === 200 && body !== null && typeof body === 'object'
        ? ((body as { workflow_runs?: unknown }).workflow_runs as RunSummary[] | undefined) ?? []
        : [];
      const run = runs.find((candidate) => typeof candidate.display_title === 'string'
        && candidate.display_title.startsWith(`Case Lab ${requestId} `));
      if (run) {
        const title = String(run.display_title);
        const caseId = title.slice(`Case Lab ${requestId} `.length);
        caseTitle = caseById(caseId)?.title;
        runUrl = typeof run.html_url === 'string' ? run.html_url : undefined;
        const conclusion = typeof run.conclusion === 'string' ? run.conclusion : null;
        statusText = run.status === 'completed'
          ? `The workflow completed (${conclusion ?? 'unknown'}). Waiting for the published result…`
          : `The workflow is ${String(run.status)}. Sutura reproduces the failure, searches repairs, and audits the survivor. This usually takes a few minutes.`;
      } else if (attempt === 0) {
        statusText = 'The run was requested. Waiting for GitHub to start the workflow…';
      }
    } catch {
      statusText = 'Waiting for GitHub…';
    }
    main.innerHTML = renderPendingBody({
      requestId, caseTitle, status: statusText,
      ...(runUrl === undefined ? {} : { runUrl }),
    });
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  setStatus('Stopped waiting. Refresh this page later; the address stays valid.');
}

function main(): void {
  const root = document.querySelector('main');
  if (!root) return;
  const page = root.dataset.page;
  const apiBase = root.dataset.apiBase;
  if (page === 'index') {
    if (apiBase === undefined) {
      setStatus('Live runs are not configured for this build. Every case has a deterministic result you can open.');
      return;
    }
    void enableLiveButtons(apiBase);
    return;
  }
  if (page === 'result') {
    const requestId = new URLSearchParams(window.location.search).get('id') ?? '';
    if (!LIVE_REQUEST_ID.test(requestId)) {
      root.innerHTML = renderPendingBody({ requestId: 'unknown', caseTitle: undefined, status: 'Unknown result id. A live result address looks like /result/?id=cl-<digits>-<hex>.' });
      return;
    }
    void pollRun(requestId, root);
  }
}

main();
