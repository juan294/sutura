# Paid run manifests

Each manifest is a reviewable request for one paid measurement. Authorization
starts at zero and is scoped per manifest: approving one approves nothing else,
and no manifest here has been dispatched.

Rebuild and reprice any manifest with the validator that enforces its caps:

```bash
node --input-type=module -e "
import { manifestMaximumUsd, validateRunManifest } from './scripts/verified-program-evidence.mjs';
import { readFileSync } from 'node:fs';
const m = JSON.parse(readFileSync('docs/demo/run-manifests/preflight-contract-v1.json', 'utf8'));
console.log(validateRunManifest(m).manifestHash, manifestMaximumUsd(m));
"
```

## Staged ladder

The plan runs these in order, and each stage gates the next. A failure at any
stage stops every dependent job rather than continuing to the next.

| Stage | Manifest | Subjects | Priced maximum | Spend cap | What it decides |
| --- | --- | --- | --- | --- | --- |
| 1 | `preflight-contract-v1` | 6 | USD 0.12 | USD 1.00 | Whether the provider, the pinned image and the typed-probe protocol work at all. Not a quality benchmark. |
| 2 | `development-smoke-v1` | 6 | USD 0.98 | USD 3.00 | Whether six known controls behave: a preservation repair, a green-but-broken trap, a missing await, a two-file pair, a flake and a policy refusal. |

Stage 2 uses the expanded selection, because the preservation and two-file
controls are versioned cases and exist only there.
| 3 | `development-validation-v1` | 80 | USD 10.00 (clamped) | USD 10.00 | The repair, refusal and flake rates over the development and validation splits. The held-out split stays unopened. |
| 4 | not yet written | 20 | — | — | The held-out estimate, opened once, with the runtime configuration frozen beforehand. |

Stage 3's raw token ceiling is USD 13.10, above its own spend cap, so the
priced maximum reports the cap. That is expected once a run is large enough:
the cap becomes the binding constraint and the token ceiling stops being
informative. Measured cost from stage 2 puts stage 3 near USD 5.60, so the cap
carries about 1.8 times headroom over the expected total including sandbox.

Stage 4 is deliberately absent. Writing it before stage 3 has run would price a
run whose shape depends on what stage 3 finds, and the held-out split is opened
once.

## How the priced maximum is computed

Every turn is priced at the most expensive model the manifest names, with the
full input and output token allowance, and each subject may take
`modelTurnsPerSubject` of them per repetition. It is a ceiling, not an
estimate: a request that can only be approved on an optimistic average is not a
bounded request.

The spend cap is separate and lower-bounding: whichever of the two is smaller
is what the run can spend. Sandbox operations, elapsed time, raw sandbox units
and concurrency are capped independently, and none of them has a default.

## Identities

All manifests here are bound to:

| Field | Value |
| --- | --- |
| Candidate commit | `303a571dee985c6c25b5b44364490a1feb92e9e0` |
| Runtime image | `node:22` at `sha256:8a34c4ab3ea2c5cd194f07e317b2a8f09461d3c8b05c4e34c8ccd56d56024c4d` |
| Corpus (expanded, 100 cases) | `d4757a557e3376b8610c7e0ecc3b6660f5f2ca10d2fbee43e04ebaa617e4d136` |
| Split | `49fb4609a602e609a6f31596522a4b229b3fc56ba670ce6a29d764905364a683` |
| Configuration | `eadefeea0455a6a88202a6f1c5e978bafd9d1326222c4a15306b53baa5f6bf0b` |

A result recorded under any other candidate, image, corpus, split, config,
model or price is refused by `validateRunEvidence`, so evidence cannot be
carried from one manifest to another.

Stages 1 and 2 ran against the earlier expanded corpus
`ed58d316397157fca580e1a74ba9fcde8af1bd6c580137b3a09af47c48b768f6`, before
three flaky fixtures were corrected. Their manifests keep that hash, because a
manifest describes the run that happened. Stage 3 onward uses the corrected
hash above.

## Before dispatching

1. `pnpm run push-freeze on --reason "<manifest id>"` — the pre-push hook then
   refuses to push while the run is live, so the candidate cannot move under it.
2. Check credentials by presence only: `NEBIUS_API_KEY`, `CONTREE_TOKEN`,
   `CONTREE_PROJECT`, `TAVILY_API_KEY`. Never print a value.
3. Dispatch the approved manifest and nothing else.
4. `pnpm run push-freeze off` once every dispatched job is terminal or
   explicitly cancelled and recorded.

## Inference is not the whole bill

The priced maximum covers inference. Nebius bills sandbox time separately, and
on the 2026-09-03 upstream run sandbox was about 95 percent of the total at
roughly USD 0.24 per case. Six cases therefore cost about USD 1.44 in practice
against a USD 0.98 inference ceiling. The spend cap must cover both, which is
why stage 2 is capped at USD 3.00 rather than at its inference ceiling.

The manifest caps `rawSandboxUnits` separately and does not convert it to
dollars, because the provider's raw unit is unconfirmed. Recording an
unconfirmed unit as a dollar figure would state a precision the evidence does
not have.

## Cumulative controller accounting

The Placebo CLI now requires `--run-manifest` for both `run` and `streak`.
Before the first authorized dispatch, initialize its account once with
`init-spend`, using the same `--run-manifest`, `--cap-usd` and
`--initial-reserve-usd` arguments intended for the run. Initialization is local
bookkeeping, not spending authorization. Never initialize a historical manifest
with a zero balance: the pre-fix v1 history remains closed and over budget.

The account lives under `sutura-manifest-spend/` in the Git common directory.
All worktrees of this clone share it. It is separate from the replaceable case
ledger, and exclusive creation refuses a second initialization. Each dispatch
binds the manifest hash, exact candidate, listed subject and cumulative cap.
Both inference and reported sandbox cost count, including repeated cases after
a result-ledger reset. A changed hash or cap under the same manifest id is
refused. A separate clone is not a continuation controller: transfer and verify
the original account before any authorized continuation there.

Before dispatch the controller durably records a pending reservation and the
unique controller id used in the GitHub run title. Concurrent controllers are
locked out. Completion records the actual cost; a crash, failed workflow,
unknown cost or invalid artifact leaves the reservation pending and blocks
further spending. An unexpectedly expensive case can exceed the historical
maximum reserve. This change closes restart resets; it does not impose a
provider-side hard billing limit within an already running case.

For recovery, first prove the original controller process has exited and find
the exact GitHub run using the pending controller id. Wait for terminal state
and retrieve its validated artifact and cost, or establish provider billing if
no complete artifact exists. Preserve a copy of the account and case ledger.
Only reconcile a pending entry against that exact run and measured cost; never
clear it as zero merely because dispatch or download failed. Remove a stale
lock only after proving no controller owns it. There is no automatic recovery
command: unresolved billing keeps the run blocked. Account files are private
local operational state and must not be deleted as worktree cleanup.

The [v2 readiness request](development-validation-v2-readiness.md) retains the
80 subjects and proposes a fresh USD 10 cumulative cap, with USD 0 authorized.
It records the fixed controller candidate and the remote identity checks
required before a paid run.
