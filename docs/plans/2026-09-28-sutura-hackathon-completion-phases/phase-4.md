# Phase 4 — Public pilot and installation path

Parent: [Hackathon completion](../2026-09-28-sutura-hackathon-completion.md). Depends on accepted phase 3 measurement. Target exit October 14. Owner: Sutura release owner. Follow [verified repair phase 11](../2026-09-05-sutura-verified-repair-program-phases/phase-11.md?plain=1#L1) and the [release playbook](../../release/e2e-pro-playbook.md); release, push, npm, Marketplace and deployment actions require their applicable separate authority.

## Work

Run the pre-release audit, simplify/review/remediation and exact-candidate local gates. Verify package, Action bundle, install instructions, tag plan and current public Case Lab state. Inspect CI and Vercel triggers before the single integration push; do not create a Preview. Under an approved release operation, publish one pilot release through the documented `develop` → `main` path. Bind npm, immutable Action, GitHub release, Case Lab code and demo workflow to actual release identities. Run provider/image canaries, public eight-case matrix, public npm and Action install smoke, then verify the Marketplace listing and one public install smoke against that release. Full Marketplace adoption validation follows phase 5's three valid installs. The v0.3.3 [Case Lab record](../../release/v0.3.3-case-lab-record.md?plain=1#L52) is a procedure example, not proof for the pilot.

## Acceptance

Automated: Local package/Action/install contracts, bundle parity, release evidence checks and public-matrix ledger pass on the candidate/release identities they declare. After authorized push, inspect all expected CI for the exact pushed SHA. Read back npm/tag/Action/demo pins. Public checks distinguish recorded, replay and live modes; no replay is relabeled live.

Manual: Signed-out desktop/mobile judge can open a repair, refusal and flake result, inspect provenance and download stable evidence. One public npm and Marketplace install smoke resolves the immutable Action SHA and gives a valid result; the independent three-install adoption gate remains in phase 5. Record actual time/cost and every failed check. A pilot release does not satisfy final submission readiness if phase 5 findings require a new candidate.

If registry propagation, CI, preview policy, deployment health, listing or public matrix fails, keep the published result and its failure evidence; diagnose locally and request new remote authority for a corrected release. Do not rerun remote jobs or repush automatically. Phase 5 receives the validated public artifact and install instructions.
