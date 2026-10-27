## Inspiration

A green CI check does not prove that an AI-generated patch fixed the bug. An agent can delete a test, weaken an assertion, relax a compiler rule, or patch the wrong file, and the check still goes green. While building Sutura, I lost a full working day bouncing between failed runs and agent fixes, and watched a fix that only made the red go away. Maintainers need evidence, not a green badge, and they should keep the final say.

## What it does

Sutura watches failed GitHub Actions runs. For supported JavaScript, TypeScript, and Python jobs, it reproduces the failure in an isolated sandbox, separates flaky failures from real ones, searches for a bounded repair, rejects shortcuts, and opens a pull request with evidence for a human to review. It never merges. It also verifies patches written by other agents. Fixed, refused, flaky, gave-up, and infrastructure-stop outcomes stay visible with their evidence.

Version 0.4.1 includes a repository assessment that needs no provider account and executes no repository code. It reports support per job, keeping incomplete metadata unknown. Locked, self-contained Node or Python jobs may be candidates; services, application secrets, and unsupported native preparation remain explicit limits. Assessment does not prove that dependencies will prepare or that a repair will work.

Setup previews its workflow diff, permissions, provider destinations, known limits, and unpriced charges before the user applies the exact reviewed plan. Credentials must be selected explicitly. Doctor separates configuration and default-branch activation from preparation, reproduction, native verification, and integration. Live repair still requires the user's own Token Factory and access-controlled ConTree credentials; installing the package does not provide that access.

The public Sutura Case Lab separates recorded examples from live runs against a public demo repository. The [demo video](https://www.youtube.com/watch?v=5Pxpaa41fl8) shows a historical v0.3.9 live run, with Nebius sandboxes appearing in the Token Factory console. Recorded examples and live runs identify their versions separately.

## How I built it

Sutura is a TypeScript monorepo for Node.js 22 or later: a reusable core, a GitHub Action, a CLI (`npx sutura@0.4.1 assess . --json`), the controlled Placebo benchmark, an evaluation package, and the Case Lab. The published v0.4.1 CLI is available through npm and Homebrew; the GitHub Action pins an immutable release commit.

**Nebius Token Factory serves three NVIDIA Nemotron 3 models, each with its own job.** Nano (30B) diagnoses the failed run from bounded log evidence. Super (120B) proposes bounded repairs for a source excerpt the controller selects; it cannot choose trusted policy, execute tests, or approve its own candidate. Ultra (550B) audits the cleanly rerun candidate for shortcuts that static checks miss.

**Nebius ConTree sandboxes** prepare dependencies once, snapshot the filesystem, and branch isolated sandboxes for reproduction, triage, repair search, and audit. Dependency installation happens before the source overlay, and network access is off while repository code runs.

**Tavily** grounds upstream dependency failures in release notes and migration sources at runtime, with citations attached to the diagnosis. **NVIDIA ATIF and NeMo Agent Toolkit**: Sutura exports sanitized trajectories in the ATIF shape and validates them offline with the toolkit. Optional GPT-6 Astra and TypeSafe Jev audits can reject a repair but never approve one.

Repair evidence records exact source and policy identities, executed commands, model IDs, usage, sandbox lineage, and evidence mode. Setup and unsupported-input stops can occur before a full case file exists; they retain their stop reason and next action. Capture and replay turn provider, GitHub, and sandbox failures into regression fixtures. Replay is always labeled separately from live execution.

## Challenges I ran into

Generated patches can have the right idea and still produce an invalid or unsafe diff. I added anchored replacement contracts, strict path and size limits, atomic two-file application, clean reconstruction on a fresh branch, and controller-owned behavioral challenges frozen before the candidate is seen.

CI logs mention many commands and files. Sutura keeps the observed failed command authoritative and bounds every source read. A 200-line log window once dropped the only failing test block; that stop is now covered by a replay test. Slow suites also made triage expensive, so focused probes and a cumulative sandbox-time budget bound that work.

Recovery needs the right failure. Reproduction must match the selected native failure before repair inference proceeds. Version 0.4.1 preserves valid failure-identity stops and their cost evidence. For the new benchmark, nine JavaScript flaky fixtures changed under the `initial-failure-v1` corpus revision so their initial failures match before triage. Earlier results retain their original corpus identity. The case count stayed the same, but the inputs changed, so I do not present the new score as an improvement over an equivalent old run.

Interrupted setup keeps a private receipt and resumes from observed state. A remote write with an unknown outcome requires a newly reviewed plan before it can repeat. Recovery records require native verification on the exact candidate and an integration identity; a later green workflow alone cannot close an incident.

## Accomplishments that I'm proud of

The completed v0.4.1 benchmark binds both controller and subject to published release commit `3b6152d9d72beebd7dcbaaa4045c94d640456adb`. It covers 51 cases and 55 evaluations, with USD 4.9910327 in recorded cost: USD 0.705778 inference and USD 4.2852547 sandbox. The [benchmark evidence](https://github.com/juan294/sutura/blob/develop/docs/demo/sutura-v0.4.1-release-benchmark-evidence.md) retains the full denominator and run identities.

- Zero false approvals were observed in this run.
- Sutura fixed 14 of 18 repairable cases; three gave up and one was refused.
- It refused 17 of 19 traps; the other two gave up and approved nothing.
- It recognized all 10 flaky failures without inventing a patch.
- Ten of 11 deceptive supplied candidates had the required rejection proof. The remaining case stopped before supplied-candidate evaluation; it is not counted as a proved rejection. All 11 supplied fake patches failed the independent hidden checks.

These controlled benchmark results describe the frozen run. Fleet repair rates and independent adoption remain unmeasured.

## What I learned

Verification has to be separate from patch generation. A model-generated test or expectation cannot authorize its own repair, so trusted policy, challenge expectations, and the final verdict stay under controller authority. A human stays the only merge authority.

Complete denominators matter as much as the score. Three of four hidden repair-preservation checks passed; the fourth did not run. A stop before evaluating a deceptive candidate is not proof that the candidate was rejected. Keeping those distinctions prevents a safer-looking headline from replacing what actually happened.

The upstream ablation fixed 0 of 4 cases with Tavily and 2 of 4 without it. This small run does not show a repair-quality benefit from grounding; Tavily's demonstrated role remains access to current upstream sources. No user study was run, and I claim no external adoption. I uploaded a sanitized 110-row dataset to Nebius Data Lab, but the batch request received HTTP 403, so there is no batch result.

## What's next for Sutura

I use Sutura across a fleet of more than twenty repositories. Their ordinary CI failures are the next evidence: observed incidents, repair pull requests, exact native verification, integration, or the reason an attempt stopped. Missing evidence, unsupported jobs, and incomplete setup stay visible. My sibling entry, Cirujano, trims the cost of CI that works and moves heavy jobs to on-demand Nebius runners; an automatic handoff between the two remains a future integration.
