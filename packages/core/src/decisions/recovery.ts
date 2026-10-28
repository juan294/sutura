import { choice, noul, type DecisionSession } from './call.js';
import type { JsonValue, TypeSafeQuestion } from '../llm/typesafe.js';
import type { RecoveryHypothesis, ObservedRecoverySignal } from '../diagnose/hypotheses.js';
import type { RepairSourceExcerpt } from '../engine/repair.js';

type Context = { signals: readonly ObservedRecoverySignal[]; sources: readonly RepairSourceExcerpt[] };
type Intent = 'await-operation' | 'await-setup' | 'restore-strict-config';
interface Proposal { signalIndex: number; sourceIndex: number; intent: Intent; probeId: 'async-completion' | 'strict-json' }
interface Option { id: string; proposal: Proposal; hypothesis: RecoveryHypothesis }
const INTENTS: readonly Intent[] = ['await-operation', 'await-setup', 'restore-strict-config'];
function sameHypothesis(left: RecoveryHypothesis, right: RecoveryHypothesis): boolean {
  return left.class === right.class && left.intent === right.intent && left.path === right.path && left.sourceSha256 === right.sourceSha256 && left.signal === right.signal && left.probeId === right.probeId;
}

/** Selects existing validator-approved proposals; it neither reads sources nor grants authority. */
export async function chooseRecovery(
  session: DecisionSession,
  context: Context,
  validate: (value: unknown) => RecoveryHypothesis[],
  baseline?: readonly RecoveryHypothesis[],
): Promise<RecoveryHypothesis[] | undefined> {
  const mode = session.options.config.modes.recovery;
  if (mode === 'off') return undefined;
  const options: Option[] = [];
  candidates: for (const [signalIndex] of context.signals.entries()) {
    for (const [sourceIndex, source] of context.sources.entries()) {
      if (!source.content.trim()) continue;
      for (const intent of INTENTS) {
        const proposal: Proposal = { signalIndex, sourceIndex, intent, probeId: intent === 'restore-strict-config' ? 'strict-json' : 'async-completion' };
        try {
          const validated = validate({ hypotheses: [proposal] });
          if (validated.length === 1) {
            options.push({ id: `${intent}_source-${sourceIndex}_signal-${signalIndex}`, proposal, hypothesis: validated[0]! });
            if (options.length > 32) break candidates;
          }
        } catch { /* Existing validation determines eligibility. */ }
      }
    }
  }
  const tooMany = options.length > 32;
  const eligible = tooMany ? [] : options;
  const candidateIds = eligible.map(option => option.id);
  const baselineIds: string[] = [];
  let baselineInvalid = baseline !== undefined && baseline.length > 2;
  if (!baselineInvalid && baseline !== undefined) {
    for (const hypothesis of baseline) {
      const matches = eligible.filter(option => sameHypothesis(option.hypothesis, hypothesis));
      if (matches.length !== 1 || baselineIds.includes(matches[0]!.id)) { baselineInvalid = true; break; }
      baselineIds.push(matches[0]!.id);
    }
  }
  const criteria = Object.fromEntries([
    ...eligible.map(option => [option.id, `${option.hypothesis.intent} for supplied source ${option.hypothesis.path}, observed signal ${option.hypothesis.signal}, existing probe ${option.hypothesis.probeId}`]),
    ['none', 'No additional supplied recovery hypothesis is supported by the evidence.'],
  ]);
  const questions: Record<string, TypeSafeQuestion> = {
    applicable: { type: 'noul', instructions: 'Does the supplied observed failure and complete source evidence support evaluating these narrow recovery alternatives?' },
    first: { type: 'choice', instructions: 'Which supplied recovery hypothesis is best supported by the observed failure and complete source evidence?', criteria },
    second: { type: 'choice', instructions: 'Which distinct supplied recovery hypothesis is also supported by the observed failure and complete source evidence?', criteria },
  };
  const state = {
    signals: context.signals,
    sources: context.sources,
    options: eligible.map(option => ({ id: option.id, ...option.proposal, hypothesis: option.hypothesis })),
    baselineMeasured: baseline !== undefined,
    ...(baseline === undefined ? {} : { baselineHypotheses: baseline }),
  } as unknown as JsonValue;
  const inputIssue = tooMany || baselineInvalid ? 'invalid-candidates' : eligible.length === 0 || mode === 'shadow' && baseline === undefined ? 'missing-evidence' : undefined;
  const evidence = await session.judge('recovery', state, questions, baseline === undefined ? 'existing-recovery-unmeasured' : 'existing-recovery-retained', candidateIds, baselineInvalid ? [] : baselineIds, inputIssue);
  if (mode === 'shadow' || evidence.outcome !== 'answered' || !evidence.answers) return undefined;
  const first = choice(evidence.answers.first), second = choice(evidence.answers.second);
  const invalid = () => { evidence.outcome = 'uncertain'; evidence.reason = 'invalid-recovery-selection'; return undefined; };
  if (noul(evidence.answers.applicable) !== true || first === undefined || second === undefined || first === 'none' && second !== 'none' || first !== 'none' && first === second) return invalid();
  const ids = [first, second].filter(id => id !== 'none');
  const selected = ids.map(id => eligible.find(option => option.id === id));
  if (selected.some(option => option === undefined)) return invalid();
  try {
    const hypotheses = validate({ hypotheses: selected.map(option => option!.proposal) });
    if (hypotheses.length !== selected.length || hypotheses.some((hypothesis, index) => !sameHypothesis(hypothesis, selected[index]!.hypothesis))) return invalid();
    evidence.suggested = ids;
    evidence.reason = hypotheses.length ? 'recovery-applied' : 'recovery-none-supported';
    return hypotheses;
  } catch { return invalid(); }
}
