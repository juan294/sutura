# Sutura user guide

This guide covers Sutura 0.4.0. Use the packed candidate during release verification and `npx sutura@0.4.0` after publication. Sutura is in public beta, and Nebius ConTree access remains an access-controlled prerequisite.

## Requirements

Assess one repository with Node.js 22 or later before configuring accounts:

```bash
sutura assess . --json
```

The assessment reads bounded manifests, locks and workflows without executing scripts or uploading source. It reports support per job; services or native dependencies in another job do not automatically exclude a self-contained job. Incomplete metadata stays unknown. Static support is not preparation, reproduction or repair evidence.

For optional selected-run diagnosis, authenticate the GitHub CLI and run `sutura diagnose --repo example/project --run-id 12345 --json`. This reads only the named repository's bounded run/job/log evidence and uses no model or sandbox.

Live repair requires your own Nebius Token Factory key and access-controlled ConTree token/project. Tavily, OpenAI and TypeSafe are optional. Setup does not provision provider access. Read the [data boundary and retention contract](security/data-boundaries.md) and [private repository threat model](security/private-repositories.md) before enabling confidential source processing.

## Install one repository

```bash
sutura init --plan --workflow "CI" --repo example/project
```

Review the proposed diff, provider destinations, permissions, configured limits, unpriced sandbox/runner charges and concrete next command. Apply the printed digest using the same options. Candidate testing supplies `--action-sha` with an exact candidate commit; after publication the CLI resolves its matching release tag.

Select each credential explicitly with repeated `--credential` options. Required names for live repair are `NEBIUS_API_KEY`, `CONTREE_TOKEN` and `CONTREE_PROJECT`. Optional names are `TAVILY_API_KEY`, `OPENAI_API_KEY` and `TYPESAFE_API_KEY`. Supply selected values in your current environment; secret values go to GitHub through standard input and are not stored in the receipt. Unselected ambient values are ignored. `CONTREE_PROJECT` is a repository variable. Use `--no-tavily` to omit that input; `SUTURA_RUNTIME=node|python` resolves an intentional polyglot choice.

Preview makes no writes. Apply retains `.sutura/setup-receipt.json` and prior receipt history. Completed writes are not blindly repeated. Missing selected values keep setup incomplete; a lost remote response records an unknown outcome and requires a newly reviewed replacement plan. Keep receipts private and out of commits. Local completion does not prove provider access or activation.

## Activate the monitor

Review the generated workflow before committing it. In particular, confirm the
monitored workflow name, permissions, runtime, optional Tavily input, and exact
40-character Action commit.

```bash
git add .github/workflows/sutura.yml
git commit -m "ci: add Sutura repair monitor"
git push
```

The monitor becomes active only when the workflow reaches the repository's
default branch. If that branch is protected, open and merge a pull request
through the repository's normal review process.

## Understand the first run

The monitor inspects completion of the selected CI workflow without repair
credentials. A successful run needs no repair. Failed or timed-out runs start
a repair attempt only when inspection admits the job, repair is enabled and
the source is not a Sutura repair branch. Inspection-only stops retain their
summary and next action; a skipped repair is not a verified recovery.

For admitted repair attempts, Sutura publishes the applicable evidence:

- An evidence comment on the pull request or exact failing commit.
- One **Sutura repair audit** GitHub Check on the exact failing SHA.
- An HTML case-file artifact linked from the comment and check.
- A repair pull request when a candidate passes verification, with one
  **Sutura repair verification** GitHub Check on the repair commit.

Typed setup, unsupported-input or resource stops can occur before a case file
or GitHub Check exists. They retain terminal outputs/artifacts and a next action;
unexpected internal, security or evidence failures remain failed monitors.

Every attempt ends as `fixed`, `flaky-no-patch`, `refused`, `gave-up`, or
`infra-stop`. Generated customer workflows are advisory by default. Even a
verified repair remains neutral and requires human review; Sutura never merges
it.

Before repair inference, Sutura requires the sandbox failure to match the selected native failure. Mismatch or unavailable identity stops without further inference and retains consumed resources. Before it proposes a repair, Sutura reruns the failing command in the sandbox
up to five times to tell a real failure from a flaky one. On a slow test suite
those reruns dominate the cost of an attempt, so they share a sandbox-time
budget, `triage-sandbox-seconds` (default 240). Sutura measures the first rerun
and stops before any further rerun would take the total over the budget. The
attempt then ends `gave-up`, and the case file, comment and check state the
measured and predicted sandbox seconds. The worst case is the budget plus one
rerun, because the first rerun's duration is unknown until it finishes.

When the failing step calls a test runner directly (vitest, jest,
`node --test` or pytest) and the log names exactly one failing test file,
Sutura first reruns only that file. A focused rerun counts only when it fails
the same test with the same message. At the first focused rerun that passes or
fails differently, Sutura discards the focused reruns and starts again with the
full command, within the same budget. Focused reruns can therefore confirm a
real failure, but a flaky or intermittent verdict always comes from the full
command. Package scripts (`pnpm test`), compound commands (`&&`, `;`, `|`),
unknown runner options, collection or import errors and failures in several
files keep the full command; the case file names the reason, and the evidence
line reports `focused=<kept>/<rejected>` when focused reruns ran.

Sutura never repairs its own repair branches. The generated workflow skips a
failed run on a `sutura/fix-*` branch, and the Action reports the outcome
`repair-branch-skipped` without commenting, checking, or opening a pull request.
Like `already-attempted`, that outcome fails the job only under `require-fixed`.

### Your CI on a repair pull request

The **Sutura repair verification** check reports what Sutura verified in its
sandbox. It does not replace your repository's CI. When the repair pull request
is opened with the workflow's own `github.token`, GitHub does not run your
`pull_request` CI on it normally. In the Sutura demo repository GitHub held each
such run for approval (`action_required`), and unapproved held runs were later
failed by GitHub with an email to the owner.

To run your CI on the repair, either approve the held run from the pull request,
or pass a GitHub App installation token as `github-token` (for example from
`actions/create-github-app-token`). Grant the App the same repository access as
the generated workflow: actions read, checks write, contents write, and pull
requests write. Pull requests opened with an App token trigger CI normally.

## Check and configure an installation

Run `doctor` from the repository whenever setup or credentials change:

```bash
sutura doctor
```

It checks the local workflow, exact installed Action contract, required permissions and inputs, secret/variable names, default-branch activation and bounded trigger history. Names do not prove credential validity. Configured-but-unexercised, missed eligible events and unknown history are separate. Preparation, reproduction, native checks and integration remain unmeasured until their own evidence exists. Incomplete readiness returns 2; operational errors return 1.

Common configuration:

- Set `runtime` to `node` or `python` in protected `.sutura.json` when automatic
  detection finds equal evidence for both runtimes.
- Keep the generated advisory behavior for normal use. The `require-fixed`
  Action input makes every admitted repair result other than `fixed` fail the
  Sutura job. Inspection-only stops and skipped repair jobs are not repairs.
- Keep branch protection and human review enabled.
- Lower Action budgets when needed. Action inputs cannot raise the core safety
  maxima. The triage sandbox budget's default (240 seconds) sits below its
  maximum (3600), so a repository with a slow suite can raise
  `triage-sandbox-seconds` up to that maximum.

## Upgrade a repository

Each repository pins its own immutable Action commit. Updating a global npm
package, or running a newer CLI elsewhere on the machine, does not update any
installed workflow.

Review `sutura upgrade --plan --workflow "CI" --repo example/project`, then use its exact apply command. The preview changes immutable Action pins while preserving App-token wiring, custom jobs, permissions and unrelated configuration. Drift produces a three-way conflict rather than an overwrite. `init --force` cannot bypass ownership or review.

Repeat the reviewed update for each installation. Doctor reports installed source independently of the CLI's desired version; an old Action's unknown contract is not silently assigned newer capabilities.

## Pause or resume repairs

Use `sutura pause --plan --workflow "CI" --repo example/project` or the corresponding `resume` command. Apply the exact reviewed digest. These commands require a proven admission guard and check the prior `SUTURA_DISABLED` value before changing it. They do not alter CI routing modes.

## Rotate credentials

Replace a secret through the GitHub CLI; it prompts for the new value without
putting it in the command line:

```bash
gh secret set NEBIUS_API_KEY
gh secret set CONTREE_TOKEN
gh secret set TAVILY_API_KEY
gh secret set OPENAI_API_KEY
gh secret set TYPESAFE_API_KEY
gh variable set CONTREE_PROJECT
sutura doctor
```

Omit Tavily when the installation uses `--no-tavily`. `OPENAI_API_KEY` and
`TYPESAFE_API_KEY` are optional.

## Remove Sutura

Pause first if an attempt may still be running. Preview `sutura remove --plan --workflow "CI" --repo example/project` and apply its exact digest. Removal deletes only an unchanged wholly owned generated workflow. Customized/unowned files require an explicit manual diff through your normal review process. Credentials, comments, checks, workflow artifacts, repair branches, pull requests and local evidence remain retained. Commit the reviewed workflow deletion normally; local removal does not change the default branch until published.

## Troubleshooting

### `init` cannot find a workflow

Add or enable the repository's CI workflow first. When multiple workflows are
present, pass their exact top-level `name` with `--workflow`.

### `doctor` reports a missing or unsafe workflow

Run the command from the repository root. Confirm that
`.github/workflows/sutura.yml` is a regular file rather than a symbolic link.

### `doctor` reports a missing secret or variable

Configure the named value with `gh secret set` or `gh variable set`, then run
`doctor` again. `TAVILY_API_KEY`, `OPENAI_API_KEY`, and `TYPESAFE_API_KEY` are
optional; the other reported credentials are required.

### The monitor does not run

Confirm that the Sutura workflow is on the default branch, GitHub Actions is
enabled, the monitored workflow name still matches, and `SUTURA_DISABLED` is
not `true`. A successful target run intentionally skips the repair job.

### The monitor runs against an unexpected failure

Open the Sutura run and follow its target-run link. GitHub can display a
`workflow_run` monitor under the default-branch workflow identity even when the
failed target came from another branch. The evidence comment, check, and case
file should identify the exact target run and failing source SHA.

### A run gave up because triage would exceed its sandbox budget

The triage line reads `sandbox-budget — not decided` and states how many
sandbox seconds the remaining reruns would need. Either raise the
`triage-sandbox-seconds` Action input (`SUTURA_TRIAGE_SANDBOX_SEC` for the CLI,
up to 3600) or make the failing CI step run fewer tests, then rerun the failed
workflow. A step that calls the test runner directly (for example
`pnpm exec vitest run` rather than `pnpm test`) lets Sutura rerun only the
failing test file; the case file's `Focused triage not applied:` note says why
it did not. Sutura caches nothing between
attempts, so the next run uses the new budget.

### An upgrade would overwrite custom settings

Use `upgrade --plan` to inspect minimal pin changes. Resolve the displayed three-way conflict while preserving intentional inputs and conditions, then review a fresh plan. `--force` cannot overwrite custom settings.

Report reproducible defects through the repository's
[GitHub issues](https://github.com/juan294/sutura/issues). Report security
problems privately as described in [SECURITY.md](../SECURITY.md).
