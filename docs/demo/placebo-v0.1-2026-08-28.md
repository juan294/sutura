# Placebo v0.1 live evidence

Run date: 2026-08-28

Sutura commit: `478684646ee1e4ccb56fdd8260c6fe01bc4c0158`

Raw result: [`placebo-v0.1-2026-08-28.json`](placebo-v0.1-2026-08-28.json)

SHA-256: `dd050f2df5630a53218e7d395a8e671f4d8bf20a42c29dc7af5348ad943f7f87`

## Score

| Measure | Result |
| --- | ---: |
| Placebos refused | 8/8 |
| False approvals | 0 |
| Repairable cases fixed | 6/10 |
| Flaky cases identified without a patch | 4/4 |
| Upstream cases fixed with Tavily | 4/4 |
| Upstream cases fixed without Tavily | 0/4 |
| Tavily ablation delta | 4 fixes, 100 percentage points |
| Total inference cost | $0.098730 |

The failed repairable cases were `repair-esm-extension`,
`repair-hard-cache-invalidation`, `repair-missing-await`, and
`repair-tsconfig-drift`. They remain in the denominator.

## Inference cost

| Evaluation group | Evaluations | Inference cost |
| --- | ---: | ---: |
| Flaky | 4 | $0.001441 |
| Repairable | 10 | $0.052810 |
| Trap | 8 | $0.001719 |
| Upstream, paired with and without Tavily | 8 | $0.042760 |
| Total | 30 | $0.098730 |

These values are model inference cost from the result ledger. They do not
include sandbox or other operating costs.

## Grounding checks

Each Tavily-enabled upstream fix included the scorer's exact official release
or upgrade-guide URL:

- Got 12.0.0: `https://github.com/sindresorhus/got/releases/tag/v12.0.0`
- Chalk 5.0.0: `https://github.com/chalk/chalk/releases/tag/v5.0.0`
- node-fetch v3: `https://github.com/node-fetch/node-fetch/blob/main/docs/v3-UPGRADE-GUIDE.md`
- Execa 6.0.0: `https://github.com/sindresorhus/execa/releases/tag/v6.0.0`

All four paired no-Tavily evaluations gave up after diagnosis. They did not
run repair or audit inference.

## Reproduction

From the exact Sutura commit, with the documented live credentials configured:

```bash
pnpm --filter placebo exec placebo run --adapter sutura
```

The committed JSON is the direct standard output from that command. It has 30
results because the four upstream fixtures run once with Tavily and once
without it. The corpus itself contains 26 fixtures.
