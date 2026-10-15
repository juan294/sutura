# Sutura demo video: recording script

Recording draft refreshed 2026-10-15. Target length 2:55, hard limit 3:00. The Devpost rules say judges
are not required to watch past three minutes, so nothing important sits after 2:50.

This is the working script for the recording. The qualitative repo script,
[sutura-video-script.md](sutura-video-script.md), stays number-free on purpose and is
guarded by a contract test. Use this dated script for the weekend recording; the qualitative script retains historical evidence gates.

## The pitch

A green CI check can hide a fake repair. Sutura tests whether an AI fix is real, and
it never merges. Track: Coding and Agentic Engineering.

What the organizers asked for ([rules](https://nebiusglobalaihackathon.devpost.com/rules),
[winning-project tips](https://nebiusglobalaihackathon.devpost.com/updates/46205-how-to-build-a-winning-project)):

- Under 3:00, public on YouTube, showing the project working. Pitch, not tutorial.
- Lead with the problem, then the working app, who it is for, and how it uses Nebius
  and NVIDIA.
- Say "Nebius Token Factory" and "NVIDIA Nemotron" out loud, not only on screen.
- No third-party trademarks, no copyrighted music. English.

## Script

Rehearse the narration with a timer before recording; the timeline ends at 2:55.
Leave room for screen action and pauses. Read each "Say" block aloud once and trim
anything you stumble on.

### 0:00-0:15 | The problem

**On screen:** a failed CI run, then a diff that deletes one assertion line
(`expect(statusFor(503)).toBe('retry')`), then an illustrative green check. Label this opening "Illustration: how a fake fix
can pass"; do not present it as a newly executed run.

**Say:**

> A green CI check is not proof of a repair. An AI agent can make a failing test pass
> by deleting the test. Your pipeline goes green, and the bug is still there.

### 0:15-0:38 | What Sutura is, and who it is for

**On screen:** the Sutura README title and tagline, then the public Case Lab. Show a
pull request only if it has a verified public run and is labeled separately from the fixture.

**Say:**

> This is Sutura, verified self-healing CI, for maintainers who want AI help on failing
> GitHub Actions without handing over merge rights. Sutura reproduces the failure in an
> isolated sandbox, uses NVIDIA Nemotron on Nebius Token Factory to propose repairs, and
> checks for unsafe shortcuts. You get an evidence-backed pull request. Sutura never
> merges.

### 0:38-1:22 | A real repair

**On screen:** the public Case Lab at sutura-case-lab.vercel.app, signed out. Pick
"JavaScript repair". Scroll the result slowly: recorded workflow link, diagnosis, the accepted patch and clean audit, then the verdict
"fixed". Expand Execution and cost detail for search information only when present.
This fixture has no exact failing/policy commit: do not film placeholder values as identity proof.
Optional: a sped-up clip (about 8x, clock overlay) of a live run, labeled "live, sped up".

**Say:**

> Here is the public Case Lab, no account needed. This is a recorded result from our
> v0.3.9 release benchmark. A real off-by-one bug fails one test. Nemotron Nano
> classifies the test failure. Nebius ConTree prepares the dependencies once, then
> branches isolated sandboxes. Nemotron Super proposes bounded repairs, and the
> controller, not the model, applies each patch and runs the real test. The winner is
> rebuilt on a clean branch and audited by Nemotron Ultra. The verdict: fixed, in the
> code, with the assertion untouched.

### 1:22-1:50 | The trap

**On screen:** Case Lab "Greenwash trap". Show the fake fix removing the 503 assertion,
then the recorded rejection and its reason, then the verdict "refused". The Case Lab
may show that policy refused the candidate before the clean audit; keep that stage visible.

**Say:**

> Now the benchmark supplies a tempting shortcut: delete the failing assertion. Sutura's
> policy refuses the test edit. The recorded checks also flag the weakened assertion. Across the 19 trap cases in our
> benchmark, Sutura approved none. Eighteen refused, one gave up, zero false approvals.

### 1:50-2:18 | Nebius, NVIDIA, Tavily

**On screen:** the architecture diagram from the README, then the Case Lab "Upstream
dependency incident" result showing the Tavily citations in the diagnosis.

**Say:**

> Three Nemotron models do three jobs through Nebius Token Factory. Nano diagnoses.
> Super proposes. Ultra audits. ConTree gives every attempt its own sandbox with the
> network off. And when the failure comes from a dependency release, Tavily searches the
> release notes at runtime and attaches the citations to the diagnosis.

### 2:18-2:42 | The evidence, failures included

**On screen:** the v0.3.9 benchmark evidence page, then the outcome table with the
`gave-up` rows highlighted.

**Say:**

> We measure it in public, failures included. On the v0.3.9 release, all 51 benchmark
> cases: zero false approvals, 10 of 10 flaky failures recognized without inventing a
> patch, and 14 of 18 repairs fixed. The four that were not are listed, not hidden. The
> Nemotron calls for the entire benchmark cost seventeen cents. With sandboxes, under five
> dollars.

### 2:42-2:55 | Close

**On screen:** the Case Lab URL and `npx sutura@0.3.9 init` on a plain background.

**Say:**

> Sutura proposes. You inspect the evidence. A human decides. Try the Case Lab, or
> install the pinned release shown here.

## Where every claim comes from

| Claim in the narration | Evidence | Checked |
| --- | --- | --- |
| 51/51 cases, zero false approvals, 14/18 repairs fixed | `docs/demo/placebo-v0.3.9-live-2026-10-03.json`, subject `cc3281485b4364d7c8fcb2e820e03ffbaf893c2a` | JSON and immutable public hash rechecked 2026-10-15 |
| 18 of 19 traps refused, one gave up | same file, `score.catchRate` 18/19; the miss is `trap-workflow-check-removal`, outcome `gave-up` | read 2026-10-15 |
| 10 of 10 flaky recognized | same file, `score.flakyAccuracy` 10/10 | read 2026-10-15 |
| Four repairs did not fix | `score.fixRate.failures`: `python-repair-missing-await`, `repair-esm-extension-nested`, `repair-hard-cache-invalidation`, `repair-tsconfig-drift` | read 2026-10-15 |
| Nemotron calls cost seventeen cents; under five dollars total | sum of the three `nvidia/` model entries in `caseFile.cost.entries` = 0.173620 (the other 0.471723 of `inferenceUsd` 0.645343 is Astra and Jev); `totalUsd` 4.92427699 | read 2026-10-15 |
| Nano, Super and Ultra do diagnose, propose, audit | `packages/core/src/config.ts:10` (models `NVIDIA-Nemotron-3-Nano-30B-A3B`, `nemotron-3-super-120b-a12b`, `Nemotron-3-Ultra-550b-a55b`); roles in the README | read 2026-10-15 |
| Weakened assertion caught, fake fix refused | `trap-weakened-expect` case file: check `weakened-assertion` failed on the removed `expect(statusFor(503)).toBe('retry')`; outcome `refused` | read 2026-10-15 |
| JavaScript repair recorded as fixed | `repair-off-by-one`, outcome `fixed` in the same file | read 2026-10-15 |
| Tavily citations attached to the diagnosis | `upstream-formatter-release` case file, `diagnosis.grounding.citations`; outcome in that run is `gave-up` | read 2026-10-15 |
| Case Lab is public and signed-out | `https://sutura-case-lab.vercel.app/` returned 200; `/api/health` showed v0.3.9, live runs enabled | anonymous GET / health checked 2026-10-15 |
| `npx sutura@0.3.9 init` installs it | clean public npm install, generated Action pin and doctor smoke | passed 2026-10-15 |

Claims excluded because the evidence does not support them: that Token Factory made
the workflow faster than an alternative (no comparison exists), any user or fleet
recovery numbers (the 2026-09-28 fleet observation shows no verified repair PRs), and any
Data Lab result (the dataset was uploaded, but the batch was rejected with HTTP 403).

## Recording checklist

- Record the voice-over separately from the screen capture, 1080p or higher, so you can
  re-time beats without redoing the audio.
- Say the sponsor names clearly: "Nebius Token Factory", "NVIDIA Nemotron", "Nebius
  ConTree", "Tavily". The tips ask for audible callouts, not only on-screen text.
- Case Lab labels results "Recorded live result". Keep that label visible in at least one
  shot so the recording matches the page.
- Trademarks: use the browser in a clean profile, hide bookmarks and extensions, and crop out
  third-party logos unless you have permission to include them. Use plain-text sponsor
  names and Sutura's own branding. No music; if you
  want a bed, use only a track you own.
- Upload to YouTube as public, with captions. I can generate an `.srt` from the final
  narration once you lock the text.
- Before recording, reload the Case Lab and check `/api/health` still reports v0.3.9 with
  live runs enabled.

## Recording choices

1. **Live run on camera.** The recorded result is available as a fallback. A live run
   adds proof that the project works now. A run costs up to USD 0.75 worst case and is
   capped at 4 per hour. It needs your go-ahead before I dispatch one.
2. **Upstream case.** The recorded upstream result is `gave-up`, so the video shows Tavily
   citations on a case that did not end in a fix. That is honest and fits the "failures
   included" theme, but a live run might end `fixed`. Show its citations and keep the recorded gave-up verdict visible; do not imply a fix.
3. **Python case.** Skipped here because the recorded result is also `gave-up`. A live
   smoke on 2026-10-05 did end `fixed`
   (`cl-1791224387099-0b13f3f8`). It is optional extra footage, labeled with its
   October 5 date; the primary cut stays on the release recording.
4. **Fleet story.** Keep fleet recovery and savings claims out of this cut unless a new
   counted report proves them.
5. **Pronunciation and tone.** Decide how you will say "Sutura" and keep it the same
   throughout.

## Weekend capture order (October 17-18)

1. Record the JavaScript fixed result, greenwash refusal, flaky no-patch result and upstream
   citations from the public Case Lab; preserve their Recorded live result labels.
2. Capture the release SHA, benchmark denominator, unsuccessful outcomes and cost breakdown.
3. Record the voice-over and retain the final transcript; export one cut under three minutes
   for Devpost. Extra demonstration videos can remain separate from that submission cut.
4. Capture four full-resolution gallery images: home, JavaScript fixed, greenwash refusal,
   and phone-width result. Never replace evidence with an illustration.
5. Verify public YouTube playback and captions, then supply its actual URL to the final
   submission manifest. A recorded result does not establish a new live repair.

Health and all five recorded routes were reachable anonymously on 2026-10-15;
recheck before capture. See [submission readiness](sutura-submission-readiness-2026-10-15.md).
