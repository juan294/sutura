# Phase 2: Phase 0 exact live evidence

Status: Blocked at live-spend authorization

Issues: #47, #48, #49

## Order

1. Preserve the failed `da98aff6a9d25e8cbb9818429ea91cdc49623262`
   artifacts and create a ledger for the new exact candidate.
2. Run G1 once. Accept only `fixed` with Tavily enabled, a grounded Execa 6
   release citation, paired no-Tavily `gave-up`, and no false approval.
3. Run G2 on the same candidate. Retain all 51 cases and 55 evaluations,
   failures, costs, operation identities, and run URLs. Close #47 only after the
   terminal evidence commit is on `develop`.
4. Resolve the exact Case Lab/demo main SHA and run G3 on that same Action
   candidate. Close #48 after the eight-case candidate evidence is committed.
5. Run G6 only after the verified release exists. Close #49 after all eight
   public-package cases are committed and ready.

## Freeze procedure for every paid run

```bash
git fetch origin develop
CANDIDATE_SHA="$(git rev-parse refs/remotes/origin/develop)"
test "$(git rev-parse HEAD)" = "$CANDIDATE_SHA"
test "${#CANDIDATE_SHA}" -eq 40
pnpm run push-freeze on --reason "$FREEZE_REASON"
pnpm run push-freeze status
trap 'pnpm run push-freeze off' EXIT INT TERM
```

Post the matching ledger entry's duration, cap, reserve, expected cost, and stop
condition on its evidence issue before dispatch. Once the permitted workflows
are terminal:

```bash
pnpm run push-freeze off
trap - EXIT INT TERM
```

The marker stays active while waiting. Non-gated documentation continues in the
worktree. No push occurs until it is off.

## Evidence outputs

- `docs/demo/placebo-v0.2.1-live-*.json` and evidence note.
- `docs/demo/sutura-v0.2.1-candidate-matrix.json`.
- `docs/demo/sutura-v0.2.1-public-matrix.json`.
- `docs/demo/sutura-v0.2.1-phase-0-evidence.md`.
- Updated roadmap header, Phase 0 row, evidence register, and authorization
  ledger after each terminal transition.

## Exit

Phase 0 is accepted only when all denominators are complete, zero false
approvals is preserved, required outcomes pass, exact identities agree, local
validation passes, and the evidence is on `develop`.
