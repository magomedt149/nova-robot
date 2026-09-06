#!/usr/bin/env python3
"""NOVA Free Chord Music — zero-credit chord accompaniment generator.

Pure Python standard-library synthesizer. No network, model, API key or paid service.
Generates simple accompaniment from chord symbols and BPM. FFmpeg conversion/mixing
is intentionally handled by the NOVA worker.
"""
from __future__ import annotations

import argparse
import math
import random
import re
import struct
import wave
from array import array
from pathlib import Path
from typing import Iterable

SAMPLE_RATE = 44100
NOTE_INDEX = {
    "C": 0, "C#": 1, "DB": 1, "D": 2, "D#": 3, "EB": 3,
    "E": 4, "F": 5, "F#": 6, "GB": 6, "G": 7, "G#": 8,
    "AB": 8, "A": 9, "A#": 10, "BB": 10, "B": 11,
}

QUALITY_INTERVALS = {
    "": (0, 4, 7),
    "M": (0, 4, 7),
    "MAJ": (0, 4, 7),
    "MIN": (0, 3, 7),
    "M7": (0, 3, 7, 10),
    "MIN7": (0, 3, 7, 10),
    "7": (0, 4, 7, 10),
    "MAJ7": (0, 4, 7, 11),
    "SUS2": (0, 2, 7),
    "SUS4": (0, 5, 7),
    "5": (0, 7),
    "DIM": (0, 3, 6),
    "AUG": (0, 4, 8),
}

INSTRUMENTS = ("guitar", "piano", "accordion", "bass", "synth")


def normalize_chord_symbol(symbol: str) -> tuple[str, str]:
    raw = symbol.strip().replace("♭", "b").replace("♯", "#")
    if not raw:
        raise ValueError("Empty chord")
    match = re.fullmatch(r"([A-Ga-g])([#b]?)(.*)", raw)
    if not match:
        raise ValueError(f"Unsupported chord: {symbol}")
    root = (match.group(1).upper() + match.group(2)).upper()
    suffix = match.group(3).strip()
    slashed = suffix.split("/", 1)[0]
    low = slashed.lower()
    if low in {"m", "min", "minor"}:
        quality = "MIN"
    elif low in {"m7", "min7", "minor7"}:
        quality = "MIN7"
    elif low in {"maj7", "major7", "ma7"}:
        quality = "MAJ7"
    elif low in {"7", "dom7"}:
        quality = "7"
    elif low in {"sus2", "sus4", "5", "dim", "aug"}:
        quality = low.upper()
    elif low in {"", "maj", "major"}:
        quality = ""
    else:
        # For a simple accompaniment, gracefully reduce extensions like Am9/Cmaj9.
        quality = "MIN" if low.startswith("m") and not low.startswith("maj") else ""
    if root not in NOTE_INDEX:
        raise ValueError(f"Unsupported chord root: {root}")
    return root, quality


def midi_for(root: str, octave: int = 4) -> int:
    # MIDI C4 = 60. root index is relative to C.
    return 12 * (octave + 1) + NOTE_INDEX[root]


def chord_midis(symbol: str, instrument: str) -> list[int]:
    root, quality = normalize_chord_symbol(symbol)
    intervals = QUALITY_INTERVALS.get(quality, QUALITY_INTERVALS[""])
    base_octave = 2 if instrument == "bass" else 3 if instrument in {"guitar", "accordion"} else 4
    base = midi_for(root, base_octave)
    notes = [base + interval for interval in intervals]
    if instrument == "guitar":
        # Wider, guitar-like voicing.
        notes = [base, base + 7, base + 12 + intervals[1], base + 12 + intervals[-1]]
    elif instrument == "accordion":
        notes += [base + 12]
    elif instrument == "bass":
        notes = [base, base + 7]
    return notes


def midi_to_hz(midi: float) -> float:
    return 440.0 * (2.0 ** ((midi - 69.0) / 12.0))


def envelope(t: float, duration: float, instrument: str) -> float:
    if instrument == "guitar":
        attack = min(1.0, t / 0.008)
        return attack * math.exp(-4.7 * t / max(duration, 0.05))
    if instrument == "piano":
        attack = min(1.0, t / 0.012)
        return attack * math.exp(-3.0 * t / max(duration, 0.05))
    if instrument == "bass":
        attack = min(1.0, t / 0.02)
        release = max(0.0, min(1.0, (duration - t) / 0.08))
        return attack * release * 0.9
    if instrument == "accordion":
        attack = min(1.0, t / 0.06)
        release = max(0.0, min(1.0, (duration - t) / 0.12))
        return attack * release
    attack = min(1.0, t / 0.025)
    release = max(0.0, min(1.0, (duration - t) / 0.1))
    return attack * release


def oscillator(freq: float, t: float, instrument: str, phase: float = 0.0) -> float:
    x = 2.0 * math.pi * freq * t + phase
    if instrument == "guitar":
        return math.sin(x) + 0.36 * math.sin(2 * x) + 0.13 * math.sin(3 * x)
    if instrument == "piano":
        return math.sin(x) + 0.46 * math.sin(2 * x) + 0.22 * math.sin(3 * x) + 0.08 * math.sin(4 * x)
    if instrument == "accordion":
        # Two slightly detuned reeds create the familiar beating effect.
        return (
            0.55 * math.sin(x)
            + 0.32 * math.sin(2.0 * math.pi * freq * 1.006 * t + phase)
            + 0.16 * math.sin(2 * x)
        )
    if instrument == "bass":
        return math.sin(x) + 0.2 * math.sin(2 * x)
    # Soft band-limited-ish synth using a few harmonics instead of a raw saw.
    return math.sin(x) + 0.32 * math.sin(2 * x) + 0.18 * math.sin(3 * x) + 0.1 * math.sin(4 * x)


def add_note(
    buffer: array,
    midi: int,
    start_s: float,
    duration_s: float,
    instrument: str,
    gain: float,
    seed: int,
) -> None:
    start = max(0, int(start_s * SAMPLE_RATE))
    end = min(len(buffer), start + max(1, int(duration_s * SAMPLE_RATE)))
    freq = midi_to_hz(midi)
    rng = random.Random(seed)
    phase = rng.random() * 0.03 if instrument == "guitar" else 0.0
    for idx in range(start, end):
        t = (idx - start) / SAMPLE_RATE
        env = envelope(t, duration_s, instrument)
        sample = oscillator(freq, t, instrument, phase) * env * gain
        if instrument == "guitar":
            # Deterministic tiny pick noise at the transient.
            sample += (rng.random() * 2.0 - 1.0) * 0.02 * math.exp(-35 * t) * gain
        buffer[idx] += sample


def add_chord(
    buffer: array,
    chord: str,
    start_s: float,
    beat_s: float,
    beats_per_chord: float,
    instrument: str,
    chord_index: int,
) -> None:
    notes = chord_midis(chord, instrument)
    chord_duration = beat_s * beats_per_chord
    if instrument == "guitar":
        # Four simple down-strums per 4-beat chord, scaled for other lengths.
        beats = max(1, int(round(beats_per_chord)))
        for beat in range(beats):
            at = start_s + beat * beat_s
            for n_index, midi in enumerate(notes):
                add_note(buffer, midi, at + n_index * 0.018, min(chord_duration, beat_s * 1.25), instrument, 0.11, chord_index * 1000 + beat * 50 + n_index)
    elif instrument == "piano":
        for beat in range(max(1, int(round(beats_per_chord)))):
            at = start_s + beat * beat_s
            for n_index, midi in enumerate(notes):
                add_note(buffer, midi, at, min(chord_duration, beat_s * 1.6), instrument, 0.085, chord_index * 1000 + beat * 50 + n_index)
    elif instrument == "bass":
        root = notes[0]
        for beat in range(max(1, int(round(beats_per_chord)))):
            add_note(buffer, root if beat % 2 == 0 else notes[-1], start_s + beat * beat_s, beat_s * 0.8, instrument, 0.22, chord_index * 100 + beat)
    else:
        for n_index, midi in enumerate(notes):
            add_note(buffer, midi, start_s, chord_duration * 0.98, instrument, 0.065 if instrument == "accordion" else 0.08, chord_index * 100 + n_index)


def limiter(samples: array, ceiling: float = 0.94) -> array:
    peak = max((abs(x) for x in samples), default=0.0)
    gain = 1.0 if peak <= ceiling or peak == 0 else ceiling / peak
    return array("f", (max(-1.0, min(1.0, x * gain)) for x in samples))


def render_chords(
    chords: Iterable[str],
    bpm: float = 90.0,
    instrument: str = "guitar",
    beats_per_chord: float = 4.0,
    repeats: int = 1,
) -> array:
    chord_list = [c.strip() for c in chords if c.strip()]
    if not chord_list:
        raise ValueError("At least one chord is required")
    instrument = instrument.lower().strip()
    if instrument not in INSTRUMENTS:
        raise ValueError(f"Instrument must be one of: {', '.join(INSTRUMENTS)}")
    bpm = max(30.0, min(240.0, float(bpm)))
    beats_per_chord = max(0.5, min(16.0, float(beats_per_chord)))
    repeats = max(1, min(32, int(repeats)))
    beat_s = 60.0 / bpm
    total_s = len(chord_list) * repeats * beats_per_chord * beat_s + 0.35
    samples = array("f", [0.0]) * max(1, int(total_s * SAMPLE_RATE))
    cursor = 0.0
    chord_index = 0
    for _ in range(repeats):
        for chord in chord_list:
            # Validate before rendering.
            normalize_chord_symbol(chord)
            add_chord(samples, chord, cursor, beat_s, beats_per_chord, instrument, chord_index)
            cursor += beat_s * beats_per_chord
            chord_index += 1
    return limiter(samples)


def write_wav(path: Path, samples: array) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for sample in samples:
            value = int(max(-1.0, min(1.0, sample)) * 32767)
            frames += struct.pack("<hh", value, value)
        handle.writeframes(frames)
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description="NOVA zero-credit chord accompaniment generator")
    parser.add_argument("--chords", required=True, help="Comma/space separated chord symbols, e.g. Am,D,G,Em")
    parser.add_argument("--bpm", type=float, default=90.0)
    parser.add_argument("--instrument", choices=INSTRUMENTS, default="guitar")
    parser.add_argument("--beats-per-chord", type=float, default=4.0)
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    chord_text = args.chords.replace("|", ",").replace(";", ",")
    chords = [item for item in re.split(r"[,\s]+", chord_text) if item]
    samples = render_chords(
        chords,
        bpm=args.bpm,
        instrument=args.instrument,
        beats_per_chord=args.beats_per_chord,
        repeats=args.repeats,
    )
    out = write_wav(Path(args.out), samples)
    duration = len(samples) / SAMPLE_RATE
    print(f"NOVA MUSIC READY: {out} | {duration:.3f}s | {args.instrument} | {args.bpm:g} BPM | {' '.join(chords)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
