# Phase 7: Nemotron routing and progressive flake confidence

Dependencies: Phase 6

Batch status: Sequential

## Goal

Select Nemotron models from measured results and reduce unnecessary flake reruns.

## Current evidence

Model roles are fixed in `packages/core/src/config.ts:1-5`.

The ledger records tier keys instead of actual model IDs (`packages/core/src/llm/cost.ts:42-61`).

Triage launches every configured attempt concurrently (`packages/core/src/engine/triage.ts:8-31`).

The action describes `triage-n` as an exact count (`action.yml:24-31`).

## Files

Add:

- `packages/core/src/llm/router.ts`
- `packages/core/src/llm/router.test.ts`
- `packages/core/src/engine/flake-confidence.ts`
- `packages/core/src/engine/flake-confidence.test.ts`
- `packages/placebo/src/ablation.ts`
- `packages/placebo/src/ablation.test.ts`

Modify:

- `packages/core/src/config.ts`
- `packages/core/src/llm/cost.ts`
- `packages/core/src/llm/nebius.ts`
- `packages/core/src/engine/triage.ts`
- `packages/core/src/domain.ts`
- `packages/core/src/heal.ts`
- `packages/core/src/report/*`
- action and CLI configuration surfaces
- `packages/placebo/src/types.ts`
- `packages/placebo/src/score.ts`
- `action.yml`
- `packages/action/action.yml`
- `README.md`

Update matching tests, fixtures, snapshots, and the action bundle.

## Model experiment

Compare these available candidates:

```text
nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B
nvidia/Nemotron-3_5-Lightning
nvidia/nemotron-3-super-120b-a12b
nvidia/Nemotron-3-Ultra-550b-a55b
```

Run the same versioned cases, prompts, schemas, tools, and budgets for every candidate.

Record the actual model ID, role, price snapshot, tokens, latency, outcome, and provider request ID.

Verify the price snapshot against the live Token Factory catalog before scoring.

## Selection rules

Diagnosis selects the lowest-cost candidate that matches baseline accuracy and schema reliability.

Repair selects the highest fix rate. Ties select lower cost, then lower median latency.

Audit requires zero false approvals. Keep Ultra when a challenger only ties the declared trap corpus.

If no challenger meets a rule, retain the current model.

Do not change production defaults from a partial evaluation.

## Routing contract

Record both role and actual model ID in every ledger entry.

Keep the abstract role separate from the resolved provider model ID.

Use these routing inputs only:

- requested role
- failure class
- diagnosis confidence
- bounded context size
- remaining inference budget
- selected evaluation profile

Do not route from repository identity or maintainer identity.

## Progressive triage

Treat `SUTURA_TRIAGE_N` as a maximum attempt count.

Use a sequential probability ratio test with these hypotheses:

```text
stable pass probability: 0.20
stable failure probability: 0.80
false-positive limit: 0.05
false-negative limit: 0.05
```

Run attempts in batches of two. Stop when evidence crosses a decision boundary.

Use a final batch of one when an odd maximum leaves one attempt.

Use the maximum attempt count when evidence remains mixed.

Report `real` early only after the failure boundary crosses with no observed pass.

Report `flaky` early only after the pass boundary crosses with no observed failure.

Any mixed sequence runs to the maximum and reports `intermittent`.

Report a 95 percent Wilson interval for the observed reproduction probability.

## Triage result

Extend the verdict:

```text
attemptsUsed
maximumAttempts
reproductionProbability
confidenceLower
confidenceUpper
stopReason
methodVersion
```

Keep `reproduced`, `of`, and `status` for compatibility during one release.

## Automated success criteria

- Every ledger entry contains role and actual model ID.
- Router decisions are deterministic for one evaluation profile.
- An incomplete ablation cannot change defaults.
- Repeated failures stop as real before the maximum when evidence permits.
- Repeated passes stop as flaky before the maximum when evidence permits.
- Mixed results use the maximum and report intermittent.
- Early stopping never marks a mixed sequence as real.
- An odd maximum executes its final single attempt.
- Boundary sequences do not stop early.
- Attempts never exceed the configured maximum.
- Reports show probability, interval, method, and stop reason.
- Placebo retains zero false approvals.
- The complete local gate passes.

## Manual success criteria

- Run the complete live model-role ablation.
- Verify current Token Factory prices before scoring cost.
- Inspect one early real stop, one early flaky stop, and one maximum intermittent result.

## Exit evidence

Publish the ablation manifest, raw sanitized results, selected profile, and result hash.

Include a release test that proves progressive triage does not increase unsafe repair attempts.

Publish average operations saved against fixed five-run triage.
