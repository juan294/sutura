# Phase 9 — Prepare maintainer trials and public installation tasks

Parent: [Verified repair program](../2026-09-05-sutura-verified-repair-program.md). Depends on phase 5. **[batch-eligible] with phase 6 only.** Prepare concrete outreach and scheduling requests now; no participant message is sent without separate explicit authorization. Measured sessions still depend on phase 11’s real public pilot.

## Outcome and ownership

Prepare concrete, reproducible trials for three developers installing Sutura in unfamiliar repositories and five people reviewing verification evidence. A readiness check is distinct from actual participant evidence.

Own `docs/adoption/`, `scripts/adoption-study.mjs:1`, `adoption-study.test.mjs:1`, `scripts/marketplace-evidence.mjs:1` and tests, plus proposed `scripts/review-study.mjs`/tests and `docs/adoption/verified-repair-study.md`. Read existing recruitment kit, participant template, Marketplace checklist and validators completely. Do not edit evaluation/Placebo/core, root scripts, shared README, common release validator, workflows or Action dist. Integrate common wiring in phase 10.

## Study specification

Retain existing exact-three-install acceptance semantics: three independent people, three unfamiliar repositories, public npm plus immutable public Action identity, JS/TS and Python representation, and repair/refusal/flake classifications. A builder-owned fresh clone or mocked install is a rehearsal, not adoption. Capture time to first valid result, every setup failure, unclear instruction, intervention, task outcome and artifact identity.

Add a separate append-only attempt ledger for all invited/started/completed/withdrawn/failed trials, using pseudonymous participant IDs and consent status. Existing three-success record schema remains compatible, but final report must disclose total attempts and selection into the accepted three. Do not erase failures to make `ready` true. Private contact details/session recordings live outside the public repository; public quotes/screenshots require specific consent.

Five-person review task may include the same three installers plus two additional independent reviewers. Use a frozen valid repair, deceptive green patch, flake and insufficient-evidence set with hidden expected answers in the assessor sheet. Ask the person to state verdict, why, what ran and next safe action. Measure first unaided answer before hints; target four of five correctly interpret verdict/reason/action within 60 seconds. Preserve raw answers, timing, assistance and incorrect conclusions. This is a small usability study, not statistical proof of adoption or market demand.

Add a separate paired review-impact exercise for all five reviewers: ordinary diff plus CI evidence versus Sutura's verification evidence on matched frozen cases of comparable difficulty. Counterbalance task/order assignment, using two task packs so a person does not see the answer to the same defect twice. Record assigned condition/order, correct accept/refuse/abstain decision against assessor-only truth, elapsed decision time, help and confidence. Do not display Sutura's verdict in the ordinary-CI arm. Report individual paired differences, correctness before speed, median changes and the small sample/order limitations. This answers the approved review-value question separately from the 60-second comprehension target. A slower but more accurate decision is not automatically worse; do not claim a universal time saving.

Prepare two external-agent patch-source task packs: same exact clean source, failing command, allowed scope and no hidden expectations, independent from Sutura repair/challenge transcripts. No provider integration required; collect diff bytes and actual source/version provenance during phase 10. Include correct and deceptive controls to calibrate the verifier regardless of agent success. A renamed identical hand-authored patch is not two independent agent sources.

```text
prepareStudy(publicArtifactRequirements, frozenTasks, rubric)
assert no fake participant or release evidence
recordAttempt(id, consent, task, start, assistance, terminalOutcome)
acceptedInstalls = validateExistingThreeSuccessContract(completedRecords)
reviewReport = scoreFirstUnaidedAnswers(allReviewSessions)
publishOnlyConsentedSanitizedAggregate(allAttempts, acceptedInstalls, reviewReport)
```

## Automated success criteria

- [ ] Existing adoption/Marketplace validator tests remain passing; exact-three success contract is not weakened.
- [ ] New ledger/review tests reject duplicate participant IDs, missing consent, fabricated release identities, invalid timing, empty answers, post-hint answers mislabeled unaided dropped failed attempts, unbalanced condition assignments and task leakage between the paired arms.
- [ ] Trial rehearsals use local packed artifacts, label rehearsal mode and never satisfy public-install acceptance.
- [ ] Run `node --test scripts/adoption-study.test.mjs scripts/marketplace-evidence.test.mjs scripts/review-study.test.mjs` sequentially as one local test command; validate real recruitment templates with the existing script.

## Manual success criteria

A reviewer can run the task from the prepared instructions and identify exactly what will be measured. Prepare the recruitment message, intended recipient cohort and consent text early enough to request explicit authorization for reserving October 14–20 sessions during this phase. After that authorization, scheduling may proceed; actual measured installs wait for phase 11. Without it, retain prepared messages and report the calendar dependency rather than assuming participant availability. Phase 11 supplies real public artifacts; phase 12 owns participants and results.

## Phase gate

Follow the parent plan's implementation/review/fix/simplification loop. Run focused checks and the standard local commands sequentially: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`. Rebuild the committed Action bundle for core/Action changes, run `pnpm run verify:bundle`, and complete `pnpm run ci:local` before any later push involving core. New process/build/sandbox tests use explicit timeouts of at least 30 seconds. Inspect actual hosted triggers before any push; never create a Vercel preview or use hosted CI to debug. Record actual results and the integrated source identity; stop after this phase. Remote actions and participant messages require the concrete authorization described in the parent plan.
