# Phase 1: Prove the runtime fix with a real red CI in termplex

`[batch-eligible]` with phase 4 — touches no file in this repository.

**Needs authorization: one paid live run in a consumer repository, ~USD 1.**

## Goal

Observe the `.sutura.json` runtime fix clearing the gate in a real run. Today it
is verified only by code path and by parsing every policy file with
`parseRepositoryPolicy` — no consumer has gone red since the rollout.

## Why termplex (VERIFIED)

- 11 monitor triggers, **0 red runs** in the measured window — nothing is
  disturbed by making it red once.
- Its CI is a single `ubuntu-latest` job: `pnpm install --frozen-lockfile`,
  `typecheck`, `lint`, `test`, `build` (`.github/workflows/ci.yml:27-31`); the
  local suite is 161 tests in ~213 ms.
- Its failing step will be **short**, so the command header stays inside the
  20 KB window and cause A of #150 cannot fire. This isolates the runtime gate.
- `.sutura.json` = `{"version":1,"runtime":"node"}` and the pin is
  `juan294/sutura@e724f3b2 # v0.3.1`, both on `develop` (its default branch).
- `capture-replay: true` is set, so the run uploads a replay bundle.

## Known limitations of this vehicle (accept, do not fix here)

- termplex's workflow has **no `vars.SUTURA_DISABLED` guard** (the current
  `setup.ts:76` template has one; the deployed copy predates it). The only
  disarm is deleting the branch or reverting the workflow.
- `require-fixed` is unset, so the monitor job can conclude **success** on a
  `gave-up` or `infra-stop`. **Read the `Sutura outcome:` line, never the job
  conclusion.**
- v0.3.1 does not contain the #150 fix. That is deliberate and harmless here.

## Change

No repository file changes. In a throwaway branch of `termplex`:

```ts
// src/<existing test file> — a deliberate, obviously-wrong assertion
// Prefer an assertion failure over a syntax error: it must fail the `test`
// step, not the `typecheck` step, so the failing command is `pnpm test`.
expect(add(2, 2)).toBe(5);
```

```bash
git -C /Users/juan/code/termplex switch -c sutura/live-proof-2026-09-22
# edit one test to fail
git commit -am "test: deliberate failure to exercise the Sutura repair path"
git push -u origin sutura/live-proof-2026-09-22
```

The branch push runs `CI`; its failure fires `Sutura repair monitor` through
`workflow_run`.

## Success criteria

**Automated (read from the run, not asserted by a test)**

```bash
gh run list -R juan294/termplex --workflow sutura.yml --limit 3
gh run view <monitor-run-id> -R juan294/termplex --log | grep -E "Sutura outcome:|Policy evidence:|Sandbox evidence:|##\[error\]"
```

- The log contains a `Sutura outcome:` line. **Any** outcome counts as the gate
  cleared — `fixed`, `gave-up`, even `infra-stop`. The one disqualifying result
  is `Runtime evidence exceeds 500 entries`.
- `Policy evidence: … policy-sha=` is **not** `default` — proof the committed
  `.sutura.json` was read at `run.baseSha`.

**Manual**

- Record outcome, cost and elapsed time in the plan's results section.
- If the outcome is `fixed`, inspect the `sutura/fix-<runId>` PR — the first
  repair PR ever opened in a consumer repository. Do not merge it.

## Cleanup

Delete the branch and any repair branch; close (do not merge) any PR Sutura
opened. Leave `.sutura.json` and the pin in place.

```bash
git -C /Users/juan/code/termplex push origin --delete sutura/live-proof-2026-09-22
git -C /Users/juan/code/termplex switch develop
```

## Done when

The monitor run reached a `Sutura outcome:` line with `policy-sha` ≠ `default`,
the result is recorded, and the throwaway branches are deleted. STOP.
