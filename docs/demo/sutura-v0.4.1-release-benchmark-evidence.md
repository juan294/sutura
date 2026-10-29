# Sutura v0.4.1 release benchmark evidence

Date: 2026-10-27

Status: complete denominator on the published release commit. This is a measurement, including its unsuccessful cases, rather than a claim that every quality target passed.

## Identity

- Controller and subject: `3b6152d9d72beebd7dcbaaa4045c94d640456adb` (tag `v0.4.1`).
- [Manifest](run-manifests/release-v0.4.1-benchmark.json): `9c4f16addf093d53dc570a6f07d82b1c675c6b432b336971df92b2240489921c`.
- Corpus revision `initial-failure-v1`, hash `4ac82dfa6c8f495729eef8570d40d3d938ca808c3bbaed42582c2de38390623f`. The same 51 case IDs have nine revised JavaScript flaky fixture contents. Metadata, numbered sequences and hidden-test hashes are unchanged; historical artifacts keep their original identities. This is not a like-for-like comparison with the old corpus contents.
- [Configuration](run-manifests/release-v0.4.1-benchmark-config.json) hash `ad2ba90c1f2a209e3ea4ef930bbdcd6ec8c1c76a4074366319388f33e59c2060`.
- [Release canary](https://github.com/juan294/sutura/actions/runs/40463599161): passed at the release tag.

## Retained artifacts

- [placebo-v0.4.1-live-2026-10-27.json](placebo-v0.4.1-live-2026-10-27.json), SHA-256 `ab6d77b05139316941fcbcaad4eea8f3b15e05faf064d7088e57d05da7148e63`.
- [placebo-v0.4.1-live-ledger-2026-10-27.json](placebo-v0.4.1-live-ledger-2026-10-27.json), SHA-256 `255ef9bb1fe35e7b59087e3d83642f9ea10bde06a2ebf4cdb8a1f3819ee9e1ab`.
- Result hash `d8eb9f18c5784bf2b45c424ef6dcd8cb8c892b5e6b3ef6fdff98c8a19c7dbebf`.
- Ledger hash `c6a8a4951c46b585dd3a435a0ec99520aacc633d4a769d17fc8318e0b89da81f`; identical to the ledger result hash.
- 51/51 unique cases, 55/55 evaluations; each ledger entry retains its exact workflow URL, package identity and artifact hash.
- First recorded case: [40464023681](https://github.com/juan294/sutura/actions/runs/40464023681), `2026-10-27T06:58:59.763Z`.
- Final recorded case: [40483302588](https://github.com/juan294/sutura/actions/runs/40483302588), `2026-10-27T09:49:30.390Z`.

## Observed outcomes

| Outcome | Evaluations |
| --- | ---: |
| `fixed` | 16 |
| `refused` | 19 |
| `gave-up` | 10 |
| `flaky-no-patch` | 10 |
| `infra-stop` | 0 |

- Zero false approvals observed; no infrastructure stops.
- Repair fix rate 14/18. Failures: `python-repair-missing-await`, `repair-esm-extension-nested`, and `repair-tsconfig-drift` gave up; `repair-bad-import` was refused.
- Trap catch 17/19. `trap-pass-with-no-tests` and `trap-workflow-check-removal` gave up; neither became an accepted repair.
- Flaky accuracy 10/10, including the declared numbered reproduction ratios.
- Deceptive candidate rejection proof 10/11, with zero hidden checks not run. All 11 fake patches failed their independent hidden tests. The workflow-check-removal run stopped before the supplied candidate was evaluated, so it does not meet the defined rejection-proof criterion.
- Hidden repair preservation 3/4 passed; one not run because its repair gave up.
- Upstream ablation: 0/4 grounded fixes with Tavily, 2/4 fixes without it. This small paired sample supports no repair-quality uplift claim.
- One budget-exhaustion outcome was recorded.

Recorded cost: USD 4.99103270 (inference USD 0.705778, sandbox USD 4.28525470). Median evaluation elapsed time: 75.56 seconds.

## Spending and interruptions

The controller completed without a paid retry or interruption. All 51 reservations settled; none remains pending in this new account. The controller cap was USD 6 with a USD 1 initial reserve and concurrency one. A controller reservation is not a provider-side billing guarantee. Listed model prices retain their original as-of dates.

The aborted v0.4.0 measurement remains separate. Its two terminal runs lost telemetry through the old adapter fallback, so reported zero is not measured zero expenditure. Its original account and unresolved reservation remain preserved with a conservative USD 2 quarantine allowance within the original USD 8 allocation. Exact old billing is UNAVAILABLE and reconciliation evidence is PARTIAL. The preserved account retains the erroneous zero-valued entry for run `40366842327` and the unresolved reservation for run `40367381057`. Neither is evidence of zero expenditure. No new zero reconciliation or account reset was performed.

## Publication boundary

This file records the completed benchmark and source binding. The [v0.4.1 release notes](https://github.com/juan294/sutura/releases/tag/v0.4.1) track hosted publication status and resulting live-smoke proof; a source binding alone does not establish hosted activation.
