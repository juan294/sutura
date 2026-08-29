# Live repair reliability implementation plan

Date: 2026-08-29

Research source: `docs/research/2026-08-29-live-repair-control-path.md`

Baseline: `develop` at `f0fd17af8986278ca8ad43416ceb7b90920e8cd9`

Integration branch: `develop`

## Objective

Make the production GitHub-to-repair-PR path controller-owned, replayable, and locally proven before one final live dogfood run.

The target path must:

- gather enough bounded source before Super proposes a patch;
- prevent the model from choosing whether verification or submission happens;
- preserve adaptive, feedback-driven candidate search;
- admit work only when the complete attempt can fit its remaining budgets;
- audit and publish the same exact candidate;
- reproduce every live failure class in local automated tests;
- create a correct repair pull request whose CI passes in the final authorized dogfood run.

## Evidence that defines the problem

Nine live dogfood runs exercised one simple arithmetic defect. The first two stopped at Token Factory request compatibility. The next four stopped during model-directed evidence acquisition. The seventh accepted the correct patch but did not retain valid trusted-test evidence. The eighth accepted the correct patch but continued model-directed exploration. The ninth used all turns without applying a patch. The exact chronology is in `docs/research/2026-08-29-live-repair-control-path.md`.

Current unit and end-to-end tests script ideal LLM tool calls. No live test calls `orchestrate`, `repairFailure`, `runRepairAgent`, or `adaptiveSearch`. Current production admission also reduces the four-branch search default to one branch by reserving all eight model turns for it.

## Design options

### Option A: keep the free-form loop and add one import bootstrap

This preserves the smallest diff. It makes the arithmetic case more likely to work because the implementation source reaches the model earlier.

It does not remove model control over read, search, test, and submit transitions. It also leaves branch admission dependent on variable action sequences. Rejected.

### Option B: force one function tool for each controller state

This keeps provider function calling on every repair transition. It can force patch generation, while Sutura owns test and submission states.

The live model endpoint rejected one documented `tool_choice` form and accepted only `none` or `auto` during dogfood. A named function choice therefore needs a separate live compatibility proof before it can be a production dependency. Rejected as the default protocol.

### Option C: strict structured patch proposals with controller-owned execution

Super returns one bounded, schema-validated repair proposal. Sutura converts exact structured edits to a diff, applies it through the existing policy-aware repair runtime, runs the diagnosed trusted test, and creates a candidate only after the test passes. A failed proposal becomes feedback for a new baseline-based replacement proposal.

This reuses the already tested structured candidate contract, removes model-selected control transitions, gives every branch an exact operation schedule, and keeps ConTree verification and Ultra audit unchanged. Selected.

The six-tool interactive agent remains available only as an internal evaluation profile until a complete live trajectory proves it separately. Production uses strict Token Factory JSON output for repair proposals. Nano diagnosis, Super repair, Ultra audit, ConTree isolation, Tavily grounding, cost accounting, capacity signals, and ATIF tracing remain in the production path.

## Architecture

```text
failed GitHub run
  -> exact checkout and policy
  -> secure ConTree preparation and reproduction
  -> Nano diagnosis and progressive flake triage
  -> bounded source dependency closure on exact checkout
  -> adaptive search
       -> one strict Super proposal from clean baseline plus parent feedback
       -> controller validates and applies exact edits
       -> controller runs diagnosed trusted test
       -> pass: held candidate
       -> fail: checkpoint evidence for the next depth
  -> deterministic checks and fresh ConTree rerun
  -> Ultra audit
  -> exact audited candidate identity
  -> repair branch and pull request
```

## Cross-phase invariants

1. A production model response cannot request `search_repo`, `run_test`, `submit_candidate`, or any other control transition.
2. Every accepted production patch is followed by the diagnosed trusted test without another model turn.
3. A candidate exists only after the latest diagnosed trusted test passes.
4. Every search expansion begins from the clean prepared baseline and proposes a complete replacement candidate. Parent nodes supply feedback, not mutable filesystem state.
5. Every admitted expansion reserves one branch, one model turn, up to three controller actions, two sandbox operations, remaining elapsed time, worst-case inference cost, and diff capacity.
6. Source closure is bounded by the existing source limits, repository policy, sensitive-path rules, regular-file checks, exact checkout containment, and redaction rules.
7. The candidate selected for audit is the candidate published to GitHub. Candidate ID and diff hash must agree at both boundaries.
8. A failed or invalid branch cannot consume the capacity reserved for another admitted branch.
9. No remote candidate is pushed until all local gates and replay cases pass.
10. If the final live proof fails, do not push an immediate incremental repair. Add the new terminal path to the local replay suite, revise the design locally, and repeat all gates before another candidate.

## Phase sequence

| Phase | Name | Dependency | Batch status |
| ---: | --- | --- | --- |
| 1 | Bounded repair source closure | None | Sequential |
| 2 | Controller-owned repair attempt | Phase 1 | Sequential |
| 3 | Search budgets, feedback, and exact winner identity | Phase 2 | Sequential |
| 4 | Nine-run replay and production-path integration gates | Phase 3 | Sequential |
| 5 | Exact-SHA CI and final live dogfood proof | Phase 4 | Sequential |

Detailed phase files:

- `docs/plans/2026-08-29-live-repair-reliability-phases/phase-1.md`
- `docs/plans/2026-08-29-live-repair-reliability-phases/phase-2.md`
- `docs/plans/2026-08-29-live-repair-reliability-phases/phase-3.md`
- `docs/plans/2026-08-29-live-repair-reliability-phases/phase-4.md`
- `docs/plans/2026-08-29-live-repair-reliability-phases/phase-5.md`

## Local verification gate

Run sequentially with Git filesystem monitoring disabled where temporary repositories are created:

```bash
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.fsmonitor GIT_CONFIG_VALUE_0=false pnpm --filter @sutura/core test
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.fsmonitor GIT_CONFIG_VALUE_0=false pnpm --filter @sutura/action test
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
pnpm run test:package
pnpm run test:readme
pnpm run verify:readme-setup
pnpm --filter placebo run smoke:offline
pnpm run test:release-contracts
git diff --check
```

Rebuild and commit `packages/action/dist/index.cjs` for every runtime change.

Run the `codex-simplify` reuse, quality, and efficiency reviews after implementation. Fix all findings and repeat the complete local gate.

## Final automated acceptance

- The realistic arithmetic dogfood fixture reaches Super with both the test and imported implementation source.
- A scripted search-only, read-only, test-only, or submit-only model response cannot control the production attempt.
- A valid proposal always runs patch, diagnosed test, and candidate creation in controller order.
- A failing proposal supplies its complete diff and bounded test failure to the next search depth.
- A second-depth replacement candidate starts from the baseline and can pass.
- Default budgets admit multiple independent attempts and never admit a partial successful path.
- Provider, invalid-schema, policy, timeout, cancellation, and budget failures terminate with typed evidence.
- Node ESM, TypeScript extension, monorepo, and Python relative-source closure cases pass.
- Source traversal, symlink, sensitive path, policy denial, ambiguity, oversized content, and credential redaction fail closed.
- Audit and publication use one exact candidate ID and diff hash.
- The recorded GitHub action E2E creates one repair branch and PR for the realistic direct-run dogfood fixture.
- All nine historical live terminal classes have local regression coverage.
- The complete local verification gate and simplification reviews pass.

## Final live acceptance

After the local candidate is fixed:

1. Fast-forward the candidate into local `develop`.
2. Push one exact `develop` SHA.
3. Wait for all applicable CI on that exact SHA to finish successfully.
4. Create one new dogfood branch from that green SHA with the same arithmetic defect.
5. Push and dispatch the intentional CI failure.
6. Wait for Sutura to report `fixed` and create one repair pull request.
7. Verify the repair commit is a direct child of the dogfood SHA and changes subtraction to addition without changing the test or policy.
8. Wait for all repair pull-request CI to finish successfully.
9. Record the exact develop CI, intentional CI, Sutura workflow, repair PR, repair commit, and repair PR CI URLs.
10. Clean task-owned local worktrees and local branches. Preserve the user-owned `docs/demo/thumbnail/` directory.

The intentionally failed dogfood CI is expected. A Sutura `gave-up`, `refused`, `infra-stop`, missing PR, incorrect patch, or red repair-PR CI does not satisfy acceptance.

## Scope boundaries

This reliability cycle does not publish v0.2.0, create a tag or GitHub release, publish npm or Marketplace artifacts, merge to `main`, enable a public demo, upload Data Lab records, or update Devpost.

## Completion state

- [ ] Phase 1: Bounded repair source closure
- [ ] Phase 2: Controller-owned repair attempt
- [ ] Phase 3: Search budgets, feedback, and exact winner identity
- [ ] Phase 4: Nine-run replay and production-path integration gates
- [ ] Phase 5: Exact-SHA CI and final live dogfood proof
