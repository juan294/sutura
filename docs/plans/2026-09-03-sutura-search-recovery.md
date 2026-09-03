# Sutura adaptive search recovery plan

Date: 2026-09-03

Status: Planned; implementation not started

Integration branch: `develop`

Parent plan: `docs/plans/2026-09-01-sutura-v0.2.1-evidence-remediation.md` (inserts before its Phase 4 benchmark rerun)

## Objective

Raise the repair rate of the controlled adaptive search without changing any fixture, denominator, safety gate, or the zero-false-approval rule. Every change is measured by the same v0.2.1 benchmark rerun that Phase 4 of the parent plan already requires, so this plan adds no benchmark spend.

## Measured evidence

Live re-run of the four Placebo upstream cases on `develop` commit `d03a8d15cc264f4245a6baddc1fc40d98b0bc221` on 2026-09-03 (ledger `.sutura/placebo-v0.2.1-live-ledger.json`, USD 0.9688):

| Case | With Tavily | Without Tavily | Release fact cited | Run |
| --- | --- | --- | --- | --- |
| upstream-client-release | fixed | gave-up | yes | 33786181498 |
| upstream-formatter-release | gave-up | gave-up | yes | 33786645421 |
| upstream-parser-release | refused | gave-up | yes | 33787636996 |
| upstream-retry-release | fixed | gave-up | yes | 33788056265 |

Grounding is not the defect: the release-fact citation reached the model in 4/4 with-Tavily evaluations (`packages/core/src/engine/repair-attempt.ts:162` serializes `diagnosis.grounding` into the user message). The `refused` result is correct audit behavior: the model wrote `import` in a `.cjs` file, Vitest masked it, and the Ultra audit rejected it.

The `gave-up` result (`upstream-formatter-release`) exposes four defects in the search itself. All four are confirmed in code and all four apply to every `repairable` case, not only upstream cases.

1. `packages/core/src/engine/search-score.ts:28-35` orders nodes by `pruned, passing, failureSignatures, diffBytes, changedFiles`. A branch whose proposal was invalid JSON has no patch, so `diffBytes` is 0 and it outranks every branch that applied a patch. In the chalk run node `search-003` (no patch) took one of the two beam slots at depth 2.
2. `packages/core/src/heal.ts:1000-1003` gives every child the parent's target index. A parent that produced no patch is re-expanded on the same excerpt with no new information.
3. `packages/core/src/engine/repair-attempt.ts:186` states that proposals apply to the clean baseline. When the model returns the same replacement at depth 2, the child's cumulative diff equals the parent's, `packages/core/src/engine/search.ts:158-166` marks it `repeated-state`, and the frontier empties. The chalk run stopped at 6 of 12 branches, depth 2 of 4, with 6 of 8 model turns used.
4. `packages/core/src/engine/repair-attempt.ts:343-352` fails the attempt on the first invalid proposal. Across the got and chalk runs 3 of 14 Super proposals were invalid JSON (476 to 627 output tokens). The bounded strict-schema retry added by the parent plan covers diagnosis only (`packages/core/src/diagnose/classify.ts:206-216`). NVIDIA's Nemotron 3 model cards recommend `chat_template_kwargs.force_nonempty_content` for coding agents; the flag is absent from `packages/core/src/llm/nebius.ts:408-414`.

## Design decisions

- Rank patched failures above unpatched failures. A node that applied no patch carries no search information and must not displace a node that did.
- Retry an invalid proposal exactly once with the parse error and the exact required shape, in the same attempt, charged to the same inference and model-turn budgets. A second invalid proposal fails the attempt as today.
- Send `force_nonempty_content: true` with `enable_thinking: false`. This changes the production request serializer, so the provider contract version moves to `sutura-super-repair-v5` and the live canary must pass before any benchmark dispatch. If the provider rejects the field, revert only that change; the retry stands on its own.
- When a child proposal is byte-identical to its parent's diff, request one alternative with explicit feedback before the search marks the node `repeated-state`.
- A parent that produced no patch expands on the next target index instead of repeating its own.
- No change to `DEFAULT_SEARCH_LIMITS`, `DEFAULT_REPAIR_BUDGET_LIMITS`, `REPAIR_ATTEMPT_COSTS`, the audit, policy rules, or any Placebo fixture or scorer.

## Phases

| Phase | Name | Files | Dependency | Batch status |
| ---: | --- | --- | --- | --- |
| 1 | Rank patched branches first | `engine/search-score.ts`, `engine/search-score.test.ts`, `engine/search.test.ts` | None | `[batch-eligible]` |
| 2 | Proposal validity retry and provider flag | `engine/repair-attempt.ts`, `engine/repair-attempt.test.ts`, `llm/nebius.ts`, `llm/nebius.test.ts`, `llm/provider-contract-canary.ts`, `llm/provider-contract-canary.test.ts` | None | `[batch-eligible]` |
| 3 | Identical re-proposal recovery and target rotation | `heal.ts`, `heal.test.ts`, `engine/repair-attempt.ts`, `engine/repair-attempt.test.ts` | Phase 2 (shared `repair-attempt.ts`) | Sequential |

Phase files:

- `docs/plans/2026-09-03-sutura-search-recovery-phases/phase-1.md`
- `docs/plans/2026-09-03-sutura-search-recovery-phases/phase-2.md`
- `docs/plans/2026-09-03-sutura-search-recovery-phases/phase-3.md`

## Verification

Each phase runs its focused tests, then `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, and `pnpm run test`. The integrated candidate runs `pnpm run ci:local` and rebuilds `packages/action/dist/index.cjs` in the same commit.

Live measurement, each under its own authorization and cap:

1. Provider contract canary on the exact candidate (required by the existing dogfood gate; cents).
2. The same four upstream cases through `scripts/placebo-live.mjs run` (about USD 1.00) as an early signal. Target: `upstream-formatter-release` no longer ends `gave-up` from an exhausted frontier.
3. The complete 51-case, 55-evaluation benchmark from Phase 4 of the parent plan. Targets are unchanged: repair at least 11/18, zero false approvals, upstream with Tavily 4/4.

## Success criteria

Automated:

- All new and existing tests in the listed files pass.
- No fixture, hidden test, scorer rule, or denominator changes (`git diff --stat` shows no path under `packages/placebo/corpus` or `packages/placebo/src/score.ts`).
- The offline corpus self-check remains 51 cases and 55 evaluations (`pnpm --filter placebo run smoke:offline`).
- `pnpm run ci:local` passes on the integrated commit.

Manual:

- Review that no change weakens a policy rule, the audit, or a terminal outcome class.
- Confirm the live canary passed with `sutura-super-repair-v5` before any benchmark dispatch.

## Out of scope

- Nano and Ultra sampling parameters (temperature 0 versus NVIDIA's documented 1.0 and top_p 0.95). Tracked separately in the hackathon roadmap.
- Any change to search limits, budgets, or beam width. Those need the controlled comparison required by roadmap strategy rule 9.
- Restoring the model-driven tool-calling loop (`runRepairAgent`) as the production path.

## Authorization gates

This plan does not authorize a push, a canary, a live case run, a benchmark, or a release. Each needs its own exact candidate and explicit authorization.
