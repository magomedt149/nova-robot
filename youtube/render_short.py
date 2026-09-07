#!/usr/bin/env python3
import argparse
import json
import math
import os
import subprocess
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

from prepare_daily_queue import VOICE_IDS, validate_queue

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_QUEUE = ROOT / "youtube_queue" / "today.json"
DEFAULT_OUT = ROOT / "youtube_output"

W, H = 1080, 1920
FPS = 30
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def load_font(path, size):
    return ImageFont.truetype(path, size=size)


def fit_lines(draw, text, font, max_width):
    words = text.split()
    lines, cur = [], ""
    for word in words:
        test = word if not cur else cur + " " + word
        box = draw.textbbox((0, 0), test, font=font)
        if box[2] - box[0] <= max_width:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def draw_centered_lines(draw, lines, font, y, fill, gap=18):
    heights = []
    for line in lines:
        box = draw.textbbox((0, 0), line, font=font)
        heights.append(box[3] - box[1])
    for line, hh in zip(lines, heights):
        box = draw.textbbox((0, 0), line, font=font)
        ww = box[2] - box[0]
        draw.text(((W - ww) / 2, y), line, font=font, fill=fill)
        y += hh + gap
    return y


def make_slide(scene, idx, total, title):
    palettes = [
        ((11, 32, 70), (32, 92, 220)),
        ((24, 28, 42), (226, 71, 62)),
        ((8, 55, 48), (28, 170, 118)),
        ((58, 34, 13), (235, 158, 52)),
        ((42, 18, 68), (147, 76, 220)),
        ((15, 48, 66), (61, 166, 208)),
    ]
    top, bottom = palettes[(idx - 1) % len(palettes)]
    gradient = Image.linear_gradient("L").resize((W, H))
    img = ImageOps.colorize(gradient, black=top, white=bottom).convert("RGB")

    draw = ImageDraw.Draw(img, "RGBA")
    draw.rounded_rectangle((60, 70, W - 60, 190), radius=34, fill=(255, 255, 255, 34))
    badge = f"SHORT {idx}/{total}"
    f_badge = load_font(FONT_BOLD, 38)
    draw.text((95, 108), badge, font=f_badge, fill=(255, 255, 255, 235))

    f_head = load_font(FONT_BOLD, 78)
    head_lines = fit_lines(draw, scene["headline"], f_head, W - 150)
    y = 330
    y = draw_centered_lines(draw, head_lines, f_head, y, (255, 255, 255, 255), gap=20)

    draw.rounded_rectangle((70, y + 55, W - 70, y + 430), radius=50, fill=(255, 255, 255, 228))
    f_cap = load_font(FONT_REG, 50)
    cap_lines = fit_lines(draw, scene.get("caption", ""), f_cap, W - 190)
    block_y = y + 105
    for line in cap_lines[:7]:
        box = draw.textbbox((0, 0), line, font=f_cap)
        ww = box[2] - box[0]
        draw.text(((W - ww) / 2, block_y), line, font=f_cap, fill=(20, 35, 60, 255))
        block_y += 70

    f_brand = load_font(FONT_BOLD, 30)
    brand = "ПОЛЕЗНО В США"
    box = draw.textbbox((0, 0), brand, font=f_brand)
    draw.text(((W - (box[2] - box[0])) / 2, H - 170), brand, font=f_brand, fill=(255, 255, 255, 210))

    # progress bar
    x1, x2 = 90, W - 90
    yb = H - 90
    draw.rounded_rectangle((x1, yb, x2, yb + 18), radius=9, fill=(255, 255, 255, 70))
    done = x1 + int((x2 - x1) * idx / total)
    draw.rounded_rectangle((x1, yb, done, yb + 18), radius=9, fill=(255, 255, 255, 235))

    return img


def run(cmd):
    subprocess.run(cmd, check=True)


def synthesize_test_tone(text, wav_path):
    """Create deterministic audio for a local zero-network smoke test only."""
    sample_rate = 24000
    duration = max(1.1, min(5.0, len(text) / 18.0))
    frames = int(sample_rate * duration)
    with wave.open(str(wav_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        for index in range(frames):
            envelope = min(1.0, index / 600, (frames - index) / 600)
            sample = int(1800 * envelope * math.sin(2 * math.pi * 220 * index / sample_rate))
            wf.writeframesraw(sample.to_bytes(2, "little", signed=True))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--queue", type=Path, default=DEFAULT_QUEUE)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUT)
    parser.add_argument(
        "--test-tone",
        action="store_true",
        help="Use a tone instead of speech. Intended only for local pipeline smoke tests.",
    )
    args = parser.parse_args()

    queue_path = args.queue.resolve()
    out = args.output_dir.resolve()
    out.mkdir(parents=True, exist_ok=True)

    data = json.loads(queue_path.read_text(encoding="utf-8"))
    validate_queue(data)
    scenes = data["scenes"]
    narrator = str(data.get("narrator", "irina")).lower()
    voice_id = str(data.get("voice_id") or VOICE_IDS[narrator])

    voice = None
    syn = None
    if not args.test_tone:
        from piper import PiperVoice, SynthesisConfig

        model_dir = Path(os.environ.get("NOVA_PIPER_DIR", ".")).resolve()
        model_path = model_dir / f"{voice_id}.onnx"
        config_path = model_dir / f"{voice_id}.onnx.json"
        if not model_path.is_file() or not config_path.is_file():
            raise SystemExit(
                f"Piper voice is incomplete: {voice_id}. "
                "Download both the .onnx model and .onnx.json config first."
            )
        voice = PiperVoice.load(model_path, config_path=config_path)
        syn = SynthesisConfig(
            length_scale=1.04,
            noise_scale=0.667,
            noise_w_scale=0.8,
            normalize_audio=True,
        )

    segment_files = []
    total_duration = 0.0

    for idx, scene in enumerate(scenes, 1):
        png = out / f"scene_{idx:02d}.png"
        wav = out / f"scene_{idx:02d}.wav"
        mp4 = out / f"scene_{idx:02d}.mp4"

        make_slide(scene, idx, len(scenes), data["title"]).save(png)

        if args.test_tone:
            synthesize_test_tone(scene["narration"], wav)
        else:
            with wave.open(str(wav), "wb") as wf:
                voice.synthesize_wav(scene["narration"], wf, syn_config=syn)

        with wave.open(str(wav), "rb") as wf:
            duration = wf.getnframes() / wf.getframerate()

        duration += 0.25
        total_duration += duration

        vf = (
            "fps=30,"
            "fade=t=in:st=0:d=0.18,"
            f"fade=t=out:st={max(duration - 0.18, 0):.3f}:d=0.18"
        )
        run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-loop", "1", "-i", str(png),
            "-i", str(wav),
            "-t", f"{duration:.3f}",
            "-vf", vf,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
            "-af", f"apad=pad_dur={duration:.3f},atrim=0:{duration:.3f}",
            "-movflags", "+faststart",
            str(mp4),
        ])
        segment_files.append(mp4)

    concat = out / "concat.txt"
    concat.write_text(
        "".join(f"file '{p.as_posix()}'\n" for p in segment_files),
        encoding="utf-8",
    )

    final = out / "short.mp4"
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "concat", "-safe", "0",
        "-i", str(concat),
        "-c", "copy",
        "-movflags", "+faststart",
        str(final),
    ])

    thumb = out / "thumbnail.jpg"
    first = make_slide(scenes[0], 1, len(scenes), data["title"])
    first.save(thumb, quality=92)

    metadata = dict(data)
    metadata["render"] = {
        "voice_id": voice_id,
        "tts_mode": "test-tone" if args.test_tone else "piper",
        "width": W,
        "height": H,
        "fps": FPS,
    }
    (out / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"VIDEO={final}")
    print(f"THUMBNAIL={thumb}")
    print(f"VOICE_ID={voice_id}")
    print(f"DURATION_SECONDS={total_duration:.2f}")
    if total_duration > 60:
        print("WARNING: video is over 60 seconds; it is still eligible for Shorts if vertical and <= 3 minutes.")


if __name__ == "__main__":
    main()
