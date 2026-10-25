# Sutura Devpost submission record, 2026-10-18

Status: **SUBMITTED** to the Nebius x NVIDIA Global AI Hackathon on 2026-10-18 (Devpost confirmation "Project submitted!"). Devpost allows edits until the deadline, 2026-10-30 13:00 EDT (19:00 Madrid). Project page: https://devpost.com/software/sutura-zgrhl6 (Devpost software id 1157841).

## What was changed before submitting

| Field | Before | After |
| --- | --- | --- |
| About the project | 0.2.1 / 80-case development story (backup in `docs/agents/devpost-20261018/old-devpost-story-backup.md`, gitignored) | v0.3.9 release story from [sutura-devpost-story-2026-10-18.md](sutura-devpost-story-2026-10-18.md), 1,191 words, pasted byte-for-byte (7,302 characters verified) |
| Demo video URL | empty | https://youtu.be/5Pxpaa41fl8 (public, title "Sutura: Verified Self-Healing CI with NVIDIA Nemotron on Nebius", verified with the YouTube oEmbed endpoint) |
| Nemotron output quality | 80-case development numbers | 8/10 kept; v0.3.9 release results (14/18, 11/11, 10/10, zero false approvals, one trap gave up, hidden checks 3/4 with one not run) |
| Performance compared to other models | development run wording | release benchmark wording: 168 calls, USD 0.17, median latencies, 4 of 18 repairs gave up; still no cross-provider claim |
| Most valuable Nebius capabilities | no cost figures | Nemotron USD 0.173620 by role, total USD 4.92427699, ConTree three-hour run with no infra stop, Data Lab upload READY but batch HTTP 403 |
| Experience running Nemotron on Nebius | 80-case run only | 8/10 kept; adds the release benchmark and the 2026-09-16 json_schema regression |
| AI tools used (required, was blank) | blank | Codex and Claude Code for development; Nemotron, Tavily, optional Astra and Jev audits in the product; ATIF and NeMo Agent Toolkit offline; ElevenLabs for the video narration |
| Level of learning (required, was blank) | blank | Significant (Juan, 2026-10-15) |
| AI value for your career (required, was blank) | blank | Yes (Juan, 2026-10-15) |
| Official Rules and Terms agreement | unchecked | checked as part of the submit action Juan authorized on 2026-10-18 |

Unchanged: project name and tagline; Built-with tags; the four "Try it out" links (Case Lab, GitHub, npm, evaluation guide), all returning HTTP 200 on 2026-10-18 (npm returns 403 to curl but `npm view sutura version` is 0.3.9); track "Coding and agentic engineering"; "New" project; Tavily "Yes"; Builders & Brews city left empty (decided 2026-10-07); the eight saved gallery images and captions.

## Checks after submitting

- Signed-out fetch of the public page: see the table in the terminal log for 2026-10-18; the page carries the video id, the v0.3.9 story and the release commit, and no longer mentions 0.2.1.
- Case Lab `/api/health`: v0.3.9, live runs enabled, 1 concurrent, 4 per hour, 24 per day, USD 0.75 per run ceiling.
- Three Case Lab live runs were made on 2026-10-18 for the video (`cl-1792308749776-358e4d83`, `cl-1792309420966-f2677cc1`, `cl-1792310048304-d6a58632`), all `fixed`.

## Still open (editable until the deadline)

- Gallery: the eight saved images are the September concept illustrations. The four real Case Lab captures in `gallery-2026-10-07/` were not uploaded in this pass; upload them and label the illustrations if the gallery should show real screens.
- Marketplace and release links are not in the "Try it out" list (four links saved); optional.
- Judging archive: add the video URL, the exact transcript (`~/Desktop/Sutura Demo/voice/beat-*.txt`) and the gallery to the final manifest, per the readiness record.
- Judging operations through 2026-12-15 per `docs/runbooks/judging-access.md`.
