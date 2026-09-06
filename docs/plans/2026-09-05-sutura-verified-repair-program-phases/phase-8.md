# Phase 8 — Verdict-first Case Lab and repeatable two-patch evidence

Parent: [Verified repair program](../2026-09-05-sutura-verified-repair-program.md). Depends on phase 7. Sequential, not batch eligible. Build and inspect locally; public deployment is phase 11.

## Outcome and source

A developer understands Sutura's verdict and value before reading the execution internals. The main story demonstrates two green patches, the broken behavior in one, and the independent evidence behind acceptance/refusal. External verification uses the same result layout.

Read `packages/case-lab/src/render.ts:1`, `site.ts:1`, `result.ts:16`, `replay.ts:1`, `client.ts:1`, `labels.ts:1`, `cases.ts:1`, `limits.ts:1`, `acceptance.ts:1`, `packages/case-lab/README.md:1` and existing recorded cases completely. Own Case Lab source/content/test files, local demo script and targeted shared-report presentation if needed. Preserve fixed scenario catalog, request limits, authenticated dispatcher and secret-free browser; no arbitrary browser patch execution is added.

## Interaction specification

Create checkable local HTML states for: verified correct repair, rejected floor-only patch, flake/no patch, insufficient challenge evidence, provider/infrastructure failure and historical recorded result. Top region contains verdict, one-sentence reason, exact evidence mode/date, and next action. Then show failure → changed behavior → checks. Keep model/branch/trace details expandable below this explanation.

```text
Result
  verdict + plain-language reason
  live / replay / recorded + exact subject + timestamp
  recommended review action
  [Correct repair] [Green but broken patch]
  visible test: both pass
  preservation check: 21 items / 10 per page => expected 3
  correct patch: 3; bad patch: 2 => rejected
  evidence links / diff / checks
  expandable execution and cost details
```

Example copy: “Rejected: this patch passes the original test but undercounts a partial page.” Accepted copy: “Passed the required checks. Review the diff and the behavior tested before merging.” Never say universally safe, proven correct or production-certified. The recorded greenwash supplied-patch refusal and a live generated honest repair are different subjects; buttons must state what is being run.

Replay selects an immutable run and follows recorded operations with no provider calls. Repeated replay produces identical semantic result/evidence hashes; clock/progress animation is excluded from semantic comparison, actual measured historical time remains intact in the artifact. If a record cannot replay under the engine contract, show a labeled recorded-result view and the reason; do not silently relabel it replay. Live controls start disabled while checking real availability, then enable only when ready; explain quota, missing configuration, service outage and recorded alternatives. Retain current finite request caps unless separately reviewed and authorized.

Costs display priced inference estimate, raw/confirmed sandbox costs with units and total only where compatible. No unknown equals zero. Hide unnecessary infrastructure jargon in the first screen, retain transparent detail on demand. Provide a concise CLI verify command route with source/policy identities and read-only Action setup link; arbitrary patch upload remains CLI/Action only.

## Automated success criteria

- [ ] Render tests cover all six states; no infrastructure/insufficient result gets accepted color/text or green scenario expectation.
- [ ] Regression comparison binds the same baseline, exact two diff hashes, old visible test and new independent checks. Historical artifacts retain original mode/hash and annotation.
- [ ] Replay tests execute twice with network/provider spies and compare semantic outputs; mismatch, unsupported version and missing artifact have explicit recorded fallback.
- [ ] Browser interaction tests cover keyboard tabs, focus, expanded evidence, status announcements, responsive layouts and live-button readiness/quota transitions. Cost fixtures cover unknown units and partial records.
- [ ] `pnpm --filter @sutura/case-lab test` passes; run local build and existing acceptance validator. No hosted screenshots or preview deployment needed.

## Manual success criteria

Inspect locally in browser at narrow and desktop widths, keyboard-only and signed-out-equivalent state. Confirm verdict/why/next action fits the first meaningful screen, public artifacts contain no secrets, and a reader can distinguish two submitted patches from two execution modes. Save actual screenshots after implementation, not invented mock evidence. Five-person comprehension measurement belongs to phase 12.

## Phase gate

Follow the parent plan's implementation/review/fix/simplification loop. Run focused checks and the standard local commands sequentially: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`. Rebuild the committed Action bundle for core/Action changes, run `pnpm run verify:bundle`, and complete `pnpm run ci:local` before any later push involving core. New process/build/sandbox tests use explicit timeouts of at least 30 seconds. Inspect actual hosted triggers before any push; never create a Vercel preview or use hosted CI to debug. Record actual results and the integrated source identity; stop after this phase. Remote actions and participant messages require the concrete authorization described in the parent plan.

## Progress record — September 6

Not started. No source, test, artifact, message or dispatch belonging to this phase exists.
