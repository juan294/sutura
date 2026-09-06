# Phase 4 — Shared verification and independent regression challenges

Parent: [Verified repair program](../2026-09-05-sutura-verified-repair-program.md). Depends on phases 1–3, including the phase 1 evidence contracts and phase 2 diagnosis and phase 3 multi-file policy. Sequential; not batch eligible. Stop after review and local verification. Live comparative proof belongs to phase 10.

## Outcome

Every generated repair, supplied patch, and counterfactual receives the same production verification gates. A separate Nemotron purpose generates bounded declarative behavioral probes from baseline source and traceable contracts before seeing any candidate. The same frozen challenges test every candidate in isolated ConTree branches. Required challenge verification abstains when valid contract-backed checks cannot be completed; it cannot turn missing evidence into approval.

## Existing implementation and files

Read these files completely when implementing; line references describe the planning baseline and may move after earlier phases:

- `packages/core/src/engine/search.ts:151` currently cancels siblings on visible-test success and returns early; change success admission to full verification as specified below.
- `packages/core/src/heal.ts:748` owns diagnosis, generation, supplied candidates, and final verification; `:826` currently acquires source context only for generated repair. Move common safe baseline context acquisition ahead of candidate selection.
- `packages/core/src/audit/audit.ts:63` owns mechanical checks, held status, fresh suite execution, and adjudication. `packages/core/src/audit/repository-policy.ts:37` owns required commands and resource comparisons.
- `packages/core/src/counterfactual/evaluate.ts:169` duplicates production gate orchestration; `packages/core/src/counterfactual/types.ts:12` defines gate names. Replace parallel gate implementations with a shared evaluator while retaining versioned legacy adapters.
- `packages/core/src/domain.ts:69` defines checks and verdicts; `:149` defines case evidence. Consume phase 1's `VerificationEvidence` v1 rather than inventing another status vocabulary.
- `packages/core/src/executor/types.ts:62` exposes snapshot/run operations, but no protected harness capability. `packages/core/src/heal.ts:339` supplies fixed environment and disabled network, except controlled dependency preparation.
- `packages/core/src/engine/candidate-validation.ts:16` centralizes candidate validation. `packages/core/src/llm/types.ts:121` provides the existing model-tier client interface.
- `packages/core/src/replay/record-executor.ts:1`, `packages/core/src/replay/replay-executor.ts:1`, and `packages/core/src/trace/types.ts:1` carry operation/replay evidence.
- `packages/placebo/src/counterfactual.ts:48` explicitly identifies offline-only omitted gates. Preserve that distinction when adding challenge observations.

Add `packages/core/src/verification/evaluate.ts`, `packages/core/src/challenges/{types,generate,validate,evaluate,runner}.ts`, colocated tests, and challenge fixtures under `packages/core/src/challenges/__fixtures__/`. Update public exports in `packages/core/src/index.ts:1`, report renderers, relevant replay contracts, runtime observation adapters, and their tests. Reuse the existing sandbox client; no ConTree mount or privilege API is assumed.

## Contracts and authority

Use phase 1's versioned evidence with statuses `passed | failed | insufficient | not-run | infra-stop`. Structured gate/reason identifiers must replace inference from human-readable refusal strings. Record source commit and snapshot hash, trusted policy base SHA and policy SHA, candidate diff hash, runtime image digest, exact executed commands, model purpose/tier/requested model/returned model, and immutable evidence references. The trusted policy base can differ from the failing source commit; neither candidate nor failing checkout selects a more permissive policy.

```ts
type ChallengeKind = 'preservation' | 'bug-regression';
type ChallengeMode = 'disabled' | 'optional' | 'required';
interface ChallengeProposal {
  id: string;
  kind: ChallengeKind;
  contractRefs: Array<{ path: string; sha256: string; startLine: number; endLine: number }>;
  rationale: string;
  probeId: string; // controller allowlisted callable/operation
  inputs: JsonValue[]; // bounded typed values
  contractId: string; // must exist in the operator-trusted policy for this target
  relationId: string; // must match that declared contract; expected values are controller-derived
}
interface FrozenChallengeSet {
  version: 'sutura-challenges-v1';
  baselineSnapshotHash: string;
  trustedPolicySha: string;
  contextHash: string;
  promptHash: string;
  setHash: string;
  challenges: ChallengeProposal[]; // maximum 3 retained
  excluded: Array<{ id: string; reasonCode: string }>;
}
```

Expected-value qualification is deterministic: resolve `contractId` from the explicitly trusted policy, verify target/domain binding, and compute expectations using the controller-owned template or exact declared example table established in phase 1. A source/prose citation and its valid hash do not establish semantics. Reject an input outside the declared domain, a relation inconsistent with the contract, or a model-supplied expected override even when its citation is valid. Initial templates and exact JSON constraints are listed in the parent; unsupported prose interpretations remain insufficient. The challenger selects diverse inputs and supported relations; it cannot declare a new trusted oracle. Corpus contracts are visible repository input; hidden acceptance probes remain evaluator-only.

Use existing tier `super` with purpose `challenge-generation`; do not add a fourth pricing/model tier. Generator input contains failure, baseline production source, and policy-filtered contract excerpts. Exclude proposed diff, repair transcript, alternatives, agent provenance, expected benchmark outcomes, fixture kinds, hidden tests, and known-good patches. Freeze before repair generation or supplied-patch evaluation. No regeneration based on candidate outcomes within the run. Separate purpose is not a claim of independent model-family errors.

Retain at most three challenges and run two repetitions for every retained challenge/subject. Candidate and each alternative share identical declarative probe bytes/set hash. Repeats start from fresh branches so one execution cannot make the next pass. A preservation challenge must pass baseline consistently. A bug-regression challenge must fail baseline through an intended assertion, with expected behavior supported by the cited contract. An import error, timeout, syntax error, missing observation, tautological relation, or unsupported expected result is invalid/insufficient evidence. A passing candidate does not validate a generated oracle. Exclude unsupported expectations and report why. Trusted fixture controls and held-out tests remain evaluator-only material.

## Controller-owned probes and assertion evaluation

Select bounded declarative probes/invariants rather than arbitrary model-authored test programs. This trades general test-language expressiveness for a control boundary the present executor can enforce. Phase 1 establishes the protocol and supported contract/source fixtures before this phase builds on it. JavaScript/TypeScript exported functions and Python callables, including awaited results, plus bounded JSON-property reads for strictness/configuration contracts, are the supported initial surfaces. Unsupported source shapes or contract relations produce insufficient evidence, not guessed adapters.

The controller assigns probe IDs, resolves callable targets from baseline source, validates bounded typed inputs, and owns runtime invocation and assertion evaluation. The model proposes only supported target/input/relation data with contract references. Expected values are never model authority. It cannot supply executable test source, arbitrary shell, dependencies, network, hooks, runner flags, or policy changes. A protected controller challenge directory holds frozen probes and expected values outside the candidate snapshot; candidate diffs cannot include or modify it. The sandbox receives only the invocation and inputs required for that individual observation, never the controller-held frozen expectation tables or result writer. Public contract examples may legitimately reveal intended behavior; they are not secret challenge assurance. Exclude frozen tables, hidden evaluator values and raw Git objects from candidate snapshots, with packaging sentinel tests. Preserve sanitized public contract context needed by models without giving the candidate control of assertions.

```ts
observeProbe(candidateImage, frozenProbe):
  adapter = controllerAdapters.resolve(frozenProbe.probeId)
  invocation = adapter.buildTypedInvocation(frozenProbe.inputs)
  raw = executor.run(candidateImage, invocation, fixedEnvironmentAndNoNetwork)
  observed = adapter.parseBoundedTypedObservation(raw)
  if missingOrMalformedOrInterrupted(observed): return nonPassObservation
  return controllerAssertions.evaluate(deriveFromTrustedContract(frozenProbe), observed.value)
```

The candidate can influence or return observed values; it cannot set the controller verdict, expected relation, or frozen contract. Ignore candidate-authored `passed`/`approved` fields and reject malformed, duplicate, excessive or missing result envelopes. Candidate stdout is untrusted data and cannot be interpreted as a check result. Only controller comparisons create `passed` observations. General generated testfiles remain unsupported in this scope.

This boundary does not prove that a malicious implementation lacks test-aware behavior: it can return plausible values for particular inputs. State that limitation and test held-out input behavior in evaluation. Do not claim a nonce, signature, file hash, or role separation establishes semantic correctness. No protected mount, privileged sandbox runner, secret attestation credential, or new provider API is required by this selected design. Adapter support and correct typed result extraction are covered locally and then with the local phase 1 proof and the first separately authorized provider preflight in phase 10.

## Shared orchestration pseudocode

```ts
prepareVerificationContext(request):
  bindImmutableSourceAndTrustedPolicy()
  reserveRequiredAuditBudget() // suite, adjudication, policy commands, terminal evidence
  context = acquirePolicyFilteredBaselineContext()
  if challengeMode != disabled:
    requireBudgetForGenerationAndBoundedChallengeExecutions()
    proposed = challengeLlm.chat('super', purpose='challenge-generation', context)
    frozen = validateFreezeAndPersist(proposed)
    baselineChecks = qualifyOnFreshBaselineBranches(frozen, repetitions=2)
  return preparedContext

verifyCandidate(candidate, preparedContext):
  requireCandidatePolicyAndDiffLimits(candidate)
  requireDiagnosedVerificationPasses(candidate)
  requireMechanicalChecksPass(candidate)
  requireFreshSuitePasses(candidate)
  challengeEvidence = executeQualifiedFrozenChallenges(candidate, repetitions=2)
  adjudication = adjudicateWithNamedEvidence(candidate, challengeEvidence)
  requireRepositoryCommandsAndResourceLimits(candidate)
  if requiredChallengeEvidenceMissing: return insufficient
  return combineStructuredObservationsWithoutPromotingMissingChecks()

for subject in selectedRepairAndSuppliedAlternatives:
  result = verifyCandidate(subject, samePreparedContext)
```

Early refusal records remaining gates `not-run` with a blocking gate. Optional challenges preserve existing audit semantics but label missing challenge assurance explicitly. Defaults: new external verify and flagship demo require challenges; legacy heal uses optional unless trusted repository policy selects required. Optional baseline-only outcomes remain visibly lower assurance and cannot satisfy challenge-specific evidence gates. Required mode needs at least one qualified contract-backed challenge with both repetitions completed on baseline/candidate, all retained required checks passed, and all existing gates passed; otherwise abstain/refuse/infrastructure-stop as appropriate. All candidate paths must use this evaluator. No counterfactual or render-layer scoring shortcut can confer approval.

Integrate the evaluator into search admission, not just after the search winner is chosen. `search.ts` must treat diagnosed-test green as a provisional candidate. Verify each provisional candidate with the same frozen context; only a fully accepted result may cancel siblings and terminate successfully. A rejected provisional patch retains its reasons and continues to another viable candidate/frontier within existing branch, operation, time and inference caps. Reserve required verification capacity before admitting each new attempt; if unavailable, return the explicit budget/insufficient stop without claiming search success. Never refund spent verification work or regenerate challenges based on failure. Supplied verification evaluates only its supplied patch and never enters repair search.

Use the global phase 1 budget ledger. Reserve full audit before generation; charge challenge inference, preparation, repetitions, alternatives, and cleanup/terminal work. Default limits are never silently raised. If the remaining budget cannot cover the chosen set and subjects, reduce retained proposals before freezing or report insufficient; do not selectively omit failures or drop frozen required checks. Operation capacities and cancellation must preserve terminal observations and remaining budget accounting.

## Executable acceptance specification

Write failing tests first, then implementation and review:

1. `verification/evaluate.test.ts`: same patch/baseline/policy produces the same ordered gate observations through repair, supplied verification, and counterfactual adapters. Each refusal names the first blocking gate; omitted suite, policy command, challenge, adjudication, or terminal result is never a pass.
2. `challenges/generate.test.ts`: inspect captured prompt objects to prove patch/transcript/alternative/oracle exclusion, including supplied-candidate route; assert frozen set is created before the repair call and no candidate-outcome regeneration occurs.
3. `challenges/validate.test.ts`: reject absolute/traversal targets, symlink escape, executable/runner override, new dependency, denied source, wrong source hash, oversized inputs, unknown relation IDs, tautological assertions, and unknown contract references. Set max is three and repeated IDs are invalid.
4. `challenges/evaluate.test.ts`: phase 1's exact recorded pagination floor-only patch and correct ceil patch both pass the old visible suite; independent checks `(21,10)->3` and `(1,10)->1` reject the floor-only patch and preserve the correct patch. Add a held-out analogous arithmetic family during phase 10 rather than exposing that oracle here.
5. Quality fixtures cover preservation baseline pass, bug-regression assertion failure, baseline import failure, nondeterminism, tautologies, unsupported expectations, equivalent valid repairs, and contradictory contracts. Invalid generated tests never become patch-defect findings.
6. `challenges/runner.test.ts`: candidate prints forged approval fields, malformed/duplicate/oversized observation envelopes, exits without a value, targets unsupported exports, exploits a symlink, mutates the next repetition, or tries to access controller-held expectations. Controller verdict cannot be forged; no secrets, controller-held frozen expectation tables or evaluator-hidden answers enter the sandbox; public examples remain labeled specifications; environment is fixed and network disabled. Node, TypeScript, Python sync and Python awaited adapters return supported typed observations. Unsupported adapters return insufficient. Include a test-aware patch that passes known inputs but fails held-out evaluation inputs to document the remaining limitation.
7. Budget tests exhaust each resource immediately before generation, between repetitions, and before alternatives; mandatory audit reserve survives, no silent limit increase occurs, and no incomplete observation is approved.
8. Search integration test: first candidate is the exact floor-only patch and second is correct ceil; both pass the visible test, first fails trusted challenges, second is reached and fully accepted when the reserved budget permits. Verify siblings are not cancelled at first visible green; all candidates rejected and budget-exhausted paths remain truthful.
9. Oracle qualification tests: valid citation hash with fabricated expected=2 for (21,10) cannot override trusted ceil-division expected=3; an unsupported prose-only target abstains. Strict-config fixtures receive the JSON-property adapter and exact true constraint without losing phase 2 reachability.
10. Replay tests reproduce challenge set/subject hashes, order, cancellation, observation-protocol failures, and all five statuses. Report snapshots show invalid, absent, failed, approved and infrastructure examples distinctly. Historical replay remains readable with challenge evidence absent.

## Automated success criteria

- All named local controls pass, including exact published pagination regression and verification-route parity.
- Captured fixtures support provider/image guard behavior; local tests establish controller-side assertion authority and fail-closed observation parsing without paid execution.
- Global gate results and report labels cannot confuse log-only, replay, executed baseline, and executed challenge evidence.
- Run targeted tests sequentially, then `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, and `pnpm run build` sequentially. Rebuild the committed Action bundle for core changes; verify with `pnpm run verify:bundle`. Before any later authorized push, run `pnpm run ci:local` and inspect hosted triggers; never create a Vercel preview.

## Manual success criteria and phase exit

Reviewer can trace one named contract through immutable challenge bytes, baseline/candidate repetitions, decision, remaining uncertainty, and cost. Review the declarative probe support matrix and observe a forged-success fixture fail safely. These reviews cannot substitute for automated controls or phase 10 paid live evidence. Perform plan-compliance review, fix findings, dedicated simplification review, and local gates; stop for the phase gate. No production deployment, remote CI experiment, publication, or live quality claim is authorized by this phase document.

## Progress record — September 6

Implemented source: `5803d4b`. No push, provider inference, deployment or hosted sandbox occurred.

Built and locally verified:

- `verification/evaluate.ts` orders phase 1's gate names into the production sequence and returns an observation for every gate. Acceptance item 1 is met: the same subject produces identical ordered observations through the repair, supplied and counterfactual adapters; each refusal names the first blocking gate; an omitted suite, policy command, challenge, adjudication or terminal result is recorded `not-run`/`not-executed` and never reads as a pass. Required challenge mode without qualified assurance is `insufficient`. 22 tests.
- `challenges/generate.ts` builds the generation prompt from baseline failure, source and contract excerpts alone and refuses any context carrying a candidate diff, transcript, alternatives, provenance, expected outcome, fixture kind, hidden test, oracle or known-good patch, including nested inside supplied evidence. `freezeChallengeSet` retains at most three proposals, excludes duplicates and any proposal naming a contract the trusted policy does not declare, and refuses model-supplied expected values, test source and commands as unsupported fields. 35 tests.
- `challenges/runner.ts` qualifies each frozen challenge on the baseline across both repetitions before the candidate sees it, excludes an unqualified challenge with a reason, never runs the candidate for one, and requires every qualified challenge to pass every candidate repetition. 8 tests.

Local verification: workspace typecheck, lint and build passed; the core suite passed 1,476 tests with nine credential-gated skips.

Not built in this pass, and not claimed:

- Acceptance items 3, 4, 5, 7, 8, 9 and 10 have no tests yet: probe target validation against traversal, symlink and denied sources; the pagination floor-only versus ceil oracle qualification; the quality fixture family; budget exhaustion around generation and repetitions; search-admission integration; fabricated-expectation qualification; and replay reproduction of challenge hashes and statuses.
- Item 2's prompt-exclusion proof is covered, but "frozen set is created before the repair call" is not, because the evaluator and challenge set are not yet wired into `heal.ts` or `search.ts`. Search still admits on diagnosed-test green rather than on `verificationApproved`, so the shared evaluator is available and tested but not yet the production admission path.
- `challenges/validate.ts` and `challenges/evaluate.ts` are not added; phase 1's `protocol.ts` continues to own probe freezing and observation decoding.
