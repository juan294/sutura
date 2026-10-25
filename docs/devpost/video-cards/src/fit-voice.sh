#!/bin/zsh
# Regenerate all nine beats on eleven_multilingual_v2 (Eric). Speed 1.0 first; if speech is longer than the
# clip, regenerate once at the speed that fits (model honors speed, max 1.2). Never cut words, never stretch audio.
setopt +o nomatch
cd "/Users/juan/Desktop/Sutura Demo/voice" || exit 1
typeset -A L
L=(0 9.90 1 14.60 2 14.80 3 33.70 4 16.95 5 13.95 6 24.50 7 14.60 8 36.45)
VOICE=cjVigY5qzO86Huf0OWal
gen() { # $1 beat, $2 speed, $3 out
  local body
  body=$(python3 -I -c 'import json,sys; print(json.dumps({"text": open(f"beat-{sys.argv[1]}.txt").read().strip(), "model_id": "eleven_multilingual_v2", "language_code": "en", "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.15, "use_speaker_boost": True, "speed": float(sys.argv[2])}}))' "$1" "$2")
  elevenlabs text-to-speech convert --voice-id $VOICE --output-format mp3_44100_128 --json "$body" -o "$3" -q 2>err-$1.txt
}
dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }
for b in 0 1 2 3 4 5 6 7 8; do
  target=${L[$b]}
  if ! gen $b 1.0 raw-$b.mp3; then echo "beat $b FAILED: $(head -c 200 err-$b.txt)"; continue; fi
  v=$(dur raw-$b.mp3); speed=1.0
  if python3 -I -c "import sys; sys.exit(0 if $v > $target else 1)"; then
    speed=$(python3 -I -c "print(min(1.2, round($v/($target-0.25), 3)))")
    if gen $b $speed raw-$b.v2.mp3; then mv -f raw-$b.v2.mp3 raw-$b.mp3; v=$(dur raw-$b.mp3); else echo "beat $b speed retake FAILED, keeping 1.0"; speed=1.0; fi
  fi
  read lead tempo <<<"$(python3 -I -c "
v=$v; L=$target; s=L-v
if s>=0.3: print(min(1.0, round(s/2,2)), 1.0)
elif s>=0: print(0, 1.0)
else: print(0, round(v/(L-0.1),4))")"
  ms=$(python3 -I -c "print(int($lead*1000))")
  ffmpeg -v error -y -i raw-$b.mp3 -af "atempo=${tempo},adelay=${ms}|${ms},apad=whole_dur=${target}" -c:a libmp3lame -b:a 192k voice-$b.mp3 || { echo "beat $b fit FAILED"; continue; }
  printf "beat %d  speech %5.1f s | clip %5.2f | file %5.2f | speed %s | lead-in %ss | tempo %s\n" $b "$v" "$target" "$(dur voice-$b.mp3)" "$speed" "$lead" "$tempo"
  rm -f raw-$b.mp3 err-$b.txt
done
echo; ls
