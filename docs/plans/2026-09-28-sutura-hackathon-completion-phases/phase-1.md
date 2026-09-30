# Phase 1 — Fleet evidence and recovery attribution

Parent: [Hackathon completion](../2026-09-28-sutura-hackathon-completion.md). Target exit October 1. Planning base `d249c2562704d4b42c22a08e06c5ffd0dc2bfe9c`; recheck before execution. This phase is local and read-only toward GitHub except for an authorized integration push after local verification. Owner: Sutura integration owner.

## Work and source contract

Use the existing [collector](../../../scripts/fleet-dogfood-metrics.mjs#L254), [documentation](../../adoption/fleet-dogfood-metrics.md?plain=1#L1), [tests](../../../scripts/fleet-dogfood-metrics.test.mjs#L14) and [#139](https://github.com/juan294/sutura/issues/139). The collector already reads monitor artifacts but hard-codes recovery unknown at `scripts/fleet-dogfood-metrics.mjs:379`. Reconcile the ignored private fleet config with the actual repository set and historical Action pins without overwriting unrelated local settings. Include active, disabled, uninstalled, inaccessible and no-failure states; do not infer live operation from a workflow file. Keep raw repository/run events in ignored `.sutura/`; prepare only sanitized aggregates and consented public examples for `docs/demo/`.

Version the output contract so an event's observed Action SHA and release cohort do not depend on one current config SHA. Persist immutable, content-hashed parsed terminal evidence locally before Actions artifacts expire; write checkpoints atomically and retain previously known evidence across crash, rerun and partial API failure. Correlate failed/timed-out CI run, Sutura monitor result, exact repair PR/diff, repair CI, merge or integration commit, intended branch and next same-workflow green. Claim agent fallback only with authenticated session/actor provenance and the same incident/branch/workflow relationship; author text or temporal next-green alone becomes `resolved-externally` or `unknown`. Preserve `unknown` for expired artifacts, missing cost, ambiguous PRs and changed branch heads. Use each repository's actual monitor activation date to define its preceding 45-day comparison, with the same branch/workflow recovery definition; record unavailable historic runs, pagination coverage and censoring rather than implying one fleet-wide window. Reuse the richer event and attribution semantics in [CI recovery phase 4](../2026-09-14-sutura-ci-recovery-phases/phase-4.md?plain=1#L7), while keeping autonomous recovery implementation out of scope.

```text
@ classifyFleetIncident(ciRun, monitor, githubTimeline) -> incident
ctx: GitHub read API, local ignored evidence cache
pre: repository/workflow/branch and run IDs are exact
do:
  1. lookup failed run and Sutura terminal artifact
  2. lookup repair PR, repair CI and target-branch CI by exact identities
  3. compute recovery state and evidence coverage
  4. write versioned local event and sanitized aggregate
br: if links are absent or ambiguous -> unknown or unresolved with reason
fx: local evidence files only
risk: a green monitor or PR alone can falsely inflate recovery
```

## Acceptance

Automated: TDD fixtures cover Sutura-green, proposal-only, authenticated agent-fallback-green, externally resolved, unresolved, flake/refusal/gave-up/infra-stop, expired artifact, ambiguous branch, rebased PR, missing cost, pagination and mixed historical pins. Crash/restart and artifact-expiry tests preserve already parsed proof; partial collection cannot overwrite a complete prior event. Mutations that remove target-branch green or authenticated actor provenance remove the corresponding recovery claim. Public-export fixtures use sentinel repository names, private URLs, logs, source and identifying text and prove none survives sanitization; detailed events stay ignored. Versioned v1 output remains interpretable. Run collector tests, release contracts and all applicable workspace gates sequentially.

Manual/read-only: Independently trace one event of each available outcome against GitHub UI/API; mark unavailable outcome classes as a coverage gap. Reconcile every configured repository and every eligible incident in the declared window. Report attempted, verified PR, recovered, fallback, unresolved and unknown counts with denominators, cost coverage and exact observation dates. A public-safe case needs explicit redaction review; private rows stay local. No claim of saved agent subscription dollars.

Expired or unreadable artifacts with a known incident denominator receive `unknown` with an exact reason and can remain in the completed report. Missing API pages or inaccessible repositories that make the denominator unbounded block the completeness claim until access returns or the affected scope is explicitly labeled unmeasured. Phase 2 receives the measured blocker list and public-case candidates.

`[batch-eligible]` Read-only GitHub timeline sampling and local collector fixture design can proceed separately; the integration owner alone changes collector output and tests. No working branch is pushed for this batch.
