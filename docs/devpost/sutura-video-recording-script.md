# Sutura demo video: recording script

Refreshed 2026-10-17. Record this version for the hackathon. Target **2:55**;
export below **3:00**, including the end card. Lead with the future, demonstrate
the product, then close on developer time and money. Track: Coding and Agentic
Engineering.

The [qualitative source script](sutura-video-script.md) remains a separate,
historical, number-free contract artifact. Read only the timed **Say** blocks
for the submission. Everything afterward is preparation or optional material.

## The pitch to remember

**Give developers their focus back. Make every automated repair earn trust.
Use Nebius intelligence and isolated execution to make that practical.**

Start with possibility, then make it tangible: one broken function, one real
repair, one shortcut rejected. Be ambitious about impact and precise about
evidence. This is promising early benchmark data; developer-scale reliability
is the opportunity ahead.

The [official rules](https://nebiusglobalaihackathon.devpost.com/rules) and
[organizer video guidance](https://nebiusglobalaihackathon.devpost.com/updates/46205-how-to-build-a-winning-project)
were rechecked on October 17: show functioning software, use public YouTube,
stay under three minutes, and explain the Nebius and NVIDIA contribution.
Use plain-text service names and your own visuals; include third-party marks
or music only with permission.

## Set up before rehearsing

Open these tabs in capture order, without signing in. **Start live run**
dispatches paid work; use **Open recorded live result** for this recording.
No new live run is needed for this cut. Hide bookmarks, notifications and
unrelated tabs. Capture each shot first, then assemble it under the narration;
you can also practice speaking while switching prepositioned tabs.

| Tab | Open | Prepare |
| --- | --- | --- |
| A | [Case Lab home](https://sutura-case-lab.vercel.app/) | Title and five case cards. |
| B | [JavaScript repair](https://sutura-case-lab.vercel.app/replay/javascript-repair/) | Capture verdict and **Recorded live result** label. Expand **Execution and cost detail** to find the search tree and selected patch. Capture **Clean audit branch and Ultra verdict** separately. |
| C | [Greenwash trap](https://sutura-case-lab.vercel.app/replay/greenwash-trap/) | **Refused**, policy reason and **weakened-assertion** failure. Expand execution details for the supplied patch. |
| D | [Flaky failure](https://sutura-case-lab.vercel.app/replay/flaky-failure/) | **Flaky, no patch** and recorded-result label. |
| E | [Upstream incident](https://sutura-case-lab.vercel.app/replay/upstream-incident/) | Tavily citations in the diagnosis. Establish the **Gave up** outcome; this demonstrates grounding, not a successful upstream repair. |
| F | [How Sutura verifies](https://sutura-case-lab.vercel.app/about/) | **Runtime roles** table. |
| G | [Release benchmark evidence](https://github.com/juan294/sutura/blob/develop/docs/demo/sutura-v0.3.9-release-benchmark-evidence.md) | **Benchmark evidence**, outcome counts and model-cost table. October 3 measurement, not today's source commit. |
| H | [Cirujano public proof](https://github.com/juan294/cirujano/blob/develop/docs/research/2026-10-09-skip-validated-push-live-proof.md) | **Measured runs**: baseline 3, candidate 1, control 4. |

## Script

The narration is 356 words, about 128 words per minute with eight seconds
reserved for pauses. Timestamps are editing targets; a spoken rehearsal decides
the final pace. Captions below are editor-added text, not product features.

### 0:00-0:16 | The future developers deserve

**Show:** Tab A, title and case cards. Caption: **More time building. Verified
repairs. Human control.** At “scale”, optionally cut to a simple illustration
of many repositories feeding the verification process, labeled **Vision**.
Return immediately to the product.

**Say:**

> Imagine a million developers spending more time building, while AI investigates
> broken CI and brings back repairs they can inspect. That is Sutura's ambition:
> verified self-healing CI at developer scale, powered by Nebius.

### 0:16-0:33 | Why I built it

**Show:** Tab B, **Failed commit and CI evidence**, error **expected 3 to be 2**.
Move toward the audit section. Use this public fixture; keep private fleet
screens and billing pages out of the capture.

**Say:**

> I built it around a familiar pain: stop coding, read logs, rerun tests, lose
> focus. An agent creates another problem: it can make CI green by weakening a
> test. Maintainers need a repair they can trust.

### 0:33-1:08 | Watch the repair earn its verdict

**Show, in order:**

1. Tab B, **Recorded live result**, release subject and **Fixed**.
2. **Nano diagnosis and confidence**. Keep its actual confidence readable;
   controller evidence also contributes to the classification.
3. Expanded **Execution and cost detail**, **ConTree search tree and branch
   status**, then **Super proposals and candidate patches**. Hold the selected
   diff for four seconds: `Math.floor(items / size) + 1` becomes the guarded
   `Math.ceil(items / size)` expression.
4. **Clean audit branch and Ultra verdict**, then **Final outcome** and the
   human-review sentence. Edit between positions instead of scrolling the
   entire page during narration.

**Say:**

> Here is the working Case Lab. This recorded release result repairs an
> off-by-one bug. NVIDIA Nemotron Nano diagnoses through Nebius Token Factory.
> Nebius ConTree prepares dependencies once and branches isolated sandboxes.
> Nemotron Super proposes repairs; the controller applies them and runs the
> tests with networking disabled. The selected patch gets a clean rerun and
> Nemotron Ultra audit. The code changes, the assertion stays. Sutura can open
> an evidence-backed pull request. A human decides whether to merge. Sutura
> never merges.

### 1:08-1:30 | The difference that matters

**Show:** Tab C, supplied patch, policy refusal and failed
**weakened-assertion** check. Cut to Tab D for the last sentence.

**Say:**

> Now the benchmark supplies a fake fix: delete the failing assertion. Sutura
> refuses the test edit and flags the weakened assertion. A green check alone
> cannot authorize a repair. Here, a flaky failure gets classified without
> inventing a patch.

### 1:30-1:58 | Why the Nebius platform matters

**Show:** Tab F, **Runtime roles**, then Tab E's Tavily citations. Cut to a
plain-text integration card: **Astra + Jev: optional vetoes**;
**ATIF + NeMo: offline evaluation**; **Data Lab: dataset uploaded, batch denied**;
**Nebius: inference + isolated execution**. No provider-console tour is needed.

**Say:**

> Nebius brings managed model intelligence and isolated execution into one
> developer workflow, without us operating GPU infrastructure. Tavily grounds
> upstream diagnoses. Optional GPT-6 Astra and TypeSafe Jev add vetoes. NVIDIA
> ATIF and NeMo Agent Toolkit support offline evaluation. We also uploaded our
> sanitized dataset to Nebius Data Lab; its batch request was denied.

### 1:58-2:17 | Early evidence worth building on

**Show:** Tab G, **51 cases / 55 evaluations**, then large captions over the
real evidence: **14/18 repairs fixed**, **10/10 flaky classified**,
**0 observed false approvals**, **4 repairs gave up**. Keep
**v0.3.9 · October 3 benchmark** visible. These measures overlap; do not add
them together as separate groups.

**Say:**

> The early data is encouraging: fifty-one benchmark cases, fourteen of eighteen
> repairs fixed, all ten flaky cases recognized, and zero false approvals
> observed. Four repairs gave up. These are controlled benchmark results, with
> failures published alongside successes.

### 2:17-2:33 | A bigger benefit with Cirujano

**Show:** Tab H's measured table. Caption: **Separate Cirujano proof: 3 → 1
billed runner minutes per eligible push** and **Public benchmark: $0 GitHub
charge saving**. Then show **Sutura verifies repairs → human review → Cirujano
reduces repeated work**, labeled **Proposed joint workflow**.

**Say:**

> Cirujano complements Sutura with leaner workflows and on-demand Nebius AI Cloud
> runners. Its separate public proof cut eligible push checks from three billed
> minutes to one. An automatic handoff is the next opportunity.

### 2:33-2:55 | Time and money, then the invitation

**Show:** Tab G's cost table: **Nemotron $0.173620**, **all recorded inference
and sandboxes $4.92427699**. End on Tab A with a clean overlay:
**Give developers their focus back.**
**sutura-case-lab.vercel.app · npx sutura@0.3.9 init**
Small caption: **Developer hours and net dollar savings: not yet measured**.
Hold through 2:55; no extra spoken sentence afterward.

**Say:**

> What can I put a number on today? Fourteen benchmark repairs, seventeen cents
> of Nemotron calls, under five dollars including sandboxes and optional audits.
> My hours saved and net savings are still unmeasured. The ambition is hours
> back, lower bills, and more developers building. Try Sutura.

## Longer pitch for conversations and practice

Use this separately from the submission cut, or as answers after showing it.

> The next leap in developer productivity could come from protecting focus.
> Imagine every maintainer having a repair team that investigates broken CI,
> tests alternatives, and brings back a small patch with evidence. Across
> thousands of teams, that could return an enormous amount of attention to
> building software.
>
> That is the problem behind Sutura. A failed pipeline pulls me out of the work
> I wanted to do. Handing it to an AI agent is useful only if I can trust the
> result. An agent can delete an assertion and deliver a green check with the
> bug still present. Sutura makes the repair earn its verdict through real
> execution, repository policy, a clean rerun and an independent audit.
>
> Nebius is central to making this practical. Token Factory serves NVIDIA
> Nemotron Nano for diagnosis, Super for bounded repairs and Ultra for audit.
> ConTree turns one prepared snapshot into isolated reproduction, repair and
> audit branches. Managed inference plus branching execution lets me
> concentrate on the product rather than operating GPU infrastructure. Tavily
> brings current upstream facts into diagnoses. Optional Astra and Jev checks
> add vetoes; ATIF and NeMo Agent Toolkit support offline evaluation. We also
> uploaded a sanitized dataset to Data Lab. Its batch request was denied, so
> we claim no batch result.
>
> The early result gives us something concrete to build on. The released
> v0.3.9 system fixed fourteen of eighteen repair cases and recognized all ten
> flaky cases. We observed no false approvals in the benchmark. We publish
> the four repairs that gave up. This demonstrates working behavior in
> controlled cases; developer-scale reliability is the opportunity ahead.
>
> Cirujano extends the opportunity to CI cost. After a human accepts Sutura's
> repair, Cirujano can examine repeated work and propose cheaper execution
> while preserving the checks. Its on-demand Nebius AI Cloud CPU runners start
> for eligible queued jobs and stop when idle. Its separate public push proof
> reduced sampled eligible checks from three billed runner minutes to one.
> That public benchmark saves zero GitHub dollars; it proves a mechanism we
> can measure on paid workloads. Each product works independently today. The
> direct automatic handoff is a future integration.
>
> My measured starting point was about $386 a month in GitHub Actions bills.
> An early Cirujano model targets about $120 a month, or $1,440 a year, using
> four concurrent slots that are not yet built. That is a projection. For
> Sutura, the full recorded release benchmark cost $4.92, with just $0.17 spent
> on Nemotron. I have not measured my recovered hours or realized net savings
> yet. Even fifteen minutes of net developer time recovered per successful
> repair would make the economics compelling. That is the future I want to
> build: more focus, credible repairs, and less money spent repeating work.

## Everything we used

This is the relevant product, evaluation, delivery and development inventory.
Use it for the platform shot and longer answers; keep package names on screen
rather than reading the entire list aloud.

| Component | Actual role and evidence to show |
| --- | --- |
| Nebius Token Factory | Managed inference for the three Nemotron roles. Show the [release model-cost table](../demo/sutura-v0.3.9-release-benchmark-evidence.md). |
| NVIDIA Nemotron 3 Nano 30B, Super 120B, Ultra 550B | Diagnosis, bounded proposals and independent audit. [Model configuration](../../packages/core/src/config.ts#L10); Tabs F and B. |
| Nebius ConTree | Prepared dependencies, snapshots and isolated reproduction, triage, search and clean verification branches. Tab B's expanded detail; network off during untrusted execution. |
| Tavily Search / Extract | Grounding in upstream release and migration sources. Tab E's citations; recorded outcome **gave-up**; release upstream fixes **1/4**. |
| OpenAI GPT-6 Astra | Optional veto-only second opinion. [Audit evidence](../demo/sutura-v0.3.9-release-benchmark-evidence.md). It was skipped on this JavaScript result because its budget was exhausted. |
| TypeSafe Jev | Optional calibrated veto-only audit. Tab B, **typesafe-audit**. Both optional voices ran in the overall benchmark. |
| NVIDIA ATIF | Sanitized interoperable trajectory format. [Committed trajectory](../demo/sutura-trajectory-v1.atif.json). |
| NVIDIA NeMo Agent Toolkit | Offline validation and evaluation, not live orchestration. [Report](../evaluation/nemo-atif-report.json). |
| Nebius Data Lab | Sanitized 110-row dataset uploaded and read back READY on October 7. [Record](../demo/nebius-data-lab-upload-2026-10-07.md); batch denied HTTP 403, no batch result. |
| TypeScript, Node.js 22, Python | Implementation and runtime / evaluation paths. [Contributor setup](../../README.md); JavaScript, TypeScript and Python repair support. |
| pnpm, Vitest, ESLint | Workspace tooling, tests and static checks. [Scripts](../../package.json). |
| GitHub Actions, GitHub App, CLI / npm / Marketplace | CI entry point, scoped repair-PR access and distribution. [Install instructions](../../README.md); the recorded fixture does not demonstrate a new PR. |
| Vercel | Hosted Case Lab UI; repair intelligence and sandbox execution use Nebius. Tab A. |
| Placebo | Controlled benchmark, traps, flaky cases and retained failures. [Benchmark contract](../../packages/placebo/README.md). |
| Codex and Claude Code | Development assistance, distinct from running repair models. [Form disclosure](sutura-devpost-form.md). |
| Cirujano: Token Factory, Sandboxes and AI Cloud CPU VMs | Separate product's NVIDIA workflow diagnosis, isolated optimization verification and on-demand runners. [Public proof](https://github.com/juan294/cirujano/blob/develop/docs/research/2026-10-09-skip-validated-push-live-proof.md). No GPU-runner claim. |

## Savings: a truthful, concrete close

| Status | Number | Meaning and limit |
| --- | --- | --- |
| Measured Sutura cost | **$4.92427699 total** = **$0.173620 Nemotron** + **$0.471723 other inference** + **$4.27893399 sandboxes** | October 3 release, 51 cases / 55 evaluations. Benchmark spend, not money saved against manual work or total development spend. |
| Measured repair work | **14/18 repairs fixed** | Controlled cases; no measurement of recovered developer hours. |
| Measured Cirujano mechanism | **3 → 1 billed runner minutes**, a **66.7%** reduction | Three sampled eligible candidate pushes, two runner minutes avoided each. Direct-push control used **4** minutes including overhead. PR checks still ran. Public repository: **$0 GitHub dollar saving**; provider costs not netted. |
| Historical personal billing baseline | **$370.64** and **$401.78**, average **$386.21/month** | July and August 2026, [anonymized baseline](https://github.com/juan294/cirujano/blob/develop/docs/research/2026-09-08-github-actions-cost-baseline.md). Not an October bill. |
| Cirujano projection | About **$120/month**, **$1,440/year** | Historical model assumes **four concurrent runner slots**; implemented runners have one slot per enrollment. [Case study](https://github.com/juan294/cirujano/blob/develop/docs/cirujano-savings-case-study.md). Fleet net savings pending. |
| Illustrative developer-time value | **3.5 hours**, **$262.50 gross value** | Assume each of 14 benchmark fixes replaces **15 minutes of net hands-on work after review**, at **$75/hour**. Subtracting the whole $4.92427699 benchmark gives **$257.58 illustrative net value**. Assumptions, not recovered hours or realized cash savings. |
| Actual personal time and combined net savings | **Unmeasured** | Do not convert benchmark duration or runner minutes into developer time. |

If asked “How much has it saved you?”, answer directly:

> I can measure the automated work and its cost: fourteen successful benchmark
> repairs, and $4.92 for the entire release benchmark. I have not measured my
> personal hours saved or net dollars saved yet. Cirujano separately demonstrated
> two billed runner minutes avoided per eligible sampled push; the $120 monthly
> target remains a projection. Those are the starting points for the next
> before-and-after measurement.

For a scale illustration outside the submission cut: **1,000 developers
recovering 15 minutes each week = 250 developer-hours per week**. The developer
count and recovered minutes are assumptions, not adoption or an observed effect.

## How the products work together

**Sutura verifies repairs. Cirujano reduces repeated CI work and compute cost.
A developer keeps approval.** Keep Cirujano to its single short beat in this
Sutura submission; the projects remain distinct products and submissions.

The proposed loop is: failed run → Sutura evidence and repair → human review
and merge → Cirujano measures CI cost and proposes verified optimization or an
eligible runner migration → human approval → measure reliability, developer
effort and total spend. Count verification cost as well as avoided work.

There is no implemented direct automatic handoff. Sutura does not automatically
provision Cirujano runners. Workflow optimization does not remove Sutura's
workspace CI-routing authority; prepared local routing is not hosted activation.
Full checks, policy and publication retain their independent controls.

## Three rehearsals, then capture

1. **Voice only.** Read the eight Say blocks with a stopwatch. Aim for 2:45–2:50
   spoken delivery, leaving a few seconds for pauses and the final card.
   Pause after “the assertion stays” and “zero false approvals observed”.
   If long, shorten the platform beat; preserve the repair and refusal.
2. **Screen only.** Practice A → B → C → D → F → E → G → H → G → A. Record at
   1080p or higher with readable code. Pre-expand B and C. Hold key details
   three to five seconds; point once, then stop moving the pointer. Keep
   recorded-mode labels visible.
3. **Full practice.** Speak while switching prepared views. Watch back once:
   can a stranger see the repaired line, see the refused shortcut, name
   Nebius's role, and distinguish measured costs from future savings?
   Re-record the weak beat rather than the whole demonstration.
4. **Final capture.** Record clean narration separately and assemble footage
   under it. Do not accelerate speech to fit. Keep the complete export below
   three minutes. Add captions matching the final take and retain its exact
   transcript for the archive. Voice recording is a user-performed step.

Sound excited about the future, calm during proof, and precise on figures.
Pronounce **Nebius Token Factory**, **NVIDIA Nemotron**, **Nebius ConTree** and
**Tavily** clearly. Use a consistent pronunciation of Sutura. The final feeling
should be “I want my focus back. I can try this now.”

## Evidence checks and recording limits

Checked October 17: anonymous health reported **v0.3.9**, Action
`cc3281485b4364d7c8fcb2e820e03ffbaf893c2a`, live enabled, one concurrent run,
four per hour and 24 per day. Browser inspection confirmed the JavaScript
recorded verdict, selected diff, expanded cost detail and public architecture
page. Health and displayed recordings do not establish a new live repair.

The [release JSON](../demo/placebo-v0.3.9-live-2026-10-03.json) retains the exact
subject above, 51 cases / 55 evaluations, 14/18 repair fixes, 18/19 trap
refusals (one gave up), 10/10 flaky classifications, 11/11 deceptive patches
rejected and zero observed false approvals. Hidden repair checks passed 3/4;
one did not run. Tavily-grounded upstream fixes were 1/4. Optional audits
contributed to the measured system. These results do not establish universal
safety, competitive superiority or steady improvement.

The trap is **benchmark-supplied**, not generated by Nemotron on camera. Policy
refuses it before Ultra adjudication; do not attribute it to an audit that did
not run. The JavaScript fixture's exact failing/policy commits are unavailable;
its CLI examples do not prove those identities or establish a repair PR.

The [September 28 fleet observation](../demo/fleet-recovery-observation-2026-09-28.md)
recorded zero verified repair PRs in that window. It supports no fleet-recovery,
personal-time or realized-savings claim. Earlier dogfood proof and later
release benchmark results are separate evidence.

Recheck home, health and recorded routes before final capture. If access fails,
use retained [real gallery captures](gallery-2026-10-07/README.md) with their
original dates, or resolve access before filming. Never label a recording as a
new live run. Preparation does not authorize provider dispatch, upload,
publication, portal updates or submission. Remaining closeout items are in
the [readiness record](sutura-submission-readiness-2026-10-15.md).
