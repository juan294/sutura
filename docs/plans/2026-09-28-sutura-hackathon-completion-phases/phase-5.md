# Phase 5 — Independent adoption and repair

Parent: [Hackathon completion](../2026-09-28-sutura-hackathon-completion.md). Depends on phase 4's working public pilot. Target exit October 20. Owner: study coordinator plus Sutura integration owner. Follow [verified repair phase 12](../2026-09-05-sutura-verified-repair-program-phases/phase-12.md?plain=1#L1) and [prepared study contract](../../adoption/verified-repair-study.md?plain=1#L1). Participant messages and public quotation need explicit authorization and item-specific consent.

## Work

Recruit three developers unfamiliar with Sutura for independent installs in repositories they know, including JavaScript/TypeScript and Python. Run five real reviewer sessions with first unaided comprehension and counterbalanced ordinary-CI versus Sutura evidence tasks. Record every invitation, setup failure, manual intervention, withdrawal, verdict decision, correctness, elapsed time and assistance in private records; publish only consented aggregates. Use `scripts/adoption-study.mjs:1`, `scripts/review-study.mjs:1` and their existing tests. Include one repair, one refusal and one flake through the external installation path. Obtain two genuine external-agent supplied diffs for the verifier if phase 3 did not already complete that evidence.

Triage each product finding. Reproduce confirmed defects with a failing test, fix in an isolated worktree, review/simplify and rerun affected local and live gates under a new candidate/authorization as needed. Do not silently retain old benchmark or install claims after a behavior change. Update install instructions from observed friction, not only internal expectations.

## Acceptance

Automated: Study validators reject a missing invited participant, unbalanced task order, unsupported success, wrong release pin, private raw data in public export and a changed candidate masquerading as the old pilot. Local gates and affected runtime gates pass after fixes.

Manual: Three validated independent public-artifact installations and five completed reviewer sessions exist, with every failed or withdrawn attempt and assistance retained in the denominator. The full Marketplace adoption validator runs against these records. At least four of five reviewers identify verdict, rejection reason and next safe action within 60 seconds unaided, or the UX is repaired and rerun with a declared new/repeated cohort. Findings have explicit fixed, rejected-with-evidence or unresolved-blocker dispositions. No quote or repository name is published without specific consent.

If recruitment or consent is incomplete, show actual counts and keep adoption readiness false. Phase 6 receives the final trial report, finding dispositions, affected-gate reruns and exact pilot/final candidate relation.

`[batch-eligible]` Consented study scheduling and local documentation drafting may run independently of code repairs; no two implementers own the same release, study-record or source files.
