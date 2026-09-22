# Fleet dogfood metrics — 2026-09-22

Measurement of every repository that installs the Sutura Action, covering the
whole install window (first trigger 2026-09-06 in `sutura`, 2026-09-13
everywhere else) through 2026-09-22.

All numbers below are read from the GitHub Actions API and from the job logs of
every non-skipped monitor run (76 runs). Method and commands are in
[Method](#method) so the sweep can be repeated.

## Inventory

18 repositories install `.github/workflows/sutura.yml`. 14 of them are the
projects the archy portfolio watchdog scans
(`archy/scripts/agent-config.json` → `agents.portfolio_watchdog_agent_enabled.config.project_dirs`);
the other four (`archy`, `cc-rpi`, `cirujano`, `spoken-letter-alexa`) install
the Action without being watchdog-monitored.

Before 2026-09-22 all 17 consumers pinned `juan294/sutura@5fe1649` (**v0.2.1**,
two releases stale) and **no repository shipped a `.sutura.json`**, so every run
used the default policy (`policy-sha=default` in the run logs).

## Outcomes

`triggers` counts every monitor run; `red` counts the runs where CI actually
failed and Sutura attempted work (the rest are skipped no-ops on green CI).
`gated` means the run stopped at a fail-closed gate before diagnosis.

| Repo | triggers | red | fixed | gave-up | infra-stop | gated | sandbox USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| juan294/chapa | 1 | 0 | 0 | 0 | 0 | 0 | 0.00 |
| juan294/chapa-cli | 6 | 0 | 0 | 0 | 0 | 0 | 0.00 |
| juan294/clarity | 8 | 3 | 0 | 0 | 0 | 3 | 0.00 |
| juan294/coach | 13 | 8 | 0 | 0 | 7 | 1 | 1.19 |
| juan294/gh-glance | 28 | 11 | 0 | 0 | 0 | 11 | 0.00 |
| juan294/kalpha | 7 | 2 | 0 | 0 | 0 | 2 | 0.00 |
| juan294/layalga | 19 | 5 | 0 | 0 | 0 | 5 | 0.00 |
| juan294/paisaxe | 21 | 9 | 0 | 0 | 0 | 9 | 0.00 |
| juan294/portfolio | 35 | 9 | 0 | 0 | 0 | 9 | 0.00 |
| frivas/roots | 35 | 6 | 0 | 0 | 5 | 1 | 0.24 |
| juan294/spoken-letter | 4 | 3 | 0 | 0 | 0 | 3 | 0.00 |
| juan294/summon | 20 | 0 | 0 | 0 | 0 | 0 | 0.00 |
| juan294/termplex | 11 | 0 | 0 | 0 | 0 | 0 | 0.00 |
| juan294/cc-rpi | 1 | 0 | 0 | 0 | 0 | 0 | 0.00 |
| juan294/cirujano | 36 | 5 | 0 | 4 | 0 | 1 | 0.66 |
| juan294/spoken-letter-alexa | 4 | 1 | 0 | 0 | 0 | 1 | 0.00 |
| juan294/archy | 21 | 7 | 0 | 0 | 0 | 7 | 0.00 |
| juan294/sutura | 100 | 7 | 0 | 4 | 0 | 3 | 1.47 |
| **Total** | **370** | **76** | **0** | **8** | **12** | **56** | **3.57** |

**No repository has produced a verified repair in the measured window.** Of 76
red-CI attempts: 56 stopped at a fail-closed gate, 12 stopped as `infra-stop`,
8 reached `gave-up`. Total sandbox spend was $3.57.

Two measurement traps worth keeping:

- **A green monitor job does not mean a repair.** 17 runs concluded `success`;
  12 of those were `outcome=infra-stop` (sandbox preparation failed before
  reproduction) and 4 were `gave-up`. Read the `Sutura outcome:` log line, not
  the job conclusion.
- **`sutura/fix-*` pull requests exist only in `juan294/sutura`** (11, all from
  dogfood and demo runs). No consumer repository has received one.

## Why runs stop

Distribution of the terminating error across the 76 red-CI runs:

| Terminating error | Runs | Repos affected |
| --- | ---: | --- |
| `Runtime evidence exceeds 500 entries; set runtime in .sutura.json` | 34 | portfolio 9, paisaxe 8, archy 6, spoken-letter 3, clarity 3, kalpha 2, layalga 1, coach 1, spoken-letter-alexa 1 |
| `Failed-step logs do not contain an observed failing command` | 17 | gh-glance 10, layalga 4, sutura 1, cirujano 1, archy 1 |
| `Sutura required fixed but produced gave-up` | 4 | sutura 4 |
| `Workflow run head branch no longer matches the failing SHA` | 2 | sutura 1, gh-glance 1 |
| `Sutura required fixed but produced already-attempted` | 1 | sutura 1 |
| `ConTree POST …/sandboxes/v1/instances failed with HTTP 504` | 1 | roots 1 |

### Cause 1 — runtime detection scan cap (34 runs, fixed 2026-09-22)

`detectRuntime` walks the repository tree and fails closed once it passes
`MAX_RUNTIME_EVIDENCE_ENTRIES` (500) directory entries
(`packages/core/src/runtime/detect.ts:155`). Every consumer relied on `auto`
detection with no policy file, so large repositories tripped the cap.

Setting `runtime` in `.sutura.json` short-circuits the scan before it starts
(`packages/core/src/runtime/detect.ts:183`, reached from
`packages/core/src/heal.ts:1648` via `ctx.runtimeId ?? ctx.policy?.runtime`).
The Action's `runtime:` input covers only the heal path; the replay-capture path
reads the runtime exclusively from `.sutura.json`
(`packages/action/src/replay-repository.ts:92`), which is why the policy file is
the correct fix rather than the workflow input.

### Cause 2 — failing command lost to the bounded tail (17 runs, open)

`classifyMechanically` reads only a bounded **tail** of the failed-step log —
`finalLines(log, MAX_LOG_LINES)` with `maxLines: 200`, `maxCharacters: 20_000`
and `maxBytes: 20_000` (`packages/core/src/diagnose/classify.ts:12-33`). The
`Run <command>` header that `failingCommand` looks for
(`packages/core/src/diagnose/classify.ts:49`) is **head-anchored**: it is the
first line the step emits. Any failing step whose output exceeds the tail window
loses its own header, `failingCmd` becomes `'unknown'`, and the run dies at the
gate in `packages/core/src/orchestrate.ts:602`.

Reproduced against the real log of `juan294/gh-glance` job 106473097216
(monitor run 35644619036): the failing step `Run npm run test:pty` emits 877
lines, with the header on the step's first line.

| Input to `classifyMechanically` | `failingCmd` |
| --- | --- |
| full 877-line step log | `unknown` |
| header + last 399 lines | `unknown` |
| header + last 199 lines | `unknown` |
| header + last 49 lines | `npm run test:pty` |

The binding constraint is the 20 KB byte cap, not the 200-line cap: the header
survives only once the tail is small enough that the whole excerpt fits under
`MAX_LOG_BYTES`. This is why verbose suites (gh-glance's PTY tests, layalga)
fail consistently while quieter ones do not — it scales with step output size,
not with repository or failure kind.

A fix must carry the command header separately from the bounded tail rather than
hoping it survives truncation — for example, extracting it from the head of the
step log in `collectFailedLogs` (`packages/core/src/orchestrate.ts:282`) and
prepending it to the excerpt the classifier sees.

## Method

```bash
# Per-repo run inventory (conclusions, durations, repair PRs)
gh api "repos/<owner>/<repo>/actions/workflows/sutura.yml/runs?per_page=100"
gh api "repos/<owner>/<repo>/pulls?state=all&per_page=100"   # head.ref ~ ^sutura/fix-

# Real outcome per non-skipped run — job conclusion is not the outcome
gh run view <run-id> -R <owner>/<repo> --log | grep "Sutura outcome:"
gh run view <run-id> -R <owner>/<repo> --log | grep '##\[error\]'
gh run view <run-id> -R <owner>/<repo> --log | grep "sandbox cost USD="
```

Counts cover at most the 100 most recent runs per workflow; only `juan294/sutura`
(exactly 100) may be clipped by that page size.

## Limitations

- Zero verified repairs means the fleet has produced **no evidence of repair
  quality** — these numbers measure reachability of the repair path, not its
  success rate once reached.
- The `.sutura.json` fix is verified by code path and by parsing every new file
  with `parseRepositoryPolicy`; it has **not** yet been observed clearing the
  gate in a live CI run. First red CI in any consumer will confirm it.
- `frivas/roots` is third-party; its secrets and variables are not readable from
  this account, so its configuration is inferred from run behaviour alone.
