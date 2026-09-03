#!/usr/bin/env bash
set -euo pipefail

INPUT="${1:?Usage: render-irina-liza-style.sh input.wav [output.wav]}"
OUTPUT="${2:-irina_liza_style.wav}"

ffmpeg -y -v error -i "$INPUT" \
  -af "rubberband=pitch=1.414:tempo=0.98:transients=smooth:detector=soft:formant=preserved:pitchq=quality,highpass=f=75,equalizer=f=220:t=q:w=1.0:g=0.6,equalizer=f=3200:t=q:w=1.0:g=0.9,equalizer=f=6500:t=q:w=1.2:g=-1.4,deesser=i=0.45:m=0.45:f=0.5,acompressor=threshold=-20dB:ratio=1.7:attack=15:release=120:makeup=1.5,loudnorm=I=-16:TP=-1.5:LRA=6,afade=t=in:st=0:d=0.012" \
  -ar 48000 -ac 1 "$OUTPUT"

printf 'NOVA Irina Liza-style ready: %s\n' "$OUTPUT"
