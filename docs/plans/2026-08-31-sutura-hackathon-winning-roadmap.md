# Sutura hackathon winning roadmap

Date: 2026-08-31

Status: Active

Owner: Juan

Integration branch: `develop`

Release branch: `main`

Submission deadline: 2026-10-30 at 10:00 PDT

Planned submission date: 2026-10-29

Current phase: Phase 0 - Close the v0.2 evidence gap

Detailed plan: `docs/plans/2026-08-31-sutura-phase-0-evidence-baseline.md`

Next action: Implement Phase 1 of the detailed Phase 0 plan. Do not start paid provider work or remote mutation until its exact scope and spend cap receive explicit authorization.

## Purpose

This document is the durable source of truth for Sutura's remaining hackathon work. Use it after a new session, context reset, computer restart, or interrupted operation.

The roadmap does not replace the technical decisions in `docs/plans/2026-08-28-sutura-hackathon-improvement.md`. That plan records the completed v0.2 implementation. This roadmap replaces its old delivery calendar and governs the work from the published v0.2.0 release through the final hackathon submission.

The roadmap also resolves one important status difference:

- The eleven implementation phases are complete.
- The hackathon evidence and judge experience are not complete.
- A published release is not the same as a submission-ready product.

## Winning thesis

AI agents can make CI green. Sutura proves whether they fixed the problem.

Sutura must show this claim through one complete, visible product experience:

1. Reproduce an exact CI failure.
2. Separate real failures from flakes and upstream incidents.
3. Explore repairs through bounded Nemotron tool use and ConTree branches.
4. Reject deceptive patches that only weaken enforcement.
5. Audit the surviving patch on a clean branch.
6. Publish evidence for human review without automatic merge.

The submission must make this process clear within 30 seconds and prove it within three minutes.

## Official judging target

The [hackathon overview](https://nebiusglobalaihackathon.devpost.com/) gives equal emphasis to four judging areas. It requires a working demo, public repository, public video of no more than three minutes, project description, and product feedback. The [official rules](https://nebiusglobalaihackathon.devpost.com/rules) set the deadline and require runtime use of Nebius Token Factory or Nebius AI Cloud with an NVIDIA open model.

| Judging area | Current assessment | Submission target | Required proof |
| --- | ---: | ---: | --- |
| Technological Implementation | 9/10 | 10/10 | Live v0.2 benchmark, ConTree search, Nemotron roles, Data Lab experiment, exact public evidence |
| Quality of the Idea | 9/10 | 10/10 | Counterfactual proof that distinguishes a real repair from a merely green patch |
| Potential Impact | 7/10 | 9/10 | Independent installs, unfamiliar repositories, external feedback, public benchmark comparison |
| Design | 5-6/10 | 9/10 | Public self-service Case Lab, coherent result view, deterministic replay, concise video |

These scores are internal planning estimates. They are not official scores and do not predict placement against unpublished competitors.

## Baseline on 2026-08-31

### Shipped

- [x] Sutura v0.2.0 is published on npm.
- [x] GitHub release `v0.2.0` points to `a943ded4c734aed75c5c63f2b2dd63a2f44556c2`.
- [x] `develop` contains the released work at `ac9e678bd718f4ee7df9402fb2e22e587a843b29`.
- [x] JavaScript, TypeScript, and Python repair paths exist.
- [x] Bounded Nemotron tool use exists.
- [x] Adaptive ConTree beam search exists.
- [x] Network-disabled untrusted stages and repository policy exist.
- [x] Progressive flake classification, GitHub Checks, audit-only mode, ATIF export, and local evaluation records exist.
- [x] Ten consecutive live dogfood repairs completed with independent full CI at Action commit `a99e23199a80ae6ee51fe1680afb74188416160c`.

### Not yet accepted as hackathon evidence

- [ ] Complete live Placebo v0.2 benchmark.
- [ ] Candidate eight-case external matrix.
- [ ] Public eight-case external matrix.
- [ ] Dogfood executable-equivalence proof between `a99e23199a80ae6ee51fe1680afb74188416160c` and the v0.2.0 release commit.
- [ ] Current public demo that a signed-out non-collaborator can use.
- [ ] Demo pinned to the exact submitted release.
- [ ] Real sanitized Data Lab import and batch experiment.
- [ ] Public Sutura Arena comparison.
- [ ] External installation and usability evidence from at least three developers.
- [ ] Marketplace evidence.
- [ ] Final Nebius and NVIDIA feedback report.
- [ ] Devpost description, images, and public video.
- [ ] One complete public evidence index bound to the submitted release.

### Existing evidence contract

`docs/demo/sutura-v0.2.0-release-evidence-requirements.json` requires these records:

1. `benchmark`
2. `candidate-matrix`
3. `demo`
4. `dogfood`
5. `devpost`
6. `feedback`
7. `github-release`
8. `local-gate`
9. `marketplace`
10. `npm`
11. `public-matrix`

The manifest is a tracking and consistency check. It does not replace direct product evidence. A record can become `passed` only when its underlying public run, artifact, hash, or acceptance report exists.

## Strategy rules

1. Visible proof has priority over additional hidden architecture.
2. Zero false approvals remains a hard release gate.
3. Failed cases remain in every benchmark denominator.
4. A live result must bind to an exact 40-character commit and public artifact.
5. A replay can protect the demo from provider delays, but it must be labeled as a replay.
6. The public demo accepts only fixed allowlisted cases. It never accepts arbitrary repositories, commands, branches, patches, or free text.
7. Repository source and logs stay local unless an explicit sanitized export is authorized.
8. Data Lab use is opt-in, redacted, versioned, and reproducible.
9. New algorithms enter the product only after a controlled comparison.
10. Sutura never automatically merges a generated repair.
11. Each completed implementation is merged into local `develop`, verified at the integrated commit, and followed by removal of its task worktree and local task branch.
12. Push, release, deployment, live spending, public demo enablement, Data Lab upload, and Devpost submission remain separate authorization gates.

## Roadmap at a glance

| Phase | Dates | Outcome | Dependency | Status |
| ---: | --- | --- | --- | --- |
| 0 | Sep 1-5 | Complete and reconcile v0.2 evidence | None | Active |
| 1 | Sep 6-14 | Public Sutura Case Lab | Phase 0 evidence model | Not started |
| 2 | Sep 15-21 | Counterfactual patch proof | Case Lab result model | Not started |
| 3 | Sep 22-Oct 5 | Sutura Arena and Data Lab experiment | Phases 0 and 2 | Not started |
| 4 | Oct 6-12 | External adoption and product hardening | Public Case Lab | Not started |
| 5 | Oct 13-20 | Submission story and judge assets | Phases 1-4 | Not started |
| 6 | Oct 21-24 | Feature freeze and final release candidate | All product phases | Not started |
| 7 | Oct 25-29 | Public acceptance and submission | Final public release | Not started |
| Buffer | Oct 30 | Emergency submission correction only | Submission created | Reserved |

The dates are exit dates, not start promises. If a phase slips, reduce stretch scope before reducing evidence quality or the final buffer.

## Phase 0 - Close the v0.2 evidence gap

Dates: 2026-09-01 to 2026-09-05

Objective: Establish one honest current baseline before adding new product claims.

### Work

- [ ] Audit the eleven required evidence records against current public state.
- [ ] Bind already valid npm, GitHub release, dogfood, local gate, and release records to their exact commits and URLs.
- [ ] Prove the dogfood Action executable and metadata are identical between the streak commit and v0.2.0. Do not repeat the ten-run streak when exact executable equivalence passes.
- [ ] Add resumable, content-hashed controllers for the live benchmark and external matrices before provider spending.
- [ ] Run the complete live Placebo v0.2 benchmark under an authorized spend cap.
- [ ] Report JavaScript, TypeScript, and Python results separately and together.
- [ ] Retain all repair failures, refusals, flakes, upstream outcomes, costs, latency, and sandbox operations.
- [ ] Run the candidate eight-case external matrix with real sandbox operation identifiers.
- [ ] Run the public eight-case matrix against only public artifacts.
- [ ] Verify the provider contract and ConTree isolation contract used by the benchmark.
- [ ] Update README claims from v0.1 to v0.2 only after the live result is complete.
- [ ] If public v0.2.0 has a product defect, create a patch-release plan. Do not rewrite evidence or silently substitute an unreleased commit.

### Exit gate

- The live benchmark has a versioned manifest, exact release identity, result hash, complete denominator, cost, latency, and public-safe report.
- Both eight-case matrices are complete with zero false approvals.
- Phase 0-owned records have an explicit terminal result. Later `demo`, `devpost`, `feedback`, and `marketplace` records remain `pending` with their owning roadmap phase and next action.
- README claims match the measured result.

### Evidence destinations

- `docs/demo/`
- `docs/agents/` for operational reports when repository policy permits
- GitHub Actions runs and artifacts bound to the exact candidate

## Phase 1 - Build the public Sutura Case Lab

Dates: 2026-09-06 to 2026-09-14

Objective: Let any judge understand and experience Sutura without GitHub collaborator access.

### Product experience

The Case Lab offers five fixed public scenarios:

1. JavaScript repair.
2. Python repair.
3. Deterministic flaky failure.
4. Greenwash trap.
5. Upstream dependency incident.

For each scenario, the result view shows:

- Exact failed commit and CI evidence.
- Nano diagnosis and confidence.
- ConTree search tree and branch status.
- Super tool calls and candidate patches.
- Rejected patches and rejection reasons.
- Clean audit branch and Ultra verdict.
- Final outcome: `fixed`, `flaky-no-patch`, `refused`, `gave-up`, or `infra-stop`.
- Token cost, provider cost, latency, CPU, memory, I/O, and sandbox operations.
- Links to the GitHub run, pull request or refusal report, evidence bundle, and ATIF trajectory.

### Safety and reliability

- [ ] Accept only server-defined case identifiers.
- [ ] Reject arbitrary repository names, refs, commands, patches, and free text.
- [ ] Apply request throttling, concurrency limits, a daily spend stop, and an emergency disable control.
- [ ] Use a protected service identity with minimum GitHub permissions.
- [ ] Keep provider secrets outside ConTree.
- [ ] Provide a deterministic replay for every case.
- [ ] Clearly label live runs and replayed runs.
- [ ] Return stable result URLs that survive a page refresh.
- [ ] Make the main result readable on desktop and mobile.
- [ ] Remove the old instruction that asks visitors to run a collaborator-only `workflow_dispatch` action.

### Nebius deployment decision

Evaluate Nebius Serverless Jobs and Serverless Endpoints for the public control plane before implementation. Use them only if the current service contracts support the required asynchronous execution, secret isolation, request limits, and stable result URLs. The Token Factory and ConTree repair path remains the required runtime core.

### Exit gate

- A signed-out non-collaborator selects each allowlisted case and receives a stable result.
- At least one live repair and one refusal complete through the public path.
- Every case has a tested replay fallback.
- The demo is pinned to the exact current public Sutura release.
- Security tests prove that arbitrary input and unauthorized repository access fail closed.

## Phase 2 - Add counterfactual patch proof

Dates: 2026-09-15 to 2026-09-21

Objective: Make Sutura's unique verification value visible and measurable.

### Work

- [ ] For selected cases, create two or three plausible alternative patches from the same ConTree checkpoint.
- [ ] Include at least one shortcut that weakens a test, type check, lint rule, or error path.
- [ ] Run every candidate through the same declared mechanical and model-audit gates.
- [ ] Record the exact rule, hidden test, policy, or audit finding that rejects each deceptive patch.
- [ ] Show the accepted patch and rejected alternatives side by side in the Case Lab.
- [ ] Add counterfactual results to the evidence and ATIF formats without duplicating source data.
- [ ] Measure additional cost, latency, and sandbox operations.

### Exit gate

- At least four representative cases show one accepted or correctly refused outcome beside rejected alternatives.
- Every deceptive alternative is rejected.
- The feature preserves zero false approvals across Placebo v0.2.
- The Case Lab explains why “green” is not sufficient without requiring the judge to inspect raw logs.

## Phase 3 - Build Sutura Arena and use Data Lab

Dates: 2026-09-22 to 2026-10-05

Objective: Prove the architecture at useful scale and use Nebius evaluation services in the real improvement loop.

### Benchmark design

- [ ] Select a stratified set of 100 public software-engineering cases from available SWE-bench and SWE-rebench environments.
- [ ] Record language, failure class, repository, difficulty, and inclusion reason.
- [ ] Compare Sutura with a single-branch repair baseline.
- [ ] Compare full Sutura verification with a “first green patch wins” baseline.
- [ ] Compare current beam search with fixed parallel search.
- [ ] Preserve identical case selection, limits, provider models, and scoring across comparisons.
- [ ] Expand toward 200 cases only after the 100-case run is complete, affordable, and statistically useful.

### Data Lab integration

- [ ] Define and test the redaction boundary before any upload.
- [ ] Upload only sanitized, public-safe evaluation records after explicit authorization.
- [ ] Record Data Lab dataset identifiers, versions, input hashes, and output hashes.
- [ ] Use batch inference for at least one model, router, or prompt comparison.
- [ ] Publish the winning and losing configurations with cost, latency, and quality results.
- [ ] Document Zero Data Retention behavior and what the explicit dataset import changes.

### Public Arena view

Show:

- Repair success rate.
- False approval count and rate.
- Flake and upstream classification accuracy where applicable.
- Median and tail latency.
- Provider and sandbox cost.
- Token and sandbox operation counts.
- Resource use.
- Results by language and failure class.
- Complete failures and refusal reasons.

### Exit gate

- The 100-case comparison is reproducible from a versioned manifest.
- No failed case is removed from the denominator.
- Sutura improves at least one primary measure over the single-branch baseline without weakening zero-false-approval or security gates.
- One real Data Lab batch experiment has public-safe evidence and exact hashes.
- The Arena has a concise public result page and a downloadable machine-readable report.

## Phase 4 - External adoption and product hardening

Dates: 2026-10-06 to 2026-10-12

Objective: Prove that Sutura solves a real developer problem outside its own repository.

### Work

- [ ] Recruit at least three developers who did not build Sutura.
- [ ] Test installation in at least three unfamiliar repositories.
- [ ] Include JavaScript or TypeScript and Python.
- [ ] Install only from public npm and immutable Action artifacts.
- [ ] Measure time to first valid result, setup failures, unclear instructions, and manual interventions.
- [ ] Run one repair, one refusal, and one flake classification through the external path.
- [ ] Correct every release-blocking installation, documentation, permission, and result-clarity defect.
- [ ] Collect short, attributable feedback only with participant permission.
- [ ] Complete the Marketplace listing and verify installation from it.
- [ ] Update the provider privacy, retention, and threat-model documentation.

### Exit gate

- Three external installation records exist.
- A new user can reach a useful result without repository-owner coaching.
- The public setup guide matches the released package and Action.
- Marketplace installation and immutable pinning work.
- The impact claim uses observed user evidence, not only internal opinion.

## Phase 5 - Build the submission story and judge assets

Dates: 2026-10-13 to 2026-10-20

Objective: Convert the verified product into a complete, coherent submission.

### Devpost package

- [ ] Project title and one-sentence value statement.
- [ ] Problem, audience, and why existing “fix CI” tools are insufficient.
- [ ] Product workflow with one clear architecture diagram.
- [ ] Direct explanation of Nano, Super, Ultra, Token Factory, ConTree, Data Lab, and NVIDIA ATIF or NeMo use.
- [ ] Measured Placebo, dogfood, Arena, cost, and external-user results.
- [ ] Significant work completed after the submission period started.
- [ ] Nebius and NVIDIA product feedback.
- [ ] Public repository, working demo, release, Marketplace, benchmark, and evidence links.

### Video plan

The public YouTube video must be shorter than three minutes.

| Time | Content |
| --- | --- |
| 0:00-0:20 | Problem: a green CI result can still be a fake repair |
| 0:20-1:20 | One live or deterministic Case Lab repair from failure through verified pull request |
| 1:20-1:55 | Counterfactual greenwash patch rejected beside the accepted patch |
| 1:55-2:25 | Nebius architecture: Nemotron routing, ConTree branching, Data Lab evaluation |
| 2:25-2:45 | Placebo, dogfood, Arena, cost, and external-user results |
| 2:45-2:55 | Human review, no automatic merge, final call to action |

### Exit gate

- The complete Devpost draft exists with no unsupported claim.
- Every number links to public evidence.
- The video is public, under three minutes, audible, legible, and accurate.
- A signed-out reviewer can follow every link.
- The README, demo, video, release, and Devpost entry use the same product language and results.

## Phase 6 - Feature freeze and final release candidate

Dates: 2026-10-21 to 2026-10-24

Objective: Freeze one submission candidate and prove its complete local and public contract.

### Work

- [ ] Stop new features on 2026-10-21.
- [ ] Accept only security, release, evidence, and demo-blocking fixes after the freeze.
- [ ] Run `pnpm run ci:local` sequentially on the exact candidate.
- [ ] Run candidate installation and external matrix checks.
- [ ] Run live provider and ConTree contract canaries under an authorized cap.
- [ ] Review code reuse, quality, and efficiency with `codex-simplify`.
- [ ] Merge the approved candidate through the documented release path after separate authorization.
- [ ] Publish a patch or later release only when required by the verified candidate.
- [ ] Verify npm, Action tag, Marketplace listing, GitHub release, and public install from a clean environment.

### Exit gate

- One exact 40-character release commit supports the package, Action, demo, benchmark, Arena, and submission claims.
- Exact-commit CI is terminal and green.
- Public artifact installation and the public external matrix pass.
- The release evidence contract is complete.
- No task-owned worktree or branch remains.

## Phase 7 - Final public acceptance and submission

Dates: 2026-10-25 to 2026-10-29

Objective: Test the product as a judge and submit one day before the deadline.

### Acceptance matrix

- [ ] Signed-out desktop Case Lab repair.
- [ ] Signed-out mobile Case Lab repair or replay.
- [ ] Signed-out refusal and flaky result.
- [ ] Stable evidence and download links.
- [ ] Public npm install.
- [ ] Public Marketplace install.
- [ ] Public repository setup from a clean checkout.
- [ ] Public video playback with captions and correct links.
- [ ] Devpost preview with every required field.
- [ ] Written explanation of significant work completed during the submission period.
- [ ] Feedback section complete.
- [ ] Final backup of submission text, images, video link, evidence index, and release identity.

### Submission gate

Devpost submission is an outward-facing action and needs explicit authorization. After authorization:

1. Submit on 2026-10-29.
2. Open the public submission page while signed out.
3. Verify the demo, repository, video, and evidence links again.
4. Record the final submission URL and timestamp in this roadmap.
5. Make no product change unless a verified submission blocker requires it.

### Exit gate

- The public submission exists and is independently readable.
- All links work while signed out.
- The submitted product matches the video and text.
- The final identity, evidence, and timestamp are recorded.

## Stretch lane

Stretch work can start only when Phase 0 is accepted, the Case Lab is public, and the 100-case Arena is on schedule. Stretch work must stop if it threatens the October 21 freeze.

### Stretch A - Verified failure memory

- Store repository-owned, sanitized failure fingerprints and verified repairs.
- Use Token Factory embeddings and reranking for retrieval.
- Let retrieved cases guide search but never bypass current tests, policy, or audit.
- Compare repair rate, latency, and cost with memory enabled and disabled.

### Stretch B - Capacity-aware scheduling

- Use `Retry-After` and Token Factory rate-limit headers to schedule parallel work.
- Surface throttling and recovery in evidence.
- Compare avoidable retries, completion time, and failed operations.

### Stretch C - Search algorithm comparison

- Compare beam search with best-first search or Monte Carlo tree search only after the Arena baseline exists.
- Keep a new algorithm only if it improves a declared measure without increasing false approvals.

### Stretch D - Larger Arena

- Expand from 100 toward 200 cases after the first complete report.
- Do not expand by hiding expensive, slow, or failed cases.

## Work explicitly deferred until after submission

- Automatic merge.
- Generic chat interface.
- GitLab support.
- CircleCI support.
- Broad language expansion beyond current JavaScript, TypeScript, and Python support.
- Dedicated inference endpoints without measured capacity need.
- Model fine-tuning without a supported Nemotron path and a measured product reason.
- A general fleet dashboard that does not improve the judge experience.
- A general Docker fallback that weakens the verified ConTree product contract.

## Evidence register

Update this table only when the direct evidence exists. Link the evidence and record the exact commit or release identity in the Evidence field.

| Evidence | State | Required by | Evidence |
| --- | --- | --- | --- |
| v0.2 live benchmark | Not started | Phase 0 | `docs/demo/placebo-v0.2-local.md` records local controls only |
| Candidate external matrix | Not started | Phase 0 | No accepted live matrix recorded |
| Public external matrix | Not started | Phase 0 and Phase 6 | No accepted public matrix recorded |
| Dogfood streak | Active | Phase 0 | Ten consecutive fixed attempts at `a99e23199a80ae6ee51fe1680afb74188416160c`; v0.2.0 executable-equivalence proof pending |
| npm v0.2.0 | Passed | Baseline | `sutura@0.2.0` |
| GitHub release v0.2.0 | Passed | Baseline | Release commit `a943ded4c734aed75c5c63f2b2dd63a2f44556c2` |
| Case Lab | Not started | Phase 1 | Current demo is stale and collaborator-only |
| Counterfactual proof | Not started | Phase 2 | No public comparison recorded |
| 100-case Arena | Not started | Phase 3 | No manifest recorded |
| Data Lab batch experiment | Not started | Phase 3 | Local export only; upload disabled |
| External installs | Not started | Phase 4 | Three accepted records required |
| Marketplace evidence | Not started | Phase 4 and Phase 6 | No accepted current record |
| Nebius feedback | Not started | Phase 5 | Final measured report required |
| Public video | Not started | Phase 5 | Public YouTube URL required |
| Devpost submission | Not started | Phase 7 | Explicit submission authorization required |

## Cost and authorization ledger

Do not place secrets in this document.

Before every live or paid operation, record these items in the active phase plan or operational report:

- Exact action and provider.
- Exact candidate commit.
- Maximum total spend.
- Reserved amount for validation and cleanup.
- Maximum run, branch, or operation count.
- Stop condition.
- User authorization message and date.

A cost estimate is not authorization. Stop before the cap, not after it. A retry after a failed publication, deployment, benchmark, or public demo run needs the authority defined by that workflow.

## Risk register

| Risk | Trigger | Response |
| --- | --- | --- |
| Demo provider delay | Live case exceeds the presentation window | Show deterministic replay with a clear label and link the eventual live result |
| Spend growth | Estimated remaining work approaches the authorized cap | Stop before reserve use and request a new decision with exact evidence |
| False approval | Any trap is accepted | Block the phase and release; diagnose before more breadth work |
| Benchmark selection bias | Cases are removed after execution | Keep the fixed manifest and full denominator; publish failures |
| Data exposure | Sanitization cannot prove that source or secrets are absent | Do not upload; retain local-only evaluation |
| Release identity drift | Demo, package, Action, benchmark, or video refers to different commits | Stop publication and create one replacement candidate |
| External access failure | Signed-out user cannot trigger or inspect a result | Block demo acceptance and use the replay only as temporary evidence |
| Schedule slip | Critical path extends past October 20 | Drop stretch work, reduce Arena expansion, preserve core evidence and final buffer |
| Nebius beta or API change | Provider contract or ConTree behavior changes | Run the exact canary, document the change, and use only verified supported behavior |

## Session and reboot protocol

At the start of every Sutura hackathon session:

1. Read this roadmap completely.
2. Read the active phase plan and its evidence files completely.
3. Run `git status --short --branch` and `git worktree list --porcelain`.
4. Confirm the current phase, next unchecked task, exact candidate, and authorization boundary.
5. Check public or provider state when it can change. Do not rely on an old session report for mutable facts.
6. Continue from existing evidence. Do not repeat a paid run merely because context was lost.

At the end of every session:

1. Update the current phase, checklist, evidence register, and next action in this roadmap.
2. Record exact commits, run URLs, artifact hashes, spend, and remaining blockers in the relevant evidence file.
3. Distinguish implementation complete, locally verified, remotely verified, publicly accepted, and submitted.
4. If the work is complete, merge it into local `develop` and verify the integrated commit.
5. Remove only the task-owned worktree and local task branch after integration.
6. Preserve unrelated dirty or untracked files.

## Phase acceptance rule

A phase is `Accepted` only when all of these statements are true:

- Its exit gate is complete.
- Required local verification passed.
- Required live or public evidence is terminal and linked.
- The implementation is on local `develop`.
- The exact integrated commit is recorded.
- The task worktree and local branch are removed.
- No required next action remains hidden in prose.

Use these phase states only:

- `Not started`: no accepted work has begun.
- `Active`: work is in progress and the next action is named.
- `Blocked`: a named external dependency or authorization prevents progress.
- `Accepted`: the complete exit gate has evidence.

## Final definition of done

Sutura's hackathon work is done only when:

- The product passes the exact public release gates with zero false approvals.
- The Case Lab works for a signed-out judge and has replay protection.
- Counterfactual proof shows why deceptive green patches fail.
- The Arena publishes a reproducible 100-case comparison.
- One real sanitized Data Lab batch experiment is complete.
- Three external developers have completed public installation tests.
- npm, Action, Marketplace, demo, benchmark, Arena, video, and Devpost claims refer to one exact release identity.
- The public video is under three minutes and accurately shows the product.
- The Devpost submission is public and all links work while signed out.
- The final work is integrated into `develop`.
- No task-owned worktree or local task branch remains.

Until every statement is true, the roadmap remains active.
