# Phase 7 — Adaptive Nemotron routing under a shared budget

Parent: [Verified repair program](../2026-09-05-sutura-verified-repair-program.md). Depends on phase 6. Sequential, not batch eligible.

## Outcome and source

Replace profile-only selection with a bounded deterministic routing policy whose use of confidence, task purpose, context and feedback is visible and measurable. Keep fixed routing as a reproducible control and safe default until phase 10 evaluates promotion.

Read `packages/core/src/llm/router.ts:1`, `router.test.ts:1`, `cost.ts:1`, `types.ts:1`, configuration and client call sites, `packages/core/src/engine/repair-budget.ts:1`, and phase 4's challenge purpose. Own those files, phase 1 route evidence codecs, focused tests and rebuilt Action dist. Proposed `packages/core/src/llm/routing-policy.ts` and tests; proposed `docs/evaluation/routing-policy.md` records decision table/version without duplicating benchmark results.

## Deterministic initial policy

Roles remain nano/super/ultra; purpose is distinct. Map to explicitly configured, available NVIDIA models via Nebius. No invented currently available model IDs or price discounts. Validate actual model/pricing contracts before phase 10. Missing/unverified profile selects a valid fixed baseline or abstains if baseline itself is unaffordable/unavailable.

| Purpose/signal | Initial decision |
| --- | --- |
| Routine initial classification within configured nano context limit | Nano; confidence from result may schedule one recovery call |
| Recovery, conflicting diagnosis, low confidence below 0.7 or two-target repair | Super |
| Single-target repair, confidence at least 0.9, supported small excerpt, no previous failure | Nano candidate, if profile enables this evaluated option |
| Repair otherwise | Super |
| One structurally valid but unsuccessful repair with new execution feedback | Escalate at most once to Ultra if reserved budget allows |
| Independent challenge generation | Super, candidate-blind |
| Semantic adjudication | Ultra; never downgrade required final audit to finance repair work |

Context eligibility uses configured model input/output token ceilings and a conservative byte-to-token bound, with model-specific limits and safety margin recorded in the profile. No raw untrusted request field can claim a smaller context/budget. Thresholds above are initial **development hypotheses**, frozen after validation selection; final held-out results cannot tune them. A router refitted after held-out inspection becomes a new development profile and needs replacement held-out families for an unseen-performance claim. Structured output/transport retries consume existing retry and budget limits and do not create unlimited model escalation.

```text
reserve = fullAuditAndRequiredChallengeCost(run)
available = remainingBudget - reserve
route = decisionTable(purpose, diagnosis, targetCount, contextBound, priorFeedback)
if !verifiedModelContract(route) or !fitsWorstCaseReservation(route, available):
    route = permittedAffordableFallbackForPurposeOrAbstain()
record(route, reason, available, reserve, profileHash)
response = invoke(route, boundedPrompt, cappedOutput)
chargeActualUsageIncludingFailures(response)
assert auditReserveRemainsAvailable
```

Routing never changes patch authority, challenge requirements, policy or test commands. Record requested and returned model IDs; unexpected returned identity is explicit contract failure, not silently the requested model. Do not claim a paid pricing discount because a tier name is smaller. Price/date changes invalidate cost comparisons unless recomputed consistently from retained token counts.

## Automated success criteria

- [ ] Table-driven boundary tests at 0.7/0.9, context limits, missing confidence, one/two targets, exhaustion and previous failure demonstrate actual changed route decisions.
- [ ] Budget tests reserve maximum input/output, charge retries and provider failures, retain audit reserve, stop on missing price/model contracts and cap escalation at one.
- [ ] Same inputs/profile yield identical decisions; candidate or provenance cannot override purpose or safety gates.
- [ ] End-to-end deterministic controls show valid/invalid patches receive identical verifier gates across profiles; trace/replay preserves route reasons and returned model identity.
- [ ] Existing fixed profile remains reproducible; `pnpm --filter @sutura/core exec vitest run src/llm/router.test.ts src/llm/routing-policy.test.ts` and relevant repair-budget/replay tests pass.

## Manual success criteria

Reviewer can explain one Nano selection, one escalation and one budget abstention from evidence. Publish no cost or success improvement yet. Phase 10 runs paired profiles at matched correctness; an unsuccessful cost hypothesis leaves the implemented adaptive profile selectable and reports its limits while fixed routing stays default.

## Phase gate

Follow the parent plan's implementation/review/fix/simplification loop. Run focused checks and the standard local commands sequentially: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`. Rebuild the committed Action bundle for core/Action changes, run `pnpm run verify:bundle`, and complete `pnpm run ci:local` before any later push involving core. New process/build/sandbox tests use explicit timeouts of at least 30 seconds. Inspect actual hosted triggers before any push; never create a Vercel preview or use hosted CI to debug. Record actual results and the integrated source identity; stop after this phase. Remote actions and participant messages require the concrete authorization described in the parent plan.
