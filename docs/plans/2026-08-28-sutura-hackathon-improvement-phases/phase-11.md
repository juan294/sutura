# Phase 11: Public demo, external proof, feedback, and release readiness

Dependencies: Phase 10

Batch status: Sequential

## Goal

Prove that an external developer and a judge can use the exact public release.

Finish the Nebius feedback and submission evidence without weakening release gates.

## Current evidence

The package smoke installs a local tarball and checks limited commands (`scripts/test-package.mjs:29-62`).

The public demo repository is `/Users/juan/code/sutura-demo`.

Its README asks judges to use `workflow_dispatch` (`/Users/juan/code/sutura-demo/README.md:7-16`).

GitHub requires write access for that trigger.

The demo pins old commit `b2ee9e0435b8db235030e25b2c7a350cc83131bc` (`/Users/juan/code/sutura-demo/.github/workflows/sutura.yml:23-36`).

## Sutura repository files

Add:

- `scripts/test-candidate-install.mjs`
- `scripts/test-public-install.mjs`
- `scripts/test-external-matrix.mjs`
- matching tests
- `docs/feedback/2026-10-sutura-nebius-feedback.md`
- final versioned evidence under `docs/demo/`

Modify:

- `README.md`
- `packages/cli/README.md`
- `packages/placebo/README.md`
- `CHANGELOG.md`
- `package.json`
- release workflows and release evidence files
- Devpost draft text where maintained locally

## Demo repository files

Add or modify:

- `/Users/juan/code/sutura-demo/.github/ISSUE_TEMPLATE/run-sutura.yml`
- `/Users/juan/code/sutura-demo/.github/workflows/demo-request.yml`
- `/Users/juan/code/sutura-demo/scripts/parse-demo-request.mjs`
- `/Users/juan/code/sutura-demo/scripts/enforce-demo-quota.mjs`
- `/Users/juan/code/sutura-demo/test/workflow-contract.test.js`
- `/Users/juan/code/sutura-demo/README.md`
- `/Users/juan/code/sutura-demo/.github/workflows/sutura.yml`

Preserve the existing fixed-case break implementation.

## Safe public trigger

Use a GitHub issue form with one fixed dropdown.

Accept only committed case IDs:

```text
assertion
flaky
upstream
greenwash-bait
```

The workflow runs on `issues: opened` from the trusted default branch.

Never use `pull_request_target`.

Read the event JSON in Node. Do not interpolate issue text into a shell command.

Ignore issue title and all unrecognized text.

Enforce these quotas before provider spending:

```text
one accepted request per GitHub user per 24 hours
five accepted requests per repository per UTC day
one active demo request at a time
```

Use one static workflow concurrency group.

Count bot-authored acceptance markers from GitHub issues.

Paginate all issue results and fail closed on API errors.

Check user and daily quotas again after acquiring concurrency.

Exclude repository owners, collaborators, and bots from the non-collaborator acceptance count.

Add a `DEMO_ENABLED` repository variable that defaults to `false`.

Set hard per-run inference and sandbox operation budgets.

Reject disabled or over-quota requests before provider calls.

Dispatch the demo CI workflow and Sutura with the exact CI run ID.

Do not depend only on `workflow_run` after token-created events.

Grant only `actions: write`, `contents: write`, `issues: write`, and `pull-requests: write`.

Prohibit `id-token: write`.

Validate every parser output against the case allowlist before shell use.

Comment stable links on the issue. Close the issue after terminal completion.

## Public installation matrix

Run the prepublication matrix with the local package tarball and exact candidate action commit.

Run the public artifact matrix only after publication:

```text
npx sutura@0.2.0 init
npx sutura@0.2.0 doctor
GitHub Action pinned to the exact release commit
```

Resolve the v0.2.0 action tag to a commit during `sutura init`.

Write that immutable commit into generated workflows.

Make `sutura doctor` verify the commit against the release tag.

Run these cases in clean repositories:

- JavaScript repair
- JavaScript flake
- unsafe repair refusal
- direct-branch repair
- repository policy refusal
- audit-only invocation
- Python repair
- Python refusal

Record package version, action commit, setup duration, outcome links, inference cost, sandbox cost, and operation count.

## Nebius feedback report

Use measured evidence for:

- ConTree JavaScript SDK coverage
- API schema publication and versioning
- image deletion and retention controls
- network policy behavior
- GitHub OIDC or short-lived credentials
- rate headers under parallel repair
- function-calling reliability by model
- JSON Schema reliability by model
- model metadata and price stability
- cold start, branch latency, cancellation, and resource metrics
- Data Lab redaction and ZDR behavior
- request IDs, errors, and recovery guidance

Separate verified behavior, observed problems, requested features, and proposed impact.

Do not claim GitHub OIDC support for Token Factory unless current documentation and a live probe confirm it.

## Release sequence

1. Freeze implementation on 2026-10-23.
2. Run the full live benchmark after Python corpus completion.
3. Commit sanitized benchmark results and their hashes.
4. Run `/pre-launch` against one exact `develop` candidate.
5. Complete `/remediate` and `/update-docs` findings.
6. Run `/simplify` and the complete local gate.
7. Run the local tarball and exact-SHA external candidate matrix.
8. Obtain release authorization.
9. Merge `develop` into `main` through the repository release workflow.
10. Verify terminal CI on the exact `main` commit.
11. Publish npm, Marketplace, tag, and GitHub release from that commit.
12. Run the public npm and Marketplace artifact matrix.
13. Update the demo pin to the exact release commit.
14. Obtain authorization to enable the public demo and spend provider credits.
15. Run the non-collaborator demo acceptance.
16. Update the Devpost draft with exact public evidence.

A failed public artifact matrix requires a new patch release.

Do not change the release commit after public artifact verification.

Tagging and publication remain authorization gates.

## Automated success criteria

- Demo parsing accepts only the four fixed identifiers.
- Invalid issue content spends no provider credit.
- Quota and concurrency tests fail closed.
- Simultaneous issue openings cannot exceed user or repository quotas.
- The disabled demo and exhausted budgets spend no provider credit.
- Demo workflow checks out only the trusted default branch.
- Demo action pin matches the exact release commit.
- Public package installation uses the released npm artifact.
- External workflows use the released action bundle.
- Root and package action metadata are identical.
- `packages/action/dist/index.cjs` matches the release source.
- Generated and demo workflows use the same immutable release SHA.
- Every installation matrix case reaches its expected terminal outcome.
- Placebo v0.2 reports zero false approvals.
- The release commit supports every published claim.
- The complete local release gate passes before any push.

## Manual success criteria

- A non-collaborator submits one valid demo issue.
- The issue receives stable broken pull request, CI, Sutura, and result links.
- Reviewers verify desktop and mobile case-file presentation.
- The final video stays under three minutes.
- The final video names Token Factory, Nemotron, ConTree, and the measured Placebo result.
- Devpost images, video, text, repository, and release use the same evidence.

## Exit evidence

Create one release evidence manifest tied to the exact `main` commit.

Include npm, Marketplace, GitHub release, demo, benchmark, external matrix, feedback, and Devpost draft references.

Store post-publication proof in release assets, workflow artifacts, and the Devpost evidence record.

Bind every record through the release SHA, content hashes, and public run URLs.

Stop before final Devpost submission unless that outward-facing action has explicit authorization.
