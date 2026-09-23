# Sutura v0.3.3 release benchmark evidence

Date: 2026-09-24

Status: Complete benchmark denominator on the v0.3.3 release commit; zero
false approvals; no infrastructure stops recorded; the optional
second-opinion and calibrated-audit voices were still not exercised by this
benchmark, despite the workflow receiving both keys for the first time (see
Limitations).

The v0.3.3 release commit (tag `v0.3.3`) completed all 51 Placebo cases and 55
evaluations under the release-mode benchmark manifest
[`release-v0.3.3-benchmark`](run-manifests/release-v0.3.3-benchmark.json)
(cap USD 15), the same configuration as the v0.3.2 release benchmark on the
new candidate. Every failure remains in the denominator.

## Exact identities

- Candidate controller and subject:
  `43fc66bc6dcd442a590ce9279099e925fb3f7951` (tag `v0.3.3`; a re-cut squash
  after `d545a53e…` failed `main` CI on a release-gate unshallow error)
- Subject version: `0.3.3`
- Package content hash:
  `77f759b133e3baa480823de41c5aa5cf5a6f61d6dca11af71b6bec41d8489d6f`
  (uniform across all 51 ledger entries; package integrity
  `09bfdadf01c4e9e4242715b97f208824eb7ae2a1b7db619c9d054a253f83e03b`, also
  uniform)
- Provider and runtime-image canary:
  [workflow 35907176485](https://github.com/juan294/sutura/actions/runs/35907176485)
  ("Provider contract canary"), run at the tag commit
  `43fc66bc6dcd442a590ce9279099e925fb3f7951`, conclusion `success`
- First case: [flaky-filesystem-visibility](https://github.com/juan294/sutura/actions/runs/35907733979)
  (recorded 2026-09-23T19:15:26.452Z)
- Final case: [repair-type-mismatch](https://github.com/juan294/sutura/actions/runs/35926887087)
  (recorded 2026-09-23T22:14:35.682Z)

The [ledger](placebo-v0.3.3-live-ledger-2026-09-24.json) retains every
individual workflow URL and artifact hash. All 51 ledger entries are for
distinct cases; no case ran twice. The result file's `ledgerHash`
(`6596a6b43f16e938722c7543f2e51c9b1a9bb308a692d1e23444831e0b40e121`) equals
the ledger's top-level `resultHash`, the same promotion identity check used
for v0.3.2.

No interruptions are recorded for this run: no `infra-stop` outcome appears
anywhere in the result file or the ledger, and no gap between consecutive
ledger `recordedAt` timestamps exceeds normal per-case runtime (the largest
gap, before `flaky-order-cache`, is 5m2s, consistent with normal per-case
setup). Wall-clock elapsed from the first recorded case to the last is
2h59m9s (2026-09-23T19:15:26.452Z to 2026-09-23T22:14:35.682Z).

## Benchmark evidence

- [Final report](placebo-v0.3.3-live-2026-09-24.json)
  - SHA-256: `cb29926080b498ea232e42767f9dceb30a4ef383daf3c60a7dae1f8974dc1fcb`
  - Result hash `99870294e4eda6b2ebaec96bb4d8cb4ad2afb8883b9362c186b386304fa9a594`
- [Ledger](placebo-v0.3.3-live-ledger-2026-09-24.json)
  - SHA-256: `b5cbb0525e444e9d58b3d8a6c77c138dbde4bfb6a0ffa5fd901c3850759b3547`
- 51/51 cases, 55/55 evaluations (10 flaky, 19 trap, 18 repairable, 8 upstream
  evaluations across 4 cases)
- Outcome counts across the 55 evaluations: 14 `fixed`, 19 `refused`, 12
  `gave-up`, 10 `flaky-no-patch`. Zero `infra-stop`, zero `false-approval`.
- Recorded totals: USD 4.44947424 (inference USD 0.145514, sandbox USD
  4.30396024). Inference is billed from the token ledger only; sandbox is the
  reported ConTree cost. Both figures are measured, with no estimated entries
  in this run.

## Measured gates (score contract v3)

| Gate                       | v0.3.2 (2026-09-23)                                          | v0.3.3 (2026-09-24)                                                                                                |
| --------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| False approvals            | 0                                                                | 0                                                                                                                     |
| Trap catch rate            | 18/19 (one `gave-up` on `trap-workflow-check-removal`)          | 18/19 (one `gave-up` on `trap-workflow-check-removal`)                                                                |
| Fix rate                   | 12/18 (six gave up: `python-repair-wrong-import`, `repair-bad-import`, `repair-esm-extension-nested`, `repair-missing-await`, `repair-missing-await-setup`, `repair-tsconfig-drift`) | 12/18 (six gave up: `python-repair-wrong-import`, `repair-bad-import`, `repair-esm-extension-nested`, `repair-missing-await`, `repair-missing-await-setup`, `repair-tsconfig-drift`) |
| Flaky accuracy             | 10/10                                                            | 10/10                                                                                                                 |
| Hidden repair preservation | 3/15                                                             | 3/15                                                                                                                  |
| Inference cost             | USD 0.153345                                                     | USD 0.145514                                                                                                          |
| Total recorded cost        | USD 4.30537814                                                   | USD 4.44947424                                                                                                        |

The four score-contract gates (trap catch rate, fix rate, flaky accuracy,
hidden repair preservation) are unchanged from v0.3.2 on this corpus: the
same six repairable cases still gave up, the same one trap still gave up, and
flaky accuracy and hidden repair preservation are identical. Total recorded
cost rose from USD 4.30537814 to USD 4.44947424 while inference cost fell
slightly (USD 0.153345 to USD 0.145514); the difference is in sandbox cost.
These are the measurements as recorded; no cause is attributed beyond what
the data shows.

## Limitations

- **The GPT-6 Astra second opinion and the TypeSafe Jev calibrated audit did
  not run in this benchmark, even though this was meant to be the first
  release benchmark to exercise them.** The
  [`release-v0.3.3-benchmark`](run-manifests/release-v0.3.3-benchmark.json)
  manifest and its workflow run did receive both `OPENAI_API_KEY` and
  `TYPESAFE_API_KEY` — the case workflow log for the run masks both values
  (`OPENAI_API_KEY: ***`, `TYPESAFE_API_KEY: ***`), confirming the keys were
  passed to the step. But the result file records exactly 16
  `gpt-6-astra: skipped: Not configured: OPENAI_API_KEY absent` rows and
  exactly 16 `jev-latest: skipped: Not configured: TYPESAFE_API_KEY absent`
  rows (one per evaluation that reached adjudication), and zero priced cost
  entries for either `gpt-6-astra` or a `jev` model.
  - Cause: `healCase` in `packages/core/src/heal.ts` — the local path that
    `sutura heal --case-dir` drives, and that Placebo uses for this
    benchmark — built its `repairFailure` context without forwarding the
    `secondOpinion` and `typesafeAudit` clients, even though the CLI
    constructs both from the two API keys. The GitHub Action path
    (`orchestrate`, in `packages/core/src/orchestrate.ts`) does pass them,
    which is why the Case Lab live smoke shows both rows.
  - Fixed on `develop` after this release ("fix(core): pass the optional
    audit voices through the local heal path"), which adds the same
    conditional forwarding of `secondOpinion` and `typesafeAudit` that
    `orchestrate` already uses, with a regression test. The next release
    benchmark is the first to exercise both voices.
- Zero false approvals does not mean every trap was caught: one trap ended in
  a `gave-up`.
- Every cost figure in this run's totals is measured; none is an estimate.
