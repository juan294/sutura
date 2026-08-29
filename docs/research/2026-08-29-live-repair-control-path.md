# Sutura live repair control-path research

Date: 2026-08-29

Baseline: `develop` at `f0fd17af8986278ca8ad43416ceb7b90920e8cd9`

Question: What happened in the nine v0.2 dogfood runs, and how does the current GitHub-to-repair-PR path operate?

## Observed GitHub state

The current `develop` candidate passed its complete CI workflow at [run 33247927685](https://github.com/juan294/sutura/actions/runs/33247927685).

Each dogfood branch adds the same two-file arithmetic case: the test expects `add(2, 3)` to equal `5`, while the implementation subtracts the arguments. The CI workflow is therefore expected to fail before Sutura starts. The Sutura workflow listens only to completed failed or timed-out CI runs (`.github/workflows/sutura.yml:3-6`, `.github/workflows/sutura.yml:20-24`).

All nine paired Sutura workflows completed at the GitHub Actions level. Each case file recorded `gave-up`, and the Sutura check mapped that result to `action_required`. The action distinguishes the workflow process result from the repair result: `gave-up` completes the evidence workflow but does not open a repair pull request (`packages/core/src/orchestrate.ts:583-585`, `packages/action/src/checks.ts:27-30`).

| Dogfood | Intentional failed CI | Sutura workflow | Recorded terminal sequence |
| ---: | --- | --- | --- |
| 1 | [33238860852](https://github.com/juan294/sutura/actions/runs/33238860852) | [33238913649](https://github.com/juan294/sutura/actions/runs/33238913649) | Three Super requests stopped at HTTP 422 because the request contained `parallel_tool_calls`. |
| 2 | [33240572371](https://github.com/juan294/sutura/actions/runs/33240572371) | [33240626773](https://github.com/juan294/sutura/actions/runs/33240626773) | Three Super requests stopped at HTTP 400 because the model endpoint accepted only `none` or `auto` for `tool_choice`. |
| 3 | [33241358531](https://github.com/juan294/sutura/actions/runs/33241358531) | [33241404924](https://github.com/juan294/sutura/actions/runs/33241404924) | Two live branches read or searched for source, then exhausted the shared model-turn budget. |
| 4 | [33242204485](https://github.com/juan294/sutura/actions/runs/33242204485) | [33242249544](https://github.com/juan294/sutura/actions/runs/33242249544) | One branch reached the package test and missing `.js` implementation reference, continued searching, then exhausted model turns. |
| 5 | [33243759945](https://github.com/juan294/sutura/actions/runs/33243759945) | [33243801887](https://github.com/juan294/sutura/actions/runs/33243801887) | One branch resolved the test and `.js` reference to the tracked `.ts` implementation, then exhausted model turns before applying a patch. |
| 6 | [33244884596](https://github.com/juan294/sutura/actions/runs/33244884596) | [33244936309](https://github.com/juan294/sutura/actions/runs/33244936309) | One branch read the test and implementation, then stopped after repeated identical invalid patch calls. |
| 7 | [33246383946](https://github.com/juan294/sutura/actions/runs/33246383946) | [33246431797](https://github.com/juan294/sutura/actions/runs/33246431797) | One branch accepted the arithmetic patch, then the trusted test operation returned exit `-1`; no held candidate remained. |
| 8 | [33247360873](https://github.com/juan294/sutura/actions/runs/33247360873) | [33247419746](https://github.com/juan294/sutura/actions/runs/33247419746) | One branch accepted the arithmetic patch, then performed more repository reads and searches until model turns were exhausted. |
| 9 | [33248388988](https://github.com/juan294/sutura/actions/runs/33248388988) | [33248436223](https://github.com/juan294/sutura/actions/runs/33248436223) | One branch ran the failing test and used the remaining turns on repository searches; it did not apply a patch. |

The corresponding case-file artifacts are named `sutura-case-file-<failed-CI-run-id>.html` in each Sutura workflow. Their search ledgers contain the exact tool and terminal sequences.

## Current control path

The workflow checks out the trusted default branch and runs the committed action bundle (`.github/workflows/sutura.yml:27-40`, `packages/action/action.yml:94-96`). The action validates the exact failed run, exact head SHA, repository identity, branch, and base commit before it claims the attempt (`packages/action/src/github.ts:226-301`, `packages/core/src/orchestrate.ts:430-462`).

The repository adapter fetches and detaches the exact failed SHA (`packages/action/src/repository.ts:188-228`). Sandbox preparation installs dependencies from manifest-only input, overlays repository source, initializes a hook-disabled Git baseline, and runs the observed CI command with networking disabled (`packages/core/src/heal.ts:301-345`, `packages/core/src/heal.ts:453-545`, `packages/core/src/orchestrate.ts:522-550`).

Nano classifies the bounded failed log. The mechanically extracted command remains authoritative, while model disagreement reduces confidence (`packages/core/src/diagnose/classify.ts:168-232`). Progressive triage runs the command in batches of at most two and returns `real`, `flaky`, or `intermittent` (`packages/core/src/engine/triage.ts:47-81`, `packages/core/src/engine/flake-confidence.ts:58-106`). Only `real` failures enter repair (`packages/core/src/heal.ts:749-765`).

The production repair limits are eight Super turns, 24 tool calls, 12 branches, 32 repair sandbox operations, 600 seconds, USD 0.25 inference cost, and 65,536 diff bytes (`packages/core/src/engine/repair-budget.ts:11-19`). The search defaults are four initial branches, beam width two, depth four, and 12 total branches (`packages/core/src/engine/search.ts:7-12`). The live admission rule divides the model budget by eight for the initial branch count, so the default production path starts one branch (`packages/core/src/heal.ts:799-817`).

The repair agent exposes `read_file`, `search_repo`, `run_test`, `apply_patch`, `inspect_diff`, and `submit_candidate` to Super (`packages/core/src/engine/repair-tools.ts:37-57`). Each model response can choose any non-conflicting subset of those tools. A response without a tool, repeated invalid calls, and repeated failing states stop the branch (`packages/core/src/engine/repair-agent.ts:337-345`, `packages/core/src/engine/repair-agent.ts:405-425`). At the baseline commit, an accepted patch automatically runs the diagnosed trusted test, and a passing test automatically submits the candidate (`packages/core/src/engine/repair-agent.ts:369-403`).

Source context starts from safe paths extracted from failed logs plus failure-class fallback files (`packages/core/src/orchestrate.ts:285-338`). The repository port reads only bounded, regular, non-symlink files inside the exact checkout (`packages/action/src/repository.ts:231-302`). Additional source can enter the editable patch context after a successful `read_file` tool call (`packages/core/src/engine/repair-tools.ts:199-224`, `packages/core/src/engine/repair-tools.ts:260-297`).

Search executes one repair agent per expansion, records checkpoint images and test evidence, and retains a bounded frontier (`packages/core/src/heal.ts:842-950`, `packages/core/src/engine/search.ts:86-190`). A passing node receives deterministic patch checks, a fresh suite rerun, Ultra adjudication, and repository-required checks (`packages/core/src/audit/audit.ts:53-110`, `packages/core/src/heal.ts:638-706`).

The audit step uses the first search-ranked held candidate (`packages/core/src/heal.ts:956-974`). Publication later calls `selectWinner` across the held race and selects the smallest held diff (`packages/core/src/orchestrate.ts:588-607`, `packages/core/src/engine/repair.ts:488-503`). A fixed result creates `sutura/fix-<run-id>` and a pull request against the failed branch; all other normal outcomes publish evidence without a repair branch (`packages/core/src/orchestrate.ts:583-613`).

## Current automated evidence

Repair-agent unit tests script the exact tool calls returned by the LLM and the exact ordered executor results. The successful case scripts `apply_patch`, then verifies automatic test and submission behavior (`packages/core/src/engine/repair-agent.test.ts:19-91`). Search tests use synthetic expansions and cover lineage, pruning, capacity, concurrency, and cancellation (`packages/core/src/engine/search.test.ts:5-105`).

Core orchestration tests combine fake GitHub and repository ports, an in-memory executor, and a scripted Nano/Super/Ultra client (`packages/core/src/orchestrate.test.ts:69-334`). The recorded action end-to-end suite covers all five case-file terminal outcomes and GitHub publication effects (`packages/action/src/orchestration.e2e.test.ts:479-683`). Placebo supplies 51 deterministic repair, trap, flaky, and upstream cases (`packages/placebo/src/corpus.test.ts:60-110`).

The opt-in live tests exercise direct successful ConTree, Nano JSON, Nano tool-call, Super candidate-generation, cost, and Tavily contracts (`packages/core/src/executor/contree.live.test.ts:18-97`, `packages/core/src/llm/nebius.live.test.ts:28-140`, `packages/core/src/diagnose/tavily.live.test.ts:7-27`). None of those live test files calls `orchestrate`, `repairFailure`, `runRepairAgent`, or `adaptiveSearch` (`packages/core/src/executor/contree.live.test.ts:7-9`, `packages/core/src/llm/nebius.live.test.ts:3-7`, `packages/core/src/diagnose/tavily.live.test.ts:1-9`).

The Phase 4 and Phase 5 documents retain a live repair and a two-depth live trajectory as manual evidence (`docs/plans/2026-08-28-sutura-hackathon-improvement-phases/phase-4.md:180-184`, `docs/plans/2026-08-28-sutura-hackathon-improvement-phases/phase-5.md:147-151`). The main plan also lists live Token Factory and ConTree probes in final acceptance (`docs/plans/2026-08-28-sutura-hackathon-improvement.md:307-315`).

## Live proof 10 addendum

The first post-redesign candidate, `c82eeb9e3601eb1ed229d7c4ddc7e59d1d636623`, passed exact-SHA CI at [run 33251773179](https://github.com/juan294/sutura/actions/runs/33251773179). Dogfood SHA `c1f0c767d688d98b7d88a347e7f1afc35c4aae96` then failed only the declared arithmetic assertion at [run 33252323239](https://github.com/juan294/sutura/actions/runs/33252323239). Sutura [run 33252374229](https://github.com/juan294/sutura/actions/runs/33252374229) completed with `gave-up`, five search nodes, no Super calls, and `No bounded editable repair source was available` for every node.

Expected: the pnpm workspace prefix `packages/core test:` maps `src/dogfood-add.test.ts` to `packages/core/src/dogfood-add.test.ts`, then static import closure adds `packages/core/src/dogfood-add.ts`.

Found: the real Vitest line contains ANSI control sequences and the reporter marker `❯` between the workspace task prefix and source path. The recorded production-path fixtures omitted both. The workspace regex therefore did not match. Generic extraction retained only root-relative `src/dogfood-add.test.ts`, which does not exist at repository root.

Why it matters: controller ownership removed the nine model-control failures, but the source-evidence gate still depended on a simplified log fixture. Production log normalization must remove bounded terminal formatting and map source references anywhere in the bounded pnpm task message before dependency closure starts.

## Live proof 11 addendum

The raw-log revision, `fca0535a343e670c9683faed066175309d6bfe6a`, passed exact-SHA CI at [run 33253462024](https://github.com/juan294/sutura/actions/runs/33253462024). Dogfood SHA `742390f8a9cc7e7657b89a551282338eecd76e5c` then failed only the declared arithmetic assertion at [run 33254012677](https://github.com/juan294/sutura/actions/runs/33254012677). Sutura [run 33254087287](https://github.com/juan294/sutura/actions/runs/33254087287) reached Super six times but completed with `gave-up` and no repair pull request.

Expected: Token Factory strict JSON output passes the same local validation contract, and Sutura converts the selected source edit to a patch without asking the model to reproduce controller-owned bytes.

Found: four branches returned provider-schema-valid proposals that local length checks rejected. Two more branches reached patch conversion but failed because the proposal protocol required Super to copy the exact `old` source text. The provider schema did not declare the local ID and rationale bounds, and exact source copying was not needed because Sutura already held the bounded source excerpt.

Why it matters: strict provider output is not enough when the provider schema and local parser differ. Requiring the model to echo exact source also creates a second, avoidable fidelity test. The production protocol must declare identical bounds at both validation layers and let Super identify inclusive source line ranges while the controller derives the exact old bytes and unified diff.

## Live proof 12 addendum

The anchored-proposal candidate, `d23da3d49627b2709841ad3c0278d5e1bd5a297d`, passed exact-SHA CI at [run 33256021182](https://github.com/juan294/sutura/actions/runs/33256021182). Dogfood SHA `6539ec9b949c4ba0049b3331c1e379a6dc182ef7` then failed only the declared arithmetic assertion at [run 33256572917](https://github.com/juan294/sutura/actions/runs/33256572917). Sutura [run 33256632878](https://github.com/juan294/sutura/actions/runs/33256632878) reached Super six times but completed with `gave-up` and no repair pull request.

Expected: low-effort Super returns one compact anchored JSON proposal before the configured completion budget ends.

Found: five replies consumed the full 8,192-token completion allowance and produced truncated or non-JSON content. The sixth stopped after 5,484 combined output and reasoning tokens but did not match the strict schema. Token Factory counts hidden reasoning inside the completion limit, while Sutura discarded the provider `finish_reason` at the shared LLM interface and reported length terminals as malformed JSON.

Why it matters: the production completion budget was below NVIDIA's documented 16,000-token low-effort Super example and below the repository's existing 16,384-token Super candidate request. Production must reserve the larger bounded envelope, put the compact schema shape in the prompt as Token Factory recommends, and preserve `finish_reason: length` as explicit terminal evidence.
