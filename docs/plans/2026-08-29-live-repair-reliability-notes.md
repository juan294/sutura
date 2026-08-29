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

### Path-range revision

- Develop candidate: `c7f312584d3d801345d49a7873cf4c22995b3761`
- Develop CI: [33258309351](https://github.com/juan294/sutura/actions/runs/33258309351), passed in 11 minutes 37 seconds
- Dogfood SHA: `23d7adb3017bfae10ca59e46a8b0243b11b17221`
- Intentional CI: [33258931783](https://github.com/juan294/sutura/actions/runs/33258931783), failed only the declared arithmetic assertion after 725 core tests passed and 8 live tests skipped
- Sutura: [33258981625](https://github.com/juan294/sutura/actions/runs/33258981625), `gave-up`
- Terminal evidence: seven Super replies finished below the completion cap; six selected ranges outside the three-line source, and one accepted patch failed the trusted test
- Response: derive one path-discriminated provider schema and numbered prompt evidence from the exact bounded source closure

### Path-range local gate

- Core: 730 passed, 8 skipped
- Action: 70 passed
- Evaluation: 5 passed
- CLI: 81 passed
- Placebo: 70 passed in 848 seconds
- Repository total: 956 passed, 8 skipped
- Focused path-range core replay: 266 passed
- Focused Action orchestration replay: 6 passed
- Typecheck: passed for all five buildable workspace packages
- Lint: passed for all five buildable workspace packages
- Build and Action bundle rebuild: passed
- README setup tests: 3 passed
- README isolated setup verification: passed
- Vendored runtime verification and offline `darwin-arm64` smoke: passed
- Release contracts: 22 passed
- Reuse review: clean
- Quality review: clean
- Efficiency review: clean
- `git diff --check`: passed

Final Phase 5 exact-SHA CI and live dogfood evidence remain pending.

### Controller-selected replacement revision

- Develop candidate: `1f7a768d9940905f1c4e619d77f204ecc74bb4c1`
- Develop CI: [33261011801](https://github.com/juan294/sutura/actions/runs/33261011801), passed
- Dogfood SHA: `f71a7d136a664a84f21ed44096d82cd132e72b6e`
- Intentional CI: [33261605582](https://github.com/juan294/sutura/actions/runs/33261605582), failed only the declared arithmetic assertion after 730 core tests passed and 8 live tests skipped
- Sutura: [33261662501](https://github.com/juan294/sutura/actions/runs/33261662501), `gave-up`
- Terminal evidence: six invalid target ranges and two applied patches that failed the trusted test
- Response: remove path and line selection from provider output; assign one policy-admissible complete excerpt to each repair branch and accept only its complete replacement text
- Local review response: share a 1,000-code-point source and replacement bound, prove the worst JSON-escaped reply stays below half the completion envelope, deduplicate baseline admission quotes, and expand the initial search to reach every admitted target when budgets permit
- Final review response: treat executor and provider availability as batch concurrency rather than total target authorization, fail closed when aggregate budgets cannot cover every target, center bounded excerpts on the observed line, and omit incomplete boundary lines before inference

### Controller-selected replacement local gate

- Core: 740 passed, 8 skipped
- Action: 70 passed
- Evaluation: 5 passed
- CLI: 81 passed
- Placebo: 70 passed in 863 seconds
- Repository total: 966 passed, 8 skipped
- Typecheck: passed for all five buildable workspace packages
- Lint: passed for all five buildable workspace packages
- Build and Action bundle rebuild: passed
- README setup tests: 3 passed
- Release contracts: 22 passed
- Reuse review: clean
- Quality review: clean
- Efficiency review: clean
- `git diff --check`: passed

The new Phase 5 exact-SHA and live dogfood proof remains pending.

### One-field proposal revision

- Develop candidate: `9648815d76ef496dc4397294e7f55830a214365a`
- Develop CI: [33264700186](https://github.com/juan294/sutura/actions/runs/33264700186), passed in 11 minutes 38 seconds
- Dogfood SHA: `d4969c24b58c9df3b34eff205fdfed79091dddaa`
- Intentional CI: [33265268595](https://github.com/juan294/sutura/actions/runs/33265268595), failed only the declared arithmetic assertion after 740 core tests passed and 8 live tests skipped
- Sutura: [33265333427](https://github.com/juan294/sutura/actions/runs/33265333427), workflow passed but product outcome was `gave-up`
- Terminal evidence: three strict-schema failures, one trusted-test failure after an accepted patch, one rejected patch, and one 16,384-token completion-limit terminal; baseline Super completions used 12,884 to 16,384 tokens from about 4,922 input tokens
- Response: accept only `{replacement}`, derive proposal identity and rationale in the controller, disable reasoning, use `temperature: 1` and `top_p: 0.95`, and reserve an 8,192-token completion envelope
- Local regression response: legacy model-owned metadata fails before sandbox work; provider and local replacement bounds match; maximally escaped output fits the declared envelope; patch, test, and submission remain controller-owned

### One-field proposal local gate

- Core: 745 passed, 8 skipped
- Action: 70 passed
- Evaluation: 5 passed
- CLI: 81 passed
- Placebo: 70 passed in 1,314 seconds
- Repository total: 971 passed, 8 skipped
- Typecheck: passed for all five buildable workspace packages
- Lint: passed for all five buildable workspace packages
- Build and Action bundle rebuild: passed
- Reuse review: clean
- Quality review: clean
- Efficiency review: clean
- `git diff --check`: passed

### Model-specific thinking-control revision

- Develop candidate: `3e14fc835727b168c6a451c2022989dd46d21130`
- Develop CI: [33267438324](https://github.com/juan294/sutura/actions/runs/33267438324), passed in 11 minutes 50 seconds
- Dogfood SHA: `7488afea0c123f3ef84354301c6a1d90e4f9cfb0`
- Intentional CI: [33268037618](https://github.com/juan294/sutura/actions/runs/33268037618), failed only the declared arithmetic assertion after 745 core tests passed and 8 live tests skipped
- Sutura: [33268103281](https://github.com/juan294/sutura/actions/runs/33268103281), workflow passed but product outcome was `gave-up`
- Terminal evidence: all four search branches stopped at HTTP 400 before Super inference because the endpoint rejected `reasoning_effort: none`
- Response: add typed model chat-template thinking controls, serialize thinking-off as `extra_body.chat_template_kwargs.enable_thinking: false`, reject conflicting reasoning controls, and omit `reasoning_effort` from production repair requests
