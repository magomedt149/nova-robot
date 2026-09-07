#!/usr/bin/env python3
"""Validate the complete NOVA YouTube Short package."""
from __future__ import annotations

import argparse
import json
import subprocess
from fractions import Fraction
from pathlib import Path
from typing import Any

from PIL import Image

from prepare_daily_queue import canonical_fingerprint, validate_queue

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "youtube_output"


def probe_video(path: Path) -> dict[str, Any]:
    raw = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt,sample_aspect_ratio,channels:format=duration,size",
            "-of",
            "json",
            str(path),
        ],
        text=True,
    )
    return json.loads(raw)


def validate_package(output_dir: Path, allow_test_audio: bool = False) -> dict[str, Any]:
    video_path = output_dir / "short.mp4"
    thumbnail_path = output_dir / "thumbnail.jpg"
    metadata_path = output_dir / "metadata.json"
    report_path = output_dir / "validation_report.json"

    errors: list[str] = []
    for path in (video_path, thumbnail_path, metadata_path):
        if not path.is_file() or path.stat().st_size <= 0:
            errors.append(f"missing or empty file: {path.name}")

    metadata: dict[str, Any] = {}
    if metadata_path.is_file():
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            validate_queue(metadata)
            recorded = str(metadata.get("content_fingerprint", ""))
            expected = canonical_fingerprint(metadata)
            if not recorded or recorded != expected:
                errors.append("metadata content_fingerprint is missing or incorrect")
            render = metadata.get("render", {})
            if render.get("tts_mode") != "piper" and not allow_test_audio:
                errors.append("production package must use Piper narration")
            if not str(render.get("voice_id", "")).strip():
                errors.append("metadata render.voice_id is missing")
        except Exception as exc:
            errors.append(f"invalid metadata.json: {exc}")

    probe: dict[str, Any] = {}
    if video_path.is_file() and video_path.stat().st_size > 0:
        try:
            probe = probe_video(video_path)
            streams = probe.get("streams", [])
            video = next((item for item in streams if item.get("codec_type") == "video"), None)
            audio = next((item for item in streams if item.get("codec_type") == "audio"), None)
            if not video:
                errors.append("MP4 has no video stream")
            else:
                if video.get("codec_name") != "h264":
                    errors.append("video codec must be h264")
                if (video.get("width"), video.get("height")) != (1080, 1920):
                    errors.append("video dimensions must be 1080x1920")
                if video.get("pix_fmt") != "yuv420p":
                    errors.append("video pixel format must be yuv420p")
                if video.get("sample_aspect_ratio") not in {None, "1:1"}:
                    errors.append("video sample aspect ratio must be 1:1")
                try:
                    fps = float(Fraction(str(video.get("r_frame_rate", "0/1"))))
                except (ValueError, ZeroDivisionError):
                    fps = 0.0
                if abs(fps - 30.0) > 0.01:
                    errors.append("video frame rate must be 30 fps")
            if not audio:
                errors.append("MP4 has no audio stream")
            else:
                if audio.get("codec_name") != "aac":
                    errors.append("audio codec must be aac")
                if int(audio.get("channels") or 0) < 1:
                    errors.append("audio stream has no channels")

            duration = float(probe.get("format", {}).get("duration") or 0)
            size = int(probe.get("format", {}).get("size") or 0)
            if not 1.0 <= duration <= 180.0:
                errors.append("video duration must be between 1 and 180 seconds")
            if size < 10_000:
                errors.append("video file is unexpectedly small")
        except Exception as exc:
            errors.append(f"ffprobe failed: {exc}")

    thumbnail: dict[str, Any] = {}
    if thumbnail_path.is_file() and thumbnail_path.stat().st_size > 0:
        try:
            with Image.open(thumbnail_path) as image:
                thumbnail = {"format": image.format, "width": image.width, "height": image.height}
                if image.format != "JPEG":
                    errors.append("thumbnail must be JPEG")
                if image.size != (1080, 1920):
                    errors.append("thumbnail dimensions must be 1080x1920")
                image.verify()
        except Exception as exc:
            errors.append(f"thumbnail verification failed: {exc}")

    report = {
        "ok": not errors,
        "errors": errors,
        "video": probe,
        "thumbnail": thumbnail,
        "content_id": metadata.get("content_id"),
        "content_fingerprint": metadata.get("content_fingerprint"),
        "voice_id": metadata.get("render", {}).get("voice_id") if metadata else None,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--allow-test-audio", action="store_true")
    args = parser.parse_args()
    report = validate_package(args.output_dir.resolve(), args.allow_test_audio)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not report["ok"]:
        print("VALIDATION FAILED: " + "; ".join(report["errors"]))
        return 1
    print("VALIDATION OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

