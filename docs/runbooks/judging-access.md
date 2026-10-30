# Judging access and evidence retention

Owner: Juan González Ponce. Judging window: December 9 at 17:00 UTC through
December 23, 2026. Keep public
access available through **2026-12-23T20:00:00Z**. Read-only continuity checks
begin before judging. No future check is recorded as completed here.

Live operation reserve: on 2026-10-07 Juan approved a finite reserve of about USD 40 in
total for Case Lab live runs during judging. The daily spend stop stays at USD 18 and each
run is capped at USD 0.75 in the worst case. This is a ceiling for the owner, not money
set aside. Checked in the Token Factory console on 2026-10-07: account balance USD 24.12,
October consumption USD 1.27 so far, and the only paid invoice is USD 1.00 (the rest is
credit). The balance covers about 32 worst-case runs, not the full USD 40 ceiling, so a top-up
of about USD 16 is needed if the full reserve must be funded. Recheck the balance during the
November 16-20 inventory. The November 16-20 and November 27 steps below are on Juan's
calendar.

## Before submission

After the final release, retain a public judging manifest beside the release
evidence index. It must name actual public artifact URLs: installation and
Action documentation, pinned source/evidence JSON, the recorded fallback,
video and transcript, and the live availability page. Keep immutable public
archives independently of expiring GitHub Actions artifacts. Do not include
participant records, secrets, tokens, or authenticated download URLs.

Each artifact has `name` and `url`. Use HTTPS without embedded credentials.
Use `method: GET` for archives. Bind archive bytes with
`expectedResultHash` (SHA-256). Pinned JSON evidence additionally declares
`expectedPin` (the exact 40-character source commit) and `pinField` (the actual
top-level JSON property containing that commit). `HEAD` is only suitable for
reachability; it cannot establish a byte hash or served source identity.
`expiresAt`, when used, is an actual UTC expiry copied from authorized
metadata, not an estimated lifetime. The manifest names `liveArtifactName`
and `fallbackArtifactName` when it includes both paths.

The [public manifest](../demo/judging-access-manifest.json) pins release
README, installation documentation and the Action contract to v0.5.1 commit
`ddab42eadc92801f97c4745ed10f7e467b9843c8`. The independent recorded fallback is
public raw GitHub JSON at repository commit
`37107a26e06310ff4a8541d3ef5e282f0ad32a88`: the v0.4.1 benchmark, whose actual
`controllerSha` is `3b6152d9d72beebd7dcbaaa4045c94d640456adb`. Its SHA-256 binds
the exact downloaded bytes. This recording is historical evidence, not a new
measurement of v0.5.1. It remains accessible independently of Vercel and
expiring Actions artifacts.

Case Lab home, health and five recorded pages are anonymous reachability
checks only. HTTP 200, including `/api/health`, does not establish a live
execution or valid dispatcher credentials. The collector does not validate
video playback. Its video-page check is labeled historical v0.3.9. The manifest
omits `liveArtifactName`, so `servedPath: durable-only` asserts no dispatchability.
An exact public final-video transcript is not yet established;
a recording script must not be relabeled as that transcript.

## Remaining continuity work

Credential rotation and verification of provider credit expiry through the
judging cutoff remain required. Actual expiry metadata and the owner handoff
are tracked in the private operational inventory. Public HTTP reachability
checks do not resolve these blockers or establish uninterrupted live operation.
No credential rotation or funding change is performed by this preparation.

## Check procedure

From the repository root, run the collector with the final manifest path and
a new dated output directory (never reuse an existing directory):

```sh
node scripts/judging-access-collect.mjs docs/demo/judging-access-manifest.json docs/agents/judging-access-2026-12-09
```

The collector permits only anonymous GET/HEAD, rejects redirects, imposes
15-second transport and 16-MiB per-artifact limits, and checks at most 32 artifacts. It
stores exact downloaded bytes under their SHA-256 and writes `report.json`.
It never dispatches a canary, repairs a deployment, supplies credentials, or
raises a quota. Exit zero means all named reachability and declared identity checks passed;
it does not establish paid execution readiness. A nonzero result
requires reading the report; a usable recorded fallback remains explicitly
identified when live access is unavailable. If both paths are down, the collector
still writes every observation with `reasonCode: no-usable-path` and
`servedPath: unavailable`. Responses arriving after the transport deadline are
not archived.

Retain each report and verified archive in the durable public evidence area
after checking for private material. Publishing those records remains a
separately authorized operation. A local successful download alone does not
prove the durable public archive has been published.

## Calendar and response

- After publication on the default branch, `.github/workflows/judging-access.yml`
  runs the existing anonymous collector daily at 10:20 UTC, without provider
  credentials, dependencies or dispatch. Reports and collected bytes are retained
  in Actions artifacts for 90 days; failures remain failed. Those reports are
  operational receipts, not the independent public fallback. A local workflow
  file does not establish hosted scheduling or activation.
- November 16–20: inventory actual expiry dates and scopes through authorized
  provider metadata. Resolve missing metadata before claiming readiness.
  Review the expected judging traffic and request a finite live reserve using
  measured release costs. Existing Case Lab limits are ceilings, not a new
  spending authorization.
- By November 27: prepare any necessary credential rotation with minimal
  scopes, a readback check and rollback procedure. Execute rotation only with
  Juan's authorization. A nominal 90-day token lifetime is not expiry evidence.
- December 9–23: review the daily check and repeat it after an incident repair.
  Review the report the same day. Record the affected artifact, first observed
  time, fallback availability and repair outcome in the evidence index.
- After December 23 at 20:00 UTC: retain the final check and incident ledger.
  Close this phase only after the observed access obligation is fulfilled.
  The workflow skips URL collection after that cutoff; disable its schedule
  during closeout under the existing authorization. Keep the public
  evidence available; decommissioning requires a separate decision.

An unavailable live service must display the labeled recording and install
instructions. If both paths fail, report the incident and restore a usable
path under the existing deployment authorization procedure. Do not relabel a
recorded result as live, expand token scopes automatically, or rerun paid
measurements as an availability test. Juan owns operational decisions through
the existing project communication channel; no private contact information is
published here.

The existing [Case Lab operations documentation](../../packages/case-lab/README.md)
contains the runtime limits and emergency disable procedure. Live canaries
need an explicit capped schedule and cumulative accounting separate from this
read-only collector.
