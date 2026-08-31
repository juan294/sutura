# Phase 8: GitHub Checks and audit-only distribution

Dependencies: Phase 7

Batch status: `[batch-eligible]` with Phase 9

## Goal

Improve GitHub review evidence and provide reduced-assurance auditing without ConTree credentials.

## Current evidence

The GitHub port supports comments, pull requests, and artifacts only (`packages/core/src/orchestrate.ts:86-95`).

The action adapter has no Checks methods (`packages/action/src/github.ts:49-79`).

The installer omits `checks: write` (`packages/cli/src/setup.ts:44-48`).

The CLI already accepts a candidate diff for verified healing (`packages/cli/src/args.ts:14-20`).

That path still requires ConTree (`packages/cli/src/heal.ts:290-298`).

## Files

Add:

- `packages/action/src/checks.ts`
- `packages/action/src/checks.test.ts`
- `packages/core/src/audit-only.ts`
- `packages/core/src/audit-only.test.ts`
- `packages/core/src/report/audit-markdown.ts`
- `packages/core/src/report/audit-casefile.ts`
- matching fixtures and snapshots

Modify:

- `packages/core/src/orchestrate.ts`
- `packages/core/src/domain.ts`
- `packages/core/src/index.ts`
- `packages/action/src/github.ts`
- `packages/action/src/octokit.ts`
- `packages/action/src/main.ts`
- `packages/action/src/evidence.ts`
- `packages/cli/src/args.ts`
- `packages/cli/src/cli.ts`
- `packages/cli/src/heal.ts`
- `packages/cli/src/setup.ts`
- `packages/cli/src/doctor.ts`
- `packages/cli/src/doctor.test.ts`
- `.github/workflows/sutura.yml`
- action metadata and README files

Update matching tests and rebuild CLI and action bundles.

Do not modify `packages/placebo/**` in this phase.

## GitHub Check lifecycle

Create one in-progress check with a stable repository and run `external_id`.

Store the check-run ID with the atomic attempt claim.

On redelivery, recover the existing check independently from the comment claim.

Target the exact failing SHA.

Update the same check through terminal completion.

Use this conclusion mapping:

```text
fixed -> neutral
flaky-no-patch -> neutral
refused -> action_required
gave-up -> action_required
infra-stop -> action_required
```

Keep the existing comment as the durable discussion record.

Link both surfaces to the same HTML artifact.

Validate annotation paths against the exact checkout. Bound annotations to GitHub limits.

Add `checks: write` to generated and dogfood workflows.

Complete any created check from a bounded failure-safe path in `packages/action/src/main.ts`.

This path runs after provider, sandbox, artifact, or serialization exceptions.

Document that maintainers can require the Sutura check, but `fixed` stays neutral on repair pull requests.

## Audit-only command

Add this explicit command:

```text
sutura audit \
  --case-dir /tmp/sutura-audit/case \
  --candidate-diff /tmp/sutura-audit/candidate.diff \
  --before-log /tmp/sutura-audit/before.log \
  --after-log /tmp/sutura-audit/after.log \
  --format json
```

Require only `NEBIUS_API_KEY`.

Use Nano to classify the redacted before and after logs.

Apply built-in patch rules, repository policy, and Ultra adjudication.

Include Nano and Ultra usage in cost evidence.

Require both logs from the same allowlisted command.

Refuse when the before log does not fail or the after log does not pass.

Use supplied CI evidence. Do not reproduce, race, or execute the patch.

Return a separate schema:

```text
AuditFile {
  assurance: "reduced"
  outcome: "audit-approved" | "audit-refused"
  diagnosis
  policy
  audit
  cost
}
```

Never report `fixed`, `verified`, or `flaky-no-patch` from audit-only mode.

Never open a branch or pull request.

## Automated success criteria

- One check targets the exact failing SHA.
- Redelivery updates the existing check.
- Every terminal Sutura outcome completes the check.
- Unexpected failures after check creation complete the same check.
- Invalid annotation paths never reach GitHub.
- The comment and check link to the same artifact.
- Installer output includes `checks: write`.
- `doctor` verifies `checks: write`, required inputs, and the action reference.
- Audit-only works without ConTree credentials.
- Audit-only never invokes the executor.
- Audit-only cannot report a verified outcome.
- Missing, ambiguous, symlinked, or oversized evidence fails closed.
- Audit-only requires paired before and after evidence for one command.
- Audit-only cost includes every Nano and Ultra call.
- Audit-only reports contain visible reduced-assurance language.
- The complete local gate passes.

## Manual success criteria

- Run one real GitHub Action and inspect the check on the exact failing commit.
- Confirm the action token can create and update the check.
- Run audit-only against one honest patch and one Placebo patch.
- Confirm neither audit-only run creates remote state.

## Exit evidence

Record one public check URL and one sanitized audit-only result under `docs/demo/`.

Document the assurance difference in the CLI README and main README.

## Implementation evidence

- Local automated implementation is complete. The sanitized reduced-assurance example is `docs/demo/sutura-audit-only-local-v1.json`.
- The public check URL, live token-permission inspection, and live honest/Placebo audit runs are pending. Phase 8 did not call GitHub, Token Factory, ConTree, or other provider services.
- Audit evidence uses one trusted allowlisted `Run <command>` or `$ <command>` identifier and one GitHub `Process completed with exit code N` marker in each log. Both command identifiers must match exactly.
