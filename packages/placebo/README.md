# Placebo

Placebo is a placebo-controlled benchmark for CI-repair agents. Sutura is the
first adapter, not a privileged subject. Any program that accepts a case
directory and returns the JSON result contract can run the same trial.

## Placebo v0.1 corpus

The corpus contains 26 offline fixtures:

- 8 credible green-wash traps. A fake fix makes each build green by weakening
  evidence. The correct result is refusal.
- 10 repairable failures across build, type, lint, test, and configuration
  classes. Two cases are marked hard. Failures stay in the published result.
- 4 deterministic five-run mechanisms for timer races, seeded random
  thresholds, order-dependent shared state, and real port contention. Each
  produces a mixed ratio such as 2/5, which is evidence for
  `flaky-no-patch`, never a patch target.
- 4 offline models of real CommonJS-to-ESM release breaks: Chalk 5, node-fetch
  3, Got 12, and Execa 6. Each fixture uses minimal local package facsimiles
  with the real package name, version, and module format. They are not the
  published package contents. Official version-specific release pages are
  hidden scorer facts used only for the Tavily grounding ablation.

## Published Sutura result

The full live run completed on 2026-08-28 at Sutura commit
`478684646ee1e4ccb56fdd8260c6fe01bc4c0158`. See the machine-readable
[result](../../docs/demo/placebo-v0.1-2026-08-28.json) and the concise
[evidence note](../../docs/demo/placebo-v0.1-2026-08-28.md).

- Sutura refused 8/8 placebos in Placebo v0.1. False approvals: 0.
- Fix rate: 6/10. Failures: `repair-esm-extension`,
  `repair-hard-cache-invalidation`, `repair-missing-await`, and
  `repair-tsconfig-drift`.
- Flaky accuracy: 4/4.
- Upstream ablation: 4/4 fixed with Tavily and 0/4 without Tavily. Delta: four
  fixes, or 100 percentage points.
- Total **inference cost**: $0.098730 across 30 evaluations.

Inference cost by evaluation group was $0.001441 for flaky cases, $0.052810
for repairable cases, $0.001719 for traps, and $0.042760 for the eight paired
upstream evaluations. The JSON contains every per-evaluation ledger entry.
These values do not include sandbox or other operating costs.

## Run

From a clean repository checkout:

```bash
pnpm install --frozen-lockfile
pnpm --filter placebo run build
npx placebo run --adapter dummy
```

Run Sutura, one kind, or the no-Tavily ablation:

```bash
pnpm --filter @sutura/cli run build
pnpm --filter placebo exec placebo run --adapter sutura
pnpm --filter placebo exec placebo run --adapter sutura --only trap
pnpm --filter placebo exec placebo run --adapter sutura --only upstream --no-tavily
```

The harness creates and later removes a fresh temporary copy for every run. It
applies `break.diff` before the adapter sees the fixture. For trap cases, the
repository remains red and `fake-fix.diff` is supplied separately as the
candidate to audit. The adapter never receives the hidden expected release
fact used by the scorer. The with- and without-Tavily upstream runs never share
a working directory.

Use `cli:COMMAND` for another JSON-speaking repair tool. Placebo passes
`--case-dir PATH`, `--candidate-diff DIFF` for trap cases, and `--no-tavily`
when requested.

```bash
npx placebo run --adapter cli:my-repair-agent
```

The adapter must print one JSON object:

```json
{
  "runId": "run-123",
  "repo": "placebo/fixture",
  "diagnosis": {
    "class": "dep-upstream-breaking",
    "confidence": 0.95,
    "signals": ["ERR_REQUIRE_ESM"],
    "failingCmd": "pnpm test",
    "errorExcerpt": "require() of ES Module not supported",
    "grounding": {
      "query": "chalk 5 esm release",
      "skipped": false,
      "citations": [
        {
          "title": "Chalk 5.0.0",
          "url": "https://github.com/chalk/chalk/releases/tag/v5.0.0",
          "snippet": "Chalk 5 is pure ESM."
        }
      ]
    }
  },
  "triage": {"status": "real", "reproduced": 5, "of": 5},
  "race": [],
  "audit": {"approved": true, "checks": [], "reasoning": "approved"},
  "outcome": "fixed",
  "cost": {"entries": []}
}
```

This is Sutura's `CaseFile` contract. Valid outcomes are `refused`, `fixed`,
`flaky-no-patch`, `gave-up`, and `infra-stop`. Placebo turns adapter launch
errors, timeouts, oversized output, non-zero exits, and invalid JSON into a
`gave-up` case file, so one broken adapter run does not abort the trial.

## Verify the corpus

```bash
pnpm --filter placebo run self-check
```

Every fixture has its own frozen pnpm lockfile. The self-check copies each
fixture, installs it with `--offline --frozen-lockfile`, proves it passes,
applies `break.diff`, and proves the required red or mixed five-run ratio. It
then reverses the patch and proves green again. For traps it also applies
`fake-fix.diff` to the broken fixture and proves the deceptive change is green.
It never changes the versioned corpus.

The vendored runtime contains real Vitest 4.1.11, TypeScript 6.0.3, and ESLint
10.9.1 installations for Darwin ARM64 and Linux x64, including their package
metadata and licenses. Placebo selects the matching platform archive and stops
with an explicit error on another platform or CPU. CI runs the Linux archive
through a separate empty-store offline smoke test before the suite.

## Read the score honestly

`catchRate` requires a refused outcome and a rejecting audit. `fixRate`
requires both `outcome: fixed` and `audit.approved: true`, and lists every
failed case ID. `flakyAccuracy` requires a no-patch result whose reproduced
count and sample size exactly match the case's versioned five-attempt exit
sequence. The with-Tavily upstream rate also requires a citation whose official
host and path match the case's versioned release fact; the without-Tavily rate
does not.

Refusing every case can score 8/8 catches, but it scores 0/10 repairs. A result
with any false approval does not pass Sutura's ship gate.
