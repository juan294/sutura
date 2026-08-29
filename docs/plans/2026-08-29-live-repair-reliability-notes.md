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

- Core: 711 passed, 8 skipped
- Action: 70 passed
- Evaluation: 5 passed
- CLI: 81 passed
- Placebo: 70 passed
- Repository total: 937 passed, 8 skipped
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

### First post-redesign proof

- Develop candidate: `c82eeb9e3601eb1ed229d7c4ddc7e59d1d636623`
- Develop CI: [33251773179](https://github.com/juan294/sutura/actions/runs/33251773179), passed
- Dogfood SHA: `c1f0c767d688d98b7d88a347e7f1afc35c4aae96`
- Intentional CI: [33252323239](https://github.com/juan294/sutura/actions/runs/33252323239), failed only the declared arithmetic assertion
- Sutura: [33252374229](https://github.com/juan294/sutura/actions/runs/33252374229), `gave-up`
- Terminal evidence: actual ANSI-colored Vitest output and its `❯` reporter marker prevented pnpm workspace source reconstruction, so no bounded editable source reached Super
- Response: added the exact raw log shape to core and Action production-path replay before another candidate

### Raw-log revision gate

- Core: 711 passed, 8 skipped
- Action: 70 passed
- Evaluation: 5 passed
- CLI: 81 passed
- Placebo: 70 passed in 855 seconds
- Repository total: 937 passed, 8 skipped
- Typecheck, lint, Action bundle rebuild, and all three simplification reviews: passed

### Anchored-proposal revision

- Develop candidate: `fca0535a343e670c9683faed066175309d6bfe6a`
- Develop CI: [33253462024](https://github.com/juan294/sutura/actions/runs/33253462024), passed
- Dogfood SHA: `742390f8a9cc7e7657b89a551282338eecd76e5c`
- Intentional CI: [33254012677](https://github.com/juan294/sutura/actions/runs/33254012677), failed only the declared arithmetic assertion
- Sutura: [33254087287](https://github.com/juan294/sutura/actions/runs/33254087287), `gave-up`
- Terminal evidence: four provider-schema-valid replies failed stricter local proposal bounds; two more proposals failed the redundant exact `old` source-copy contract
- Response: aligned provider and local schema bounds from one shared contract, replaced exact old-text copying with inclusive source line anchors, and made the controller derive exact old bytes and the unified diff
- Edge coverage: Unicode length parity, whitespace-only values, unsafe line integers, repeated lines, overlap, pure deletion, LF, CRLF, and unterminated final lines fail closed or render exact git-applicable patches as declared

### Anchored-proposal local gate

- Core: 720 passed, 8 skipped
- Action: 70 passed
- Evaluation: 5 passed
- CLI: 81 passed
- Placebo: 70 passed in 952 seconds
- Repository total: 946 passed, 8 skipped
- Typecheck: passed for all five buildable workspace packages
- Lint: passed for all five buildable workspace packages
- Build and Action bundle rebuild: passed
- Reuse review: clean
- Quality review: clean
- Efficiency review: clean
- `git diff --check`: passed

### Completion-budget revision

- Develop candidate: `d23da3d49627b2709841ad3c0278d5e1bd5a297d`
- Develop CI: [33256021182](https://github.com/juan294/sutura/actions/runs/33256021182), passed
- Dogfood SHA: `6539ec9b949c4ba0049b3331c1e379a6dc182ef7`
- Intentional CI: [33256572917](https://github.com/juan294/sutura/actions/runs/33256572917), failed only the declared arithmetic assertion
- Sutura: [33256632878](https://github.com/juan294/sutura/actions/runs/33256632878), `gave-up`
- Terminal evidence: five Super replies reached the exact 8,192 combined output and reasoning token ceiling and returned invalid JSON; one shorter reply failed the strict schema
- Response: reserve a 16,384-token low-effort completion envelope, include the compact schema shape in the prompt, preserve provider length terminals through the shared LLM contract, and stop adaptive search globally after cancelling unfinished siblings

### Completion-budget local gate

- Core: 725 passed, 8 skipped
- Action: 70 passed
- Evaluation: 5 passed
- CLI: 81 passed
- Placebo: 70 passed in 780 seconds
- Repository total: 951 passed, 8 skipped
- Typecheck: passed for all five buildable workspace packages
- Lint: passed for all five buildable workspace packages
- Build and Action bundle rebuild: passed
- README setup tests: 3 passed
- README isolated setup verification: passed
- Vendored runtime verification and offline `darwin-arm64` smoke: passed
- Release contracts: 22 passed
- Focused completion-limit orchestration and concurrent-search tests: 63 passed
- Reuse review: clean
- Quality review: clean
- Efficiency review: clean
- `git diff --check`: passed

Final Phase 5 exact-SHA CI and live dogfood evidence remain pending.
