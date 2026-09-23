# Phase 4: Fleet loose ends — kalpha push, paisaxe `main`

`[batch-eligible]` with phase 1 — touches no file in this repository and no file
in common with phase 1.

**Needs authorization: a pull request against `juan294/paisaxe` `main`.**

## Goal

Finish the 2026-09-22 rollout for the two repositories it did not reach.

## 4a. kalpha — push the committed fix

### Current state (VERIFIED)

`develop` is ahead 4 / behind 8. Local commit `35b8f99`
(`chore(ci): pin Sutura to v0.3.1 and declare the python runtime`) is unpushed.
A plain `git pull --rebase` conflicts inside **Juan's own** commit
`dc5dc4d chore(agents): update reports 2026-09-16`, which touches
`docs/agents/{cc-rpi-update,cost-analyst,coverage,qa}-report.md` while
`origin/develop` has three `chore(coverage): nightly coverage report` commits
touching the same generated files.

### Change

Do not resolve Juan's report commits. Take only the Sutura commit to a branch
based on the current `origin/develop`:

```bash
git -C /Users/juan/code/kalpha fetch origin
git -C /Users/juan/code/kalpha switch -c chore/sutura-v0.3.1 origin/develop
git -C /Users/juan/code/kalpha cherry-pick 35b8f99
git -C /Users/juan/code/kalpha push -u origin chore/sutura-v0.3.1
```

Then either fast-forward `develop` to it (if that is clean) or open a PR. Leave
Juan's three agent-report commits on his local `develop` untouched — they are
his to rebase.

### Verify

```bash
gh api repos/juan294/kalpha/contents/.sutura.json?ref=develop --jq '.content' | base64 -d
gh api repos/juan294/kalpha/contents/.github/workflows/sutura.yml?ref=develop --jq '.content' | base64 -d | grep 'uses: juan294/sutura@'
```

Expect `"runtime": "python"` (kalpha is `pyproject.toml` + `uv.lock` at root
with a nested `design-system/package.json` — the polyglot shape that made
auto-detection expensive) and the `e724f3b2 # v0.3.1` pin.

## 4b. paisaxe — a targeted PR against `main`

### Current state (VERIFIED)

**All 22 paisaxe monitor runs, including all 8 failures, are on `main`.** Its
default branch is `main`; `develop` is **554 commits ahead**. The 2026-09-22
commit `89bc25da` went to `develop`, so **neither** half of the fix reaches
paisaxe: `workflow_run` loads the workflow from the default branch, and the
policy is read at `run.baseSha` (`orchestrate.ts:578`), which is `main`.

This corrects an earlier claim that the policy half was probably already
effective there. It is not.

### Change

A two-file PR against `main`, not a 554-commit merge:

```bash
git -C /Users/juan/code/paisaxe fetch origin
git -C /Users/juan/code/paisaxe switch -c chore/sutura-v0.3.1-main origin/main
# .sutura.json  -> {"version": 1, "runtime": "node"}
# .github/workflows/sutura.yml -> pin juan294/sutura@e724f3b2… # v0.3.1
git -C /Users/juan/code/paisaxe push -u origin chore/sutura-v0.3.1-main
gh pr create -R juan294/paisaxe --base main --title "chore(ci): pin Sutura to v0.3.1 and declare the node runtime" --body "…"
```

The PR body should state the measured reason: 8 of paisaxe's monitor runs died
on `Runtime evidence exceeds 500 entries`, all on `main`, and link
`docs/research/2026-09-22-fleet-dogfood-metrics.md`.

**Leave the PR for human review — do not merge it.**

### Verify after merge (whenever that happens)

```bash
gh api repos/juan294/paisaxe/contents/.sutura.json?ref=main --jq '.content' | base64 -d
```

## Explicitly out of scope

- `layalga` and `spoken-letter`: under code freeze. Their commits
  (`17ef6c7`, `51b2205`) stay on local `develop`. **No push, no PR.** Re-confirm
  with Juan before touching either remote — the freeze membership has already
  changed once.
- `frivas/roots`: third-party. Its working tree was reverted clean on
  2026-09-22 and it keeps the v0.2.1 pin. Note that frivas already sets
  `runtime: node` as an action input there, which is why roots never hit the
  runtime gate.

## Done when

kalpha's `develop` carries the pin and policy on the remote; paisaxe has an open
PR against `main`; layalga, spoken-letter and roots are untouched. STOP.
