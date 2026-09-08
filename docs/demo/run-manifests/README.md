# Paid run manifests

Each manifest binds one measurement to its candidate, configuration, subjects and finite caps. Authorization is separate and specific to that manifest. Historical runs do not authorize a new run or leave a reusable balance.

## Current request

[Stage 3 v3 readiness](development-validation-v3-readiness.md) is the current proposed request: 80 development/validation subjects, candidate `ba408402f7ceaae0d291fca300280326f7cd2241`, and a proposed **USD 25 cumulative cap, with USD 0 authorized**. Nothing has been dispatched under v3. The [saved configuration](development-validation-v3-config.json) fixes the production baseline routing and existing per-subject budgets. It does not select the experimental adaptive profile.

The expanded verification path invalidates the earlier runtime/cost extrapolations. The readiness request distinguishes the validator's USD 10.48576 token calculation, the USD 20 aggregate repair-inference envelope at unchanged defaults, unknown sandbox billing and the proposed cumulative cap. None is a promise of a completed 80-case run.

## Staged ladder and historical records

| Stage | Manifest | Status |
| --- | --- | --- |
| 1 | `preflight-contract-v1` | Historical provider/image contract evidence; not a quality measurement. |
| 2 | `development-smoke-v1` | Historical six-control smoke passed, including a live two-file transaction. Later defects prevent treating it as current quality evidence. |
| 3 | `development-validation-v1` | Stopped after a false approval; cumulative restart accounting was subsequently fixed. Retain the original manifests, costs and failed evidence. |
| 3 | `development-validation-v2` | Superseded, unexecuted request for the earlier candidate. |
| 3 | `development-validation-v3` | Current proposed request, not authorized or dispatched. |
| 4 | Not prepared | Held-out 20 require a separate cap and frozen configuration after Stage 3 is read. |

Each stage gates the next. Stop dependent jobs after a failed control or incomplete run. No clean repair rate exists for the new candidate yet. Paid Data Lab comparisons and other roadmap experiments need their own concrete requests; Stage 3 does not authorize them.

Historical JSON identities remain unchanged. Read each manifest's own candidate, corpus, split, configuration, image and dated model prices. Do not rewrite old evidence to match the current candidate. A declared registry digest does not attest a provider image; executed evidence records the actual immutable executor baseline separately.

## Local manifest checks

From the repository root, validate the saved request without contacting a provider:

```bash
node --input-type=module -e "
import { manifestMaximumUsd, validateRunManifest } from './scripts/verified-program-evidence.mjs';
import { readFileSync } from 'node:fs';
const m = JSON.parse(readFileSync('docs/demo/run-manifests/development-validation-v3.json', 'utf8'));
console.log(validateRunManifest(m).manifestHash, manifestMaximumUsd(m));
"
```

The validator prices the maximum listed model with equal input/output token allowances and takes the smaller result or inference cap. This calculation is not a provider invoice ceiling: actual input context, sandbox charges and controller reservations have separate semantics. The readiness request records these limits explicitly. Unknown sandbox units remain unknown; never convert them to USD or zero without billing evidence.

## Before dispatch

Follow the exact candidate, remote checks, credential-presence checks, commands and stop procedure in [v3 readiness](development-validation-v3-readiness.md). Push authorization and paid-run authorization are separate. Check secrets by presence only; never print their values. The push freeze remains enabled until every dispatched job is terminal or its cancellation and billing are reconciled.

## Cumulative controller accounting

The Placebo CLI requires `--run-manifest` for both `run` and `streak`. Before the first authorized dispatch, initialize its account once with `init-spend`, using the same `--run-manifest`, `--cap-usd` and `--initial-reserve-usd` arguments intended for the run. Initialization is local bookkeeping, not spending authorization. Never initialize a historical manifest with a zero balance: the pre-fix v1 history remains closed and over budget.

The account lives under `sutura-manifest-spend/` in the Git common directory. All worktrees of this clone share it. It is separate from the replaceable case ledger, and exclusive creation refuses a second initialization. Each dispatch binds the manifest hash, exact candidate, listed subject and cumulative cap. Both inference and reported sandbox cost count, including repeated cases after a result-ledger reset. A changed hash or cap under the same manifest id is refused. A separate clone is not a continuation controller: transfer and verify the original account before any authorized continuation there.

Before dispatch the controller durably records a pending reservation and the unique controller id used in the GitHub run title. Concurrent controllers are locked out. Completion records the actual cost; a crash, failed workflow, unknown cost or invalid artifact leaves the reservation pending and blocks further spending. An unexpectedly expensive case can exceed the historical maximum reserve. This closes restart resets; it does not impose a provider-side hard billing limit within an already running case.

For recovery, first prove the original controller process has exited and find the exact GitHub run using the pending controller id. Wait for terminal state and retrieve its validated artifact and cost, or establish provider billing if no complete artifact exists. Preserve a copy of the account and case ledger. Only reconcile a pending entry against that exact run and measured cost; never clear it as zero merely because dispatch or download failed. Remove a stale lock only after proving no controller owns it. There is no automatic recovery command: unresolved billing keeps the run blocked. Account files are private local operational state and must not be deleted as worktree cleanup.
