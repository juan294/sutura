# Live repair reliability implementation notes

Date: 2026-08-29

Plan: `docs/plans/2026-08-29-live-repair-reliability.md`

## Local candidate

- Implementation commit: `e9e38b6922608022d5a51105b90a9528be6de736`
- Integration target: `develop`
- Action bundle rebuilt from the candidate source
- Reuse review: clean
- Quality review: clean
- Efficiency review: clean

## Implemented control path

- Bounded Node and Python source dependency closure, with deterministic depth, file, probe, policy, path, symlink, size, binary, and credential limits
- One strict Super JSON repair proposal with no production control tools
- Controller-owned patch, diagnosed test, and candidate submission order
- Clean-baseline replacement proposals with bounded failed-parent feedback
- Exact routed inference reservation and adaptive batch reauthorization
- Multiple independent initial branches under the default budget
- Exact audited candidate ID and SHA-256 diff identity through publication
- Named local regression coverage for all nine live dogfood failure classes
- Recorded direct GitHub Action orchestration coverage through repair branch, pull request, check, comment, artifact, and idempotent redelivery

## Local verification evidence

The complete local gate passed against the implementation tree. Candidate package verification was repeated after the implementation commit so it could bind to an exact clean `HEAD`.

- Core: 710 passed, 8 skipped
- Action: 70 passed
- Evaluation: 5 passed
- CLI: 81 passed
- Placebo: 70 passed
- Repository total: 936 passed, 8 skipped
- Typecheck: passed for all five buildable workspace packages
- Lint: passed for all five buildable workspace packages
- Build: passed for all five buildable workspace packages
- Candidate package install: passed for `sutura@0.2.0` with Action `e9e38b6922608022d5a51105b90a9528be6de736`
- README setup tests: 3 passed
- README isolated setup verification: passed
- Vendored runtime verification and offline `darwin-arm64` smoke: passed
- Release contracts: 22 passed
- `git diff --check`: passed

## Remote proof

Pending Phase 5 exact-SHA CI and live dogfood evidence.
