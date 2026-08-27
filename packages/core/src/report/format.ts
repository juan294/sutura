import type { CaseFile, RaceResult } from '../domain.js';
import { selectWinner } from '../engine/repair.js';

const STAGE_BY_MODEL = [
  { match: /nano/i, stage: 'Diagnosis' },
  { match: /super/i, stage: 'Procedure' },
  { match: /ultra/i, stage: 'Pathology' },
] as const;

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

export function escapeMarkdown(value: string): string {
  return value
    .replace(/[\\`*_[\]<>]/g, '\\$&')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

export function safeWebUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

export function stageForModel(model: string, index: number): string {
  return (
    STAGE_BY_MODEL.find(({ match }) => match.test(model))?.stage ??
    `Inference ${index + 1}`
  );
}

export function outcomeLabel(outcome: CaseFile['outcome']): string {
  return {
    fixed: 'PATCH CERTIFIED',
    'flaky-no-patch': 'FLAKY — NO PATCH',
    refused: 'PATCH REFUSED',
    'gave-up': 'NO PATCH HELD',
    'infra-stop': 'INFRA — STOPPED',
  }[outcome];
}

export function triageSentence(caseFile: CaseFile): string {
  if (caseFile.outcome === 'infra-stop') {
    if (caseFile.diagnosis.signals.includes('sandbox-preparation:failed')) {
      return 'Sandbox dependency preparation failed. Sutura stopped before reproduction and inference.';
    }
    return 'The failing command passed in a clean sandbox reproduction. Sutura stopped before inference.';
  }
  const { reproduced, of, status } = caseFile.triage;
  if (status === 'flaky') {
    return `Reproduced ${reproduced}/${of} across forked sandbox states — flaky. No patch proposed.`;
  }
  if (status === 'intermittent') {
    return `Reproduced ${reproduced}/${of} across forked sandbox states — intermittent.`;
  }
  return `Reproduced ${reproduced}/${of} across forked sandbox states — real.`;
}

export function raceNote(result: RaceResult): string {
  if (result.note) return result.note;
  if (result.held) return 'Survived the verification race';
  if (result.exitCode === 0) return 'Rolled back after comparison';
  return `Rolled back; verification exited ${result.exitCode}`;
}

export function diffSummary(caseFile: CaseFile): string {
  const winner = selectWinner(caseFile.race);
  if (!winner) return 'No candidate patch survived.';

  const lines = winner.candidate.diff.split(/\r?\n/);
  const added = lines.filter(
    (line) => line.startsWith('+') && !line.startsWith('+++'),
  ).length;
  const removed = lines.filter(
    (line) => line.startsWith('-') && !line.startsWith('---'),
  ).length;
  return `${winner.candidate.id}: +${added} / −${removed} lines`;
}

export function mergeGuidance(caseFile: CaseFile): string {
  switch (caseFile.outcome) {
    case 'fixed':
      return 'Confirm the surviving diff matches the diagnosed API change, then merge only if the cited checks remain green.';
    case 'refused':
      return 'Do not merge this candidate. Restore the behavior named in the failed pathology checks.';
    case 'gave-up':
      return 'No candidate is safe to merge. Inspect the diagnosis and start a new repair cycle with more evidence.';
    case 'flaky-no-patch':
      return 'No patch exists to merge. Investigate the timing boundary and rerun with the same commit.';
    case 'infra-stop':
      return 'No patch exists to merge. Inspect the CI infrastructure and the difference between the failing runner and the clean sandbox.';
  }
}
