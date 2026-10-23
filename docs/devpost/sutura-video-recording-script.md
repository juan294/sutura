# Sutura demo video: recording script

Final version, 2026-10-17. Record this for the hackathon. Target **2:50**, export below **3:00** including the end card. Track: Coding and Agentic Engineering.

This merges the two October 17 drafts: the concrete origin story, same-bug progress and modular Cirujano clip from one, and the precise screen cues, rehearsal method and evidence limits from the other. The [qualitative source script](sutura-video-script.md) remains a separate, number-free contract artifact. Read only the timed **Say** blocks for the submission.

## The pitch to remember

**Every developer gets a CI nurse on call. Every repair has to prove itself. Nebius makes it practical.**

Metaphor rule: Sutura is the **nurse** (triages, stitches, hands the decision to the doctor). **Surgeon** belongs to Cirujano (Spanish for surgeon), which operates on CI cost. The developer is the **doctor** who signs off. Never call Sutura a surgeon.

Open big, then make it tangible: one real repair, one shortcut refused, one flaky failure left alone. Be ambitious about the future and exact about the numbers. Close on what a verified answer costs today, and on what we measure next.

The [official rules](https://nebiusglobalaihackathon.devpost.com/rules) and [organizer video guidance](https://nebiusglobalaihackathon.devpost.com/updates/46205-how-to-build-a-winning-project) ask for functioning software, public YouTube, under three minutes, a pitch and not a tutorial, and audible Nebius and NVIDIA callouts. Use plain-text sponsor names and your own visuals. No other third-party marks, no copyrighted music.

## Set up before rehearsing

Recording method (decided 2026-10-18): each beat is its own clip, assembled in the editor. Claude drives one Dia tab through the browser extension: it loads the page for the beat, enlarges the text and scrolls to each section while you record. You say "prep N", Claude parks the tab at the beat's first view and answers "ready"; you start recording and say "go N"; Claude runs the beat and answers "done". "go N again" repeats it. The tab list below is the page order Claude loads, not tabs you keep open. Record only the browser window, not the full 6K desktop, so page text stays readable; export the final cut at 3840x2160. Beat 3 is the one live run (see its section); every other beat shows recorded results and never clicks **Start live run**.

| Tab | Open | Prepare |
| --- | --- | --- |
| A | [Case Lab home](https://sutura-case-lab.vercel.app/) | Title and five case cards. |
| B | [JavaScript repair](https://sutura-case-lab.vercel.app/replay/javascript-repair/) | **Failed commit and CI evidence** (`expected 3 to be 2`), **Recorded live result** label, **Nano diagnosis and confidence**, expanded **Execution and cost detail** (ConTree search tree, Super proposals, selected patch), **Clean audit branch and Ultra verdict**, **Fixed**. |
| C | [Greenwash trap](https://sutura-case-lab.vercel.app/replay/greenwash-trap/) | Supplied patch removing `expect(statusFor(503)).toBe('retry')`, policy refusal, failed **weakened-assertion** check, **Refused**. |
| D | [Flaky failure](https://sutura-case-lab.vercel.app/replay/flaky-failure/) | **Flaky, no patch** with its recorded-result label. |
| E | [Upstream incident](https://sutura-case-lab.vercel.app/replay/upstream-incident/) | Tavily citations in the diagnosis. Its outcome is **Gave up**: show grounding, do not linger on the verdict. |
| F | [How Sutura verifies](https://sutura-case-lab.vercel.app/about/) | **Runtime roles** table. |
| G | [Dogfood ledger](https://github.com/juan294/sutura/blob/develop/docs/demo/dogfood-ledger.md) | The table: early gave-up and refused rows, then ten **fixed** rows. |
| H | [Release benchmark evidence](https://github.com/juan294/sutura/blob/develop/docs/demo/sutura-v0.3.9-release-benchmark-evidence.md) | Headline counts, outcome table with the four unfixed repairs, model-cost table. |
| I | [Cirujano public proof](https://github.com/juan294/cirujano/blob/develop/docs/research/2026-10-09-skip-validated-push-live-proof.md) | **Measured runs**: baseline 3, candidate 1, control 4. |

Four editor cards (still 3840x2160 images you drop into the video editor) are ready in [video-cards](video-cards/): `0-intro-card.png` (beat 0, 10 seconds; `0-intro-card-youtube-thumbnail.jpg` is the same card at 1280x720 for YouTube), `1-vision.png` (beat 1, about 4 seconds, optional), `2-fake-fix-illustration.png` (beat 2, about 5 seconds) and `3-end-card.png` (beat 8, final 15 seconds).

Before final capture, check `https://sutura-case-lab.vercel.app/api/health` reports version 0.3.9 with `"enabled":true`. It did on October 17.

## Script

The narration is 382 words including the intro: 2:33 at 150 words per minute, 2:56 at 130, so keep the pace up and cut pauses rather than words if a rehearsal runs long. That leaves the repair and refusal shots time to register. Timestamps are editing targets; your spoken rehearsal sets the final pace.

### 0. Intro | 0:00-0:10

**Show:** `0-intro-card.png` full screen for the whole beat (it is also the YouTube thumbnail). No browser.

**Say:**

> I'm Juan González. I run more than twenty projects with AI coding agents, and this is Sutura, one of my two entries for the Nebius and NVIDIA Global Hackathon.

Timing note (2026-10-18): the eight recorded clips already total 2:50.9, so a 10-second intro pushes the cut to 3:00.9. Take the time back from beat 8's silent end-card hold (36.6 s recorded against 33 planned) and a second or two from beats 4 and 6 so the export stays under 3:00. The beat timestamps below are written without the intro; add 0:10 to each.

### 1. The future | 0:00-0:15

**Show:** Tab A, title and case cards. Brief cut to the **Vision** card on "every developer", then back to the product.

**Say:**

> Imagine every developer with a CI nurse on call. A build breaks at three in the morning; by breakfast it is triaged, repaired and proven, waiting for a human to approve. That is Sutura, built on Nebius.

### 2. Why I built it | 0:15-0:30

**Show:** Tab B, **Failed commit and CI evidence**, error `expected 3 to be 2`. Then the **Illustration** card.

**Say:**

> It started with my own pain: a full working day lost bouncing between failed runs and agent fixes. And an agent can make CI green by deleting the failing test, while the bug stays.

### 3. A real repair | 0:30-1:05

**Show: a live run, split screen, sped up.** Left half (Dia): the Case Lab. Right half (Chrome, signed in as the Token Factory org): **Sandboxes → Operations** at `tokenfactory.nebius.com/sandboxes/operations`. Caption in the editor: **Live run, sped up**.

1. Claude clicks **Start live run** on the JavaScript repair card, then switches the left half to the GitHub workflow log (the result page's "Watch the workflow run on GitHub" link).
2. Claude reloads the Operations page every 10 seconds. About a minute in, an **Image import** row appears, then a burst of **Sandbox run · Success** rows for about two minutes: Sutura's ConTree sandboxes in the Nebius account as they happen.
3. When the workflow finishes (about 3.5 minutes), the left half returns to the result page showing **Live run · Fixed** and "Executed live".
4. Then, still on the result page, scroll: **Nano diagnosis**, expanded **Execution and cost detail** with the ConTree search tree and the selected diff (`Math.floor(items / size) + 1` becomes `Math.ceil(items / size)`, hold four seconds), **Clean audit branch and Ultra verdict**, **Fixed**.

Speed the 3.5 minutes to about 20 seconds in the editor; keep the diff and verdict at normal speed. Fallback if the live run gives up or the limit of 4 per hour is reached: record the **Recorded live result** route with the same scroll order and keep its label visible.

Test run 2026-10-18 09:32Z (`cl-1792308749776-358e4d83`, GitHub run 39108052864): outcome fixed, 22 sandbox operations, sandbox cost USD 0.14; 15 new rows appeared on the Operations page between 09:33:45 and 09:35:08. Its result page stays public at `sutura-case-lab.vercel.app/result/?id=cl-1792308749776-358e4d83`.

**Say:**

> Here is the public Case Lab, running a live repair right now: a real off-by-one bug. NVIDIA Nemotron Nano, served by Nebius Token Factory, diagnoses it. Nebius ConTree prepares dependencies once and branches isolated sandboxes. Nemotron Super proposes repairs; the controller applies each one and runs the real tests, network off. The winner gets a clean rerun and a Nemotron Ultra audit. The code changes, the assertion stays. A human decides whether to merge.

### 4. The shortcut, refused | 1:05-1:22

**Show:** Tab C, supplied patch, policy refusal, failed **weakened-assertion**, **Refused**. Cut to Tab D for the last sentence.

**Say:**

> Now the benchmark offers a fake fix: delete the failing assertion. Sutura refuses it and flags the weakened assertion. Across nineteen traps in the release benchmark, it approved none. And a flaky failure is recognized as flaky, with no invented patch.

### 5. Why Nebius | 1:22-1:37

**Show:** Tab F, **Runtime roles**. Then Tab E, Tavily citations.

**Say:**

> Nebius gives one developer workflow managed intelligence and isolated execution, with no GPU fleet to operate. When a dependency release breaks the build, Tavily searches the release notes live and cites them.

### 6. Early data | 1:37-2:02

**Show:** Tab G, the ledger rows turning from gave-up to ten fixed. Then Tab H: **51 cases / 55 evaluations**, captions **14/18 repairs fixed**, **10/10 flaky recognized**, **0 observed false approvals**, then the four unfixed rows. Keep **v0.3.9 · October 3** visible.

**Say:**

> The early data is encouraging. In August, Sutura fixed one of twenty-two attempts on a seeded bug. Within two days, it fixed that same bug ten times in a row. On the v0.3.9 release benchmark: fifty-one cases, fourteen of eighteen repairs fixed, ten of ten flaky failures recognized, zero false approvals observed, and the four misses published.

### 7. Sutura and Cirujano | 2:02-2:17 (record as a separate clip)

**Show: a live Cirujano runner, split screen, sped up.** Left half (Dia): Tab I, **Measured runs**, then the GitHub run page of a dispatched workflow. Right half (Chrome): the Nebius Cloud console, Cirujano's project, **Compute → Virtual machines**, starting from "No standalone VMs". Caption: **Live run, sped up**, plus **Separate Cirujano proof: 3 → 1 billed runner minutes per eligible push**. The **Proposed joint workflow** card (Sutura heals red CI → human review → Cirujano trims green CI) goes in during the edit.

Recorded 2026-10-18: Claude dispatched the coverage workflow of an enrolled private repository (Cirujano handle P5) on its `develop` branch (run 39115214375, 09:24:35Z; a manual run of an existing workflow, no commit). Its coverage job is enrolled with Cirujano's P5 controller. On camera the console went empty → `cirujano-p5-vm` Starting → Running (about 09:27Z) → the job ran on runner `cirujano-p5-g23` (09:28:55Z to 09:31:34Z, green) → Stopped (09:38Z) → deleted (09:40Z). About 15 minutes of real time; compress to the 15-second beat. Cost: a few cents of VM time. The repository name is private; keep it out of frame or blur it.

**Say:**

> Sutura heals CI when it breaks. Its sibling, Cirujano, cuts the cost of CI that works, with leaner workflows and on-demand Nebius runners. In its public proof, eligible push checks fell from three billed minutes to one.

### 8. Cost and invitation | 2:17-2:50

**Show: split screen.** Left half (Dia): Tab H, model-cost table: **Nemotron $0.17**, **total $4.92 for 55 evaluations**. These are the numbers the narration says. Right half (Chrome): the Token Factory **Usage** page (`tokenfactory.nebius.com/organization/usage`), signed in as the Token Factory org, showing the Nemotron Nano, Super and Ultra rows. Its totals cover a month of all usage (about USD 2.43 on 2026-10-18), not the benchmark, so do not read them aloud. End on the end card. Hold through 2:50 in silence.

**Say:**

> And the cost of a verified answer? About eighty-five seconds and nine cents per benchmark evaluation, with seventeen cents of Nemotron for the whole run. Next, we measure the hours and dollars that gives back, on my repositories, then for every developer. Sutura proposes. A human decides. Try it in the Case Lab. Sutura: verified self-healing CI. Developers keep their focus, every repair proves itself, and a human keeps the final say. Built on Nebius, with NVIDIA Nemotron. Thank you.

## Rehearse three times, then capture

1. **Voice only.** Read the eight Say blocks with a stopwatch. Aim for 2:30-2:45. Pause after "the assertion stays" and "ten times in a row". If long, cut "with a recorded release result" in beat 3 and "with no GPU fleet to operate" in beat 5; keep the repair and the refusal intact.
2. **Screen only.** Practice A → B → C → D → F → E → G → H → I → H → A. Pre-expand B and C. Hold key details three to five seconds, point once, then stop moving the pointer. Keep recorded-result labels visible.
3. **Full practice.** Speak while switching prepared views. Watch it back once: can a stranger see the repaired line, see the refused shortcut, name Nebius's role, and tell measured cost from future savings? Re-record the weak beat, not the whole video.
4. **Final capture.** Record clean narration separately and assemble footage under it. Do not speed up speech to fit. Every beat is its own clip, so any one can be replaced later (beat 7 after Cirujano's October 28 measurement, beat 3 if a later live run shows more). Export at 1080p or higher, upload public on YouTube with captions that match the final take, and keep the exact transcript.

Sound excited about the future, calm during the proof, precise on numbers. Say **Nebius Token Factory**, **NVIDIA Nemotron**, **Nebius ConTree** and **Tavily** clearly, and keep one pronunciation of Sutura and Cirujano.

## Longer pitch for conversations

Use this outside the submission cut, or for judge questions.

> The next leap in developer productivity is protecting focus. Imagine every maintainer with a repair team that investigates broken CI, tests alternatives in isolation, and brings back a small patch with evidence. Across thousands of teams, that returns an enormous amount of attention to building software.
>
> Sutura came from my own work. While building it, I lost a working day bouncing between failed runs and agent fixes. Handing CI to an AI agent only helps if I can trust the result, and an agent can delete an assertion and deliver a green check with the bug still there. Sutura makes every repair earn its verdict: real execution, repository policy, a clean rerun and an independent audit.
>
> Nebius makes this practical. Token Factory serves NVIDIA Nemotron Nano for diagnosis, Super for bounded repairs and Ultra for audit. ConTree turns one prepared snapshot into isolated reproduction, repair and audit branches. I build the product instead of operating GPU infrastructure. Tavily brings current upstream facts into diagnoses.
>
> The early data gives us something concrete. On one seeded bug, Sutura went from one fix in twenty-two attempts to ten fixes in a row within two days. The v0.3.9 release fixed fourteen of eighteen benchmark repairs, recognized all ten flaky cases and had no observed false approvals, and we publish the four that gave up.
>
> Cirujano extends this to CI cost. It trims repeated work and moves heavy jobs to on-demand Nebius AI Cloud runners that stop when idle. Its public proof cut eligible push checks from three billed minutes to one. Each product works on its own today; an automatic handoff is the next integration.
>
> Today a verified benchmark answer costs about nine cents and eighty-five seconds of machine time. The next measurement is the one that matters most: the hours and dollars that gives back to developers.

## Everything we used

Say the first four out loud. The rest can sit in the Devpost text.

| Component | Role |
| --- | --- |
| Nebius Token Factory | Managed inference for all Nemotron calls: 168 in the v0.3.9 benchmark, median latency 1.1 s Super, 2.2 s Ultra, 3.4 s Nano. |
| NVIDIA Nemotron 3 Nano 30B, Super 120B, Ultra 550B | Diagnose, propose, audit. [Model configuration](../../packages/core/src/config.ts#L10). |
| Nebius ConTree | Dependencies prepared once, snapshots, isolated reproduction, triage, search and clean verification branches; network off for untrusted stages. |
| Tavily Search / Extract | Runtime grounding in upstream release notes, cited in the diagnosis. Upstream fixes were 1/4 in the release. |
| NVIDIA ATIF and NeMo Agent Toolkit | Sanitized trajectory export and offline evaluation. [Trajectory](../demo/sutura-trajectory-v1.atif.json), [report](../evaluation/nemo-atif-report.json). |
| Optional veto-only auditors | Two third-party second opinions can reject a repair, never approve one. Do not name or show them in the video. |
| Nebius Data Lab | Sanitized dataset uploaded and read back on October 7; the batch was denied with HTTP 403. Feedback form only, not the video. [Record](../demo/nebius-data-lab-upload-2026-10-07.md). |
| GitHub Actions, GitHub App, npm, Marketplace | CI entry point, scoped repair-PR access and distribution. |
| Vercel | Hosts the Case Lab UI; repair intelligence and sandboxes run on Nebius. |
| Placebo | Controlled benchmark with traps, flaky cases and retained failures. [Contract](../../packages/placebo/README.md). |
| TypeScript, Node.js 22, Python, pnpm, Vitest, ESLint | Implementation and tooling; JavaScript, TypeScript and Python repair support. |
| Codex and Claude Code | Development assistance, separate from the runtime repair models. |
| Cirujano: Token Factory, Sandboxes, Nebius AI Cloud CPU VMs | Separate product: workflow diagnosis, isolated optimization verification and on-demand runners. |

## Time and money: what is measured

| Status | Number | Limit |
| --- | --- | --- |
| Measured Sutura cost | **$4.92** for 55 evaluations = **$0.17 Nemotron** + $0.47 other inference + $4.28 sandboxes | October 3 release benchmark. Benchmark spend, not money saved. |
| Measured per evaluation | About **85 seconds** and **9 cents** (4,663 case-seconds and $4.92 over 55) | Averages include refusals, flakes and unsuccessful outcomes. Not a production price or completion-time promise. |
| Measured repair work | **14/18 repairs fixed**; same seeded bug went **1/22 → 10 in a row** | Controlled cases. No measurement of recovered developer hours. |
| Measured Cirujano mechanism | **3 → 1 billed runner minutes** per eligible merge push (66.7%) | Three sampled pushes on a public repository: **$0** GitHub saving; provider cost not netted. Direct-push control billed 4. |
| Cirujano private fleet, 2026-09-13 to 2026-10-17 | **$18.84** hosted list cost avoided vs **$19.87** controller-accounted Nebius cost | Incomplete accounting; neither positive net savings nor a definitive loss. The 45-day window closes 2026-10-28; closing it does not guarantee a complete net result. |
| GitHub Actions bill | Net **$401.78** August, **$81.16** September, **$93.50** October 1-17 | Gross fell 31.7% while discounts doubled. Cause not established; do not attribute to Sutura or Cirujano. |
| Cirujano projection | About **$120/month** | Model assumes four concurrent runner slots; implemented runners have one slot per enrollment. |
| Personal hours and net dollars saved | **Unmeasured** | The next measurement. |

If a judge asks "How much has it saved you?":

> I can measure the automated work and its cost: fourteen benchmark repairs, about nine cents and eighty-five seconds per evaluation, and seventeen cents of Nemotron for the whole release benchmark. Cirujano separately cut eligible push checks from three billed minutes to one. My personal hours and net dollars saved are the next before-and-after measurement.

## How the products work together

**Sutura heals red CI. Cirujano trims green CI. A developer keeps approval.** In the shared metaphor, Sutura is the nurse on call who triages and stitches what breaks, Cirujano is the surgeon who operates on CI that works but costs too much, and the developer is the doctor who signs off on both. Keep Cirujano to its one beat; they are distinct products and separate submissions.

- **Two failure modes.** A pipeline can break, or it can keep working while it wastes money. Sutura answers red CI with a verified repair, a flaky verdict or a refusal. Cirujano measures green CI, removes verified waste and moves heavy jobs to on-demand Nebius VMs that stop when idle.
- **One loop (proposed).** A run fails → Sutura reproduces and repairs it → human review and merge → Cirujano measures the pipeline and proposes a verified optimization or runner move → human approval → measure reliability, developer effort and total spend, counting verification cost.
- **One evidence standard.** Neither trusts a green check. Sutura rejects fixes that delete tests; Cirujano rejects savings that delete coverage. Both open evidence-backed pull requests and never merge.
- **Not built yet.** There is no automatic handoff, and Sutura does not provision Cirujano runners. Each works independently today.

## Lines you must not say

| Tempting line | Why not |
| --- | --- |
| "This repo went red 29 times in three days." | 21 of the 29 were deliberately injected dogfood failures. Use the working-day story. |
| "My bill fell from $401 to $81 thanks to Cirujano." | Cirujano's own accounting shows about $19 avoided against about $20 of Nebius cost; the drop is mostly unexplained discounts. |
| "It saved me N hours" or "$X a month." | Not measured. |
| "Sutura has fixed real failures across my fleet." | The fleet report of 2026-10-11 records zero verified repair PRs and Sutura-to-green recoveries; not rechecked since. Seeded dogfood and benchmark fixes are separate evidence. |
| "Ninety seconds and ten cents per repair." | The averages are 85 seconds and 9 cents per benchmark evaluation, across all outcomes. |
| "Sutura keeps improving release after release." | Release fix rates were 14, 17, 13 and 14 of 18. Only the same-bug 1/22 → 10-in-a-row comparison is like for like. |
| "Nemotron generated the fake fix" or "Ultra caught it." | The benchmark supplies the trap, and policy refuses it before Ultra runs. |
| "Token Factory is faster than X." | No comparison was run. |
| Naming the optional auditors or the Data Lab denial. | Third-party marks; the Data Lab result belongs in the feedback form. |

## Evidence

| Claim | Source | Status |
| --- | --- | --- |
| Lost working day of failed runs and agent fixes | [CI failure retrospective](../research/2026-08-29-ci-failure-retrospective.md): 16 CI and 16 Sutura runs on 08-29, 06:36Z-18:49Z | VERIFIED |
| 1 of 22 on a seeded bug | Same retrospective, section C | VERIFIED |
| Same bug fixed ten times in a row within two days | [Dogfood ledger](../demo/dogfood-ledger.md) and [executable equivalence](../demo/dogfood-v0.2.0-executable-equivalence.md); CI runs 33328936605 (2026-08-30) to 33361548920 (2026-08-31). The streak commit and the 08-29 injection both add `dogfood-add.ts` returning `left - right` against `expect(add(2, 3)).toBe(5)` | VERIFIED 2026-10-17 |
| Off-by-one repair fixed; trap refused with weakened-assertion; 10/10 flaky; 14/18; zero false approvals; four misses | [Release JSON](../demo/placebo-v0.3.9-live-2026-10-03.json), subject `cc3281485b4364d7c8fcb2e820e03ffbaf893c2a` | VERIFIED 2026-10-15 |
| 85 seconds and 9 cents per evaluation; $0.17 Nemotron | 4,663.210 case-seconds and $4.92427699 over 55 evaluations; $0.173620 across 168 Nemotron responses ([readiness record](sutura-submission-readiness-2026-10-15.md)) | VERIFIED arithmetic |
| Tavily citations | `upstream-formatter-release` case file, `diagnosis.grounding.citations` | VERIFIED 2026-10-15 |
| Cirujano 3 → 1 | [Cirujano live proof](https://github.com/juan294/cirujano/blob/develop/docs/research/2026-10-09-skip-validated-push-live-proof.md) | VERIFIED by Cirujano readback 2026-10-17 |
| Cirujano fleet $18.84 vs $19.87 | Cirujano `docs/demo/recording-script.md`, private fleet report window ending 2026-10-17 | Read 2026-10-17 |
| Bill $401.78 / $81.16 / $93.50 | GitHub billing API `/users/juan294/settings/billing/usage/summary` | VERIFIED 2026-10-17 |
| Case Lab public, v0.3.9, live enabled | `/api/health`, anonymous | VERIFIED 2026-10-17 |

Health and recorded pages do not prove a new live repair. Never label a recorded result as a live run. Beat 3's live run was authorized by Juan on 2026-10-18 (up to $0.75 each, capped at 4 per hour) and carries the "Live run, sped up" label. Preparation does not authorize provider dispatch, upload, publication, portal updates or submission. Remaining closeout items are in the [readiness record](sutura-submission-readiness-2026-10-15.md).
