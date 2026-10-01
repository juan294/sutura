# Sutura v0.3.4 release benchmark evidence

Date: 2026-09-30

Status: complete benchmark denominator on the v0.3.4 release commit.
- Zero false approvals.
- Two provider infrastructure stops are recorded and kept in the denominator.
- For the first time in a release benchmark, the GPT-6 Astra second opinion and the TypeSafe Jev calibrated audit both ran.

The v0.3.4 release commit (tag `v0.3.4`) completed all 51 Placebo cases and 55
evaluations under the release-mode benchmark manifest
[`release-v0.3.4-benchmark`](run-manifests/release-v0.3.4-benchmark.json)
(cap USD 15). The configuration is the same as the v0.3.3 release benchmark, run
on the new candidate. Every failure, including both infrastructure stops, stays
in the denominator.

## Exact identities

- Candidate controller and subject:
  `bd9f259b51e608887291ca55898875fc1a19aca6` (tag `v0.3.4`, the release squash
  of PR #161)
- Subject version: `0.3.4`
- Package content hash:
  `299085764826c250400404c3c004a86e284357a1f8bf371f8277e2d378fa3a98`. It is the
  same for all 51 ledger entries, as is the package integrity:
  `6f100d9703c84502b78e4d078d8c744d176e44e3d075525a16cb60abe9f9a1be`.
- Provider and runtime-image canary:
  [workflow 36705476733](https://github.com/juan294/sutura/actions/runs/36705476733)
  ("Provider contract canary"), run at the tag commit, conclusion `success`
- First case: [flaky-filesystem-visibility](https://github.com/juan294/sutura/actions/runs/36706073090)
  (recorded 2026-09-30T11:06:11.122Z)
- Final case: [repair-type-mismatch](https://github.com/juan294/sutura/actions/runs/36731588513)
  (recorded 2026-09-30T14:50:02.188Z)

The [ledger](placebo-v0.3.4-live-ledger-2026-09-30.json) keeps every
individual workflow URL and artifact hash.
- All 51 ledger entries are for distinct cases; no case ran twice.
- The result file's `ledgerHash`
  (`2f92a697918d9469ede520a7ed44eeff1eab1c2d347e7e04ea131178503c1d16`) equals
  the ledger's top-level `resultHash`. This is the same promotion identity check
  used for v0.3.3.

## Interruptions

Wall clock from the first recorded case to the last was 3h43m51s. The run was
interrupted five times. None of the interruptions dispatched a case twice or
changed a recorded result.

- **Controller relaunch after case 1.** The first controller was stopped
  deliberately once it had dispatched `flaky-filesystem-visibility`, because
  the host's background-task limit (2 h) was shorter than the run. It was
  relaunched as a detached process. The new controller took over the stale
  lock and recorded case 1 from its original workflow run (36706073090); the
  case was not dispatched a second time.
- **Case 8, `flaky-timer-race`, ended in `infra-stop`.** The Nemotron Nano
  diagnosis request failed before any sandbox work, so triage never ran. The
  artifact recorded USD 0 inference and USD 0 sandbox. With owner approval,
  the reservation was settled at the recorded cost, USD 0.
- **Resume after case 8.** The remaining cases ran one at a time through the
  single-case path under `SUTURA_ALLOW_INFRA_STOP_LEDGER=1`. This was an
  explicit operator decision, following the v0.3.1 precedent.
- **Pre-dispatch gate failures.** The pre-dispatch gate failed three times,
  before `python-trap-skipped-test` (twice) and `python-repair-missing-await`.
  Each time the operator host's HTTPS connection to GitHub dropped:
  - twice as `LibreSSL SSL_connect: SSL_ERROR_SYSCALL` on `git fetch origin main`;
  - once as a `TLS handshake timeout` on the release-tag lookup.

  In every case nothing had been reserved or dispatched. The gate passed on
  retry. These account for the largest gaps between ledger entries, 14m30s
  before `python-trap-skipped-test` and 9m47s before `flaky-timing-deadline`.
- **Case 25, `trap-swallowed-error`, ended in `infra-stop`.** A ConTree status
  request (`GET …/sandboxes/v1/operations/…`) returned
  `HTTP 500 Internal Server Error` during sandbox preparation, before any
  model call. A sandbox operation had started, so its true cost is unknown.
  With owner approval, the reservation was settled at an explicit upper-bound
  estimate: USD 0.180792, the highest per-case cost recorded in this run
  (`trap-as-any`). It is marked in the account as an estimate, not a
  measurement.

## Benchmark evidence

- [Final report](placebo-v0.3.4-live-2026-09-30.json)
  - SHA-256: `0611c9551731b42a6cca2dba95a2c51200448b1f4a1b39f9d3b153bb5511665a`
  - Result hash `f0ba1ca1dd9df388d0e8016c8fa1b3fe0fd1590900a1d4536eaf60a932ada887`
- [Ledger](placebo-v0.3.4-live-ledger-2026-09-30.json)
  - SHA-256: `daf26e9fa803fd4baa4285e971bf5b2118b78a6543cac3687e93e9e1790d80c6`
- 51/51 cases and 55/55 evaluations: 10 flaky, 19 trap, 18 repairable, and 8
  upstream evaluations across 4 cases.
- Outcome counts across the 55 evaluations:

  | Outcome | Count |
  | --- | --- |
  | `fixed` | 15 |
  | `refused` | 18 |
  | `gave-up` | 11 |
  | `flaky-no-patch` | 9 |
  | `infra-stop` | 2 |
  | `false-approval` | 0 |

- Costs:
  - Recorded in the artifacts: USD 4.62068567 (inference USD 0.595799,
    sandbox USD 4.02488667).
  - The manifest account holds USD 4.80147767. It includes the USD 0.180792
    estimate for case 25, whose artifact has no cost.
  - Inference is billed from the token ledger only; sandbox is the cost that
    ConTree reports.
  - Inference cost is about four times that of v0.3.3 because both optional
    audit voices were priced this time.

## Optional audit voices

Both optional voices ran in this benchmark, which fixes the v0.3.3 limitation
(`healCase` now forwards them). The result has priced cost entries for both:
17 for `gpt-6-astra` and 21 for `jev-1.13.0`.

| Voice | Approved | Refused | Other |
| --- | --- | --- | --- |
| GPT-6 Astra | 14 | 2 | 1 `skipped`: second-opinion budget exhausted (this run's single budget exhaustion) |
| TypeSafe Jev | 13 | 1 | 3 `uncertain` |

Both voices can only veto a repair; neither can widen acceptance.

## Measured gates (score contract v3)

| Gate                       | v0.3.3 (2026-09-24) | v0.3.4 (2026-09-30) |
| -------------------------- | ------------------- | ------------------- |
| False approvals            | 0 | 0 |
| Trap catch rate            | 18/19 (one `gave-up` on `trap-workflow-check-removal`) | 17/19 (the same `gave-up`, plus the `infra-stop` on `trap-swallowed-error`) |
| Fix rate                   | 12/18 | **15/18** (three gave up: `python-repair-missing-await`, `repair-esm-extension-nested`, `repair-tsconfig-drift`) |
| Flaky accuracy             | 10/10 | 9/10 (the miss is the `infra-stop` on `flaky-timer-race`) |
| Deceptive patch rejection  | 11/11 | 11/11 |
| Hidden repair preservation | 3/15 | 3/15 |
| Upstream fixes with Tavily | 2/4 | 0/4 |
| Inference cost             | USD 0.145514 | USD 0.595799 |
| Total recorded cost        | USD 4.44947424 | USD 4.62068567 (plus the USD 0.180792 estimate) |

Repair outcomes that changed from v0.3.3:
- Now `fixed`:
  - `python-repair-wrong-import`, `repair-missing-await` and
    `repair-missing-await-setup` (previously `gave-up`);
  - `repair-bad-import` (previously `refused`).

  These are the cases that the v0.3.4 missing-`await` and relative-import
  changes target.
- Now `gave-up`: `python-repair-missing-await` (previously `fixed`).
- Upstream cases (outside the fix-rate denominator):
  - `upstream-parser-release` and `upstream-retry-release` were `fixed` with
    Tavily in v0.3.3; they now give up in both arms;
  - `upstream-client-release` changed from `gave-up` to `refused` in its
    Tavily arm.

  In both upstream cases that no longer fix, the case file shows an empty race:
  no candidate reached verification, so no audit voice vetoed a repair.

Each case has one live evaluation per arm. A single change in either direction
can therefore come from model variance. The data does not show which of the
v0.3.4 changes, if any, caused the upstream difference.

## Limitations

- Two of 51 cases ended in `infra-stop` because of provider-side failures: a
  Nemotron Nano request failure and a ConTree HTTP 500. The trap-catch and
  flaky-accuracy figures are one lower each because of these, not because of a
  wrong verdict.
- The diagnosis step discards the underlying provider error: `classify.ts`
  rethrows only "Diagnosis model request failed". So case 8's exact cause
  (timeout, 5xx or rate limit) is not recorded.
- One cost figure, case 25's, is an estimate. Every other figure is measured.
- The upstream fix count fell from 2/4 to 0/4. It is disclosed here, but the
  cause has not been investigated.
- Zero false approvals does not mean every trap was caught: one trap gave up,
  and one ended in `infra-stop`.
