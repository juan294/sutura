# Sutura evidence, submission, and release plan (WS-4)

Date: 2026-09-04

Status: Active

Owner: WS-4 (Evidence gates, submission story, release)

Integration branch: `develop`

Research base: `e58dc6ba43b6d3bdc55a5d2bcaeae4fab16bea50`

Research: `docs/research/2026-09-04-sutura-ws4-evidence-submission.md`

Workstream: `docs/plans/2026-09-04-sutura-issue-workstreams.md` (WS-4)

Roadmap: `docs/plans/2026-08-31-sutura-hackathon-winning-roadmap.md`

## Objective

Make every paid evidence dispatcher fail closed unless the repository-wide push
freeze is active, recover the observed Tavily 403 without weakening grounding,
finish the non-measured submission source now, and then carry the first candidate
containing WS-1, WS-2, and WS-3 through one exact evidence, release, acceptance,
and submission identity.

No measured claim is drafted ahead of committed evidence. No issue is closed
until its evidence-bearing commit is on `develop`. Paid, publishing, public-demo,
and Devpost actions remain separate authorization gates.

## Issues covered, in execution order

| Order | Issue | Deliverable | Plan phase |
| ---: | --- | --- | ---: |
| 1 | #47 | Complete 51-case, 55-evaluation Placebo v0.2 benchmark | 1, 2 |
| 2 | #48 | Candidate eight-case external matrix | 2 |
| 3 | #49 | Public eight-case external matrix | 2, 5 |
| 4 | #99 | Project title and one-sentence value statement | 3 |
| 5 | #100 | Problem, audience, and differentiation | 3 |
| 6 | #101 | Product workflow and architecture diagram | 3 |
| 7 | #102 | Direct provider, runtime, Data Lab, and NVIDIA explanation | 3 |
| 8 | #105 | Nebius and NVIDIA product feedback | 3 |
| 9 | #56 | Final feedback report | 3, 4 |
| 10 | #104 | Significant work during the submission period | 3 |
| 11 | #103 | Measured Placebo, dogfood, Arena, cost, and external-user results | 4 |
| 12 | #106 | Final public repository, demo, release, Marketplace, benchmark, and evidence links | 4, 7 |
| 13 | #57 | Devpost description, images, and public video | 3, 4, 6 |
| 14 | #107 | Feature freeze on the first complete cross-workstream candidate | 5 |
| 15 | #108 | Admit only security, release, evidence, and demo-blocking fixes | 5 |
| 16 | #109 | Sequential `pnpm run ci:local` on the exact candidate | 5 |
| 17 | #110 | Candidate installation and external matrix checks | 5 |
| 18 | #111 | Authorized provider and ConTree canaries | 5 |
| 19 | #112 | Reuse, quality, and efficiency review | 5 |
| 20 | #113 | Merge through the documented release path | 5 |
| 21 | #114 | Publish only if the verified candidate requires a release | 5 |
| 22 | #115 | Verify npm, Action tag, Marketplace, GitHub release, and public install | 5 |
| 23 | #116 | Signed-out desktop Case Lab repair | 6 |
| 24 | #117 | Signed-out mobile repair or replay | 6 |
| 25 | #118 | Signed-out refusal and flaky result | 6 |
| 26 | #119 | Stable evidence and download links | 6 |
| 27 | #120 | Public npm install | 6 |
| 28 | #121 | Public Marketplace install | 6 |
| 29 | #122 | Public repository setup from a clean checkout | 6 |
| 30 | #123 | Public video playback, captions, and links | 6 |
| 31 | #124 | Complete Devpost preview | 7 |
| 32 | #125 | Significant-work explanation in the preview | 7 |
| 33 | #126 | Feedback section in the preview | 7 |
| 34 | #127 | Final submission backup | 7 |
| 35 | #58 | Public release-bound evidence index | 7 |

The October dates in the roadmap are latest completion dates. Phase 5 source
work starts immediately after the Tavily implementation. Phase 6 starts as soon
as the first `develop` commit contains terminal WS-1, WS-2, and WS-3 work.

## Design decisions

### D1. Freeze state is checked at the dispatch edge

`push-freeze status` is informational and exits zero in both states. The shared
controller therefore exposes a read-only `requireActivePushFreeze` operation
that reads the common-Git-directory marker and rejects a missing or malformed
active record. Each runner calls it immediately before `gh workflow run`.

The Placebo streak checks the marker again for every eligible case after
duplicate and budget decisions. The external matrix does the same. Gate,
finalize, and cleanup commands remain usable with no freeze because they do not
spend. A freeze disappearing after one case prevents the next dispatch.
Both single-case `run` commands require explicit `--cap-usd` and
`--initial-reserve-usd` values and reject a reserve that exceeds the cap before
dispatch; streak mode retains its existing cumulative ledger enforcement.

### D2. Every paid run has one freeze lifecycle

WS-4 turns the freeze on immediately before the first dispatch, verifies its
active state, posts expected duration and cost bounds on the evidence issue,
and installs an EXIT/INT/TERM cleanup trap. It turns the freeze off as soon as
the final allowed workflow is terminal. A retry is a new dispatch and needs
remaining cap plus an active freeze; no runner turns the freeze on implicitly.

### D3. The Tavily 403 repair stays grounded and fail closed

The request shape already matches the current Tavily Search API, and the same
candidate/key returned citations for the preceding three upstream cases. The
observed product defect is that one search 403 is terminal and unclassified.

The client retries status 403 exactly once with the identical bounded request.
If the second 403 escapes into `ground`, and the diagnosis names one exact
validated dependency, grounding attempts the existing npm-registry ownership
check and Tavily extraction of the exact GitHub release and major upgrade-guide
URLs. That fallback succeeds only with a non-empty, registry-bound citation.
Otherwise the original 403 is rethrown. Status 401, malformed responses,
transport failures, unrelated diagnoses, and missing credentials are never
converted into degraded success. Public errors continue to exclude bodies.

### D4. Submission source and release evidence are separate artifacts

`docs/devpost/` holds editable submission copy and the timed video script.
Candidate-bound evidence records and the final backup live under `docs/demo/`
or `docs/feedback/`, because the release-evidence validator accepts those local
roots. A deterministic submission contract rejects missing sections, broken
local links, version drift, invalid video timing, and unfinished markers.

### D5. Measured prose is assembled last

The Phase 5 source contains headings and qualitative repository-backed claims,
but not empty metric slots, guessed counts, or future URLs. #103, the measured
part of #56/#57, and #106 are written only after the exact benchmark, dogfood,
Arena, Data Lab, external-user, release, demo, and Marketplace evidence exists
on `develop`. Failed results stay in denominators and are described as failures.

### D6. One immutable candidate binds Phase 6 and Phase 7

After WS-1, WS-2, and WS-3 are merged, WS-4 records the 40-character
`origin/develop` SHA and freezes features. Every local gate, canary, benchmark,
matrix, evidence record, release artifact, public acceptance result, video, and
submission backup must identify that candidate or its documented release
commit. Any later admitted fix creates a replacement candidate and reruns every
candidate-dependent gate.

### D7. `codex-simplify` uses the documented fallback

No local `codex-simplify` skill is installed. #112 is fulfilled by a dedicated
post-implementation review for reuse, quality, and efficiency. The review is
recorded, fixes are verified, and an independent plan-compliance pass confirms
that no accepted gate was weakened.

## Phases

| Phase | Name | Issues | Depends on | State |
| ---: | --- | --- | --- | --- |
| 1 | Dispatch freeze and Tavily recovery | #47 preparation | None | Active |
| 2 | Phase 0 exact live evidence | #47, #48, #49 | 1; authorization; #49 also needs release | Blocked at authorization after Phase 1 |
| 3 | Phase 5 qualitative submission source | #99, #100, #101, #102, #105, #104, draft #56/#57 | 1 | Ready |
| 4 | Phase 5 measured assembly | #103, #106, final #56/#57 | committed WS-1/2/3 and Phase 0/public evidence | Blocked on evidence |
| 5 | Phase 6 candidate and release | #107-#115 | merged WS-1, WS-2, WS-3; separate authorizations | Blocked on cross-stream merge |
| 6 | Phase 7 public acceptance | #116-#123 | released candidate, WS-1 acceptance script, video | Blocked on Phase 5 |
| 7 | Phase 7 submission and index | #124-#127, #58 | complete public evidence; Devpost authorization | Blocked on Phase 6 |

Detailed checklists live in
`docs/plans/2026-09-04-sutura-ws4-evidence-submission-phases/`.

## Verification and integration

Implementation occurs in `feat/ws-4-evidence-submission` in an isolated
worktree. Tests are written red-first. Focused verification runs after each
task; `pnpm run test:release-contracts` validates evidence and runner contracts.
Because Phase 1 changes `packages/core`, rebuild
`packages/action/dist/index.cjs` and run `pnpm run ci:local` sequentially before
the integration push.

Before integration: commit task work, fetch `origin/develop`, rebase the task
branch, merge it into local `develop`, verify the integrated SHA, and check
`pnpm run push-freeze status`. Push only with no active paid-run freeze. Monitor
the exact remote CI. Close each issue with a comment naming that integrated
commit and its direct evidence only after both are on `develop`.

## Authorization ledger

These entries define boundaries; they do not authorize execution. Each command
resolves and prints an exact immutable SHA before dispatch. Secrets remain only
in GitHub Actions.

### G1. Targeted Tavily proof for #47

- Exact command:

  ```bash
  git fetch origin develop
  CANDIDATE_SHA="$(git rev-parse refs/remotes/origin/develop)"
  test "$(git rev-parse HEAD)" = "$CANDIDATE_SHA"
  test "${#CANDIDATE_SHA}" -eq 40
  node scripts/placebo-live.mjs gate --controller-sha "$CANDIDATE_SHA" --subject-sha "$CANDIDATE_SHA"
  pnpm run push-freeze on --reason "WS-4 #47 upstream-retry-release Tavily proof on $CANDIDATE_SHA; expected 10 minutes"
  gh issue comment 47 --body "Starting one authorized upstream-retry-release live proof on \`$CANDIDATE_SHA\`. Expected duration: 10 minutes. Expected cost: USD 0.24; reserve: USD 0.30; cap: USD 0.40. Stop after the single workflow is terminal, or immediately on infra-stop, false approval, dispatch failure, identity mismatch, timeout, or missing grounded Execa 6 release evidence."
  pnpm run push-freeze status
  trap 'pnpm run push-freeze off' EXIT INT TERM
  pnpm placebo:live run --controller-sha "$CANDIDATE_SHA" --subject-sha "$CANDIDATE_SHA" --case upstream-retry-release --authorize --cap-usd 0.40 --initial-reserve-usd 0.30
  pnpm run push-freeze off
  trap - EXIT INT TERM
  ```
- Maximum dispatches: 1 workflow, 2 evaluations.
- Cap: USD 0.40. Reserve: USD 0.30.
- Expected cost: USD 0.24, based on prior terminal runs of USD 0.22104344 to
  USD 0.25262055. Expected duration: 10 minutes.
- Stop: the one workflow is terminal, or immediately on dispatch failure,
  identity mismatch, timeout, `infra-stop`, false approval, or missing grounded
  Execa 6 release citation. No automatic retry dispatch.

### G2. Full Placebo v0.2.1 benchmark for #47

- Exact command: `pnpm placebo:live streak --controller-sha "$CANDIDATE_SHA" --subject-sha "$CANDIDATE_SHA" --authorize --cap-usd 8 --initial-reserve-usd 0.50` after gate, freeze, and issue comment.
- Maximum dispatches: the fixed 51 cases and 55 evaluations; completed
  candidate-bound ledger entries are resumed, never replaced.
- Cap: USD 8.00. Reserve: USD 0.50.
- Expected cost: USD 5.50, using the complete v0.2 baseline's USD 5.48180609.
  Expected duration: 6 hours.
- Stop: cap reserve, false approval, `infra-stop`, identity drift, timeout, or
  the terminal 51-case ledger. Freeze comes off at that terminal boundary.

### G3. Candidate external matrix for #48

- Exact command: `pnpm external-matrix:live streak --mode candidate --controller-sha "$CANDIDATE_SHA" --action-sha "$CANDIDATE_SHA" --demo-sha "$DEMO_SHA" --authorize --cap-usd 1.50 --initial-reserve-usd 0.25` after exact candidate/demo gates, freeze, and issue comment.
- Maximum dispatches: 8 fixed cases.
- Cap: USD 1.50. Reserve: USD 0.25.
- Expected cost: USD 0.34, using the v0.2 candidate matrix's USD 0.336138.
  Expected duration: 2 hours.
- Stop: cap reserve, false approval, `infra-stop`, identity drift, timeout, or
  terminal eight-case ledger.

### G4. Provider and ConTree canaries for #111

- Exact command: `gh workflow run provider-contract-canary.yml --ref "$CANDIDATE_SHA"` after the workflow's exact SHA is on `origin/develop` and the freeze/comment lifecycle is active.
- Maximum operations: one Token Factory contract call and one ConTree image
  proof operation in one workflow; no retry.
- Cap: USD 0.25. Reserve: USD 0.10.
- Expected cost: USD 0.10. Expected duration: 15 minutes.
- Stop: workflow terminal, contract mismatch, image mismatch, provider error,
  missing artifact, identity drift, or timeout.

### G5. Release publication for #113/#114

- Exact command: the develop-based `/release` workflow: merge the reviewed
  `develop` PR to `main`, identify the squashed main SHA, create and push the
  single annotated release tag by name, then create the GitHub release. The
  tag dispatches `.github/workflows/publish.yml`.
- Maximum publications: one Git tag, one GitHub release, one npm version, and
  one Action major/minor tag update as required by the reviewed release diff.
- Cap: USD 0.00. Reserve: USD 0.00. Expected cost: USD 0.00.
- Expected duration: 45 minutes.
- Stop: any identity, CI, bundle, package, npm, tag, or public-install mismatch.
  Publication is not retried without new authorization.

### G6. Public external matrix for #49

- Exact command: `pnpm external-matrix:live streak --mode public --controller-sha "$RELEASE_SHA" --action-sha "$RELEASE_SHA" --demo-sha "$DEMO_SHA" --authorize --cap-usd 1.50 --initial-reserve-usd 0.25` after immutable public-install verification, freeze, and issue comment.
- Maximum dispatches: 8 fixed cases.
- Cap: USD 1.50. Reserve: USD 0.25.
- Expected cost: USD 0.31, using the v0.2 public matrix's USD 0.308961.
  Expected duration: 2 hours.
- Stop: cap reserve, false approval, `infra-stop`, public identity mismatch,
  timeout, or terminal eight-case ledger.

### G7. Public Case Lab enablement and live acceptance

- Exact command: the WS-1 documented enable command followed by its signed-out
  acceptance command, both bound to `RELEASE_SHA`; record those literal
  commands in this ledger before authorization because they do not exist in the
  research snapshot.
- Maximum live dispatches: 2 (one repair and one refusal); all other checks use
  deterministic replay.
- Cap: USD 1.00. Reserve: USD 0.25. Expected cost: USD 0.25.
- Expected duration: 30 minutes.
- Stop: daily-spend stop, false approval, identity drift, access failure,
  timeout, or the second terminal result.

### G8. Devpost update and submission

- Exact action: update the official entry from the release-bound backup, inspect
  preview, and submit once. The browser action is recorded verbatim with the
  final Devpost project URL before authorization.
- Maximum mutations: one update and one submission.
- Cap: USD 0.00. Reserve: USD 0.00. Expected cost: USD 0.00.
- Expected duration: 20 minutes.
- Stop: any preview field, public link, video, image, significant-work,
  feedback, deadline, or release-identity mismatch.

## Success criteria

- Both paid runners reject every dispatch without an active shared freeze and
  re-check it between streak cases.
- The exact Execa case produces grounded release evidence after the bounded 403
  recovery, or remains honestly blocked with the original typed 403.
- The accepted benchmark contains all 51 cases and 55 evaluations with zero
  false approvals; both eight-case matrices are complete and candidate-bound.
- Qualitative submission copy is complete without invented metrics; every
  measured claim later links to committed, public evidence.
- One exact released candidate supports package, Action, demo, benchmark,
  Arena, feedback, video, Marketplace, and Devpost identities.
- All 35 issues are either closed with an evidence comment after integration or
  reported blocked at one named authorization/external dependency gate.
