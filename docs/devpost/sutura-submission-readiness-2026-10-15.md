# Sutura submission readiness, October 15

Status: ready to prepare the weekend recording; final submission is **PENDING**.
The live Devpost draft is 3/5 steps complete. This record does not claim final
release acceptance, a new live repair, or a submitted entry.

Record on October 17–18. Target submission: October 29. The
[official deadline](https://nebiusglobalaihackathon.devpost.com/rules) is
October 30 at 10:00 Pacific, which is 18:00 in Madrid. Use one public YouTube
submission cut under three minutes. Keep free judging access through December 15.

## Pitch and recording package

- [Latest pitch and form answers](sutura-devpost-form.md).
- [Timed recording script and capture order](sutura-video-recording-script.md).
- [Canonical technical narrative](sutura-submission.md).
- [Service feedback](../feedback/2026-10-sutura-nebius-feedback.md).
- [Four existing real screenshots](gallery-2026-10-07/README.md); retake at full resolution.

Lead with the maintainer problem: a green check can hide a fake repair. Show the
JavaScript repair and refused greenwash shortcut, with their recorded-result labels.
The trap candidate is supplied by the benchmark; do not say Nemotron generated it.
Its rejection is a test-file policy refusal; Ultra adjudication did not run.
The release cases use fixture identities, so do not present their verification
command placeholders as exact source commits or an external customer incident.
Do not promise that every unsafe patch is caught or that fleet recovery saves time.

## Evidence checked today

Release subject: `cc3281485b4364d7c8fcb2e820e03ffbaf893c2a`, v0.3.9.
Public evidence source: `9d0f14b8198cc2082c4df6eb4a7fb99227333837`.
These are different identities: the latter stores the former's measurements.

| Check | Result and limit |
| --- | --- |
| Anonymous public access | 15/15 resources returned HTTP 200 at 08:07 UTC. All five recorded case routes, home, health, release, Marketplace, npm metadata, README, Action contract and benchmark artifacts were checked. |
| Immutable evidence | Five source files matched SHA-256; benchmark JSON also matched its declared release subject. [Rerunnable preflight input](sutura-evidence-preflight-2026-10-15.json). This is a partial access manifest, not the final judging manifest. |
| Health | v0.3.9 and the expected Action SHA; live enabled; 1 concurrent, 4/hour, 24/day, USD 0.75/run ceiling. Health does not prove a successful live repair. |
| Browser inspection | JavaScript recorded result shows Fixed; flaky result shows Flaky, no patch; greenwash result shows Refused and weakened-assertion failed, with Ultra adjudication explicitly not run. No live dispatch was made. |
| Public npm installation | Clean temporary consumer installed sutura@0.3.9, generated the expected Action pin, and passed the CLI smoke. Doctor uses a credential-name shim; this does not prove real repository credentials or repair-PR CI. |
| Package identity | Public tarball SHA-256 `421733c2239d2930740cb812e76677f38ce4c766df8b1282aba74079bbf8d176`; installed content hash `1d91985ce8f0a7e3abe058eca31f8f4e423723e09f90ba17be63f78ed47dd6c7`, matching the release benchmark record. |
| Existing hosted CI | CI 38381386937 and CodeQL 38381386828 succeeded on the public source above. The later monitor was skipped because CI passed; that is not repair evidence. |

The [release benchmark](../demo/sutura-v0.3.9-release-benchmark-evidence.md)
retains 51 cases / 55 evaluations: 14/18 repairs, 18/19 traps refused, 10/10
flakes, 11/11 deceptive patches rejected, zero observed false approvals, and
USD 4.92427699 total. Hidden repair checks passed 3/4 with one not run; upstream
fixes with Tavily were 1/4. These numbers were reread from JSON today.
Nemotron cost was recalculated as USD 0.173620 across 168 responses. Their
latency sum was 429.735 seconds across 4,663.210 case-seconds. Aggregate share
does not establish that inference never delayed an individual run.

## Local validation and review

Typecheck, lint and build passed on application source
`9d0f14b8198cc2082c4df6eb4a7fb99227333837`; application source is unchanged in
this documentation candidate. The full monorepo test run passed 2,995 tests with pinned
pnpm 11.22.0. The submission contract passed all 15 checks, and local links in
all five changed Markdown documents resolve. Independent review and three
simplify lenses covered claims, capture instructions, reuse and readability.

The first full local test attempt failed 36 Placebo tests because temporary
fixtures selected a missing pnpm 12.9.1 Corepack entrypoint. This was reproduced
outside the checkout. The exact failing fixture then passed with a task-local
wrapper for the already installed repository pin, 11.22.0; the complete suite
passed with that wrapper. Global Corepack settings were not changed. Both the
failed and passing logs are retained; the first run is not relabeled as green.

Raw access archives and the public-install receipt are retained locally under
`docs/agents/submission-readiness-20261015/`. They have not been published.

## Portal corrections and owner answers

Read-only inspection of project 1157841 on October 15 found:

- The saved story still names source 0.2.1 and hosted 0.2.0 evidence. Replace it
  with the prepared 0.3.9 story and inspect its rendered preview.
- Eight gallery entries are already saved. Upload the real full-resolution
  screenshots and clearly label any retained concept illustrations.
- The required video URL is blank. The generic form allows Vimeo/unlisted;
  follow this event's stricter public YouTube rule.
- Track is Coding and agentic engineering; Tavily is Yes; the IRL city is blank.
- Several feedback answers still emphasize the older development result.
  Refresh them with the release-bound text without inventing new model scores.
- Three required fields are blank: AI tools used, learning level and career
  value. Text is prepared in the form draft. Juan answered **Significant**
  and **Yes** on October 15 for the latter two.

No portal text, upload, certification or finalization was changed in this pass.

## Final go/no-go gates

| Gate | State | Closeout |
| --- | --- | --- |
| Video | PENDING | Record, export under three minutes, upload publicly on YouTube; verify playback, captions and actual URL. |
| Gallery | PENDING | Capture sharp desktop and phone images; upload real screenshots; inspect captions and preview. |
| Saved story and feedback | PENDING | Apply prepared text and required fields, then inspect saved values and rendered preview. |
| Final evidence acceptance | PENDING | The v0.3.9 contract requires candidate/public matrices and dogfood evidence, among other records. No complete current index was found; open issues 48, 49 and 110 retain these gates. Earlier candidate matrices do not satisfy them. Confirm valid exact-release receipts or obtain separately authorized live measurements before claiming this gate. |
| Judging archive | PENDING | Add actual video/transcript/gallery and final public evidence URLs with hashes to the final manifest; retain independently of expiring Actions artifacts. The 15-resource input above deliberately omits missing artifacts. |
| Final public acceptance | PENDING | Check signed-out desktop/phone rendering, refusal and flaky outcomes, installation guidance, and every final Devpost link. Repeat after portal updates. |
| Judging operations | PENDING future checks | Follow the [runbook](../runbooks/judging-access.md): actual credential expiry inventory, funded reserve readback and access monitoring through December 15. Older balance observations are not current funding proof. |
| Finalization | PENDING | Review the complete preview, authorize submission, retain receipt and a final backup. A draft is not submitted. |

No participant study or Data Lab batch is planned; neither is added as a new
blocker. No provider dispatch, payment, remote push or publication occurred.

## Layalga after the freeze

The monitor update is locally integrated into Layalga develop at
`92f8a8b3a506dc178e29054444be9242c4bf62d2`: v0.3.9 pin, scoped App token,
explicit missing-config failure, repair-branch guard and `require-fixed: true`.
Full actionlint and bootstrap pass. An initial SC2016 false positive in
coverage.yml was resolved by two scoped comment lines explaining the intentionally
single-quoted JavaScript; shell checks remain enabled. Application suites were not
run for this configuration-only patch.

Hosted activation remains pending. The repository lacks the App client-ID
variable and private-key secret, and installation access is unverified (403
from the read-only metadata request). Remote develop remains
`782c77b95ad3106655ddae390fabc470f981d89e`; local develop is six commits ahead,
four of which predate this task. Inspect that publication scope and workflow
triggers before authorizing a push. This configuration is not repair proof
and does not change Sutura's benchmark score.
