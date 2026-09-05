# Phase 14 — Keep judge access and evidence available

Parent: [Verified repair program](../2026-09-05-sutura-verified-repair-program.md). Depends on final submission in phase 13. Sequential operational phase through December 15, 2026. Do not mark this phase complete merely because submission is done.

## Outcome and source

Judges can access the free public product, demo and evidence throughout the stated judging window, December 1–15. Retain artifacts beyond expiring GitHub job logs and rotate expiring scoped credentials before they disrupt access. This is bounded operation, not a new feature stream.

Read `packages/case-lab/README.md:1`, `src/limits.ts:1`, `src/dispatcher.ts:1`, `src/site-config.ts:1`, public deployment/rollback runbooks and final judging-access manifest. Own proposed `docs/runbooks/judging-access.md`, a dated public-safe availability/evidence index and a small local read-only checker/test only if existing acceptance tooling cannot cover it. Do not add a scheduled paid workflow by default.

## Operational contract

Assign Juan as service owner and record actual supported contact/response procedure without publishing private details. Use existing limits as the starting point; estimate expected judge use from actual phase 10/11 resource data and prepare a finite separately approved operation reserve. No unlimited free dispatch. A quota/exhaustion/outage state offers a clearly labeled recorded result and install instructions; it does not claim live execution succeeded. Preserve runtime access requirements by repairing service outages promptly under the applicable deployment/runtime authorization.

Inventory actual credential expiry dates and scope without printing credentials. Existing Case Lab documentation permits 90-day service credentials: a token created September 5 could expire around December 4, during judging. Schedule rotation based on its real expiry, preferably before December 1, with minimum scopes, explicit rotation authorization, readback and rollback. Never commit a secret or assume today's token survives December.

Archive public-safe immutable run results, trace summaries, source hashes, comparison data and video/transcript in durable project/release locations. August/September Actions artifacts with 90-day retention may disappear before judging. Verify archive downloads/hash checks independently of Actions authentication; preserve provenance and license, exclude credentials and private participant material.

Run read-only URL/pin/archive/expiry checks weekly after submission and daily during December 1–15 using local/on-demand execution. A live canary consumes runtime budget and requires an explicit capped schedule; it is not hidden inside an ostensibly read-only check. No indefinite assistant wait loop is necessary: save a runnable runbook with owner and concrete dates, execute checks when invoked/scheduled through an authorized mechanism, and retain actual observations. Creating the runbook means operations-ready, not all future checks completed.

```text
checkPublicPagesAndPinnedArtifactsWithoutDispatch()
verifyArchiveHashesAndCredentialExpiryMetadata()
if unavailable:
    record incident and affected judge path
    expose truthful recorded fallback
    prepare/execute authorized repair under local deployment gates
if approved live-canary is due and reserve remains:
    dispatch once; observe terminal; account actual units
on December15 after judging access window:
    verify final availability record; archive final evidence
    mark operation phase complete only for checks actually performed
```

## Automated success criteria

- [ ] Local checker tests distinguish HTTP success from wrong pin/stale result, private artifacts, expired metadata and unavailable live service; it never dispatches implicitly.
- [ ] Durable artifact integrity/link checks pass without logged-in GitHub access; source/evidence identities remain final.
- [ ] Quota/credential expiry/outage tests preserve labeled fallback and do not mint new unlimited permissions or expose secrets.
- [ ] Any implementation or deployment fix receives focused and standard sequential local gates before its separately authorized remote action.

## Manual success criteria and completion

Owner confirms actual monitoring/rotation mechanism, finite remaining budget and incident response. Log actual access checks across judging and any outages/remediation. Keep project evidence public after December 15; later decommissioning is a separate deliberate action. Phase closes only after the judging-access obligation is met, not when a future checklist has been written.
