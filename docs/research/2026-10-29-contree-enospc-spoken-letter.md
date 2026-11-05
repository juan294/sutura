# ConTree ENOSPC on Spoken Letter repair attempts

Date: 2026-10-29. Repository: juan294/sutura. Branch: `develop`. Commit at research start: `87e1549c98f969f8f54c3bded26c03f8db10e967`; at research end: `3cff0cf` (another session committed `fix(security): bound native command whitespace parsing` during the work; the working tree was clean at both points and this research changed no product file). Workflow: `rpi-research` (documentarian; no recommendations). Handoff brief: `docs/agents/2026-10-29-contree-enospc-brief.md` (gitignored; it holds the private run identities).

Public-repository note: Spoken Letter and most fleet repositories are private. This document keeps aggregates (dates, counts, byte sizes, repository names) and omits private run IDs, private file paths and source captures. Raw downloads (terminal-failure artifacts, replay bundles, tree listings) stay in the session scratchpad and are not committed.

Labels: **VERIFIED** means the claim was read or computed in this session from the cited source. **INFERRED** means extrapolated from verified facts.

## Research question

Why does every Sutura repair attempt on juan294/spoken-letter fail in the ConTree sandbox with `RemoteCallError('OSError', '28', 'No space left on device (os error 28)')`? Is the disk size or layout under Sutura's control, or is Spoken Letter's source plus dependency install larger than the provider sandbox allows?

## Summary

1. **Failing step (VERIFIED).** The error does not come from the dependency install. It comes from the second snapshot, the "repository overlay", which uploads a tar of the checked-out repository and extracts it into the image that already holds installed dependencies. The provider returns `FAILED` with the ENOSPC error for that extraction instance, with `duration: -1.0`, `image_size: null` and no result image. The install instance before it ends `SUCCESS` and exit code 0. Sutura counts it as `sandboxOperations: 0` because the snapshot call is not a recorded repair operation.
2. **What gets uploaded (VERIFIED).** Sutura uploads an uncompressed tar of every tracked file that passes its path filter. For Spoken Letter at the 2026-10-29 failing commit the tar is 150,343,680 bytes (143.4 MiB) for 5,790 tracked files totalling 139.0 MiB. The only content-based exclusion is media under `docs/plans/**/evidence/`.
3. **Size separates success from failure (VERIFIED for the sample, mechanism INFERRED).** Across 192 fleet replay bundles that reached the overlay step plus the Spoken Letter bundles, every overlay archive up to 132,956,160 bytes extracted successfully and every ENOSPC archive was 134,963,200 bytes or larger. 128 MiB (134,217,728 bytes) lies inside that 2.0 MB gap. Image size after install does not separate the cases: a 152 MB image with a 135 MB archive fails, while 570 to 840 MB images with 73 MB archives succeeded.
4. **Why Spoken Letter fails every time (VERIFIED).** The Spoken Letter overlay archive was 73,482,240 bytes on 2026-10-01 and 142,909,440 bytes on 2026-10-02. The cause is the repository contents: a branch merged on 2026-10-02 brought roughly 65 MiB of agent-evidence files under `docs/agents/` into the tracked tree (tracked tree 66.8 MiB before, 132.3 MiB after). Sutura's filter code did not change between the last success and the first failure. All 31 `Repair requested` runs with ENOSPC fall on or after 2026-10-02.
5. **Control (VERIFIED facts, one INFERRED gap).** Sutura chooses what goes into the archive and sends no `resources_limits` on spawn. The provider documents a caller-settable `resources_limits.max_layer_bytes` (default 12 GiB writable layer), which is far above the observed sizes. No provider document read in this session states a disk, tmpfs, injected-file or upload size limit, so which provider limit the 128 MiB boundary corresponds to is not established.
6. **Not Spoken Letter-only (VERIFIED).** The same error at the same step occurred in chapa (3 red runs, 2026-09-26), paisaxe (2 red runs, 2026-09-28 and 2026-10-02) and Sutura's own repository (2 red runs, 2026-10-28 and 2026-10-29, Action v0.4.1 and v0.5.0). All archives in those runs exceed 134 MB.
7. **The two successful runs on 2026-10-23 (VERIFIED).** The two `success` conclusions, both on 2026-10-23, are duplicate-claim no-ops. Both log `Sutura already attempted workflow run <id>` about 14 seconds after the Action started, uploaded a 716-byte terminal-failure artifact and a 26 KB replay, and never contacted ConTree. They are duplicate-claim no-ops against a run that had already failed with ENOSPC (a sibling attempt on the same target run failed with ENOSPC the same morning).

## Detailed findings

### 1. Sequence inside one failing attempt

Source: the replay bundle from the Action run of 2026-10-29 09:40Z, Spoken Letter, Action `juan294/sutura@2b26f5e02bf99739c06168d5b7d76dfca2465c4f` (package version 0.4.0), `runtime: auto`, `contree-project` from a repository variable. The bundle's `executor` list has four entries and the `http` list has 37 exchanges (VERIFIED):

| Seq | Executor call                                                              | Result     | Notes                                                                                                                                                 |
| --- | -------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `importImage node:24`                                                      | ok         | 9 poll GETs                                                                                                                                           |
| 2   | `snapshot` profile `dependency-inputs`, mode `replace`                     | ok         | uploads 552,960 bytes (tar) and 119 bytes (manifest); extraction instance runs `rm -rf /workspace && mkdir -p /workspace && tar -xf ... && rm -f ...` |
| 3   | `run` pnpm install (`--frozen-lockfile --ignore-scripts`, network enabled) | ok, exit 0 | provider `duration` 25.77 s; `image_size` 662,235,841 bytes; 1,382 packages                                                                           |
| 4   | `snapshot` profile `repository`, mode `overlay`                            | **ERR**    | uploads 150,343,680 bytes (tar) and 318,119 bytes (manifest), then spawn on the post-install image                                                    |

The upload of the 150 MB tar took 12,963 ms (http entry 31). The overlay extraction instance (a provider operation) was polled three times and ended `status: FAILED`, `error: "RemoteCallError('OSError', '28', 'No space left on device (os error 28)')"`, `duration: -1.0`, `image_size: null`, `consumed_cpu: null`, `result_image_uuid: null`. The operation record echoes `resources_limits: { max_layer_bytes: 12884901888 }`, `timeout: 60` and `disposable: false` (VERIFIED, replay http entry 36 and, for the earlier instance, entry 12).

The terminal-failure artifact for the same run (`sutura-terminal-failure-v2`) records `outcome: infra-stop`, `failure.code: contree-error`, `failure.stage: sandbox`, `execution.sandboxOperations: 0`, `operationIds: []`, `providerInvocations: 0`, `observedCosts.sandboxUsd: 0.164138`, `replayComplete: false`, `runtimeDetection.runtime: node`. The 0.164 USD is the install instance. The replay bundle says `completeness.pendingBoundaries: ["nebius"]` (VERIFIED).

Why `sandboxOperations` is 0: `packages/action/src/terminal-failure.ts:165` sets it to `operationIds.length`, and the operation IDs come from recorded repair operations, not from snapshot extraction (INFERRED from the artifact showing `operationIds: []` while the bundle shows three provider instances; the line itself is VERIFIED).

The Action step log shows no output between the Action's inputs (09:40:43Z) and the artifact upload (09:42:59Z); the only error line is `##[error]ConTree operation ended with FAILED: RemoteCallError(...)` at 09:43:01Z. The step log never names the snapshot step (VERIFIED, `gh run view <id> --log` on that run).

### 2. What Sutura sends

- The overlay command (`packages/core/src/executor/contree.ts:718-742`, `snapshotCommand`) validates each member against the dependency manifest, then runs `tar -xf /tmp/sutura-snapshot.tar -C /workspace` and removes the tar. The tar and manifest are placed through the spawn body `files` map at `/tmp/sutura-snapshot.tar` and `/tmp/sutura-repository-overlay.manifest` (`contree.ts:46`, `contree.ts:240-267`; request body visible in replay http entry 33).
- Paths come from `listSnapshotFiles` (git-tracked files, falling back to a directory walk), filtered by `includeSnapshotPath` (`contree.ts:989-1008`) and `isPublicSnapshotPath` (`packages/core/src/security/snapshot-inputs.ts:24-35`). The filter removes installed-dependency paths, sensitive repository paths and, for the `repository` profile only, media files matching `docs/plans/**/evidence/**` (`contree.ts:1004`, preceded by the comment "Plan evidence screenshots can exhaust the provider's image layer."). That exclusion was added in commit `14b0986` (2026-09-26, `fix(core): prepare compatible fleet sandboxes`) (VERIFIED by `git log -S`).
- The archive is created by `tar -cf` with no compression flag (`contree.ts:1281-1283`), so the uploaded bytes equal the sum of file bytes plus tar headers and block padding.
- Sutura's own pre-flight caps are 10,000 files, 256 MiB of source and a 300 MiB archive (`contree.ts:55-57`, enforced at `contree.ts:1104`, `1238` and `1289`). The Spoken Letter archive (143 MiB) is below all three caps (VERIFIED).
- `SpawnBody` (`contree.ts:101-112`) has fields `image`, `command`, `shell`, `networking`, `env`, `timeout`, `cwd` and `files`. It has no `resources_limits` field, so Sutura never sets a layer limit; the provider default appears in the echoed operation record (VERIFIED).
- A provider failure is classified as `provider-disk-exhausted` only if `operation.status === 'FAILED'` and the error string equals the exact ENOSPC literal (`contree.ts:1431-1439`, called at `contree.ts:428`). `describeTerminalRecovery` maps that code to a next-action text (`packages/core/src/report/terminal-recovery.ts:15-18`). Commit `7378334` (2026-10-27) adds this typed label (`git show --stat` lists `contree.ts`, `terminal-recovery.ts` and their tests). `git merge-base --is-ancestor` shows it is not in `v0.4.1` and is an ancestor of Action commit `e9514141`, the one Sutura's own 2026-10-29 run used (package version 0.5.0); no local tag contains it. The pinned Spoken Letter Action (`2b26f5e0`, v0.4.0) reports the generic `contree-error` instead (VERIFIED from the artifact).

### 3. Archive size against outcome

All figures come from the third file upload recorded in each replay bundle (the repository overlay tar) and from whether the second `snapshot` executor entry carries an `error` result (VERIFIED, scripted over downloaded bundles).

Spoken Letter, `Repair requested` runs of the "Sutura repair monitor" workflow (51 runs, 2026-09-13 to 2026-10-29):

| Period                                          | Action SHA          | Overlay archive                | Outcome                                                                                                 |
| ----------------------------------------------- | ------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| 2026-09-26 to 2026-10-01 (8 runs with a bundle) | `d249c256`          | 69,498,880 to 73,482,240 bytes | overlay extracted; later `run` calls recorded in the bundle (`success` runs with `case-file` artifacts) |
| 2026-10-02 05:01Z (first ENOSPC)                | `d7a104e5` (v0.3.5) | 142,909,440                    | ENOSPC                                                                                                  |
| 2026-10-02 06:10Z, 07:06Z                       | `d7a104e5`          | 143,493,120; 146,616,320       | ENOSPC                                                                                                  |
| 2026-10-11 to 2026-10-23                        | `cc328148`          | 149,432,320 to 149,831,680     | ENOSPC                                                                                                  |
| 2026-10-24 to 2026-10-25                        | `cc328148`          | 149,821,440 to 149,944,320     | ENOSPC (one run `Server Error` before any upload)                                                       |
| 2026-10-27 to 2026-10-29                        | `2b26f5e0` (v0.4.0) | 149,954,560 to 150,343,680     | ENOSPC                                                                                                  |

Tally of the 51 runs: 31 ENOSPC (all `failure`), 2 duplicate-claim no-ops (`success`), 8 `success` runs from before 2026-10-02 with no terminal-failure artifact, 4 `.npmrc` credential refusals (2026-09-26), 3 `Runtime evidence exceeds 500 entries` (2026-09-13), 1 `Pull request head no longer matches the failing SHA`, 1 `Server Error` (2026-10-24) and 1 ConTree `GET .../operations/...` failure during image import (2026-10-21). Of the 25 most recent runs: 21 ENOSPC, 1 `Server Error`, 1 import-time GET failure, 2 duplicate-claim no-ops. This differs from the brief's count (18 failed, 16 ENOSPC of 25); the listing used here is `gh run list --workflow 357079580 --limit 400`, filtered to display titles beginning `Repair requested`. The brief's earliest ENOSPC (2026-10-18) is not the earliest: the first is 2026-10-02 05:01Z. Where the brief's windowing came from is unknown.

Fleet-wide boundary check (VERIFIED): 376 `Repair requested` runs in 17 fleet repositories (Spoken Letter excluded from this scan and treated above) yielded 192 replay bundles that reached the overlay step; 157 of them, from 12 repositories including Sutura, extracted the overlay successfully have archives from 163,840 to 132,956,160 bytes (all but Sutura's own repository stay under 45 MB). The 7 ENOSPC bundles from chapa, paisaxe and Sutura have archives of 134,963,200 (Sutura, 2026-10-28), 135,792,640 (Sutura, 2026-10-29), 214,691,840 (chapa), 222,392,320 and 224,706,560 (paisaxe). No bundle in the sample has a successful overlay above 132,956,160 bytes and no ENOSPC below 134,963,200 bytes. Including Spoken Letter, the two sets do not overlap; the gap between them contains 128 MiB (134,217,728 bytes).

Sutura's own repository crosses the boundary in place: 34 successful overlays in the sample, the largest on 2026-10-25 and 2026-10-26 at up to 132,956,160 bytes (Action `3956524e`), then ENOSPC at 134,963,200 bytes on 2026-10-28 (Action `969bd68b`, v0.4.1) with a post-install image of only 151,181,582 bytes. In that case the install image is small, so total image size does not explain the failure (VERIFIED).

Install image size does not track outcome: Spoken Letter images after install were 570 to 843 MB in failing runs; successful September overlays on Spoken Letter used images that the bundles do not record with a comparable `image_size` (the field is 0, 12,857, 7,655,558 or 190,804,251 depending on which operation response was last), so no clean comparison exists for the successful Spoken Letter runs (VERIFIED gap).

### 4. Why the Spoken Letter archive doubled

- The tracked tree at the checked-out commit was 66.8 MiB (4,525 files, `docs/agents/` 2.5 MiB) at the commit of the last successful bundle (2026-10-01 16:15 +02:00) and 132.3 MiB (5,322 files, `docs/agents/` 67.8 MiB) at the checkout of the first ENOSPC bundle (2026-10-01 19:41, a release branch). Commands: `git ls-tree -r -l <commit>` in the local Spoken Letter clone (VERIFIED).
- The added files are release and phase evidence under `docs/agents/`: five directories of 7 to 13 MiB each, mostly PNG screenshots (66.8 MiB of PNG across the whole 2026-10-29 tree). The branch merged to `develop` on 2026-10-02 08:58 +02:00 (VERIFIED from `git log`).
- At the 2026-10-29 failing commit, the GitHub tree API reports 5,790 blobs totalling 145,798,039 bytes (139.0 MiB); `docs/agents` is 71.6 MiB of that. The tar of 150,343,680 bytes equals that total plus about 0.78 KiB per file, which matches a 512-byte header plus average half-block padding (INFERRED from arithmetic; the match to within 1 percent supports the claim that essentially all tracked files are archived).
- The `docs/plans/**/evidence/**` media exclusion (`contree.ts:1004`) covers only paths under `docs/plans/`. Paths under `docs/agents/` have no exclusion (VERIFIED by reading the filter).
- Spoken Letter is a private repository (`gh repo view`, VERIFIED).
- Between the last success (Action `d249c256`) and the first failure (`d7a104e5`), `git log` shows no change to `contree.ts`, `snapshot-inputs.ts` or `repository-path.ts` after 2026-09-26 (VERIFIED), so the archive growth comes from repository content, not from filter code.

### 5. Provider documentation

Retrieved 2026-10-29 from Nebius Token Factory documentation (no publication date shown on any page):

- Spawn endpoint reference (`https://docs.tokenfactory.nebius.com/api-reference/sandboxes/instances/spawn-a-new-container-instance.md`): `files` is a map of absolute path to `{uuid, uid, gid, mode}`; `resources_limits.max_layer_bytes` is "Maximum writable layer size in bytes", integer minimum 1, default 12884901888, caller-settable; `disposable` default false. The page lists no disk or space error description and no file-size limit.
- Limits page (`https://docs.tokenfactory.nebius.com/sandboxes/operate/limits-retention-and-usage.md`): documents 50 simultaneous operations during Beta, 180-day checkpoint retention, stream recording defaults and an account-effective `limits` map from `GET /v1/whoami`. It does not state file upload or injected-file size, layer or image size, disk, memory or per-project quotas, and says to contact the provider before relying on unspecified limits.
- Overview and CLI pages state no disk or upload limits.

So the 12 GiB writable-layer default (VERIFIED in the operation record) is roughly 80 times the 150 MB archive. Which provider resource the 134 MB boundary corresponds to is undocumented in the pages read (UNKNOWN). The pattern that the instance never ran (`duration -1.0`, no `image_size`) while the error is a guest-side `OSError` is consistent with the failure occurring while the provider places the injected `/tmp/sutura-snapshot.tar` file, but the provider's implementation was not observed (INFERRED).

Sutura's `whoami` check exists only for deadline limits (`contree.ts:192-198`, `verifyDeadlineSupport`). The account `limits` map was not read in this session because it needs the ConTree token, which this research did not use.

### 6. Fleet scope

Red monitor runs by failure annotation, all fleet repositories with the monitor workflow, up to 2026-10-29 (VERIFIED, `gh api .../check-runs/<job>/annotations`):

- ENOSPC: Spoken Letter 31 (of 51 repair runs), chapa 3, paisaxe 2, Sutura 2.
- No ENOSPC annotation: archy (44 red runs, mostly `repository overlay refuses installed dependency path`, 27), cirujano, clarity, coach, copilot-rpi, gh-glance, kalpha, layalga, portfolio, spoken-letter-alexa. These are red runs only; green runs that end in `infra-stop` do not carry the annotation, so ENOSPC in green runs is not counted.
- `home-network`, `home-weave` and `marky` have no monitor workflow under that name.

The 2026-10-24 fleet analysis (`docs/agents/2026-10-24-fleet-ci-failures-vs-sutura.md`, gitignored) lists "disk full" as 2 Spoken Letter runs. The scan above finds it in 3 further repositories, including one before and one after that document's date.

### 7. Current recovery and visibility

- Spoken Letter repair is disabled: `SUTURA_AUTO_REPAIR=false` since 2026-10-29 09:56Z (brief; subsequent monitor runs show `Repair disabled (opt-in)`; 15 skipped monitor runs between 10:08Z and 11:41Z, VERIFIED from the run list).
- With the pinned v0.4.0 Action, each attempt ends red with the generic message and an `infra-stop` terminal-failure artifact; the PR or commit comment is updated (`terminalCommentState: updated`). The Action retains no retry for ENOSPC; `claimAttempt` makes later attempts on the same run a no-op, which is why the two 2026-10-23 "successes" exist (VERIFIED from logs; the one-attempt-per-run rule is described in `docs/agents/2026-10-24-fleet-ci-failures-vs-sutura.md` section 4.1).
- On `develop`, the typed `provider-disk-exhausted` code and its next-action text apply, and say to ask the provider owner to inspect capacity (`terminal-recovery.ts:15-18`). It does not change what is uploaded.

## Open questions and practical impact

1. **Which provider limit sits near 128 MiB?** The sample brackets it between 132,956,160 and 134,963,200 bytes but no document or provider response read here names it. Impact: the threshold is an empirical boundary on one account and one date, not a documented constant. Reading `GET /v1/whoami` `limits` with the project token, or asking the provider, would resolve it; neither was done (read-only, no token use).
2. **Does the failure occur while placing the injected file or while extracting the tar?** The instance record shows no start (`duration -1.0`), which points to the former, but is not proof. Impact: it decides whether archive size, extracted size or both matter.
3. **Is the boundary on tar bytes or on extracted bytes?** The tar is uncompressed, so both are about equal here. The sample cannot separate them.
4. **Variation across dates and accounts.** All bundles come from one ConTree project. Whether the boundary was the same on 2026-09-26 (chapa failed at 214 MB then) cannot be told from this sample.
5. **Why the brief's run counts differ from this listing** (see section 3).
6. **Green-run ENOSPC.** Green monitor runs that end in `infra-stop` were not annotated; the true fleet count of ENOSPC attempts is higher than the red-run count.
7. **Successful Spoken Letter image sizes** are not recoverable from the September bundles, so image-size comparison for the successful side relies on the fleet sample.

## Sources

- Repository: `packages/core/src/executor/contree.ts`, `packages/core/src/security/snapshot-inputs.ts`, `packages/core/src/heal.ts:631-638`, `packages/core/src/report/terminal-recovery.ts`, `packages/action/src/terminal-failure.ts:151-167`.
- GitHub Actions data for juan294/spoken-letter, chapa, paisaxe and sutura via `gh run list`, `gh run view --log`, `gh run download` and the Git trees API (retrieved 2026-10-29).
- Local Spoken Letter clone for `git ls-tree -r -l` and `git log` (read-only).
- Nebius Token Factory sandbox documentation pages listed in section 5 (retrieved 2026-10-29).
- Historical context: `docs/plans/2026-10-27-real-project-repair.md` (REAL-05), `docs/agents/2026-10-27-hackathon-final-window/real-project-assessment-cases.json`, `docs/agents/2026-10-24-fleet-ci-failures-vs-sutura.md`.

## Handoff

Objective: answer the research question above; research only. Approved scope: read-only GitHub and ConTree access; no dispatch, rerun, paid sandbox run, release or change to `SUTURA_AUTO_REPAIR` (kept `false`). Base commit `87e1549`, current `3cff0cf`, the primary checkout (clean). Output: this file, uncommitted. No findings dispositions apply. Next step if the owner wants one: a separate `rpi-assess` or `rpi-plan` request; this document does not authorize either. Evidence validity: the run lists and sizes reflect GitHub state on 2026-10-29 around 13:00 +01:00; re-check before reuse.
