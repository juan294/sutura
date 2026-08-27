import { Buffer } from 'node:buffer';

import type {
  Candidate,
  Diagnosis,
  RaceResult,
  TriageVerdict,
} from '../domain.js';
import { MAX_RACE_CANDIDATES } from '../config.js';
import { parseUnifiedDiff } from '../diff/unified.js';
import { SNAPSHOT_CWD, type Executor, type ImageId } from '../executor/types.js';
import { extractJson } from '../llm/json.js';
import type { TierLlm } from '../llm/types.js';
import { triage } from './triage.js';
import { shellQuote } from './shell.js';

const DEFAULT_RACE_CANDIDATES = 3;

export type RepairLlm = TierLlm<'super'>;

interface CandidateReply {
  candidates: Candidate[];
}

const NUMBERED_HUNK = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(?: .*)?$/u;

export interface RepairPreparation {
  triage: TriageVerdict;
  candidates: Candidate[];
}

export interface RepairSourceExcerpt {
  path: string;
  startLine: number;
  content: string;
  truncated: boolean;
}

export interface RepairSourceContext {
  sources: RepairSourceExcerpt[];
}

function positiveCount(value: number, name: string): void {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAX_RACE_CANDIDATES
  ) {
    throw new RangeError(
      `${name} must be between 1 and ${MAX_RACE_CANDIDATES}`,
    );
  }
}

function candidateReply(value: unknown, expected: number): CandidateReply {
  if (typeof value !== 'object' || value === null) {
    throw new Error('candidate reply must be an object');
  }

  const candidates = (value as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates) || candidates.length !== expected) {
    throw new Error(`candidate reply must contain exactly ${expected} candidates`);
  }

  const parsed = candidates.map((value, index): Candidate => {
    if (typeof value !== 'object' || value === null) {
      throw new Error(`candidate ${index + 1} must be an object`);
    }
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || !candidate.id.trim()) {
      throw new Error(`candidate ${index + 1} must have a non-empty id`);
    }
    if (typeof candidate.rationale !== 'string' || !candidate.rationale.trim()) {
      throw new Error(`candidate ${index + 1} must have a non-empty rationale`);
    }
    if (typeof candidate.diff !== 'string' || !candidate.diff.trim()) {
      throw new Error(`candidate ${index + 1} must have a non-empty diff`);
    }
    const parsedDiff = parseUnifiedDiff(candidate.diff);
    if (
      !parsedDiff.valid ||
      parsedDiff.files.length === 0 ||
      parsedDiff.files.some(
        ({ hunks }) =>
          hunks.length === 0 || hunks.some(({ header }) => !NUMBERED_HUNK.test(header)),
      )
    ) {
      throw new Error(
        `candidate ${index + 1} diff must be a complete git unified diff with numbered hunks`,
      );
    }

    return {
      id: candidate.id,
      rationale: candidate.rationale,
      diff: candidate.diff,
    };
  });

  if (new Set(parsed.map(({ id }) => id.trim().toLowerCase())).size !== parsed.length) {
    throw new Error('candidate ids must be distinct');
  }
  if (
    new Set(parsed.map(({ rationale }) => rationale.trim().toLowerCase())).size !==
    parsed.length
  ) {
    throw new Error('candidate rationales must be distinct');
  }
  if (new Set(parsed.map(({ diff }) => diff.trim())).size !== parsed.length) {
    throw new Error('candidate diffs must be distinct');
  }

  return { candidates: parsed };
}

function generationPrompt(K: number): string {
  return [
    `Return exactly ${K} independent CI repair candidates as one JSON object.`,
    'Use distinct strategies. Consider, in order: fix source; fix config; fix dependency pin.',
    'Each candidate must have a distinct id, a concise rationale, and a complete unified diff accepted by git apply.',
    'For every changed file, include `diff --git a/path b/path`, `--- a/path`, `+++ b/path`, and one or more numbered hunk headers such as `@@ -1,3 +1,3 @@`.',
    'Never emit a bare `@@` hunk header or omit the `diff --git` header.',
    'Inside each hunk, prefix every unchanged context line with one literal space, and make the old/new line counts match the hunk body exactly.',
    'When sourceContext contains sources, use only those repository paths and make every hunk match that source exactly.',
    'Do not weaken, skip, or delete tests. Do not include hidden reasoning.',
    'Schema: {"candidates":[{"id":"...","rationale":"...","diff":"..."}]}',
  ].join('\n');
}

export async function generateCandidates(
  llm: RepairLlm,
  diagnosis: Diagnosis,
  K = DEFAULT_RACE_CANDIDATES,
  sourceContext: RepairSourceContext = { sources: [] },
): Promise<Candidate[]> {
  positiveCount(K, 'K');

  const messages = [
    { role: 'system' as const, content: generationPrompt(K) },
    {
      role: 'user' as const,
      content: JSON.stringify({ diagnosis, sourceContext }),
    },
  ];
  const options = {
    maxTokens: 8_192,
    temperature: 0.4,
    responseFormat: { type: 'json_object' as const },
  };
  const reply = await llm.chat(
    'super',
    messages,
    options,
  );

  const result = await extractJson(
    reply,
    (value) => candidateReply(value, K),
    async (repairPrompt) =>
      llm.chat(
        'super',
        [
          ...messages,
          { role: 'assistant', content: reply.text },
          { role: 'user', content: repairPrompt },
        ],
        options,
      ),
  );
  return result.candidates;
}

export async function prepareRepair(
  executor: Executor,
  llm: RepairLlm,
  failingImage: ImageId,
  diagnosis: Diagnosis,
  N = 5,
  K = DEFAULT_RACE_CANDIDATES,
  sourceContext: RepairSourceContext = { sources: [] },
): Promise<RepairPreparation> {
  positiveCount(K, 'K');
  const verdict = await triage(executor, failingImage, diagnosis.failingCmd, N);
  if (verdict.status !== 'real') {
    return { triage: verdict, candidates: [] };
  }

  return {
    triage: verdict,
    candidates: await generateCandidates(llm, diagnosis, K, sourceContext),
  };
}

function raceCommand(diff: string, failingCmd: string): string {
  const encodedDiff = Buffer.from(diff, 'utf8').toString('base64');
  if (!failingCmd.trim()) {
    throw new Error('failingCmd must contain a command');
  }

  return `printf '%s' ${shellQuote(encodedDiff)} | base64 --decode | git apply - && sh -lc ${shellQuote(failingCmd)}`;
}

export async function race(
  executor: Executor,
  failingImage: ImageId,
  candidates: readonly Candidate[],
  failingCmd: string,
): Promise<RaceResult[]> {
  if (candidates.length > MAX_RACE_CANDIDATES) {
    throw new RangeError(
      `candidates must contain at most ${MAX_RACE_CANDIDATES} entries`,
    );
  }
  const commands = candidates.map(({ diff }) => raceCommand(diff, failingCmd));
  const runs = await executor.runMany(failingImage, commands, {
    cwd: SNAPSHOT_CWD,
  });
  if (runs.length !== candidates.length) {
    throw new Error('executor returned an unexpected number of race results');
  }

  return runs.map((run, index) => ({
    candidate: candidates[index] as Candidate,
    imageId: run.imageId,
    exitCode: run.exitCode,
    held: run.exitCode === 0,
  }));
}

export function selectWinner(results: readonly RaceResult[]): RaceResult | null {
  let winner: RaceResult | null = null;
  let winnerBytes = Number.POSITIVE_INFINITY;

  for (const result of results) {
    if (!result.held) {
      continue;
    }
    const candidateBytes = Buffer.byteLength(result.candidate.diff, 'utf8');
    if (candidateBytes < winnerBytes) {
      winner = result;
      winnerBytes = candidateBytes;
    }
  }

  return winner;
}
