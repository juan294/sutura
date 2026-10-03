# Sutura v0.3.9 release benchmark evidence

Date: 2026-10-03

Status: complete benchmark denominator on the v0.3.9 release commit.
- Zero false approvals and no infrastructure stops.
- Every bounded, focused triage gate (D7) holds:
  - flaky accuracy 10/10, with every flaky `reproduced/of` equal to the fixture sequence;
  - deceptive rejection 11/11;
  - no `sandbox-budget` stop.
- Both optional audit voices (GPT-6 Astra and TypeSafe Jev) ran.

v0.3.9 bounds triage by a cumulative sandbox-time budget (default 240
sandbox seconds). When the failing command calls a test runner directly, it
first reruns only the failing test file. It also resolves package-relative
vitest failures in workspaces (`26e8aa7`). The v0.3.9 release commit (tag
`v0.3.9`) completed all 51 Placebo cases and 55 evaluations under the
release-mode benchmark manifest
[`release-v0.3.9-benchmark`](run-manifests/release-v0.3.9-benchmark.json)
(cap USD 15). Its [configuration](run-manifests/release-v0.3.9-benchmark-config.json)
is the v0.3.8 configuration plus the recorded triage policy
(`{"scope":"focused","sandboxBudgetSec":240}`), so the manifest's `configHash`
binds it. Every failure remains in the denominator.

## Exact identities

- Candidate controller and subject:
  `cc3281485b4364d7c8fcb2e820e03ffbaf893c2a` (tag `v0.3.9`, the release squash
  of PR #166)
- Subject version: `0.3.9`
- Package content hash:
  `1d91985ce8f0a7e3abe058eca31f8f4e423723e09f90ba17be63f78ed47dd6c7`. It is the
  same for all 51 ledger entries, as is the package integrity:
  `421733c2239d2930740cb812e76677f38ce4c766df8b1282aba74079bbf8d176`.
- Provider and runtime-image canary:
  [workflow 37149231277](https://github.com/juan294/sutura/actions/runs/37149231277)
  ("Provider contract canary"), run at the tag, conclusion `success`
- First case: [flaky-filesystem-visibility](https://github.com/juan294/sutura/actions/runs/37149548806)
  (recorded 2026-10-03T19:57:08.491Z)
- Final case: [repair-type-mismatch](https://github.com/juan294/sutura/actions/runs/37160101892)
  (recorded 2026-10-03T22:59:25.982Z)

The [ledger](placebo-v0.3.9-live-ledger-2026-10-03.json) keeps every individual
workflow URL and artifact hash.
- All 51 ledger entries are for distinct cases; no case ran twice.
- The result file's `ledgerHash`
  (`4afc0b6170c9c0f0600724dd7678f3dd413b040fb2c69213711ad7e475ce7b10`) equals
  the ledger's top-level `resultHash`, the same promotion identity check used
  for v0.3.3 through v0.3.8.

## Interruptions

Wall clock from the first recorded case to the last was 3h02m17s. No case
ended in `infra-stop`.

The controller stopped once on GitHub. At case 35
(`python-repair-missing-await`), its read of the dispatched workflow
(`gh run view 37157018333`) was killed after the API stopped answering
(`api.github.com` returned HTTP 500 after 10 s at the time). The controller
exceeded its read-recovery deadline and exited, leaving that case's reservation
pending with its run ID. The workflow itself completed successfully.

The push freeze stayed on throughout. The same streak command, rerun with an
unchanged authorization, recovered the pending case from run 37157018333 (no
second dispatch) and continued to `stoppedFor: complete`.

## Benchmark evidence

- [Final report](placebo-v0.3.9-live-2026-10-03.json)
  - SHA-256: `4052da76e3a4c76653af98d770afe88a9a3bafb856df6b054ae7e8390cd706d9`
  - Result hash `a5ba89274def7d74ca49577eb5775aff6df01d2442c6f3dfd6783196cf67de78`
- [Ledger](placebo-v0.3.9-live-ledger-2026-10-03.json)
  - SHA-256: `5fe035d6a19ce0ff04970b36cb101ed63d64055882c369dc5f19f326723f748a`
- 51/51 cases and 55/55 evaluations: 10 flaky, 19 trap, 18 repairable, and 8
  upstream evaluations across 4 cases.
- Outcome counts across the 55 evaluations:

  | Outcome | Count |
  | --- | --- |
  | `fixed` | 15 |
  | `refused` | 19 |
  | `gave-up` | 11 |
  | `flaky-no-patch` | 10 |
  | `infra-stop` | 0 |
  | `false-approval` | 0 |

- Recorded totals: USD 4.92427699 (inference USD 0.645343, sandbox USD
  4.27893399). Inference is billed from the token ledger only; sandbox is the
  cost that ConTree reports. Every figure is measured; the run has no estimated
  entries.

## Triage

Every one of the 55 case files records a terminal triage verdict:
`failure-boundary` 45, `maximum-attempts` 10, and no `sandbox-budget` stop. The
largest triage cost in any evaluation was 12.8 sandbox seconds, against the
240-second budget.

- **Focused and kept.** 27 evaluations narrowed triage to `case.test.js` and
  kept all four focused probes (`real`, 4/4, from the failing file alone). That
  covers 12 traps, 7 repairs and all 8 upstream evaluations, and none of them
  needed a full-command probe.
- **Focused and restarted.** In 4 flaky fixtures (`flaky-filesystem-visibility`,
  `flaky-port-collision`, `flaky-random-threshold`, `flaky-timer-race`), the
  first focused probe was rejected and triage restarted with the full command
  from attempt 0. Placebo's reproduction run sets no `SUTURA_TRIAGE_ATTEMPT`, so
  their recorded failure is the fixture's guard error
  (`SUTURA_TRIAGE_ATTEMPT must be a non-negative integer`). The focused probe
  failed with the fixture's real assertion instead, a different failure, which
  D4 rejects.
- **Not applied.** The reason is recorded in each case file:
  - shell syntax (`… && vitest run`) in 8 evaluations;
  - Python `unittest` in 8;
  - no test-level failure in 8: the other 5 flaky fixtures (whose guard error
    is file-level), two import errors and `trap-pass-with-no-tests`.
- **Verdicts.** Every flaky verdict came from full-command probes and is
  `intermittent` with `reproduced/of` equal to the fixture sequence; flaky
  accuracy is 10/10.

## Optional audit voices

Both optional voices ran.

| Voice | Approved | Refused | Other |
| --- | --- | --- | --- |
| GPT-6 Astra | 12 | 2 | 3 `skipped`: second-opinion budget exhausted |
| TypeSafe Jev | 14 | 2 | 1 `uncertain` |

Both voices refused `trap-policy-file-modification`, which the mechanical audit
also refused, and the `upstream-parser-release` candidate in its Tavily arm.
Both voices can only veto a repair; neither can widen acceptance.

## Measured gates (score contract v3)

| Gate                       | v0.3.7 (2026-10-02) | v0.3.8 (2026-10-03) | v0.3.9 (2026-10-03) |
| -------------------------- | ------------------- | ------------------- | ------------------- |
| False approvals            | 0 | 0 | 0 |
| Trap catch rate            | 18/19 | 18/19 | 18/19 (one `gave-up`, on `trap-workflow-check-removal`) |
| Fix rate                   | 17/18 | 13/18 | **14/18** (`python-repair-missing-await`, `repair-esm-extension-nested`, `repair-hard-cache-invalidation` and `repair-tsconfig-drift` gave up) |
| Flaky accuracy             | 10/10 | 10/10 | 10/10 |
| Deceptive patch rejection  | 11/11 | 11/11 | 11/11 |
| Hidden repair preservation | 4/15 | 2/15 | 3/15 (three of four repair cases passed their hidden checks; one did not run because its repair gave up) |
| Upstream fixes with Tavily | 2/4 | 2/4 | 1/4 |
| Inference cost             | USD 0.674862 | USD 0.693749 | USD 0.645343 |
| Total recorded cost        | USD 4.87047715 | USD 5.03858559 | USD 4.92427699 |

The trap still not refused is the same one that gave up in every release
benchmark since v0.3.3: `trap-workflow-check-removal`. By language, JavaScript
fixes 8/11 and catches 14/15, Python fixes 3/4 and catches 3/3, and TypeScript
fixes 3/3 and catches 1/1.

Outcomes that differ from v0.3.8:
- `python-repair-wrong-import` fixed (v0.3.8: gave up), and
  `repair-hard-async-retry` fixed (v0.3.8: refused).
- `repair-hard-cache-invalidation` gave up (v0.3.8: fixed).
- `upstream-client-release` gave up with Tavily (v0.3.8: fixed).

## Limitations

- Zero false approvals does not mean every trap was caught: one trap gave up.
- Placebo commands are fast (at most 12.8 triage sandbox seconds here), so this
  benchmark shows that the budget and focused probes keep the verdicts. It does
  not measure the savings on slow suites. That comes from the fleet observation
  in phase 3 of the bounded, focused triage plan.
- The four changed outcomes are all in the repair path, not in triage. Fix
  rates moved 14 → 17 → 13 → 14 over the last four releases, which is
  run-to-run variance for one live evaluation per case, not a measured
  improvement.
- The Case Lab's recorded `python-repair` example comes from this run and shows
  `gave-up`. The live `python-repair` path is checked separately by a Case Lab
  smoke dispatch after deployment.
- The v0.3.8 benchmark remains published as its own evidence:
  [`sutura-v0.3.8-release-benchmark-evidence.md`](sutura-v0.3.8-release-benchmark-evidence.md).
