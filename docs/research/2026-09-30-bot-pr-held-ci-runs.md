# Bot pull requests with held CI runs

Date: 2026-09-30
Scope: pull requests that Sutura, the Case Lab and the external matrix open in
`juan294/sutura-demo` with the workflow's own `github.token`.

Each claim is labeled VERIFIED (read through the GitHub API or source this
session) or INFERRED.

## Report

The repository owner reported that bot pull requests never get CI. GitHub
created a `pull_request` CI run for each one and held it for approval
(`action_required`). The runs never started. Before the owner deleted them on
2026-09-30, 28 held runs existed, one per bot pull request (#21 to #49), created
between 2026-09-05 and 2026-09-23. In two other repositories on the same
account, GitHub failed held runs 30 days after creation and emailed the owner
"Run failed … No jobs were run" for each one.

## Findings

- VERIFIED: 28 bot pull requests were open (`sutura/fix-*`, `case-lab/*`,
  `matrix/*`), all authored by `app/github-actions`. 0 runs were
  `action_required` after the owner's cleanup.
- VERIFIED: the repository's approval policy is `first_time_contributors`
  (`GET /repos/juan294/sutura-demo/actions/permissions/fork-pr-contributor-approval`).
- VERIFIED: repair pull request #49 had 0 check runs, 0 commit statuses and 0
  workflow runs on its head commit `0381be5`.
- VERIFIED: Case Lab pull request #48 had `test` (failure) and
  `Sutura repair audit` (neutral) on its head commit. Case Lab dispatches CI with
  `gh workflow run`, which the workflow token may trigger.
- VERIFIED: Sutura created its `Sutura repair audit` check on the failing commit
  only (`packages/core/src/github/adapter.ts`, `claimAttempt`,
  `headSha: run.headSha`), so a repair pull request showed no Sutura result.
- VERIFIED: nothing prevented Sutura from repairing its own `sutura/fix-*`
  branches. The demo `sutura.yml` skipped only `matrix/` and `case-lab/`. This
  was safe only because CI never ran on repair pull requests.
- VERIFIED: comment-claim recovery accepted only the login
  `github-actions[bot]`, so a GitHub App token would have caused duplicate claim
  comments on a retry.
- VERIFIED: the external matrix already had an authorized
  `external-matrix-live.mjs cleanup --authorize` command that closes its pull
  requests and deletes its branches. It did not delete held runs, and matrix
  pull requests #21, #33 and #36 were still open.
- INFERRED: why GitHub creates and holds these runs instead of not creating them
  (the documented behavior for events caused by `GITHUB_TOKEN`) was not
  determined.
- INFERRED: the sutura-demo held runs would have failed from about 2026-10-05,
  30 days after the first one.

## Changes

- Sutura posts a neutral `Sutura repair verification` check on the repair
  commit after it opens the repair pull request. A failure to post it only
  warns.
- Sutura refuses a failed run on a `sutura/fix-*` branch right after it reads
  the workflow run, before it reads a pull request, claims, reads policy or
  checks out anything. The Action reports
  `repair-branch-skipped`. The generated workflow, this repository's
  `sutura.yml` and the demo `sutura.yml` skip those branches.
- Claim recovery also accepts a GitHub App bot login when the comment names the
  claimed check run, so a GitHub App installation token can be passed as
  `github-token`. Pull requests opened with that token
  trigger CI normally.
- The Case Lab workflow closes its case and repair pull requests, deletes their
  branches and deletes their held runs as its last step. It uses
  `continue-on-error`, so the step cannot change the result. It reaches the demo
  at the next `publish-demo`.
- The matrix `cleanup` command also deletes held runs for the branches it
  cleans.
- `docs/user-guide.md` explains the repair check, the skip outcome and how to
  run CI on a repair pull request.

## Not changed

- The workflow token still opens repair pull requests by default, so a consumer
  repository still gets a held run per repair pull request unless it passes an
  App token or approves the run.
- `break-me.yml` pull requests are left open for a human, as the manual demo
  intends.
- A `fixed` replay bundle recorded before this change does not replay with it,
  and the reverse, because the fixed path makes one more GitHub call. No such
  bundle is checked in, and Case Lab replays with the release that recorded it.
- If the final update of the repair-commit check fails, the check stays
  `in_progress`; the failure only warns, and the audit check and comment still
  carry the decision.
