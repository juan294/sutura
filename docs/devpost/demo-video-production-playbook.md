# Demo video production playbook

Learned while producing the Sutura hackathon video on 2026-10-17 and 2026-10-18. Written for the Cirujano demo so it follows the same style and workflow. Everything below was done, not planned; the numbers are the ones we measured.

## 1. The script format that worked

One file, `docs/devpost/<project>-video-recording-script.md`, with these parts in this order:

1. **The pitch to remember.** Two or three sentences the narrator can say from memory. Open with the ambition, close on what is measured.
2. **Set up before rehearsing.** The exact pages to load, in capture order, with what each one must show. Note which pages are recorded results and which action starts paid work.
3. **Script, as numbered beats.** Beat 0 is the intro card. Each beat has a timestamp range, a **Show** block (what is on screen, which section to scroll to, which caption the editor adds) and a **Say** block (the narration as a Markdown quote, `> ...`). The Say blocks are the only lines the narrator reads, and the only lines the TTS step consumes, so keep everything else out of quote syntax.
4. **Rehearse, then capture.** Voice only, screen only, then both.
5. **Longer pitch for conversations** (judge questions, Devpost text).
6. **Everything we used**, a table of each tool and its real role, with evidence links.
7. **Time and money: what is measured**, a table with a status column (measured, modeled, pending) and a limit column.
8. **Lines you must not say**, with the reason for each.
9. **Evidence**, one row per claim in the narration: source file, status (VERIFIED with date, or INFERRED).

Narration budget: about 380 words for a 3:00 video (2:33 at 150 words per minute, 2:56 at 130). Count the Say blocks with:

```bash
grep '^> ' docs/devpost/<script>.md | sed -n '1,/<last words of the final beat>/p' | sed 's/^> //' | wc -w
```

Keep the qualitative, number-free script (`<project>-video-script.md`) untouched if a contract test guards it; the dated recording script is the working copy.

## 2. Claims and wording rules

- Every number in a Say block has a row in the Evidence table. If a claim cannot be verified from a file or a command this session, it does not go in the narration.
- Say the sponsor names out loud: "Nebius Token Factory", "NVIDIA Nemotron", "Nebius ConTree" (Sutura), "Nebius AI Cloud" (Cirujano). No other third-party trademarks in the video, spoken or on screen. In Sutura's cost table the two optional third-party auditors are cropped out in the edit.
- Label the footage: "Recorded live result" stays visible on replayed pages; "Live run, sped up" goes on anything executed during the recording. Never label a recording as a new live run.
- Metaphor rule (owner decision 2026-10-18): Sutura is the **nurse** (triages, stitches, hands the decision to the doctor), Cirujano is the **surgeon** (operates on CI that works but costs too much), the developer is the **doctor** who signs off. Do not call Sutura a surgeon anywhere.
- Close on what is measured today and on the next measurement, not on what is unmeasured. The honest "not yet measured" answer lives in the judge-questions section.
- End with "Thank you."
- This repository is public. Private repository names never go into the script; use handles (P1, P5) as the fleet-migration doc does.

## 3. Recording method

- **One clip per beat**, recorded separately, assembled in the editor. Any beat can be retaken or replaced later (Cirujano's measured savings land after 2026-10-28; Sutura's beat 7 is built to be swapped).
- **Record the browser window, not the 6K desktop.** A 1920x1080-point window on the Retina display captures at 3840x2160, so the video is 4K while text stays readable on a phone. Export at 3840x2160; YouTube accepts 4K.
- **Clean profile.** No bookmarks bar, notifications off. Zoom the page (`document.documentElement.style.zoom = '1.6'` on Case Lab pages, `1.4` on GitHub pages) so text reads at phone size.
- **Who drives what.** For simple beats Juan scrolls and records himself; Claude only loads the page to the right section. For live runs Claude drives both windows while Juan records. Claude's browser extension can only see and control tabs it opened; it cannot control incognito windows, and acting on a background tab does not bring it to the front, so load everything into the one tab the recorder is watching.
- **Browser actions time out after about 90 seconds**, so a long run is driven as a sequence of short batches (reload every 8 to 10 seconds, with a 3-second settle after each reload so the table has rendered before the next step).
- Clip names: `split-<beat>.mp4` in `~/Desktop/<Project> Demo/`. Screen Studio also keeps its project folders there.

## 4. Live runs on camera

Judges value real execution over narrated replays. Two patterns worked:

**Sutura, beat 3 (Case Lab live repair, split screen).** Left: the Case Lab, click **Start live run**, then the GitHub job log, then the result page (**Live run · Fixed**). Right: Token Factory → Sandboxes → **Operations**, reloaded every 10 seconds; an image import appears about a minute in, then a burst of "Sandbox run · Success" rows for about two minutes. About 4 minutes real time, compressed to 20 seconds. Limit 4 runs per hour, up to USD 0.75 each. Collapse the console sidebar first (the site remembers it) so the timeline fills the half screen.

**Cirujano, beat 7 (on-demand runner, split screen).** Left: the Cirujano proof page, then the GitHub run page. Right: Nebius AI Cloud console → Cirujano project → **Compute → Virtual machines**, starting from "No standalone VMs". Trigger: `gh workflow run <coverage workflow> -R <enrolled private repo> --ref develop`, a manual dispatch, no commit. Timeline measured on 2026-10-18: dispatch 09:24:35Z; controller decided create-vm within 30 seconds; VM Running about 09:27Z; job started on the runner 09:28:55Z and finished green 09:31:34Z; idle grace, Stopped 09:38Z, deleted 09:40Z. About 15 minutes real time for the full cycle; the first 5 minutes give the clip (empty → Starting → Running → job executing). For a longer Cirujano video, the stop-and-delete half is the second scene. The enrolled workflows run on the Cirujano label only for a push to `develop` or a `workflow_dispatch` by the owner; a PR-validated push skips the job. Check the controller is alive first (`launchctl list | grep cirujano`, and the controller log's last tick).

Two browsers were used because Dia could not sign in to the Token Factory org (it kept picking the personal Google account; the fix is to log out of the wrong account in the Token Factory menu first). Chrome held the Nebius pages, Dia held the demo pages; Claude switches with `select_browser`.

## 5. Cards

Still images the editor drops in. Built as HTML in the product's colors (Sutura: dark theme tokens from `packages/case-lab/assets/case-lab.css`), rendered with headless Chrome at 2x to 3840x2160 PNG:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1920,1080 --user-data-dir=/tmp/card-profile \
  --screenshot=docs/devpost/video-cards/0-intro-card.png "file://$PWD/docs/devpost/video-cards/src/intro.html"
magick docs/devpost/video-cards/0-intro-card.png -resize 1280x720 -quality 90 docs/devpost/video-cards/0-intro-card-youtube-thumbnail.jpg   # under YouTube's 2 MB
```

The set: `0-intro-card` (name, project, tagline, hackathon line; also the YouTube thumbnail), `1-vision` (optional, the ambition as a diagram), `2-fake-fix-illustration` (the problem, labeled "Illustration"), `3-end-card` (URL and install command, held in silence). Break claim lines deliberately with `<br>` to avoid one-word orphans. The HTML sources, the shared `base.css` and the voice fitting script are in `docs/devpost/video-cards/src/`; copy them into the Cirujano repository and change the colors, texts and clip lengths.

## 6. Timing the clips

Measure every clip and the total before the voice-over:

```bash
for i in 1 2 3 4 5 6 7 8; do ffprobe -v error -show_entries format=duration -of csv=p=0 split-$i.mp4; done
```

Sutura landed at 2:50.9 for beats 1 to 8; the 10-second intro then has to come out of beat 8's silent end-card hold so the export stays under 3:00. Decide this before generating audio, because the audio is fitted to the clip lengths.

Optional: join the clips without re-encoding (`ffmpeg -f concat -safe 0 -i list.txt -c copy out.mp4`) when all clips share codec, size and frame rate. Juan preferred importing the clips separately into iMovie.

## 7. Voice-over with ElevenLabs

**Tooling.** The `elevenlabs` CLI (1.6.0, Homebrew) is logged in via `elevenlabs auth login` (keychain). `elevenlabs text-to-speech convert --voice-id <id> --output-format mp3_44100_128 --json '{...}' -o file.mp3 -q`. Validate the request with `--dry-run` first. The OAuth token lacks `user_read`, so quota commands fail; the generation itself works.

**Voice.** Juan's cloned voice sounded British; he wants a native US male narrator. Chosen: **Eric** (`cjVigY5qzO86Huf0OWal`, premade, "smooth, trustworthy", American, middle-aged). Other US male premade options: Brian `nPczCjzI2devNBz1zQrb`, Chris `iP95p4xoKVk53GoZ742B`, Roger `CwhRBWXzGAHq8TQ4Fs17`. List them with `elevenlabs voices search --category premade --page-size 100 --format json`.

**Model: use `eleven_multilingual_v2`, not `eleven_v3`.** v3 sounds expressive but it ignores `voice_settings.speed` (asking for 1.06 returned longer clips) and its pace varies a lot between takes (the same 42-word text came out at 12.1 s once and 19.6 s the next time). v2 honors `speed` (0.7 to 1.2) and is consistent, so a clip that runs long is regenerated once at the computed speed and lands within a few tenths of a second.

**Settings used:** `{"stability": 0.5, "similarity_boost": 0.75, "style": 0.15, "use_speaker_boost": true, "speed": 1.0}`, `language_code: "en"`.

**Rules.**
- Never cut words to fit. If speech is longer than the clip, regenerate at `speed = min(1.2, speech / (clip - 0.25))`. Up to about 1.08 is not noticeable; 1.10 is audible; 1.16 is too much.
- If speech is shorter than the clip, add silence: a lead-in of half the slack (max 1.0 s) and padding to the clip length. If the slack is more than about 3 seconds, add a sentence with verified information instead (beat 4 gained "Across nineteen traps in the release benchmark, it approved none.").
- Fit each file to the clip length minus 0.1 s so the audio never outlasts the video (a 14.10 s audio on a 14.07 s clip showed up as an overrun in iMovie).
- One final file per clip, `voice-<beat>.mp3`, and nothing else in the folder. Keep the raw generations only until the fit is done, then delete them. Juan did not want two files per beat.
- Keep `beat-<n>.txt` with the exact spoken text; it is the caption source.
- Verify before handing over: `ffmpeg -v error -i voice-N.mp3 -f null -` must print nothing, and `ffprobe` must show the target duration. The `apad=whole_dur=` padding prints harmless "non monotonically increasing dts" warnings on the MP3 muxer; the files decode cleanly.
- Each generation spends quota (about 2,300 characters for a 3-minute script). Do not regenerate everything to fix one beat.

**The fitting script** (zsh; `setopt +o nomatch` matters, an unmatched glob otherwise aborts the `&&` chain and the clip-length table never gets set, which is how one full generation was lost):

```zsh
#!/bin/zsh
setopt +o nomatch
cd "$HOME/Desktop/<Project> Demo/voice" || exit 1
typeset -A L; L=(0 9.90 1 14.60 2 14.80 3 33.70 4 16.95 5 13.95 6 24.50 7 14.60 8 36.45)   # clip length minus 0.1
VOICE=cjVigY5qzO86Huf0OWal
gen() { local body; body=$(python3 -I -c 'import json,sys; print(json.dumps({"text": open(f"beat-{sys.argv[1]}.txt").read().strip(), "model_id": "eleven_multilingual_v2", "language_code": "en", "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.15, "use_speaker_boost": True, "speed": float(sys.argv[2])}}))' "$1" "$2")
  elevenlabs text-to-speech convert --voice-id $VOICE --output-format mp3_44100_128 --json "$body" -o "$3" -q 2>err-$1.txt; }
dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }
for b in 0 1 2 3 4 5 6 7 8; do
  target=${L[$b]}; gen $b 1.0 raw-$b.mp3 || { echo "beat $b failed: $(head -c 200 err-$b.txt)"; continue; }
  v=$(dur raw-$b.mp3); speed=1.0
  if python3 -I -c "import sys; sys.exit(0 if $v > $target else 1)"; then
    speed=$(python3 -I -c "print(min(1.2, round($v/($target-0.25), 3)))")
    gen $b $speed raw-$b.v2.mp3 && mv -f raw-$b.v2.mp3 raw-$b.mp3 && v=$(dur raw-$b.mp3)
  fi
  read lead tempo <<<"$(python3 -I -c "
v=$v; L=$target; s=L-v
if s>=0.3: print(min(1.0, round(s/2,2)), 1.0)
elif s>=0: print(0, 1.0)
else: print(0, round(v/(L-0.1),4))")"
  ms=$(python3 -I -c "print(int($lead*1000))")
  ffmpeg -v error -y -i raw-$b.mp3 -af "atempo=${tempo},adelay=${ms}|${ms},apad=whole_dur=${target}" -c:a libmp3lame -b:a 192k voice-$b.mp3
  printf "beat %d speech %5.1f clip %5.2f speed %s lead %s\n" $b "$v" "$target" "$speed" "$lead"
  rm -f raw-$b.mp3 err-$b.txt
done
```

Results on the Sutura script, for pace planning: Eric on v2 at speed 1.0 speaks about 2.4 words per second (13.1 s for 32 words, 32.8 s for 85 words, 34.3 s for 80 words).

## 8. Assembly in iMovie

Import the `split-N.mp4` clips in order, drop the PNG cards as cutaways (iMovie takes PNGs directly), place each `voice-N.mp3` under its clip aligned at the start (they are the same length), add the "Live run, sped up" captions and any crops, export 3840x2160, upload public on YouTube with captions, and set `0-intro-card-youtube-thumbnail.jpg` as the thumbnail. Keep the exact transcript (`beat-N.txt`) for the judging archive.

## 9. Mistakes to skip next time

- Attributing a bill drop to the product without its own accounting (Sutura's draft claimed Cirujano cut the GitHub bill from USD 401 to 81; Cirujano's fleet report showed about USD 19 avoided against about USD 20 of Nebius cost, and the drop was mostly discounts). Measured, modeled and pending stay separate.
- Counting deliberately injected failures as "real pain" (21 of Sutura's 29 early red runs were seeded).
- Comparing fix rates across different test populations as an improvement curve. Only like-for-like comparisons (the same seeded bug, 1 of 22 then 10 in a row) belong in the narration.
- Running a long browser action loop as one batch (it times out at about 90 seconds) or acting on a tab the recorder is not watching.
- Deleting raw generations in the same step that could fail to fit them.
- Using a cloned voice without listening to its accent first.
