import { Buffer } from 'node:buffer';
import * as github from '@actions/github';
import { ASSESSMENT_BOUNDS, classifyMechanically, rankFailedSteps, type GitHubApi } from '@sutura/core';
import { GitHubAdapter } from './github.js';
import { createGitHubApi } from './octokit.js';
import { inspectEvidence, type ActionInspection, type InspectionCapture } from './inspect.js';
import type { ActionConfiguration } from './input.js';
import { resolveActionIdentity } from './terminal-failure.js';

const MAX_RESPONSE = 4_194_304, MAX_REQUESTS = 80;
const METADATA = /^(?:(?:[\w.-]+\/)*package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|\.nvmrc|pyproject\.toml|uv\.lock|requirements\.txt|poetry\.lock)$/u;
export interface InspectionContext { owner: string; repo: string; environment: Readonly<Record<string, string | undefined>> }
/** Bound every authenticated API/log response before Octokit parses it. No source is executed. */
export function inspectionFetch(fetcher: typeof globalThis.fetch = globalThis.fetch): typeof globalThis.fetch {
  let requests = 0;
  return async (input, init) => {
    if (++requests > MAX_REQUESTS) throw new Error('Inspection request limit exceeded');
    const signal = init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
    const response = await fetcher(input, { ...init, signal });
    if (!response.body) return response;
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_RESPONSE) throw new Error('Inspection response exceeds byte limit');
        chunks.push(part.value);
      }
    } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
    finally { reader.releaseLock(); }
    return new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}
export async function inspectAction(action: ActionConfiguration, context: InspectionContext): Promise<ActionInspection> {
  const { owner, repo } = context;
  if (!/^[\w.-]+$/u.test(owner) || !/^[\w.-]+$/u.test(repo)) throw new Error('Inspection repository scope is invalid');
  const octokit = github.getOctokit(action.githubToken, { request: { fetch: inspectionFetch() } });
  const runId = Number(action.runId);
  if (!Number.isSafeInteger(runId) || runId < 1) throw new Error('Inspection run identity is invalid');
  const { data: run } = await octokit.rest.actions.getWorkflowRun({ owner, repo, run_id: runId });
  if (run.id !== runId || run.repository.full_name.toLowerCase() !== `${owner}/${repo}`.toLowerCase() || !/^[a-f0-9]{40}$/iu.test(run.head_sha)) throw new Error('Inspection run scope mismatch');
  const workflowPath = run.path?.split('@')[0] ?? '';
  const base: InspectionCapture = { observedAt: new Date().toISOString(), repository: `${owner}/${repo}`, repositoryId: run.repository.id, runId: action.runId,
    attempt: run.run_attempt ?? 1, sourceSha: run.head_sha, workflowId: run.workflow_id, workflowPath, event: run.event,
    actionSha: resolveActionIdentity(context.environment).sha ?? undefined, conclusion: run.conclusion, headBranch: run.head_branch ?? '',
    complete: false, workflow: '', files: {}, paths: [], snapshot: { complete: false, fileCount: 0, totalBytes: 0, largestFileBytes: 0 } };
  if (!['failure', 'timed_out'].includes(run.conclusion ?? '') || base.headBranch.startsWith('sutura/fix-')) return inspectEvidence(base);
  const native = createGitHubApi(octokit, owner, repo);
  const api: GitHubApi = { ...native, async listJobsForWorkflowRun(id) {
    const { data } = await octokit.rest.actions.listJobsForWorkflowRun({ owner, repo, run_id: id, filter: 'latest', per_page: 100 });
    if (data.total_count > 100 || data.jobs.length !== data.total_count || data.jobs.filter(job => ['failure', 'timed_out'].includes(job.conclusion ?? '')).length > 10) throw new Error('Inspection job inventory exceeds bounded scope');
    if (data.jobs.some(job => job.run_id !== run.id || job.run_attempt !== run.run_attempt || job.head_sha !== run.head_sha)) throw new Error('Inspection job source run, attempt or head SHA mismatch');
    return data.jobs.map(job => ({ id: job.id, name: job.name, conclusion: job.conclusion,
      steps: (job.steps ?? []).map(step => ({ number: step.number, name: step.name, conclusion: step.conclusion, startedAt: step.started_at ?? null, completedAt: step.completed_at ?? null })) }));
  } };
  // Reuse existing source identity, current-head and fork admission checks; this method does not claim or mutate.
  const failing = await new GitHubAdapter(api, { owner, repo, runId: action.runId }).getFailingRun(action.runId);
  const selected = rankFailedSteps(failing.failedSteps).find(step => classifyMechanically(step.log).failingCmd !== 'unknown') ?? rankFailedSteps(failing.failedSteps)[0];
  if (!selected || selected.truncated) return inspectEvidence({ ...base, selected });
  const read = async (path: string): Promise<string> => {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref: run.head_sha });
    if (Array.isArray(data) || data.type !== 'file' || !('content' in data) || data.encoding !== 'base64' || data.size > ASSESSMENT_BOUNDS.metadataFileBytes) throw new Error('Inspection source metadata is not a bounded regular file');
    const bytes = Buffer.from(data.content, 'base64');
    if (bytes.length !== data.size || bytes.length > ASSESSMENT_BOUNDS.metadataFileBytes) throw new Error('Inspection source metadata byte count mismatch');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  };
  if (!/^\.github\/workflows\/[\w.-]+\.ya?ml$/u.test(workflowPath)) throw new Error('Inspection workflow path is invalid');
  const workflow = await read(workflowPath);
  const { data: tree } = await octokit.rest.git.getTree({ owner, repo, tree_sha: run.head_sha, recursive: '1' });
  if (tree.truncated || tree.tree.length > 12_000) return inspectEvidence({ ...base, selected, workflow });
  const blobs = tree.tree.filter(entry => entry.type === 'blob');
  if (blobs.some(entry => typeof entry.path !== 'string' || !Number.isSafeInteger(entry.size) || entry.size! < 0)) throw new Error('Inspection tree metadata is corrupt');
  const paths = blobs.map(entry => entry.path!), metadata = blobs.filter(entry => METADATA.test(entry.path!));
  const files: Record<string, string> = {};
  // Credential-bearing npm configuration is never read by inspection. Presence is an unresolved capability boundary.
  if (paths.some(path => path === '.npmrc' || path.endsWith('/.npmrc'))) return inspectEvidence({ ...base, selected, workflow });
  if (metadata.length > 64 || metadata.some(entry => entry.mode !== '100644' && entry.mode !== '100755')) return inspectEvidence({ ...base, selected, workflow });
  let total = 0;
  for (const entry of metadata) {
    if (entry.path!.split('/').some(part => part === '..' || part === '.')) throw new Error('Inspection metadata path is unsafe');
    total += entry.size!; if (total > ASSESSMENT_BOUNDS.metadataTotalBytes) return inspectEvidence({ ...base, selected, workflow });
    files[entry.path!] = await read(entry.path!);
  }
  const { data: current } = await octokit.rest.actions.getWorkflowRun({ owner, repo, run_id: runId });
  if (current.head_sha !== run.head_sha || current.run_attempt !== run.run_attempt || current.workflow_id !== run.workflow_id) throw new Error('Inspection source run changed while reading');
  return inspectEvidence({ ...base, complete: true, selected, workflow, files, paths,
    snapshot: { complete: true, fileCount: blobs.length, totalBytes: blobs.reduce((sum, entry) => sum + entry.size!, 0), largestFileBytes: Math.max(0, ...blobs.map(entry => entry.size!)) } });
}
