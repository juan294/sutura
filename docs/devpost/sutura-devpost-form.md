# Sutura: Devpost form text

Recording-ready draft refreshed 2026-10-15. Final submission remains pending. Paste-ready text for the Nebius x NVIDIA Global AI Hackathon submission
form, in the order the form asks. Project details and additional-info fields were inspected in the live draft on
2026-10-15. Follow the [official rules](https://nebiusglobalaihackathon.devpost.com/rules)
where generic Devpost guidance differs (public YouTube, under three minutes). Every number comes from the v0.3.9 release evidence (sources
at the end). Update this file as evidence changes; the narrative source of record stays
[sutura-submission.md](sutura-submission.md).

## Project name

Sutura

## Tagline

Short (37 characters): `CI repair that proves the fix is real`

Long (about 130 characters): `Sutura reproduces failing CI, races repairs on Nemotron, rejects fixes that cheat, and opens an evidence-backed PR. It never merges.`

## Track

Coding and Agentic Engineering. The track asks for agents that write, run, and test code
in Token Factory; Sutura plans, applies, tests, and audits repairs on a real repository
with a human as the only merge authority.

## Project description

**The problem.** A green CI check does not prove an AI-generated patch fixed the bug. An
agent can delete a test, weaken an assertion, or patch the wrong file, and the check still
goes green. Maintainers need evidence, not a green badge.

**What Sutura does.** Sutura watches failed GitHub Actions runs. It reproduces the failure
in an isolated sandbox, separates flaky failures from real ones, searches for a repair,
rejects shortcuts, and opens a pull request with the evidence for a human to review. It
never merges. It also verifies patches written by other agents. It repairs JavaScript,
TypeScript, and Python repositories.

**How we use Nebius and NVIDIA.**

- **Nebius Token Factory serves three NVIDIA Nemotron 3 models, each with its own job.**
  Nano (30B) diagnoses the failed run. Super (120B) proposes bounded repairs for a source
  excerpt the controller selects. Ultra (550B) audits the cleanly rerun candidate for
  shortcuts that static checks miss.
- **Nebius ConTree sandboxes** prepare dependencies once, snapshot the filesystem, and
  branch isolated sandboxes for reproduction, triage, repair search, and audit. Untrusted
  stages run with the network off.
- **NVIDIA ATIF and NeMo Agent Toolkit.** Sutura exports sanitized trajectories in the ATIF
  shape and validates them offline with the toolkit.
- **Tavily** grounds upstream dependency failures in release notes at runtime.
- Two optional second-opinion audits (GPT-6 Astra and TypeSafe Jev) can reject a repair but
  never approve one, so they cannot widen what Sutura accepts.

**Where Token Factory fits.** In the v0.3.9 release benchmark (55 evaluations), Token Factory
served 168 Nemotron calls. Median latency was 1.1 seconds for Super, 2.2 for Ultra, and 3.4
for Nano. Those calls took 9% of summed case elapsed time and USD 0.17 of the USD 4.92 total, so sandbox work dominated the aggregate
time and cost. This is one run and not a comparison with another provider.

**Results, failures included.** On the v0.3.9 release commit, all 51 benchmark cases (55
evaluations) ran with zero false approvals and no infrastructure stops. Sutura refused 18
of 19 trap cases (the other one gave up and approved nothing), recognized 10 of 10 flaky
failures without inventing a patch, rejected 11 of 11 deceptive patches, and fixed 14 of 18
repairable cases. The four it did not fix are listed in the evidence, not hidden.

**Limits we state plainly.**

- Zero false approvals does not mean every trap is caught: one trap gave up.
- Hidden repair-preservation checks passed in three of four repair cases; the fourth did not
  run because its repair gave up.
- Tavily-grounded upstream cases fixed 1 of 4.
- Fix rates for the last four releases were 14/18, 17/18, 13/18, and 14/18. Each release
  has one live evaluation per case, so we read that spread as variance, not progress.
- A separate 80-case development run (33 of 42 repairs) is not release acceptance, and its
  held-out 20 cases stay sealed.
- No user study was run, and we make no claim about external adoption.
- Nebius Data Lab: we uploaded a sanitized 110-row dataset (READY), but the one batch
  dispatch was rejected with HTTP 403, so there is no batch result. The record is in
  `docs/demo/nebius-data-lab-upload-2026-10-07.md`.

**Built during the submission period.** The submission period opened 2026-08-26. During it, Sutura grew into a
GitHub Action, CLI, npm package, and public Case Lab. The released version is v0.3.9 with exact-source evidence and a measured release benchmark.

**What's next.** Sutura runs on the author's own repositories. We measure every incident
from failed run to repair pull request and green CI, or to the reason it stopped, and fix the
stops that recur.

## Built With

TypeScript, Node.js, Python, Nebius Token Factory, NVIDIA Nemotron, Nebius ConTree, Tavily,
GitHub Actions, NVIDIA ATIF, NVIDIA NeMo Agent Toolkit, OpenAI GPT-6 Astra (optional
second opinion), TypeSafe Jev (optional second opinion), Vitest, Vercel, pnpm.

The FAQ does not restrict extra providers, and the description discloses Astra and Jev as
veto-only voices that can reject a repair but never approve one.

## Try it out links

- Demo: https://sutura-case-lab.vercel.app/
- Code: https://github.com/juan294/sutura
- npm: https://www.npmjs.com/package/sutura
- GitHub Marketplace: https://github.com/marketplace/actions/sutura-verified-self-healing-ci
- Release: https://github.com/juan294/sutura/releases/tag/v0.3.9
- Evidence: https://github.com/juan294/sutura/blob/develop/docs/demo/sutura-v0.3.9-release-benchmark-evidence.md
- Video: not recorded yet. Add the public YouTube URL here.

## Testing instructions for judges

No account or credentials are needed.

1. Open the [Case Lab](https://sutura-case-lab.vercel.app/) and pick any of the five cases:
   JavaScript repair, Python repair, flaky failure, greenwash trap, upstream dependency
   incident. Each shows a recorded result from the v0.3.9 release benchmark, labeled as a
   recorded result.
2. Optional: start a live run. It dispatches the pinned v0.3.9 Action against the public
   repository `juan294/sutura-demo`. Limits checked 2026-10-15: one run at a time, four per hour,
   24 per day. If a limit is reached, the recorded result stays available.
3. To inspect the code without any keys, clone the repository and follow the README's
   contributor setup. The test suite uses recorded fixtures and spends no API credit.
4. To run Sutura on your own repository you need your own Nebius Token Factory key and a
   ConTree token; see the README's "Install Sutura".

## Additional info: refreshed required fields

These answers are prepared locally. The saved portal feedback still leads with the older
80-case development run; update its quality and platform answers to the release results
below before submission. Preserve the owner’s existing subjective numeric ratings.

**AI tools used while working on the project:** Codex and Claude Code assisted development.
The running product uses NVIDIA Nemotron Nano, Super and Ultra through Nebius Token Factory,
Tavily for upstream grounding, and optional GPT-6 Astra and TypeSafe Jev veto-only audits.
NVIDIA ATIF and NeMo Agent Toolkit support offline trajectory validation.

**Level of learning:** Significant (Juan confirmed 2026-10-15).

**AI value usable in your career:** Yes (Juan confirmed 2026-10-15).

**Nemotron output quality:** Retain the existing 8/10 owner rating. On exact v0.3.9, the
complete system fixed 14 of 18 repairable cases, rejected 11 of 11 deceptive patches,
recognized 10 of 10 flaky cases and observed zero false approvals. One trap gave up,
and hidden repair checks passed in three of four cases, with one not run. These are
system-level results with two optional veto-only audit voices, not isolated model scores.

**Most valuable Nebius capabilities:** Managed Token Factory inference served Nano, Super
and Ultra through one API. In the release benchmark, Nemotron calls cost USD 0.173620;
recorded total cost, including sandboxes and optional audits, was USD 4.92427699. ConTree
snapshot branches isolated reproduction, search and clean audit. A sanitized Data Lab
dataset was uploaded, but the batch request was rejected with HTTP 403; no batch result
is claimed. We did not provision or operate GPU instances ourselves.

## Image gallery

Four real Case Lab captures from 2026-10-07 are in [gallery-2026-10-07](gallery-2026-10-07/):
the home page, the JavaScript repair result, the refused greenwash trap with its failed
check, and the phone-width view. They are reduced-resolution browser captures; retake them
at full resolution if the gallery needs sharper images. The eight older concept
illustrations in [gallery-2026-09-13](gallery-2026-09-13/) are labeled "Concept
illustration" and contain no numbers.

## Feedback

Paste from [the feedback document](../feedback/2026-10-sutura-nebius-feedback.md). It
covers what we used each service for, what worked, onboarding, observed problems with their
evidence, requests, and whether we would build with them again. It stays open to updates
until the day before submission.

## Open items before submitting

- [ ] Record the video and add its public YouTube URL (script:
  [sutura-video-recording-script.md](sutura-video-recording-script.md)).
- [ ] Replace the stale saved Devpost story (currently 0.2.1 / historical 0.2.0) with this
  release-bound narrative; verify its rendered preview.
- [ ] Leave the Builders & Brews city field empty (decided 2026-10-07: not attending).
- [ ] Upload the four real screenshots in `gallery-2026-10-07/` to the Devpost gallery.
- [ ] Recheck every number below against the evidence on the day before submission.
- [ ] Open the public project page signed out and click every link.
- [ ] Complete the final judging manifest with the actual public video/transcript and gallery,
  immutable evidence URLs and hashes, then archive the final submitted preview and receipt.

See [the dated readiness record](sutura-submission-readiness-2026-10-15.md) for current checks,
remaining gates and the October 29 submission target.

## Project Story field mapping

Use **The problem** for Inspiration; **What Sutura does** for What it does;
**How we use Nebius and NVIDIA** for How we built it; the four unsuccessful repair cases
and incomplete hidden checks for Challenges; **Results, failures included** for
Accomplishments; **Limits we state plainly** and the canonical narrative's What we learned
for What we learned; and **What's next** for the close. Keep the exact release identity and
all denominators together. Do not paste this operational checklist into the public story.

## Where each number comes from

| Claim | Source |
| --- | --- |
| 51 cases, 55 evaluations, zero false approvals, 18/19 traps, 10/10 flaky, 11/11 deceptive, 14/18 fixed, 1/4 Tavily, three of four hidden checks | [`placebo-v0.3.9-live-2026-10-03.json`](../demo/placebo-v0.3.9-live-2026-10-03.json), subject `cc3281485b4364d7c8fcb2e820e03ffbaf893c2a` |
| 168 Nemotron calls, median 1.1 / 2.2 / 3.4 s, 9% of summed case elapsed time, USD 0.17 of 4.92 | `trace` and `cost` in the same file, computed 2026-10-07 |
| Fix rates 14/18, 17/18, 13/18, 14/18 | the v0.3.6 to v0.3.9 result files in [`docs/demo`](../demo/) |
| 33 of 42 repairs, held-out 20 sealed | [Stage 3 v8 evidence](../demo/run-manifests/development-validation-v8-evidence.md) |
| Case Lab limits | `/api/health` on 2026-10-15: 1 concurrent, 4 per hour, 24 per day |
