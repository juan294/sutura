# Research: release-pipeline over-engineering audit against the Coach case study

**Date:** 2026-08-29
**Question:** Does Sutura's release pipeline show the same accretion pattern documented in
`~/code/coach/docs/release/release-pipeline-hardening-recovery-case-study.md` (mandatory gates
that duplicate proof, evidence/manifest/analyzer machinery, exploratory charters,
cadence/fidelity checks, broad smoke suites repeated across layers, fail-closed terminal states
for repairable conditions), and if so, where?

## What exists in the live, automated release path

Four GitHub Actions workflows make up the automated path. All are read directly.

- `.github/workflows/ci.yml:1-31` — runs on push/PR to `develop`/`main`. Steps: install,
  `pnpm run test:release-contracts` (`ci.yml:23`), `pnpm run test:readme` (`ci.yml:24`),
  `pnpm run verify:readme-setup` (`ci.yml:25`), `pnpm --filter placebo run smoke:offline`
  (`ci.yml:26`), `pnpm run typecheck` (`ci.yml:27`), `pnpm run lint` (`ci.yml:28`),
  `pnpm run test` (`ci.yml:29`), `pnpm run build` (`ci.yml:30`), `pnpm run test:package`
  (`ci.yml:31`).
- `.github/workflows/release-candidate.yml:1-43` — `workflow_dispatch` only, takes an exact
  40-char Action commit (`release-candidate.yml:6-9,18-21`), is read-only (no publish/push/tag),
  runs `test:release-contracts`, `build`, a dist-drift diff check
  (`release-candidate.yml:35`), and `scripts/test-candidate-install.mjs <sha>`
  (`release-candidate.yml:37`). This is a class A/B admission check: it proves the exact
  candidate installs correctly and spends no provider credit or publish authority.
- `.github/workflows/publish.yml:1-80` — triggers on `release: published`. It:
  1. Verifies identity: tag equals `packages/cli/package.json` version
     (`publish.yml:36-37`), the release commit equals `origin/main`
     (`publish.yml:38-40`), and the GitHub `ci.yml` workflow has at least one
     `success` run on that exact `head_sha` on `main` via `push`
     (`publish.yml:41-44`) — an exact-head required-check proof, functionally
     equivalent to Coach's "exact-head required check."
  2. Then **re-runs** `pnpm run test:release-contracts`, `pnpm run typecheck`,
     `pnpm run lint`, `pnpm run test`, and `pnpm run build`
     (`publish.yml:45-49`) — the same four of five checks `ci.yml` already ran on
     this exact commit, whose success was just proven in step 1.
  3. Verifies the checked-in Action bundle matches source
     (`publish.yml:50`), builds and hashes a candidate-install evidence file
     (`publish.yml:51-52`), publishes to npm only if not already published
     (`publish.yml:53-65`), then builds and hashes a public-install evidence file
     against the just-published package (`publish.yml:66-67`) and diff-compares
     package version, Action commit, and content hash between the two
     (`publish.yml:68-72`), and uploads both as one artifact
     (`publish.yml:73-79`).
- `.github/workflows/sutura.yml:1-41` — Sutura's own self-repair trigger on CI
  failure (`workflow_run` on the `CI` workflow). Not a release gate.

Meta-test `scripts/release-workflow.test.mjs:35-52` (`test:release-contracts`) asserts, by
regex against the workflow YAML text, that `publish.yml` contains
`pnpm run typecheck`, `pnpm run lint`, and `pnpm run test\n`
(`release-workflow.test.mjs:41-43`) alongside the identity and evidence assertions — i.e. the
duplication in item 2 above is itself pinned by a test, so it will not silently drift away.

## What exists as manual/local tooling, not wired into any workflow

Two scripts implement a Coach-shaped evidence-manifest/analyzer pattern, but neither is invoked
by any `.github/workflows/*.yml` file (confirmed by `grep -rn "release-evidence\|test-external-matrix"
.github/workflows/`, no matches):

- `scripts/release-evidence.mjs:16-19` defines exactly ten required evidence IDs —
  `benchmark, candidate-matrix, demo, devpost, feedback, github-release, local-gate, marketplace,
  npm, public-matrix` — and `analyzeReleaseEvidence` (`release-evidence.mjs:118-165`) requires
  every one of the ten to be present, `required: true`, and `status: 'passed'`
  (`release-evidence.mjs:126-133,139-141,155-163`) before `ready` is `true`
  (`assertReleaseReady`, `release-evidence.mjs:167-171`). Passed checks must carry SHA-256
  content-hashed evidence, verified either against a local `docs/demo|feedback` file
  (`release-evidence.mjs:96-108`) or against a live GitHub Actions run/artifact fetched over
  `gh api` (`release-evidence.mjs:22-60,73-95`). This mixes release-critical evidence
  (`local-gate`, `candidate-matrix`, `npm`, `github-release`, `public-matrix`) with
  submission/marketing evidence (`benchmark`, `demo`, `devpost`, `feedback`, `marketplace`) inside
  one required set and one boolean `ready` flag — the same "every representation had to agree"
  shape the case study describes for Coach's aggregate manifest (case study lines 151-165), just
  without automated enforcement.
- `scripts/test-external-matrix.mjs:13-22` defines exactly eight fixed matrix cases (JS repair,
  JS flake, unsafe-repair refusal, direct-branch repair, policy refusal, audit-only invocation,
  Python repair, Python refusal) and `createExternalMatrixManifest`
  (`test-external-matrix.mjs:68-97`) requires all eight, with strict per-case schema validation
  (outcome, audit approval, cost, duration, bounded stage list, GitHub-URL outcome links) and a
  `falseApprovalCount === 0` requirement (`test-external-matrix.mjs:94`) for `ready`. Unlike
  `release-evidence.mjs`, this exercises Sutura's own core repair/audit behavior — its subject is
  the product's central claim, not release infrastructure.
- `docs/release/v0.2.0-release-playbook.md:1-38` sequences both: an eight-step "local candidate
  gate" (lines 6-18, ending in "Create the release evidence manifest with
  `scripts/release-evidence.mjs`. Any pending required record means the release is not ready,"
  line 18) followed by a seven-item "authorization-gated sequence" (lines 23-33) that includes
  running the live Placebo benchmark, publishing npm/tag/Marketplace/GitHub release, running the
  public matrix, enabling the public demo, and updating the Devpost draft — all under the same
  evidence-manifest umbrella.
- `docs/plans/2026-08-28-sutura-hackathon-improvement-phases/phase-11.md:169-232` is the source of
  this design: a 16-step "release sequence" (lines 171-192) and an "exit evidence" section (lines
  222-232) that explicitly binds npm/GitHub-release/demo/benchmark/external-matrix/feedback/Devpost
  into "one release evidence manifest tied to the exact `main` commit" (line 224).
- `scripts/release-evidence.test.mjs` and `scripts/release-workflow.test.mjs:63-73` pin the exact
  ten-ID list and the four `authorizationGates`
  (`live-provider-benchmark, release-publication, public-demo-enable, devpost-update`) against
  `docs/demo/sutura-v0.2.0-release-evidence-requirements.json:1-16`.
- `README.md:211-214` documents the ten-record requirement and notes benchmark/publication/demo/
  Devpost evidence "remain pending their separate authorization gates."

None of this manual machinery currently blocks `git push`, PR merge, or the `publish.yml` npm
publish step — it is documentation/bookkeeping a human is expected to run and reference, not a
CI-enforced gate. `scripts/test-package.mjs`, `scripts/test-candidate-install.mjs`, and
`scripts/test-public-install.mjs` (the actual install-verification scripts `publish.yml` and
`release-candidate.yml` call) are separate from `release-evidence.mjs`/`test-external-matrix.mjs`
and are wired into the automated workflows directly.

## `docs/release/e2e-pro-playbook.md` is a template, not the live pipeline

This file is 1536 lines and, read in full, is explicitly a cross-project adoption template, not
Sutura's own procedure:

- Line 1: "E2E Pro Release Verification Playbook — Cross-Project Implementation Template."
- Lines 8-10: "Copy it into a target project and adapt it. It is intentionally comprehensive; the
  200-line limit it prescribes applies to the *finished* project's day-to-day release procedure,
  not to this adoption-and-architecture template."
- Lines 33-42: "Do not cargo-cult the full program into a small project. The mandatory floor for
  every project is Wave A ... Waves C–H (capability registry, combination engine, plan compiler,
  staging fidelity, model-based tests, TTL automation) are structural and expensive. Adopt them by
  project risk, not by default."
- Wave A (candidate identity fixed, zero-pass fails, required-check blocks, tag-last) is described
  at lines 253-367 as the mandatory floor and matches Coach's *repaired*, minimal contract.
- Waves B–H (exploratory charters lines 369-482, capability/constraint registry lines 483-618,
  combination engine lines 619-698, release-plan compiler lines 700-788, environment-fidelity
  truth table lines 790-844/234-247, cadence/TTL enforcement lines 873-907, an analyzer at
  section 8 step 7 lines 1063-1080 that fails on missing evidence/cleanup/cadence) are the same
  shapes the case study names as removed from Coach's critical path (case study lines 274-283).

`CLAUDE.md:88` records "Wave A adopted; profile pending first release" for this file. A
repo-wide grep for capability-registry, constraint-combination, plan-compiler, cadence, charter,
and environment-fidelity implementation code (`grep -rln ... --include="*.mjs" --include="*.ts"
--include="*.yml" --include="*.json" .`, excluding the template itself) returns no matches: none
of Waves B–H have been built into any script, workflow, or config. Only the Wave A shape
(identity, exact-head check, tag-last) appears in the live workflows described above.

## Git history: how the live pipeline accreted

- `scripts/release-evidence.mjs`, `scripts/evidence-contract.mjs`, and
  `scripts/test-external-matrix.mjs` were all added in a single commit,
  `7fd26d1 feat: complete local v0.2.0 release readiness` (`git log --oneline --all -- <path>`
  for each returns only this commit).
- `docs/release/e2e-pro-playbook.md` was added whole in the initial bootstrap commit
  `a8f1aa2 chore: bootstrap sutura from cc-rpi blueprint` and has never been modified since
  (`git log --oneline -- docs/release/e2e-pro-playbook.md` returns exactly one line).
- Two releases have already shipped through the simpler path: `release: Sutura v0.1.0 (#27)` and
  `release: Sutura v0.1.1 (#28)` in `git log --oneline --all -i --grep="release"`. Neither
  required the ten-ID evidence manifest or the eight-case external matrix; those were introduced
  afterward, targeting the pending v0.2.0/hackathon-submission release.

This differs structurally from Coach's timeline: Coach's hardening was many separate commits over
months, each adding one more mandatory layer to an *automated* controller, and the accumulated
weight was discovered only after it blocked real production releases four times in a row. Sutura's
manual-evidence machinery landed in one commit, is not wired into automation, and has not yet
gated (or blocked) any real release — "profile pending first release" in `CLAUDE.md:88` is
accurate.

## Classification against the case study's five-class model

| Item | Class (per case-study step 4) | Why |
| --- | --- | --- |
| Exact-candidate/tag/commit identity checks (`publish.yml:36-40`) | A/B | Prevents branch-name-as-identity drift; direct, cheap, automated |
| Exact-head CI-success check via GitHub API (`publish.yml:41-44`) | B | Proves the exact candidate passed required checks; automated |
| Re-run of `typecheck`/`lint`/`test` in `publish.yml:46-48` | E | Duplicates a risk the exact-head check (item above) already retired; automated, on the critical path of every real release |
| `pnpm run build` + dist-drift diff check in `publish.yml:49-50` | A/B | Not duplicate: produces the exact artifact being shipped and proves the checked-in bundle matches source |
| Candidate/public install verification + hash comparison (`publish.yml:51-52,66-72`) | A/B | Direct proof the shipped artifact is installable and identical pre/post publish |
| `release-candidate.yml` (whole workflow) | A/B | Read-only, exact-SHA, no publish authority — matches Coach's kept candidate-admission shape |
| `release-evidence.mjs` ten-ID manifest mixing engineering and marketing evidence | C/D (manual, not on critical path) | Same "every representation must agree" shape as Coach's deleted aggregate manifest, but not automated and not yet exercised by a real release |
| `test-external-matrix.mjs` eight-case product-behavior matrix | Mixed — subject is the product's core claim, not release infra, but the manifest schema (fixed count, strict field validation) has the same brittleness shape as Coach's evidence/manifest layer | Not automated |
| `docs/release/e2e-pro-playbook.md` Waves B–H | D/E by the template's own admission | Documented but unbuilt; the template already carries the case study's own warning against adopting it wholesale |

## Answer to the research question

The pattern is present in one automated, live place: `publish.yml` proves exact-head CI success
via the GitHub API and then unconditionally re-runs `typecheck`, `lint`, and `test` anyway,
duplicating proof already established for every real release. This is the direct, in-the-way
analogue of Coach's "full local CI mirror" duplication (case study table row "Full local CI
mirror," line 271) — it costs the same minutes on every single publish with no additional safety,
because the same source state was already proven on the same exact commit moments earlier in the
same job.

The pattern is also present, but not automated and not yet exercised, in `release-evidence.mjs`'s
ten-ID manifest, which binds release-critical evidence (`local-gate`, `candidate-matrix`, `npm`,
`github-release`, `public-matrix`) and submission/marketing evidence (`benchmark`, `demo`,
`devpost`, `feedback`, `marketplace`) into one required set and one `ready` boolean — the same
"one synchronous transaction for unrelated concerns" shape the case study diagnoses as the root
cause (case study lines 37-39), scaled down and manual rather than automated.

`docs/release/e2e-pro-playbook.md`'s Waves B–H describe the heaviest Coach-shaped machinery
(capability registries, constraint combination, plan compilers, cadence/TTL, an analyzer that
analyzes aggregated evidence) but none of it has been implemented in code, workflows, or config —
it exists only as an unadopted template section that already documents, in its own text, the same
"adopt by risk, not by default" rule the case study derives.
