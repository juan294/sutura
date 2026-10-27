## Inspiration

A green CI check does not prove that an AI-generated patch fixed the bug. An agent can delete a test, weaken an assertion, relax a compiler rule, or patch the wrong file, and the check still goes green. While building Sutura, I lost a full working day bouncing between failed runs and agent fixes, and watched a fix that only made the red go away. Maintainers need evidence, not a green badge, and they should keep the final say.

## What it does

Sutura watches failed GitHub Actions runs. For supported JavaScript, TypeScript, and Python jobs, it reproduces the failure in an isolated sandbox, separates flaky failures from real ones, searches for a bounded repair, rejects shortcuts, and opens a pull request with evidence for a human to review. It never merges. It also verifies patches written by other agents.

Repair attempts distinguish fixed, refused, flaky (no patch), gave up, and infrastructure stops. Supplied-patch verification has its own result. Deceptive alternatives stay in the record with the reason they were rejected.

Version 0.4.0 starts with a repository assessment that needs no provider account and executes no repository code. It reports support per job, keeping incomplete metadata unknown. Locked, self-contained Node or Python jobs may be candidates; services, application secrets, and unsupported native preparation remain explicit limits. Assessment does not prove that dependencies will prepare or that a repair will work.

Setup now previews its workflow diff, permissions, provider destinations, known limits, and unpriced charges before the user applies the exact reviewed plan. Credentials must be selected explicitly. Doctor separates configuration and default-branch activation from preparation, reproduction, native verification, and integration. Live repair still requires the user's own Token Factory and access-controlled ConTree credentials; installing the package does not provide that access.

The public Sutura Case Lab (no account needed) separates recorded examples from live runs against a public demo repository. The five recorded cases and demo video described here are historical v0.3.9 evidence, not v0.4.0 results. In the video, the Nebius sandboxes appear in the Token Factory console as the live run works.

## How I built it

Sutura is a TypeScript monorepo for Node.js 22 or later: a reusable core, a GitHub Action, a CLI (`npx sutura@0.4.0 assess . --json`), the controlled Placebo benchmark, an evaluation package, and the Case Lab.

**Nebius Token Factory serves three NVIDIA Nemotron 3 models, each with its own job.** Nano (30B) diagnoses the failed run from bounded log evidence. Super (120B) proposes bounded repairs for a source excerpt the controller selects; it cannot choose trusted policy, execute tests, or approve its own candidate. Ultra (550B) audits the cleanly rerun candidate for shortcuts that static checks miss.

**Nebius ConTree sandboxes** prepare dependencies once, snapshot the filesystem, and branch isolated sandboxes for reproduction, triage, repair search, and audit. Dependency installation happens before the source overlay, and network access is off while repository code runs.

**Where Token Factory fits.** In the historical v0.3.9 release benchmark (55 evaluations), Token Factory served 168 Nemotron calls. Median latency was 1.1 seconds for Super, 2.2 for Ultra, and 3.4 for Nano. Those calls took 9% of the summed case time and USD 0.17 of the USD 4.92 total, so sandbox work dominated time and cost. This is one run, not a comparison with another provider.

**Tavily** grounds upstream dependency failures in release notes and migration sources at runtime, and the citations are attached to the diagnosis. **NVIDIA ATIF and NeMo Agent Toolkit**: Sutura exports sanitized trajectories in the ATIF shape and validates them offline with the toolkit. Two optional second-opinion audits from other providers (GPT-6 Astra and TypeSafe Jev) can reject a repair but never approve one, so they cannot widen what Sutura accepts.

Repair evidence records the exact source and policy identities, executed commands, requested and returned model IDs, usage, sandbox lineage, and evidence mode. Setup and unsupported-input stops can occur before a full case file exists; they retain their stop reason and next action. Deterministic capture and replay turn provider, GitHub, and sandbox failures into regression fixtures, and replay is never presented as a live run.

## Challenges I ran into

Generated patches can have the right idea and still produce an invalid or unsafe diff. I added anchored replacement contracts, strict path and size limits, atomic two-file application, clean reconstruction on a fresh branch, and controller-owned behavioral challenges that are frozen before the candidate is seen.

CI logs mention many commands and files. Sutura keeps the observed failed command authoritative, bounds every source read, and rejects paths outside the exact checkout. Early on, a 200-line log window dropped the only failing test block, so the repair had nothing to anchor on; that class of stop is now a named replay test.

Real monorepos made triage expensive: four full reruns of a heavy suite cost more than the inference. Bounded, focused triage uses a cumulative sandbox-time budget and, where applicable, reruns only the failing test file before a full-command probe. In the historical v0.3.9 benchmark, average recorded cost was about 9 cents per evaluation and average duration was 85 seconds. Those figures do not measure v0.4.0.

Recovery also needs the right failure, not just a nonzero exit. Version 0.4.0 requires reproduction to match the selected native failure before repair inference proceeds. Its recovery records require native verification on the exact candidate and an integration identity; a later green workflow alone cannot close an incident. Interrupted setup keeps a private receipt, resumes from observed state, and requires a newly reviewed plan before repeating a remote write whose outcome is unknown.

In the historical v0.3.9 results, async behavior stayed hard: missing awaits, helper-result preservation, and gather ordering accounted for most of the repairs that gave up. Those misses remain in the score instead of leaving the denominator.

## Accomplishments that I'm proud of

The v0.4.0 release benchmark is not complete. The benchmark figures below are historical v0.3.9 results, bound to the exact release commit `cc3281485b4364d7c8fcb2e820e03ffbaf893c2a` (`sutura@0.3.9`, tagged 2026-10-03). It completed 51 of 51 cases and 55 of 55 evaluations for USD 4.92 in recorded inference and sandbox cost, with no infrastructure stops.

- Zero false approvals were observed.
- Sutura refused 18 of 19 trap cases; the one miss gave up and approved nothing.
- It rejected 11 of 11 deceptive patches and recognized 10 of 10 flaky failures without inventing a patch.
- It fixed 14 of 18 repairable cases. The four that gave up are listed in the evidence, not hidden.

In earlier development, on one seeded bug in my own repository, Sutura went from fixing 1 of 22 attempts in August to fixing that same bug ten times in a row two days later. Sutura ships as a GitHub Action, an npm package, and a Marketplace listing. On 2026-10-18, two historical v0.3.9 live Case Lab runs of the JavaScript repair case ended `fixed`, one of them on camera for the demo video. Version 0.4.0 adds repository assessment, reviewed setup, and recovery records; these earlier runs do not demonstrate an improved repair rate for it.

## What I learned

Verification has to be separate from patch generation. A model-generated test or expectation cannot authorize its own repair, so trusted policy, challenge expectations, and the final verdict stay under controller authority, and a human stays the only merge authority.

Exact identity and complete denominators matter as much as the score. A later commit cannot inherit an earlier result, and a check that did not run stays visible as not-run rather than becoming a pass. Repair rates across the four measured releases ending with v0.3.9 were 14/18, 17/18, 13/18, and 14/18; with one live evaluation per case, I read that spread as variance, not progress.

In the historical v0.3.9 benchmark, zero false approvals did not mean every trap was caught: one trap gave up. Hidden repair-preservation checks passed in three of four repair cases, and the fourth did not run. Tavily-grounded upstream cases fixed 1 of 4, so Tavily's measured role is current upstream grounding, not a repair-quality claim. No user study was run, and I claim no external adoption. I uploaded a sanitized 110-row dataset to Nebius Data Lab, but the batch request was rejected with HTTP 403, so there is no batch result.

## What's next for Sutura

I use Sutura across a fleet of more than twenty repositories. A new release benchmark and their ordinary CI failures are the next evidence for v0.4.0. The recovery collector follows observed incidents from a failed run to a repair pull request, exact native verification, and integration, or to the reason they stopped. Missing evidence, unsupported jobs, and incomplete setup stay visible; installation counts do not establish successful repairs or independent adoption. My sibling entry, Cirujano, trims the cost of CI that works and moves heavy jobs to on-demand Nebius runners; an automatic handoff between the two remains a future integration.
