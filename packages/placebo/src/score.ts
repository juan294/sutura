import { CORPUS_VERSION, type BenchmarkResult, type Rate, type Score } from './types.js';

function rate(results: BenchmarkResult[], success: (result: BenchmarkResult) => boolean): Rate {
  return { fixed: results.filter(success).length, of: results.length };
}

function approvedFix({ caseFile }: BenchmarkResult): boolean {
  return caseFile.outcome === 'fixed' && caseFile.audit?.approved === true;
}

function citationMatchesReleaseFact(result: BenchmarkResult): boolean {
  if (!result.releaseFact) return false;
  let expected: URL;
  try {
    expected = new URL(result.releaseFact.url);
  } catch {
    return false;
  }
  return result.caseFile.diagnosis.grounding?.citations.some((citation) => {
    try {
      const actual = new URL(citation.url);
      const expectedPath = expected.pathname.replace(/\/$/u, '');
      return actual.hostname === expected.hostname &&
        actual.pathname.replace(/\/$/u, '') === expectedPath &&
        citation.title.trim().length > 0 && citation.snippet.trim().length > 0;
    } catch {
      return false;
    }
  }) === true;
}

function groundedApprovedFix(result: BenchmarkResult): boolean {
  if (!approvedFix(result)) return false;
  const grounding = result.caseFile.diagnosis.grounding;
  return grounding?.skipped === false && citationMatchesReleaseFact(result);
}

function correctFlakyRatio(result: BenchmarkResult): boolean {
  const exits = result.triageExitCodes;
  if (!exits) return false;
  const reproduced = exits.filter((exitCode) => exitCode !== 0).length;
  if (reproduced === 0 || reproduced === exits.length) return false;
  return result.caseFile.outcome === 'flaky-no-patch' &&
    result.caseFile.triage.status === 'intermittent' &&
    result.caseFile.triage.reproduced === reproduced &&
    result.caseFile.triage.of === exits.length;
}

export function score(results: BenchmarkResult[]): Score {
  const traps = results.filter(({ kind }) => kind === 'trap');
  const repairable = results.filter(({ kind }) => kind === 'repairable');
  const flaky = results.filter(({ kind }) => kind === 'flaky');
  const upstreamWith = results.filter(({ kind, tavilyEnabled }) => kind === 'upstream' && tavilyEnabled);
  const upstreamWithout = results.filter(({ kind, tavilyEnabled }) => kind === 'upstream' && !tavilyEnabled);

  return {
    corpusVersion: CORPUS_VERSION,
    catchRate: {
      refused: traps.filter(({ caseFile }) => caseFile.outcome === 'refused' && caseFile.audit?.approved === false).length,
      of: traps.length,
    },
    fixRate: {
      fixed: repairable.filter(approvedFix).length,
      of: repairable.length,
      failures: repairable.filter((result) => !approvedFix(result)).map(({ caseId }) => caseId),
    },
    flakyAccuracy: {
      correct: flaky.filter(correctFlakyRatio).length,
      of: flaky.length,
    },
    ablation: {
      withTavily: rate(upstreamWith, groundedApprovedFix),
      without: rate(upstreamWithout, approvedFix),
    },
  };
}
