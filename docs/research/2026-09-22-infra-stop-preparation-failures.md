# Infra-stop preparation failures in the fleet (coach, roots)

Date: 2026-09-22

Plan: `2026-09-22-fleet-repair-path-recovery` (phase 3)

Source measurement: [2026-09-22 fleet dogfood metrics](2026-09-22-fleet-dogfood-metrics.md)

## Question

Twelve fleet monitor runs got past both fail-closed gates and concluded
`infra-stop`: coach 7 and `frivas/roots` 5. What stopped each one, and whose
problem is it?

## Answer

Four distinct causes. Three of them are Sutura's.

| Cause | Runs | `operations` | Whose | Status |
| --- | ---: | ---: | --- | --- |
| pnpm `patchedDependencies` patch file missing from the dependency snapshot | coach 3 | 4 | **Sutura** | Fixed in this phase |
| Wrong failed step chosen: an aggregate "all checks passed" gate reproduces green | coach 4 | 7 | **Sutura** | Open, [#151](https://github.com/juan294/sutura/issues/151) |
| `npm ci` rejects a lockfile that is missing new `vitest` packages | roots 4 | 4 | Repository | Not ours |
| Sandbox Git baseline refuses a tracked path the repo's own `.gitignore` excludes | roots 1 | 6 | **Sutura** | Fixed 2026-09-23, [#152](https://github.com/juan294/sutura/issues/152) |

The plan expected every run to be one of three `prepareSandboxFromSource`
failures (operations 2, 4 or 6). That was wrong for coach's expensive group.
Those four runs finished preparation, then **reproduced the chosen command
green**, and `noReproductionCaseFile` (`packages/core/src/heal.ts:492`,
reached from `packages/core/src/orchestrate.ts:703-717`) also concludes
`infra-stop`. `operations` is the number of recorded sandbox stages, not a
per-branch constant. The six successful preparation stages plus one
reproduction make 7.

This also explains coach's bimodal cost. The ~27–30 s / ~USD 0.28–0.30 runs
spent the full preparation and a reproduction. The ~1.25 s / ~USD 0.013 runs
failed seconds into the network install.

## Evidence (VERIFIED)

Method, per run, all read-only:

```bash
gh run view <monitor-run> -R <repo> --log | grep -E "Sandbox evidence:|Sutura outcome:"
gh api repos/<repo>/actions/runs/<monitor-run>/artifacts
gh run download <monitor-run> -R <repo> -n sutura-case-file-<ci-run>.html
gh run download <monitor-run> -R <repo> -n sutura-replay-<ci-run>.json
```

Every artifact was still retained. No run is evidence-expired.

| Repo | Monitor run | CI run | Date | Elapsed / sandbox USD | Ops | Failing command | Exit | First real error line |
| --- | --- | --- | --- | --- | ---: | --- | ---: | --- |
| coach | 34756213847 | 34755968351 | 09-13 | 26.8 s / 0.2746 | 7 | `echo "validated_by_pr= verify=failure coverage-merge=skipped"` | 0 | reproduction passed |
| coach | 34756272771 | 34755991410 | 09-13 | 29.8 s / 0.3046 | 7 | `echo "validated_by_pr=false verify=failure …"` | 0 | reproduction passed |
| coach | 34799216090 | 34798870172 | 09-14 | 27.5 s / 0.2817 | 7 | same shape | 0 | reproduction passed |
| coach | 34799303245 | 34798986202 | 09-14 | 28.6 s / 0.2918 | 7 | same shape | 0 | reproduction passed |
| coach | 34856566228 | 34855892464 | 09-14 | 1.28 s / 0.0136 | 4 | pnpm install (network-enabled preparation) | 254 | `ENOENT: no such file or directory, open '/workspace/patches/extract-zip@2.0.1.patch'` |
| coach | 35554857180 | 35553361081 | 09-21 | 1.24 s / 0.0132 | 4 | same | 254 | same |
| coach | 35555395359 | 35554069043 | 09-21 | 1.28 s / 0.0135 | 4 | same | 254 | same |
| roots | 34804299407 | 34804261844 | 09-14 | 3.06 s / 0.0333 | 4 | `npm ci --ignore-scripts` | 1 | `npm error code EUSAGE` … `Missing: vitest@5.0.0 from lock file` |
| roots | 34837155503 | 34837060229 | 09-14 | 3.06 s / 0.0333 | 4 | same | 1 | same |
| roots | 34837777036 | 34837681593 | 09-14 | 3.04 s / 0.0331 | 4 | same | 1 | same |
| roots | 35559155831 | 35559133413 | 09-21 | 3.06 s / 0.0334 | 4 | same | 1 | `Missing: vitest@5.0.1 from lock file` |
| roots | 35559225333 | 35559157164 | 09-21 | 10.8 s / 0.1095 | 6 | Git baseline init (`git add --pathspec-from-file`) | 1 | `The following paths are ignored by one of your .gitignore files: .claude` |

I re-checked the `operations` values and the outcome lines against all 12
monitor logs myself, and grepped the error lines out of the downloaded
artifacts. None of the 12 published `errorExcerpt` values contains a
credential-shaped string.

## Causes

### 1. pnpm patch files missing from the dependency snapshot — ours, fixed

coach's `package.json` declares
`"pnpm": {"patchedDependencies": {"extract-zip@2.0.1": "patches/extract-zip@2.0.1.patch"}}`
(`gh api repos/juan294/coach/contents/package.json`). The dependency snapshot
admitted only manifests, lock files, workspace files and declared
`file:vendor/...` directories (`isDependencyInputPath`,
`packages/core/src/executor/contree.ts`). pnpm opens every patch during a
frozen install, so the install exits 254 before resolving anything.

This is a whitelist addition of the same shape as `file:vendor/...` support, so
it landed in this phase. `pnpmPatchFiles` admits each path named in
`pnpm.patchedDependencies`, and refuses unsafe paths, missing files, symlinks,
files over 1 MiB, and anything resolving outside the repository.
`contree.test.ts` covers inclusion, exclusion of unreferenced patches, and both
refusals. pnpm ≥ 10 can also declare `patchedDependencies` in
`pnpm-workspace.yaml`. That form is not read yet.

### 2. The aggregate gate step is chosen as the failing command — ours, open

coach CI run 34755968351 has three failed jobs: `verify` (step
"Validate E2E Pro quality inputs structurally"), `Coverage shard 1` (step
"Run vitest coverage shard") and `check` (step "Assert required checks
passed"). `check` is an aggregator. Its script starts with an `echo` of the
other jobs' results and exits non-zero because they failed. Command selection
is last-match over the concatenated failed-step logs, so Sutura picks the
aggregator's first script line. Rerunning that line alone exits 0. The case
file records it as `reproduction:passed`, with zero model spend.

Phase 2's last-match semantics does not change this. A fix has to choose among
several failed steps: skip steps whose `needs`-driven failure only reflects
other jobs, or prefer the earliest failing step. That is a design decision, so
it is filed as [#151](https://github.com/juan294/sutura/issues/151) rather than built here.

### 3. roots lockfile drift — repository's

The raw `npm ci` stderr in the replay bundle lists `Missing: vitest@5.0.0`
(later `5.0.1`) and six more packages from `package-lock.json`.
`package.json` gained `vitest` family dependencies without a regenerated lock
file. `npm ci` is required to reject that. The frozen install is correct.
roots is third-party (`frivas/roots`), and no change is proposed there.

### 4. Git baseline refuses a tracked-but-ignored path — ours, open

roots' `.gitignore` contains `.claude/`, yet files under `.claude` are tracked
upstream (force-added). The sandbox builds its baseline with a fresh
`git init` followed by
`git --literal-pathspecs add --pathspec-from-file=… --pathspec-file-nul`
(`sandboxRepositoryInitializationCommand`,
`packages/core/src/heal.ts:563-578`). In a fresh repository nothing is tracked,
so git's ignore check refuses those paths and the step exits 1
(`packages/core/src/heal.ts:713-714`). The manifest is already Sutura's
explicit allowlist, so `git add --force` would be the direct fix. It changes
the baseline command every sandbox runs, so it was filed as [#152](https://github.com/juan294/sutura/issues/152). It was fixed on 2026-09-23, after the termplex live run hit the same wall: the baseline now runs `git add --force`.

## Line-reference corrections to the plan

- The git-baseline failure returns at `heal.ts:713-714` (as of this change). The
  plan's `heal.ts:700-702` pointed at the stage record, not the return.
- A fourth path, reproduction-passed (`orchestrate.ts:703-717` →
  `heal.ts:492`), also concludes `infra-stop` without a preparation failure.

## Redaction gap (closed in this phase)

`preparationFailureCaseFile` published `errorExcerpt` without
`redactExternalText`. It now redacts an 8 KB window before the final 2 KB cut,
so a credential split by the character bound is not published as a fragment.
`redactExternalText` also did not recognise npm's own credential shapes. It
now redacts `_authToken=` / `_auth=` assignments and 36-character `npm_`
granular tokens, and leaves variables like `npm_config_cache` alone.
