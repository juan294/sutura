import { execFile } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import type { CaseFile } from '../domain.js';
import type { CheckAnnotation } from './types.js';

export const SUTURA_CHECK_NAME = 'Sutura repair audit';
export const MAX_CHECK_ANNOTATIONS = 50;
const MAX_ANNOTATION_SOURCE_BYTES = 1_024 * 1_024;
const SHA_PATTERN = /^[0-9a-f]{40}$/iu;
const execFileAsync = promisify(execFile);

export function checkExternalId(repository: string, runId: string): string {
  return `sutura:${repository}:workflow-run:${runId}`;
}

export function checkConclusion(outcome: CaseFile['outcome']): 'neutral' | 'action_required' {
  return outcome === 'fixed' || outcome === 'flaky-no-patch' ? 'neutral' : 'action_required';
}

export function checkOutput(caseFile: CaseFile): { title: string; summary: string } {
  return {
    title: `Sutura outcome: ${caseFile.outcome}`,
    summary: [
      `Outcome: ${caseFile.outcome}`,
      `Diagnosis: ${caseFile.diagnosis.class}`,
      `Policy SHA: ${caseFile.policy.policySha}`,
      `Inference cost: $${caseFile.cost.totalUsd().toFixed(6)}`,
    ].join('\n').slice(0, 65_535),
  };
}

function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

function safeRelative(path: string): boolean {
  return path.length > 0 && path.length <= 240 && !path.startsWith('/') &&
    !path.includes('\\') && /^[A-Za-z0-9_@./-]+$/u.test(path) &&
    path.split('/').every((part) =>
      part !== '' && part !== '.' && part !== '..' && part.toLowerCase() !== '.git',
    );
}

async function validCheckoutPath(root: string, path: string): Promise<boolean> {
  if (!safeRelative(path)) return false;
  let current = root;
  for (const part of path.split('/')) {
    current = resolve(current, part);
    const metadata = await lstat(current).catch(() => null);
    if (!metadata || metadata.isSymbolicLink()) return false;
  }
  const canonical = await realpath(current).catch(() => null);
  if (!canonical || !inside(root, canonical)) return false;
  return (await lstat(canonical)).isFile();
}

async function trackedFileAtSha(
  root: string,
  headSha: string,
  path: string,
): Promise<string | null> {
  if (!SHA_PATTERN.test(headSha)) return null;
  try {
    const object = `${headSha}:${path}`;
    const type = await execFileAsync('git', ['-C', root, 'cat-file', '-t', object], {
      encoding: 'utf8', maxBuffer: 1_024,
    });
    if (type.stdout.trim() !== 'blob') return null;
    const content = await execFileAsync('git', ['-C', root, 'show', object], {
      encoding: 'utf8', maxBuffer: MAX_ANNOTATION_SOURCE_BYTES,
    });
    return content.stdout;
  } catch {
    return null;
  }
}

function lineCount(content: string): number {
  if (content.length === 0) return 0;
  const newlines = [...content.matchAll(/\n/gu)].length;
  return newlines + (content.endsWith('\n') ? 0 : 1);
}

export async function checkAnnotations(
  checkoutDir: string,
  headSha: string,
  caseFile: CaseFile,
): Promise<CheckAnnotation[]> {
  const root = await realpath(checkoutDir).catch(() => null);
  if (!root) return [];
  const references = new Map<string, number>();
  const pattern = /(?:^|[\s("'`])(?<path>(?:[A-Za-z0-9_@.-]+\/)*[A-Za-z0-9_@.-]+\.[A-Za-z0-9_-]+):(?<line>\d+)/gu;
  for (const match of caseFile.diagnosis.errorExcerpt.matchAll(pattern)) {
    const path = match.groups?.path;
    const line = Number(match.groups?.line);
    if (path && Number.isSafeInteger(line) && line > 0 && !references.has(path)) {
      references.set(path, line);
    }
  }
  const annotations: CheckAnnotation[] = [];
  for (const [path, line] of references) {
    if (annotations.length >= MAX_CHECK_ANNOTATIONS) break;
    if (!await validCheckoutPath(root, path)) continue;
    const trackedContent = await trackedFileAtSha(root, headSha, path);
    if (trackedContent === null || line > lineCount(trackedContent)) continue;
    annotations.push({
      path, startLine: line, endLine: line,
      annotationLevel: caseFile.outcome === 'fixed' ? 'notice' : 'warning',
      title: `Sutura: ${caseFile.diagnosis.class}`.slice(0, 255),
      message: caseFile.diagnosis.errorExcerpt.slice(0, 64_000),
    });
  }
  return annotations;
}
