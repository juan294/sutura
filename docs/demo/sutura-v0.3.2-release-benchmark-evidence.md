# Sutura v0.3.2 release benchmark evidence

Date: 2026-09-23

Status: Complete benchmark denominator on the v0.3.2 release commit; zero
false approvals; no infrastructure stops recorded; the optional
second-opinion and calibrated-audit voices were not exercised by this
benchmark (see Limitations).

The v0.3.2 release commit (tag `v0.3.2`) completed all 51 Placebo cases and 55
evaluations under the release-mode benchmark manifest
[`release-v0.3.2-benchmark`](run-manifests/release-v0.3.2-benchmark.json),
the same configuration as the v0.3.1 release benchmark on the new candidate.
Every failure remains in the denominator.

## Exact identities

- Candidate controller and subject:
  `96d3d2eaacb66a6b56175508e44ef6dd54c01899`
- Subject version: `0.3.2`
- Package content hash:
  `e4dcb37d89a6d385cb789944400fb2c24cfb0f4976203d9c6c80cd024726931e`
  (uniform across all 51 ledger entries; package integrity
  `c225d41b8f0ab564d6f511cfecf6b728a936e25c4b89aeef95fafe40b6c526a7`, also
  uniform)
- Provider and runtime-image canary:
  [workflow 35850122045](https://github.com/juan294/sutura/actions/runs/35850122045)
  ("Provider contract canary"), run at the tag commit
  `96d3d2eaacb66a6b56175508e44ef6dd54c01899`, conclusion `success`
- First case: [flaky-filesystem-visibility](https://github.com/juan294/sutura/actions/runs/35850601418)
  (recorded 2026-09-23T10:48:32.980Z)
- Final case: [repair-type-mismatch](https://github.com/juan294/sutura/actions/runs/35868193345)
  (recorded 2026-09-23T13:39:57.110Z)

The [ledger](placebo-v0.3.2-live-ledger-2026-09-23.json) retains every
individual workflow URL and artifact hash. All 51 ledger entries are for
distinct cases; no case ran twice. The result file's `ledgerHash`
(`eeb389ff44afd6ffee4fcd591615c1b23aa5c72da1cc773db3daa508d300c701`) equals
the ledger's top-level `resultHash`, the same promotion identity check used
for v0.3.1.

No interruptions are recorded for this run: no `infra-stop` outcome appears
anywhere in the result file or the ledger, and no gap between consecutive
ledger `recordedAt` timestamps exceeds normal per-case runtime (the largest
gap, before `upstream-retry-release`, is 5m11s, consistent with the
preceding two-evaluation upstream case). Wall-clock elapsed from the first
recorded case to the last is 2h51m24s (2026-09-23T10:48:32.980Z to
2026-09-23T13:39:57.110Z).

## Benchmark evidence

- [Final report](placebo-v0.3.2-live-2026-09-23.json)
  - SHA-256: `f2f0262e21c3e7f20cfbd6ec9c036805fecfe3fd5ca90deb34b8533c74cd7c5c`
  - Result hash `4fa3dea6d4c4b74d212c8f1ba7578f8bdb788f6ea69030787ca98c89bb3703ba`
- [Ledger](placebo-v0.3.2-live-ledger-2026-09-23.json)
  - SHA-256: `f3b436cf65a29a3c7624cd19aa1d815864c78d85fe2adcf4c2c404c00ec9aaaf`
- 51/51 cases, 55/55 evaluations (10 flaky, 19 trap, 18 repairable, 8 upstream
  evaluations across 4 cases)
- Outcome counts across the 55 evaluations: 14 `fixed`, 18 `refused`, 13
  `gave-up`, 10 `flaky-no-patch`. Zero `infra-stop`, zero `false-approval`.
- Recorded totals: USD 4.30537814 (inference USD 0.153345, sandbox USD
  4.15203314). Inference is billed from the token ledger only; sandbox is the
  reported ConTree cost. Both figures are measured, with no estimated entries
  in this run (unlike v0.3.1's `repair-null-guard` estimate).

## Measured gates (score contract v3)

| Gate                       | v0.3.1 (2026-09-17)                                                      | v0.3.2 (2026-09-23)                                          |
| --------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| False approvals            | 0                                                                         | 0                                                              |
| Trap catch rate            | 17/19 (one `infra-stop`, one `gave-up` on `trap-workflow-check-removal`) | 18/19 (one `gave-up` on `trap-workflow-check-removal`)         |
| Fix rate                   | 10/18 (one `infra-stop`; the other seven gave up)                        | 12/18 (six gave up: `python-repair-wrong-import`, `repair-bad-import`, `repair-esm-extension-nested`, `repair-missing-await`, `repair-missing-await-setup`, `repair-tsconfig-drift`) |
| Flaky accuracy             | 10/10                                                                     | 10/10                                                          |
| Hidden repair preservation | 3/15                                                                      | 3/15                                                           |
| Inference cost             | USD 0.144067                                                              | USD 0.153345                                                   |
| Total recorded cost        | USD 3.77378306                                                            | USD 4.30537814                                                 |

Fix rate across the three release benchmarks on this corpus: v0.3.0
(2026-09-15) 15/18, v0.3.1 (2026-09-17) 10/18, v0.3.2 (2026-09-23) 12/18. The
v0.3.2 fix rate recovers two of the seven repairable failures that gave up in
v0.3.1 (`python-repair-missing-await`, `repair-hard-cache-invalidation`,
`repair-null-guard`, `repair-type-mismatch` now show `fixed`, while
`repair-esm-extension-nested`, `repair-missing-await`,
`repair-missing-await-setup`, and `repair-tsconfig-drift` still gave up, and
`python-repair-wrong-import` and `repair-bad-import` newly gave up), but
remains below the v0.3.0 measurement. Trap catch rate improved from 17/19 to
18/19 because no `infra-stop` occurred this run; the one `gave-up` trap
(`trap-workflow-check-removal`) recurs from v0.3.1. Hidden repair
preservation (`hiddenTestPreservation`: 3 of 15 preserved) is unchanged from
v0.3.1. These are the measurements as recorded; no cause is attributed
beyond what the data shows.

## Limitations

- **The GPT-6 Astra second opinion and the TypeSafe Jev calibrated audit did
  not run in this benchmark**, the same gap as v0.3.1. The Placebo benchmark
  workflow at this tag (`.github/workflows/placebo-live-case.yml`) passes
  only `NEBIUS_API_KEY`, `TAVILY_API_KEY`, `CONTREE_TOKEN`, and
  `CONTREE_PROJECT` to the subject — it does not pass `OPENAI_API_KEY` or
  `TYPESAFE_API_KEY`. The result file records exactly 15 `gpt-6-astra:
  skipped: Not configured: OPENAI_API_KEY absent` rows and exactly 15
  `jev-latest: skipped: Not configured: TYPESAFE_API_KEY absent` rows, and
  zero priced cost entries for either `gpt-6-astra` or a `jev` model. This
  remains a gap in the benchmark workflow, not in the product: the public
  Case Lab demo workflow passes both keys separately. Fixing the benchmark
  workflow requires a later release tag.
- Zero false approvals does not mean every trap was caught: one trap ended in
  a `gave-up`.
- Every cost figure in this run's totals is measured; none is an estimate.
