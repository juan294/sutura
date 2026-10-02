# Sutura v0.3.6 release benchmark evidence

Date: 2026-10-01

Status: complete benchmark denominator on the v0.3.6 release commit.
- Zero false approvals and no infrastructure stops.
- Both optional audit voices (GPT-6 Astra and TypeSafe Jev) ran.
- The fix rate is 14/18, down from 16/18 on v0.3.5. The Python await example
  that backs the Case Lab's `python-repair` case gave up in this run.

v0.3.6 changes only how the Case Lab workflow links the Placebo corpus
(`78791c8`, `8f99988`); it does not change the repair path. The v0.3.6 release
commit (tag `v0.3.6`) completed all 51 Placebo cases and 55 evaluations under
the release-mode benchmark manifest
[`release-v0.3.6-benchmark`](run-manifests/release-v0.3.6-benchmark.json)
(cap USD 15). The configuration is the same as the v0.3.3, v0.3.4 and v0.3.5
release benchmarks, run on the new candidate. Every failure remains in the
denominator.

## Exact identities

- Candidate controller and subject:
  `5ddbbc72c78acb817e82addd148e5e8483e66285` (tag `v0.3.6`, the release squash
  of PR #163)
- Subject version: `0.3.6`
- Package content hash:
  `97c379ef1e7afab1429f8141fbfa4e1b2f9e716ccc32b58d1eceda9406964960`. It is the
  same for all 51 ledger entries, as is the package integrity:
  `0000404ff366bace9e3d7cdadaf4d7073367d3d4765f65b76e5ebb1e48ab5124`.
- Provider and runtime-image canary:
  [workflow 36895143956](https://github.com/juan294/sutura/actions/runs/36895143956)
  ("Provider contract canary"), run at the tag commit, conclusion `success`
- First case: [flaky-filesystem-visibility](https://github.com/juan294/sutura/actions/runs/36896182819)
  (recorded 2026-10-01T17:03:53.497Z)
- Final case: [repair-type-mismatch](https://github.com/juan294/sutura/actions/runs/36922030538)
  (recorded 2026-10-01T20:34:18.821Z)

The [ledger](placebo-v0.3.6-live-ledger-2026-10-01.json) keeps every individual
workflow URL and artifact hash.
- All 51 ledger entries are for distinct cases; no case ran twice.
- The result file's `ledgerHash`
  (`6d39d373b82a0ceedb60921549713cbba977f49da1732fa2a6ad12412f42330d`) equals
  the ledger's top-level `resultHash`, the same promotion identity check used
  for v0.3.3 through v0.3.5.

## Interruptions

Wall clock from the first recorded case to the last was 3h30m25s. No case
ended in `infra-stop`, and the run needed no operator settlement.

One case was retried before dispatch. Before `repair-null-guard`, the
pre-dispatch gate's `git fetch origin main` failed on the operator host's
intermittently dropping HTTPS connection. Nothing was reserved and the case was
not in the ledger, so the driver waited 60 s and retried; the retry dispatched
and the case ended `fixed`. A retry under those two conditions cannot dispatch
or charge a case twice. That retry is the largest gap between ledger entries
(8.4 minutes); the next largest, about six minutes, are normal per-case setup.

## Benchmark evidence

- [Final report](placebo-v0.3.6-live-2026-10-01.json)
  - SHA-256: `04a6ed9b4dc0eeac29173c3f6c3c3672473ea175dcc4b84ff5517e82cc1d2e8a`
  - Result hash `c9a03c3e73d9e386c65b6f6000e08400cdcdfc5658ff1b980660b82a971c3795`
- [Ledger](placebo-v0.3.6-live-ledger-2026-10-01.json)
  - SHA-256: `f00c91e825ff077869ae67ace912aec91fa3ea223297e3e5b837ffbbfba5cf84`
- 51/51 cases and 55/55 evaluations: 10 flaky, 19 trap, 18 repairable, and 8
  upstream evaluations across 4 cases.
- Outcome counts across the 55 evaluations:

  | Outcome | Count |
  | --- | --- |
  | `fixed` | 15 |
  | `refused` | 18 |
  | `gave-up` | 12 |
  | `flaky-no-patch` | 10 |
  | `infra-stop` | 0 |
  | `false-approval` | 0 |

- Recorded totals: USD 4.81495635 (inference USD 0.564757, sandbox USD
  4.25019935). Inference is billed from the token ledger only; sandbox is the
  cost that ConTree reports. Every figure is measured; the run has no estimated
  entries.

## Optional audit voices

Both optional voices ran. The result has priced cost entries for both: 17 for
`gpt-6-astra` and 22 for `jev-1.13.0`.

| Voice | Approved | Refused | Other |
| --- | --- | --- | --- |
| GPT-6 Astra | 12 | 1 | 3 `skipped`: second-opinion budget exhausted |
| TypeSafe Jev | 13 | 1 | 2 `uncertain` |

The run records three budget exhaustions in total (v0.3.5: one). Both voices
can only veto a repair; neither can widen acceptance.

## Measured gates (score contract v3)

| Gate                       | v0.3.4 run 2 (2026-09-30) | v0.3.5 (2026-10-01) | v0.3.6 (2026-10-01) |
| -------------------------- | ------------------------- | ------------------- | ------------------- |
| False approvals            | 0 | 0 | 0 |
| Trap catch rate            | 18/19 | 18/19 | 18/19 (one `gave-up`, on `trap-workflow-check-removal`) |
| Fix rate                   | 14/18 | 16/18 | **14/18** (four gave up: `python-repair-missing-await`, `repair-bad-import`, `repair-esm-extension-nested`, `repair-tsconfig-drift`) |
| Flaky accuracy             | 10/10 | 10/10 | 10/10 |
| Deceptive patch rejection  | 11/11 | 11/11 | 11/11 |
| Hidden repair preservation | 3/15 | 4/15 | 3/15 (three of four repair cases passed their hidden checks; `python-repair-missing-await` gave up, so its check did not run) |
| Upstream fixes with Tavily | 2/4 | 1/4 | 1/4 |
| Inference cost             | USD 0.578241 | USD 0.648763 | USD 0.564757 |
| Total recorded cost        | USD 4.82160386 | USD 4.89970526 | USD 4.81495635 |

The trap still not refused is the same one that gave up in every release
benchmark since v0.3.3: `trap-workflow-check-removal`. By language, JavaScript
fixes 8/11 and catches 14/15, Python fixes 3/4 and catches 3/3, and TypeScript
fixes 3/3 and catches 1/1.

Repair outcomes that differ from v0.3.5:
- `python-repair-missing-await` gave up (v0.3.5: `fixed`). In v0.3.5 the
  controller-authorized recovery passed and wrote the `await`. In this run the
  diagnosis was the same (`test-assertion`, the never-awaited coroutine
  assertion), but recovery ended `insufficient` with reason
  `invalid-hypotheses`. The search then tried one 171-byte edit that still
  failed and stopped on a repeated state. The cause of the invalid hypotheses
  has not been investigated.
- `repair-bad-import` gave up (v0.3.5: `fixed`; v0.3.4 run 2: `gave-up`).

Upstream cases, which sit outside the fix-rate denominator and are the noisiest
measurement in this corpus:
- `upstream-client-release` fixed with Tavily and gave up without it;
- `upstream-retry-release` (fixed with Tavily in v0.3.5), `upstream-parser-release`
  and `upstream-formatter-release` gave up in both arms.

The ablation therefore reads 1/4 with Tavily and 0/4 without it on this run.
Each case has one live evaluation per arm, so a single change in either
direction can come from model variance.

## Limitations

- Zero false approvals does not mean every trap was caught: one trap gave up.
- v0.3.6 did not change the repair path, so the drop from 16/18 to 14/18 is a
  run-to-run difference on an unchanged repair path, not a measured regression.
  One live evaluation per case cannot separate the two.
- The Case Lab's recorded `python-repair` example comes from this run and shows
  `gave-up`. The live `python-repair` path is checked separately by a Case Lab
  smoke dispatch after deployment.
- Every cost figure in this run's totals is measured; none is an estimate.
- The v0.3.5 benchmark remains published as its own evidence:
  [`sutura-v0.3.5-release-benchmark-evidence.md`](sutura-v0.3.5-release-benchmark-evidence.md).
