#!/usr/bin/env python3
"""Extract a stable 2D/relative-depth pose track from a reference video.

The output JSON is intentionally simple so Blender can consume it without any
third-party Python packages.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import mediapipe as mp


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--fps", type=float, default=24.0)
    parser.add_argument("--duration", type=float, default=5.0)
    parser.add_argument("--model-complexity", type=int, choices=(0, 1, 2), default=2)
    parser.add_argument("--smooth-alpha", type=float, default=0.55)
    return parser.parse_args()


def smooth_landmarks(
    current: list[list[float]],
    previous: list[list[float]] | None,
    alpha: float,
) -> list[list[float]]:
    if previous is None:
        return current
    smoothed: list[list[float]] = []
    for now, before in zip(current, previous):
        xyz = [alpha * now[i] + (1.0 - alpha) * before[i] for i in range(3)]
        smoothed.append([*xyz, now[3]])
    return smoothed


def main() -> None:
    args = parse_args()
    if not args.input.is_file():
        raise FileNotFoundError(args.input)
    if args.fps <= 0 or args.duration <= 0:
        raise ValueError("fps and duration must be positive")

    capture = cv2.VideoCapture(str(args.input))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open video: {args.input}")

    source_fps = float(capture.get(cv2.CAP_PROP_FPS) or args.fps)
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    max_frames = max(1, round(args.duration * args.fps))
    next_sample_time = 0.0
    source_index = 0
    frames: list[dict[str, object]] = []
    previous: list[list[float]] | None = None

    pose_module = mp.solutions.pose
    with pose_module.Pose(
        static_image_mode=False,
        model_complexity=args.model_complexity,
        smooth_landmarks=True,
        enable_segmentation=False,
        min_detection_confidence=0.45,
        min_tracking_confidence=0.45,
    ) as pose:
        while len(frames) < max_frames:
            ok, image = capture.read()
            if not ok:
                break
            timestamp = source_index / source_fps
            source_index += 1
            if timestamp + 1e-6 < next_sample_time:
                continue
            next_sample_time += 1.0 / args.fps

            result = pose.process(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
            if result.pose_landmarks is None:
                if previous is not None:
                    frames.append({"t": round(len(frames) / args.fps, 6), "landmarks": previous})
                continue

            current = [
                [
                    round(float(point.x), 6),
                    round(float(point.y), 6),
                    round(float(point.z), 6),
                    round(float(point.visibility), 6),
                ]
                for point in result.pose_landmarks.landmark
            ]
            previous = smooth_landmarks(current, previous, args.smooth_alpha)
            frames.append({"t": round((len(frames)) / args.fps, 6), "landmarks": previous})

    capture.release()
    if not frames:
        raise RuntimeError(
            "No person pose was detected. Use a clip where the full body is visible and well lit."
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "source": str(args.input),
        "source_width": width,
        "source_height": height,
        "fps": args.fps,
        "duration": len(frames) / args.fps,
        "frame_count": len(frames),
        "frames": frames,
    }
    args.output.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(
        f"Pose track saved: {args.output} | {len(frames)} frames | "
        f"{len(frames) / args.fps:.2f}s @ {args.fps:g} fps"
    )


if __name__ == "__main__":
    main()
