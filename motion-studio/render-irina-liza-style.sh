#!/usr/bin/env bash
set -euo pipefail

INPUT="${1:?Usage: render-irina-liza-style.sh input.wav [output.wav]}"
OUTPUT="${2:-irina_liza_style.wav}"

# v2: tuned against ScreenRecording_08-28-2026 04-23-21_1(1).mp4.
# Important: pause cleanup (target 0.12-0.16 s, max ~0.22 s) is performed
# before this mastering pass when phrase boundaries are known.
ffmpeg -y -v error -i "$INPUT" \
  -af "rubberband=pitch=1.055:tempo=1.0:transients=smooth:detector=soft:formant=preserved:pitchq=quality,equalizer=f=175:t=q:w=0.85:g=2.0,equalizer=f=520:t=q:w=1.0:g=0.7,equalizer=f=3000:t=q:w=1.1:g=0.25,equalizer=f=6200:t=q:w=1.0:g=-1.35,deesser=i=0.20:m=0.40:f=0.55,acompressor=threshold=0.13:ratio=1.35:attack=32:release=230:makeup=1.08:knee=4,loudnorm=I=-16.7:TP=-3.3:LRA=4,afade=t=in:st=0:d=0.018" \
  -ar 48000 -ac 1 "$OUTPUT"

printf 'NOVA Irina Liza-style v2 ready: %s\n' "$OUTPUT"
