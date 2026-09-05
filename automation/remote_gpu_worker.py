#!/usr/bin/env python3
"""NOVA Remote GPU Worker for Google Colab or a local GPU machine.

The worker exposes a token-protected HTTP API used by Motion + VFX Studio.
It can:
- accept a source video + NOVA job JSON;
- run FFmpeg normalization/transcode jobs;
- run Blender blocking or pose-control jobs;
- stage a WanGP job (and optionally call a configured Gradio API);
- return progress and the finished file to the phone;
- optionally mirror completed jobs to Google Drive.

No paid API is required by this worker.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

REPO_ROOT = Path(__file__).resolve().parents[1]
JOB_ROOT = Path(os.environ.get("NOVA_REMOTE_JOB_ROOT", "/content/NOVA_REMOTE_JOBS")).resolve()
DRIVE_ROOT = Path(os.environ.get("NOVA_REMOTE_DRIVE_ROOT", "/content/drive/MyDrive/NOVA_RENDER_QUEUE")).resolve()
TOKEN = os.environ.get("NOVA_REMOTE_TOKEN") or secrets.token_urlsafe(24)
MAX_UPLOAD_BYTES = int(os.environ.get("NOVA_REMOTE_MAX_UPLOAD_BYTES", str(8 * 1024**3)))

JOB_ROOT.mkdir(parents=True, exist_ok=True)
LOCK = threading.Lock()
PROCESSES: dict[str, subprocess.Popen[str]] = {}
CANCELLED: set[str] = set()
WANGP_ROOT = Path(os.environ.get("NOVA_WANGP_ROOT", "/content/Wan2GP")).resolve()
WANGP_OUTPUT_ROOT = Path(os.environ.get("NOVA_WANGP_OUTPUT_ROOT", str(JOB_ROOT / "_wangp_outputs"))).resolve()
WANGP_SESSION = None
WANGP_SESSION_LOCK = threading.Lock()
WANGP_JOBS: dict[str, Any] = {}
DOWNLOAD_TICKETS: dict[str, dict[str, Any]] = {}
DOWNLOAD_TICKET_TTL = int(os.environ.get("NOVA_REMOTE_DOWNLOAD_TTL", "600"))
WORKER_VERSION = "1.6.0"
PROTOCOL_VERSION = 3
SESSION_ID = uuid.uuid4().hex[:12]

app = FastAPI(title="NOVA Remote GPU Worker", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


def require_token(request: Request) -> None:
    supplied = request.headers.get("x-nova-token") or request.query_params.get("token")
    if not supplied or not secrets.compare_digest(str(supplied), TOKEN):
        raise HTTPException(status_code=401, detail="Invalid NOVA worker token")


def status_path(job_id: str) -> Path:
    return JOB_ROOT / job_id / "status.json"


def read_status(job_id: str) -> dict[str, Any]:
    path = status_path(job_id)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Job not found")
    return json.loads(path.read_text(encoding="utf-8"))


def update_status(job_id: str, **updates: Any) -> dict[str, Any]:
    path = status_path(job_id)
    with LOCK:
        current: dict[str, Any] = {}
        if path.is_file():
            try:
                current = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                current = {}
        current.update(updates)
        current["updated_at"] = time.time()
        path.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
        return current


def append_log(job_id: str, line: str) -> None:
    path = JOB_ROOT / job_id / "render.log"
    with path.open("a", encoding="utf-8", errors="replace") as handle:
        handle.write(line.rstrip() + "\n")


def command_exists(name: str) -> bool:
    return shutil.which(name) is not None


def gpu_info() -> dict[str, Any]:
    result: dict[str, Any] = {"available": False, "name": None, "memory_mb": None}
    try:
        probe = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=8,
            check=True,
        )
        first = (probe.stdout or "").strip().splitlines()[0]
        name, memory = [part.strip() for part in first.split(",", 1)]
        result = {"available": True, "name": name, "memory_mb": int(float(memory))}
    except Exception:
        pass
    return result


def safe_job_id(value: str | None = None) -> str:
    if value:
        cleaned = "".join(ch for ch in value if ch.isalnum() or ch in "-_")[:80]
        if cleaned:
            return cleaned
    return f"NOVA_{time.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"


def profile_for(job: dict[str, Any]) -> dict[str, Any]:
    quality = str(job.get("quality") or "preview").lower()
    ratio = str(job.get("ratio") or job.get("format") or "9:16")
    duration = max(1.0, float(job.get("duration") or 5.0))
    if quality == "preview":
        duration = min(duration, float(job.get("preview_duration") or 5.0))
        fps = int(job.get("fps") or 24)
        width, height = ((432, 768) if ratio == "9:16" else (960, 540))
        crf = "25"
        preset = "veryfast"
    else:
        fps = int(job.get("fps") or 30)
        width, height = ((1080, 1920) if ratio == "9:16" else (1920, 1080))
        crf = "18"
        preset = "medium"
    width = int(job.get("width") or width)
    height = int(job.get("height") or height)
    return {
        "quality": quality,
        "ratio": ratio,
        "duration": duration,
        "fps": fps,
        "width": width,
        "height": height,
        "crf": crf,
        "preset": preset,
    }


def run_command(job_id: str, args: list[str], *, cwd: Path | None = None) -> None:
    if job_id in CANCELLED:
        raise RuntimeError("Job cancelled")
    append_log(job_id, "$ " + " ".join(map(str, args)))
    proc = subprocess.Popen(
        list(map(str, args)),
        cwd=str(cwd) if cwd else None,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    with LOCK:
        PROCESSES[job_id] = proc
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            append_log(job_id, line)
            if job_id in CANCELLED:
                proc.terminate()
                break
        code = proc.wait()
        if job_id in CANCELLED:
            raise RuntimeError("Job cancelled")
        if code != 0:
            raise RuntimeError(f"Command failed with exit code {code}")
    finally:
        with LOCK:
            PROCESSES.pop(job_id, None)


def source_file(job_dir: Path) -> Path | None:
    candidates = sorted(job_dir.glob("source.*"))
    return candidates[0] if candidates else None


def reference_file(job_dir: Path) -> Path | None:
    candidates = sorted(job_dir.glob("reference.*"))
    return candidates[0] if candidates else None


def normalize_video(job_id: str, source: Path, out: Path, profile: dict[str, Any], keep_audio: bool = True) -> Path:
    if not command_exists("ffmpeg"):
        raise RuntimeError("FFmpeg is not installed")
    vf = (
        f"scale={profile['width']}:{profile['height']}:force_original_aspect_ratio=decrease,"
        f"pad={profile['width']}:{profile['height']}:(ow-iw)/2:(oh-ih)/2:black,"
        f"fps={profile['fps']}"
    )
    args = [
        "ffmpeg",
        "-y",
        "-i",
        str(source),
        "-t",
        str(profile["duration"]),
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        profile["preset"],
        "-crf",
        profile["crf"],
        "-pix_fmt",
        "yuv420p",
    ]
    if keep_audio:
        args += ["-c:a", "aac", "-b:a", "192k"]
    else:
        args += ["-an"]
    args.append(str(out))
    run_command(job_id, args)
    return out


def run_ffmpeg_job(job_id: str, job: dict[str, Any], job_dir: Path) -> Path:
    source = source_file(job_dir)
    if source is None:
        raise RuntimeError("FFmpeg job needs a source video")
    profile = profile_for(job)
    update_status(job_id, progress=20, stage="ffmpeg", message="Нормализую видео на удалённом GPU-воркере.")
    out = job_dir / ("FINAL.mp4" if profile["quality"] == "final" else "preview.mp4")
    normalize_video(job_id, source, out, profile, keep_audio=True)
    update_status(job_id, progress=92, stage="encode", message="FFmpeg рендер готов, проверяю файл.")
    return out


def run_blender_job(job_id: str, job: dict[str, Any], job_dir: Path) -> Path:
    if not command_exists("blender"):
        raise RuntimeError("Blender is not installed in this runtime")
    profile = profile_for(job)
    source = source_file(job_dir)

    if source is None:
        update_status(job_id, progress=15, stage="director", message="Собираю Blender blocking из Scene Pack.")
        scene_pack = job.get("scene_pack")
        scene_pack_path = job_dir / "NOVA_scene_pack.json"
        if scene_pack:
            scene_pack_path.write_text(json.dumps(scene_pack, ensure_ascii=False, indent=2), encoding="utf-8")
            cmd = [
                sys.executable,
                str(REPO_ROOT / "automation" / "nova_pipeline.py"),
                "--scene-pack",
                str(scene_pack_path),
                "--out",
                str(job_dir / "blender"),
                "--run-blender",
            ]
        else:
            cmd = [
                sys.executable,
                str(REPO_ROOT / "automation" / "nova_pipeline.py"),
                "--prompt",
                str(job.get("source_prompt") or "TUMSOEV cinematic scene"),
                "--duration",
                str(int(round(profile["duration"]))),
                "--ratio",
                profile["ratio"],
                "--out",
                str(job_dir / "blender"),
                "--run-blender",
            ]
        run_command(job_id, cmd, cwd=REPO_ROOT)
        result = job_dir / "blender" / "NOVA_blocking_preview.mp4"
        if not result.is_file():
            raise RuntimeError("Blender blocking preview was not created")
        target = job_dir / ("FINAL.mp4" if profile["quality"] == "final" else "preview.mp4")
        shutil.copy2(result, target)
        return target

    update_status(job_id, progress=12, stage="normalize", message="Готовлю reference video для Blender tracking.")
    reference = job_dir / "reference_control.mp4"
    normalize_video(job_id, source, reference, profile, keep_audio=False)

    extract_pose = REPO_ROOT / "blender-colab" / "scripts" / "extract_pose.py"
    make_control = REPO_ROOT / "blender-colab" / "scripts" / "make_blender_control.py"
    if not extract_pose.is_file() or not make_control.is_file():
        raise RuntimeError("Blender pose-control scripts are missing from the repository")

    motion_json = job_dir / "motion.json"
    update_status(job_id, progress=32, stage="tracking", message="Извлекаю движение человека.")
    run_command(
        job_id,
        [
            sys.executable,
            str(extract_pose),
            "--input",
            str(reference),
            "--output",
            str(motion_json),
            "--fps",
            str(profile["fps"]),
            "--duration",
            str(profile["duration"]),
        ],
        cwd=REPO_ROOT,
    )

    control_dir = job_dir / "blender_control"
    control_dir.mkdir(parents=True, exist_ok=True)
    update_status(job_id, progress=58, stage="blender", message="Blender строит 3D pose-control и камеру.")
    run_command(
        job_id,
        [
            "blender",
            "--background",
            "--python",
            str(make_control),
            "--",
            "--motion",
            str(motion_json),
            "--output-dir",
            str(control_dir),
            "--width",
            str(profile["width"]),
            "--height",
            str(profile["height"]),
        ],
        cwd=REPO_ROOT,
    )
    result = control_dir / "blender_pose_control.mp4"
    if not result.is_file():
        raise RuntimeError("Blender pose-control video was not created")
    target = job_dir / ("FINAL.mp4" if profile["quality"] == "final" else "preview.mp4")
    shutil.copy2(result, target)
    return target


def extract_first_frame(job_id: str, source: Path, destination: Path) -> Path:
    if not command_exists("ffmpeg"):
        raise RuntimeError("FFmpeg is required to create a WanGP start image")
    run_command(
        job_id,
        [
            "ffmpeg", "-y", "-i", str(source), "-frames:v", "1",
            "-vf", "scale='min(1280,iw)':-2", str(destination),
        ],
    )
    if not destination.is_file():
        raise RuntimeError("Could not extract a start image for WanGP")
    return destination


def get_wangp_session():
    global WANGP_SESSION
    with WANGP_SESSION_LOCK:
        if WANGP_SESSION is not None:
            return WANGP_SESSION
        if not (WANGP_ROOT / "shared" / "api.py").is_file():
            raise RuntimeError(
                "WanGP API is not installed. Run the WanGP setup cell in NOVA_Remote_GPU_Worker.ipynb."
            )
        if str(WANGP_ROOT) not in sys.path:
            sys.path.insert(0, str(WANGP_ROOT))
        WANGP_OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
        update_env = {
            "WAN_CACHE_DIR": str(WANGP_ROOT / "cache"),
            "HF_HOME": str(WANGP_ROOT / "cache" / "huggingface"),
            "HUGGINGFACE_HUB_CACHE": str(WANGP_ROOT / "cache" / "huggingface" / "hub"),
            "TORCH_HOME": str(WANGP_ROOT / "cache" / "torch"),
            "XDG_CACHE_HOME": str(WANGP_ROOT / "cache" / ".cache"),
        }
        os.environ.update(update_env)
        from shared.api import init as wangp_init
        WANGP_SESSION = wangp_init(
            root=WANGP_ROOT,
            output_dir=WANGP_OUTPUT_ROOT,
            cli_args=["--attention", "sdpa", "--profile", "5"],
            console_output=True,
        )
        return WANGP_SESSION


def _model_inputs(record: dict[str, Any]) -> set[str]:
    metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else record
    raw = metadata.get("inputs") if isinstance(metadata, dict) else []
    if isinstance(raw, str):
        return {raw.lower()}
    if isinstance(raw, (list, tuple, set)):
        return {str(item).lower() for item in raw}
    return set()


def human_motion_options(job: dict[str, Any]) -> dict[str, Any]:
    raw = job.get("human_motion")
    if not isinstance(raw, dict):
        scene_pack = job.get("scene_pack") if isinstance(job.get("scene_pack"), dict) else {}
        raw = scene_pack.get("human_motion") if isinstance(scene_pack.get("human_motion"), dict) else {}
    prompt = str(job.get("source_prompt") or job.get("prompt") or "").lower()
    mode = str(raw.get("mode") or "auto").strip().lower()
    if mode == "auto":
        if re.search(r"\b(run|running|sprint)\b|бег|беж|спринт", prompt):
            mode = "run"
        elif re.search(r"\b(dance|dancing)\b|танц", prompt):
            mode = "dance"
        elif re.search(r"\b(walk|walking|stride|gait)\b|ходьб|ид[её]т|идти|шага", prompt):
            mode = "walk"
        elif re.search(r"motion.?transfer|openpose|skeleton|pose.?control|скелет|поз[аы]|движени[ея] человека", prompt):
            mode = "motion-reference"
        else:
            mode = "none"
    return {
        "enabled": bool(raw.get("enabled", mode != "none")) and mode != "none",
        "mode": mode,
        "control_source": str(raw.get("control_source") or "source_video"),
        "prefer_pose_control": bool(raw.get("prefer_pose_control", True)),
        "full_body": bool(raw.get("full_body", True)),
    }


def _model_blob(record: dict[str, Any]) -> str:
    metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}
    return " ".join(
        str(value or "")
        for value in (
            record.get("name"),
            record.get("model_type"),
            metadata.get("name"),
            metadata.get("model_type"),
        )
    ).lower()


def pick_wangp_model(session, job: dict[str, Any], has_source: bool) -> dict[str, Any]:
    options = job.get("wangp") if isinstance(job.get("wangp"), dict) else {}
    explicit = str(options.get("model_type") or "").strip()
    if explicit:
        records = session.list_model_metadata(model_type=explicit, limit=5)
        if records:
            return records[0]
        return {"model_type": explicit, "name": explicit, "metadata": {}}

    gpu = gpu_info()
    low_vram = not gpu.get("memory_mb") or int(gpu.get("memory_mb") or 0) < 18000
    motion = human_motion_options(job)

    # Human motion needs a control-aware model. On a free Colab T4, prefer
    # VACE 1.3B (pose-control capable) before generic FastWan. Bigger GPUs can
    # use Wan 2.2 Animate / VACE 14B families.
    queries: list[str] = []
    if has_source and motion["enabled"]:
        if low_vram:
            queries += ["VACE 1.3B", "Vace 1.3B"]
        else:
            queries += ["Wan 2.2 Animate 2", "Wan 2.2 Animate", "VACE 14B", "Scail 2"]
    elif has_source and not low_vram:
        queries += ["Scail 2", "Wan 2.2 Animate", "Bernini"]
    queries += ["FastWan", "Wan 2.2"]

    best_fallback = None
    for query in queries:
        try:
            records = session.list_model_metadata(query=query, main_output="video", limit=20)
        except Exception:
            records = []
        for record in records:
            if best_fallback is None:
                best_fallback = record
            inputs = _model_inputs(record)
            blob = _model_blob(record)

            if has_source and motion["enabled"]:
                if low_vram and "vace" in blob and ("1.3" in blob or "1_3" in blob or "1-3" in blob):
                    return record
                if not low_vram and ("animate" in blob or "vace" in blob or "scail" in blob):
                    return record
                # Never silently downgrade a requested body-motion transfer to a
                # generic image/video model; that is the old "person stays still" bug.
                continue

            if has_source and "video" in inputs and (not low_vram or "fast" in blob):
                return record
            if has_source and "image" in inputs and "fastwan" in blob:
                return record
            if not has_source and ("text" in inputs or not inputs):
                return record

    if has_source and motion["enabled"]:
        try:
            records = session.list_model_metadata(main_output="video", limit=100)
        except Exception:
            records = []
        for record in records:
            blob = _model_blob(record)
            if low_vram and "vace" in blob and ("1.3" in blob or "1_3" in blob or "1-3" in blob):
                return record
            if not low_vram and ("animate" in blob or "vace" in blob or "scail" in blob):
                return record
        raise RuntimeError(
            "WanGP human-motion control model is unavailable. On T4 install/enable VACE 1.3B; "
            "NOVA will not replace it with a static FastWan/Blender preview."
        )

    if best_fallback is not None:
        return best_fallback

    records = session.list_model_metadata(main_output="video", limit=30)
    if not records:
        raise RuntimeError("WanGP reported no video generation models")
    return records[0]


def build_wangp_settings(
    session,
    model_record: dict[str, Any],
    job: dict[str, Any],
    profile: dict[str, Any],
    prepared_video: Path | None,
    job_dir: Path,
) -> dict[str, Any]:
    model_type = str(model_record.get("model_type") or "").strip()
    if not model_type:
        metadata = model_record.get("metadata") if isinstance(model_record.get("metadata"), dict) else {}
        model_type = str(metadata.get("model_type") or "").strip()
    if not model_type:
        raise RuntimeError("WanGP model discovery returned a model without model_type")

    defaults = session.get_default_settings(model_type)
    settings = dict(defaults or {})
    settings["model_type"] = model_type
    motion = human_motion_options(job)
    prompt = str(job.get("source_prompt") or job.get("prompt") or "cinematic realistic motion").strip()
    motion_prompts = {
        "walk": "Full-body natural walking cycle with clear forward locomotion, alternating heel-to-toe steps, visible weight transfer, stable hips, and opposite arm swing.",
        "run": "Full-body natural running cycle with continuous forward locomotion, believable foot contacts, weight transfer, arm swing, and stable anatomy.",
        "dance": "Full-body coordinated dance motion with continuous body movement, planted foot contacts when appropriate, stable limbs, and consistent rhythm.",
        "motion-reference": "Follow the driving video's full-body motion and timing closely while preserving stable anatomy and continuous locomotion.",
    }
    if motion["enabled"] and motion["mode"] in motion_prompts:
        prompt = (prompt + " " + motion_prompts[motion["mode"]]).strip()
        negative = str(settings.get("negative_prompt") or "").strip()
        motion_negative = "static pose, frozen body, no locomotion, foot sliding, skating feet, duplicated limbs, broken legs, unstable gait, body morphing"
        settings["negative_prompt"] = (negative + ", " + motion_negative).strip(", ")
    settings["prompt"] = prompt
    settings["video_length"] = f"{float(profile['duration']):g}s"
    settings["force_fps"] = int(profile["fps"])

    gpu = gpu_info()
    low_vram = not gpu.get("memory_mb") or int(gpu.get("memory_mb") or 0) < 18000
    # Generate economically, then upscale the approved final with FFmpeg.
    if low_vram:
        settings["resolution"] = "480x832" if profile["ratio"] == "9:16" else "832x480"
    else:
        settings["resolution"] = "704x1248" if profile["ratio"] == "9:16" else "1248x704"

    name_blob = (str(model_record.get("name") or "") + " " + model_type).lower()
    if "fastwan" in name_blob:
        try:
            current_steps = int(settings.get("num_inference_steps") or 8)
            settings["num_inference_steps"] = min(current_steps, 8)
        except Exception:
            settings["num_inference_steps"] = 8

    inputs = _model_inputs(model_record)
    character_reference = reference_file(job_dir)
    if prepared_video is not None:
        if motion["enabled"] and "vace" in name_blob:
            # VACE guide preprocessing explicitly supports PV = pose preprocessing
            # + control video. This turns the driving clip into body-motion control
            # instead of simply feeding its RGB frames as an ordinary video source.
            settings["video_guide"] = str(prepared_video)
            settings["video_prompt_type"] = "PVI" if character_reference is not None else "PV"
            if character_reference is not None:
                settings["image_refs"] = [str(character_reference)]
            settings.pop("video_source", None)
        elif motion["enabled"] and "animate" in name_blob:
            # Wan 2.2 Animate 2 exposes UV as its driving-video process; I adds
            # a separate character reference instead of stealing identity from the driver.
            settings["video_guide"] = str(prepared_video)
            settings["video_prompt_type"] = "UVI" if character_reference is not None else "UV"
            if character_reference is not None:
                settings["image_refs"] = [str(character_reference)]
            settings.pop("video_source", None)
            if character_reference is None and "image" in inputs:
                start_image = extract_first_frame(job["job_id"], prepared_video, job_dir / "WAN_GP_START.png")
                settings["image_start"] = str(start_image)
                settings["image_prompt_type"] = "S"
        elif "video" in inputs:
            settings["video_source"] = str(prepared_video)
        elif "image" in inputs:
            start_image = extract_first_frame(job["job_id"], prepared_video, job_dir / "WAN_GP_START.png")
            settings["image_start"] = str(start_image)

    (job_dir / "NOVA_MOTION_CONTROL.json").write_text(
        json.dumps(motion, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    overrides = job.get("wangp") if isinstance(job.get("wangp"), dict) else {}
    user_settings = overrides.get("settings")
    if isinstance(user_settings, dict):
        # Explicit per-job settings win, except model_type is normalized above.
        settings.update(user_settings)
        settings["model_type"] = str(user_settings.get("model_type") or model_type)

    (job_dir / "WANGP_SETTINGS.json").write_text(
        json.dumps(settings, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    return settings


def run_wangp_job(job_id: str, job: dict[str, Any], job_dir: Path) -> Path:
    """Run WanGP headlessly through its official in-process Python API."""
    profile = profile_for(job)
    source = source_file(job_dir)
    prepared = None
    if source is not None:
        update_status(job_id, progress=16, stage="wangp_prepare", message="Готовлю вход для WanGP.")
        prepared = job_dir / "WAN_GP_INPUT.mp4"
        # AI generation stays economical; final delivery is upscaled afterwards.
        ai_profile = dict(profile)
        ai_profile.update({
            "width": 480 if profile["ratio"] == "9:16" else 832,
            "height": 832 if profile["ratio"] == "9:16" else 480,
            "fps": min(24, int(profile["fps"])),
            "crf": "21",
            "preset": "veryfast",
        })
        normalize_video(job_id, source, prepared, ai_profile, keep_audio=True)

    prompt = str(job.get("source_prompt") or job.get("prompt") or "cinematic realistic motion")
    (job_dir / "WAN_GP_PROMPT.txt").write_text(prompt, encoding="utf-8")

    update_status(job_id, progress=22, stage="wangp_init", message="Запускаю WanGP Python API.")
    session = get_wangp_session()
    model_record = pick_wangp_model(session, job, prepared is not None)
    model_type = str(model_record.get("model_type") or (model_record.get("metadata") or {}).get("model_type") or "")
    model_name = str(model_record.get("name") or model_type)
    motion = human_motion_options(job)
    motion_label = f" • motion={motion['mode']}" if motion["enabled"] else ""
    update_status(
        job_id,
        progress=26,
        stage="wangp_model",
        message=f"WanGP: {model_name}{motion_label}. Подготавливаю модель.",
        wangp_model=model_type,
        wangp_model_name=model_name,
        human_motion=motion,
    )

    settings = build_wangp_settings(session, model_record, job, profile, prepared, job_dir)

    class Callbacks:
        def on_status(self, status):
            text_status = str(status or "").strip()
            if text_status:
                update_status(
                    job_id,
                    stage="wangp",
                    message="WanGP: " + text_status[:240],
                )

        def on_progress(self, update):
            try:
                raw = float(getattr(update, "progress", 0) or 0)
            except Exception:
                raw = 0.0
            mapped = 28 + max(0.0, min(100.0, raw)) * 0.62
            update_status(
                job_id,
                progress=round(mapped, 2),
                stage="wangp",
                message="WanGP генерирует видео…",
            )
            if job_id in CANCELLED:
                active = WANGP_JOBS.get(job_id)
                if active is not None:
                    try:
                        active.cancel()
                    except Exception:
                        pass

        def on_stream(self, line):
            try:
                append_log(job_id, f"[WanGP] {getattr(line, 'text', line)}")
            except Exception:
                pass

    update_status(job_id, progress=28, stage="wangp", message="WanGP начинает генерацию.")
    api_job = session.submit_task(settings, callbacks=Callbacks())
    WANGP_JOBS[job_id] = api_job
    try:
        result = api_job.result()
    finally:
        WANGP_JOBS.pop(job_id, None)

    if job_id in CANCELLED or bool(getattr(result, "cancelled", False)):
        raise RuntimeError("Job cancelled")
    if not bool(getattr(result, "success", False)):
        errors = getattr(result, "errors", None) or []
        message = "; ".join(str(getattr(err, "message", err)) for err in errors[:5]) or "WanGP generation failed"
        raise RuntimeError(message)

    generated = list(getattr(result, "generated_files", None) or [])
    candidate = None
    for item in generated:
        path = Path(os.fspath(item))
        if path.suffix.lower() in {".mp4", ".mov", ".mkv", ".webm"} and path.is_file():
            candidate = path
            break
    if candidate is None:
        raise RuntimeError("WanGP completed but returned no video file")

    update_status(job_id, progress=92, stage="wangp_encode", message="WanGP готов. Кодирую файл для iPhone.")
    target = job_dir / ("FINAL.mp4" if profile["quality"] == "final" else "preview.mp4")
    # Final jobs are delivered as 1080p H.264/AAC. Preview stays light.
    normalize_video(job_id, candidate, target, profile, keep_audio=True)
    return target


def mirror_completed_job(job_id: str, job_dir: Path) -> str | None:
    try:
        DRIVE_ROOT.mkdir(parents=True, exist_ok=True)
        target = DRIVE_ROOT / "completed" / job_id
        if target.exists():
            shutil.rmtree(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(job_dir, target)
        return str(target)
    except Exception as exc:
        append_log(job_id, f"Drive mirror skipped: {exc}")
        return None


def recovery_dir(job_id: str) -> Path:
    return DRIVE_ROOT / "recovery" / job_id


def checkpoint_job(job_id: str, job_dir: Path) -> str | None:
    """Best-effort persistent checkpoint when Google Drive is already mounted."""
    if not Path("/content/drive/MyDrive").exists():
        return None
    try:
        target = recovery_dir(job_id)
        target.mkdir(parents=True, exist_ok=True)
        keep_names = {
            "job.json",
            "NOVA_scene_pack.json",
            "WAN_GP_INPUT.mp4",
            "WAN_GP_START.png",
            "WAN_GP_PROMPT.txt",
            "WANGP_SETTINGS.json",
        }
        for source in job_dir.iterdir():
            if not source.is_file():
                continue
            if not (source.name.startswith("source.") or source.name in keep_names):
                continue
            destination = target / source.name
            if destination.exists() and destination.stat().st_size == source.stat().st_size:
                continue
            shutil.copy2(source, destination)
        return str(target)
    except Exception as exc:
        append_log(job_id, f"Recovery checkpoint skipped: {exc}")
        return None


def execute_job(job_id: str) -> None:
    job_dir = JOB_ROOT / job_id
    try:
        job = json.loads((job_dir / "job.json").read_text(encoding="utf-8"))
        if bool(job.get("mirror_drive")):
            asyncio.create_task(asyncio.to_thread(checkpoint_job, job_id, job_dir))
        engine = str(job.get("engine") or "auto").lower()
        if engine == "auto":
            engine = "blender" if command_exists("blender") else "ffmpeg"
        update_status(
            job_id,
            status="running",
            engine=engine,
            quality=str(job.get("quality") or "preview").lower(),
            progress=5,
            stage="start",
            message=f"Запускаю {engine}.",
        )
        if engine == "ffmpeg":
            result = run_ffmpeg_job(job_id, job, job_dir)
        elif engine == "blender":
            result = run_blender_job(job_id, job, job_dir)
        elif engine == "wangp":
            result = run_wangp_job(job_id, job, job_dir)
            if result is None:
                return
        else:
            raise RuntimeError(f"Unknown engine: {engine}")

        if job_id in CANCELLED:
            raise RuntimeError("Job cancelled")
        drive_path = mirror_completed_job(job_id, job_dir) if bool(job.get("mirror_drive")) else None
        update_status(
            job_id,
            status="completed",
            progress=100,
            stage="done",
            message="Готово. Результат можно открыть на телефоне.",
            result_file=result.name,
            result_bytes=result.stat().st_size,
            quality=str(job.get("quality") or "preview").lower(),
            drive_path=drive_path,
        )
    except Exception as exc:
        state = "cancelled" if job_id in CANCELLED else "error"
        update_status(job_id, status=state, stage=state, message=str(exc), error=str(exc))


async def save_upload(upload: UploadFile, destination: Path) -> int:
    total = 0
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as handle:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_UPLOAD_BYTES:
                handle.close()
                destination.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="Video exceeds worker upload limit")
            handle.write(chunk)
    return total


def new_download_ticket(job_id: str, filename: str) -> str:
    now = time.time()
    expired = [key for key, value in DOWNLOAD_TICKETS.items() if float(value.get("expires_at", 0)) <= now]
    for key in expired:
        DOWNLOAD_TICKETS.pop(key, None)
    ticket = secrets.token_urlsafe(24)
    DOWNLOAD_TICKETS[ticket] = {
        "job_id": job_id,
        "filename": filename,
        "expires_at": now + max(60, DOWNLOAD_TICKET_TTL),
    }
    return ticket


@app.get("/")
async def root(request: Request):
    require_token(request)
    return {"ok": True, "service": "NOVA Remote GPU Worker"}


@app.get("/health")
async def health(request: Request):
    require_token(request)
    disk = shutil.disk_usage(JOB_ROOT)
    return {
        "ok": True,
        "worker_version": WORKER_VERSION,
        "protocol_version": PROTOCOL_VERSION,
        "session_id": SESSION_ID,
        "gpu": gpu_info(),
        "blender": command_exists("blender"),
        "ffmpeg": command_exists("ffmpeg"),
        "wangp_api_ready": (WANGP_ROOT / "shared" / "api.py").is_file(),
        "capabilities": {
            "chunked_upload": True,
            "download_ticket": True,
            "preview_promote": True,
            "full_auto": True,
            "auto_recovery": True,
            "drive_restore": Path("/content/drive/MyDrive").exists(),
            "blender": command_exists("blender"),
            "ffmpeg": command_exists("ffmpeg"),
            "wangp": (WANGP_ROOT / "shared" / "api.py").is_file(),
            "human_motion_control": True,
            "human_motion_preferred_t4": "VACE 1.3B",
        },
        "wangp_root": str(WANGP_ROOT),
        "job_root": str(JOB_ROOT),
        "drive_mounted": Path("/content/drive/MyDrive").exists(),
        "free_disk_gb": round(disk.free / 1024**3, 1),
    }


@app.post("/jobs")
async def create_job(
    request: Request,
    job_json: str = Form(...),
    source: UploadFile | None = File(None),
    reference: UploadFile | None = File(None),
):
    require_token(request)
    try:
        job = json.loads(job_json)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid job JSON: {exc}") from exc
    if not isinstance(job, dict):
        raise HTTPException(status_code=400, detail="Job must be a JSON object")

    job_id = safe_job_id(job.get("job_id"))
    job_dir = JOB_ROOT / job_id
    if job_dir.exists():
        raise HTTPException(status_code=409, detail="Job ID already exists")
    job_dir.mkdir(parents=True)
    job["job_id"] = job_id
    (job_dir / "job.json").write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")

    upload_bytes = 0
    if source is not None and source.filename:
        suffix = Path(source.filename).suffix.lower()
        if suffix not in {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}:
            shutil.rmtree(job_dir, ignore_errors=True)
            raise HTTPException(status_code=400, detail="Unsupported video type")
        upload_bytes = await save_upload(source, job_dir / f"source{suffix}")

    reference_bytes = 0
    if reference is not None and reference.filename:
        ref_suffix = Path(reference.filename).suffix.lower()
        if ref_suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
            shutil.rmtree(job_dir, ignore_errors=True)
            raise HTTPException(status_code=400, detail="Unsupported character reference image type")
        reference_bytes = await save_upload(reference, job_dir / f"reference{ref_suffix}")

    deferred = bool(job.get("defer_start"))
    update_status(
        job_id,
        job_id=job_id,
        status="uploading" if deferred else "queued",
        progress=0,
        stage="uploading" if deferred else "queued",
        message="Задание создано. Жду видео по частям." if deferred else "Задание принято Colab worker.",
        upload_bytes=upload_bytes,
        reference_bytes=reference_bytes,
        has_character_reference=reference_file(job_dir) is not None,
        quality=str(job.get("quality") or "preview").lower(),
        created_at=time.time(),
    )
    if bool(job.get("mirror_drive")) and source_file(job_dir) is not None:
        asyncio.create_task(asyncio.to_thread(checkpoint_job, job_id, job_dir))
    if not deferred:
        asyncio.create_task(asyncio.to_thread(execute_job, job_id))
    return {"ok": True, "job_id": job_id, "status": "uploading" if deferred else "queued"}


@app.post("/jobs/{job_id}/upload-chunk")
async def upload_chunk(
    job_id: str,
    request: Request,
    index: int = Form(...),
    total: int = Form(...),
    filename: str = Form(...),
    chunk: UploadFile = File(...),
):
    require_token(request)
    job_dir = JOB_ROOT / job_id
    if not job_dir.is_dir():
        raise HTTPException(status_code=404, detail="Job not found")
    if total < 1 or index < 0 or index >= total or total > 10000:
        raise HTTPException(status_code=400, detail="Invalid chunk coordinates")
    safe_name = Path(filename).name
    suffix = Path(safe_name).suffix.lower()
    if suffix not in {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}:
        raise HTTPException(status_code=400, detail="Unsupported video type")
    chunks_dir = job_dir / "chunks"
    chunks_dir.mkdir(exist_ok=True)
    part = chunks_dir / f"{index:06d}.part"
    size = await save_upload(chunk, part)
    received = len(list(chunks_dir.glob("*.part")))
    update_status(
        job_id,
        status="uploading",
        stage="uploading",
        progress=min(12, round(received / total * 12, 2)),
        upload_received=received,
        upload_total=total,
        message=f"Получено {received}/{total} частей видео.",
    )
    if received == total:
        target = job_dir / f"source{suffix}"
        total_bytes = 0
        with target.open("wb") as out:
            for part_index in range(total):
                p = chunks_dir / f"{part_index:06d}.part"
                if not p.is_file():
                    raise HTTPException(status_code=409, detail=f"Missing chunk {part_index}")
                total_bytes += p.stat().st_size
                if total_bytes > MAX_UPLOAD_BYTES:
                    target.unlink(missing_ok=True)
                    raise HTTPException(status_code=413, detail="Video exceeds worker upload limit")
                with p.open("rb") as src:
                    shutil.copyfileobj(src, out, length=1024 * 1024)
        shutil.rmtree(chunks_dir, ignore_errors=True)
        update_status(
            job_id,
            status="uploaded",
            stage="uploaded",
            progress=12,
            upload_bytes=total_bytes,
            upload_received=total,
            upload_total=total,
            message="Видео полностью загружено. Можно запускать GPU render.",
        )
        job = json.loads((job_dir / "job.json").read_text(encoding="utf-8"))
        if bool(job.get("mirror_drive")):
            checkpoint_job(job_id, job_dir)
    return {"ok": True, "job_id": job_id, "received": received, "total": total, "bytes": size}


@app.post("/jobs/{job_id}/start")
async def start_job(job_id: str, request: Request):
    require_token(request)
    job_dir = JOB_ROOT / job_id
    if not job_dir.is_dir():
        raise HTTPException(status_code=404, detail="Job not found")
    current = read_status(job_id)
    if current.get("status") in {"running", "completed"}:
        return {"ok": True, "job_id": job_id, "status": current.get("status")}
    job = json.loads((job_dir / "job.json").read_text(encoding="utf-8"))
    engine = str(job.get("engine") or "auto").lower()
    if engine == "ffmpeg" and source_file(job_dir) is None:
        raise HTTPException(status_code=400, detail="FFmpeg job needs a source video")
    job["defer_start"] = False
    (job_dir / "job.json").write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
    update_status(job_id, status="queued", stage="queued", progress=max(12, current.get("progress") or 0), message="Видео принято. Запускаю GPU.")
    asyncio.create_task(asyncio.to_thread(execute_job, job_id))
    return {"ok": True, "job_id": job_id, "status": "queued"}


@app.post("/jobs/{job_id}/promote")
async def promote_job(job_id: str, request: Request):
    require_token(request)
    source_dir = JOB_ROOT / job_id
    if not source_dir.is_dir():
        raise HTTPException(status_code=404, detail="Job not found")
    status = read_status(job_id)
    if status.get("status") != "completed":
        raise HTTPException(status_code=409, detail=f"Job is {status.get('status')}")
    original = json.loads((source_dir / "job.json").read_text(encoding="utf-8"))
    if str(original.get("quality") or "preview").lower() == "final":
        return {"ok": True, "job_id": job_id, "status": "completed", "already_final": True}

    promoted = dict(original)
    promoted.pop("job_id", None)
    promoted["quality"] = "final"
    promoted["fps"] = max(30, int(original.get("final_fps") or 30))
    promoted["defer_start"] = False
    promoted["promoted_from"] = job_id
    promoted["created_at"] = time.time()
    new_id = safe_job_id()
    promoted["job_id"] = new_id
    target_dir = JOB_ROOT / new_id
    target_dir.mkdir(parents=True)

    for source in source_dir.iterdir():
        if not source.is_file():
            continue
        if source.name.startswith("source.") or source.name.startswith("reference.") or source.name in {
            "NOVA_scene_pack.json",
            "WAN_GP_INPUT.mp4",
            "WAN_GP_START.png",
            "WAN_GP_PROMPT.txt",
            "WANGP_SETTINGS.json",
        }:
            target = target_dir / source.name
            try:
                os.link(source, target)
            except Exception:
                shutil.copy2(source, target)

    (target_dir / "job.json").write_text(
        json.dumps(promoted, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    update_status(
        new_id,
        job_id=new_id,
        status="queued",
        quality="final",
        progress=0,
        stage="queued",
        message=f"Preview {job_id} одобрен FULL AUTO. Запускаю Final без повторной загрузки.",
        promoted_from=job_id,
        created_at=time.time(),
    )
    asyncio.create_task(asyncio.to_thread(execute_job, new_id))
    return {"ok": True, "job_id": new_id, "status": "queued", "promoted_from": job_id}


@app.post("/recovery/{job_id}/restore")
async def restore_recovery_job(job_id: str, request: Request):
    require_token(request)
    if not Path("/content/drive/MyDrive").exists():
        raise HTTPException(status_code=409, detail="Google Drive is not mounted")
    source = recovery_dir(job_id)
    if not source.is_dir() or not (source / "job.json").is_file():
        raise HTTPException(status_code=404, detail="Recovery checkpoint not found")
    target = JOB_ROOT / job_id
    if target.exists():
        current = status_path(job_id)
        if current.is_file():
            return {"ok": True, "job_id": job_id, "status": read_status(job_id).get("status"), "restored": False}
        shutil.rmtree(target, ignore_errors=True)
    shutil.copytree(source, target)
    job = json.loads((target / "job.json").read_text(encoding="utf-8"))
    job["job_id"] = job_id
    job["defer_start"] = False
    (target / "job.json").write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
    update_status(
        job_id,
        job_id=job_id,
        status="queued",
        quality=str(job.get("quality") or "preview").lower(),
        progress=0,
        stage="recovered",
        message="Восстановил job из Google Drive checkpoint после новой Colab-сессии.",
        recovered_from_drive=True,
        created_at=time.time(),
    )
    asyncio.create_task(asyncio.to_thread(execute_job, job_id))
    return {"ok": True, "job_id": job_id, "status": "queued", "restored": True}


@app.get("/jobs/{job_id}")
async def get_job(job_id: str, request: Request):
    require_token(request)
    status = read_status(job_id)
    log = JOB_ROOT / job_id / "render.log"
    if log.is_file():
        try:
            lines = log.read_text(encoding="utf-8", errors="replace").splitlines()
            status["log_tail"] = lines[-20:]
        except Exception:
            pass
    return status


@app.post("/jobs/{job_id}/download-ticket")
async def create_download_ticket(job_id: str, request: Request):
    require_token(request)
    status = read_status(job_id)
    if status.get("status") != "completed":
        raise HTTPException(status_code=409, detail=f"Job is {status.get('status')}")
    name = str(status.get("result_file") or "")
    path = JOB_ROOT / job_id / name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Result file is missing")
    ticket = new_download_ticket(job_id, path.name)
    return {
        "ok": True,
        "path": f"/download/{ticket}",
        "filename": path.name,
        "expires_in": max(60, DOWNLOAD_TICKET_TTL),
    }


@app.get("/download/{ticket}")
async def download_with_ticket(ticket: str):
    data = DOWNLOAD_TICKETS.get(ticket)
    if not data or float(data.get("expires_at", 0)) <= time.time():
        DOWNLOAD_TICKETS.pop(ticket, None)
        raise HTTPException(status_code=404, detail="Download link expired")
    job_id = str(data.get("job_id") or "")
    filename = str(data.get("filename") or "")
    path = JOB_ROOT / job_id / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Result file is missing")
    return FileResponse(path, media_type="video/mp4", filename=path.name)


@app.get("/jobs/{job_id}/result")
async def get_result(job_id: str, request: Request):
    require_token(request)
    status = read_status(job_id)
    if status.get("status") != "completed":
        raise HTTPException(status_code=409, detail=f"Job is {status.get('status')}")
    name = str(status.get("result_file") or "")
    path = JOB_ROOT / job_id / name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Result file is missing")
    return FileResponse(path, media_type="video/mp4", filename=path.name)


@app.post("/jobs/{job_id}/finalize")
async def finalize_job(job_id: str, request: Request, result: UploadFile = File(...)):
    require_token(request)
    job_dir = JOB_ROOT / job_id
    if not job_dir.is_dir():
        raise HTTPException(status_code=404, detail="Job not found")
    suffix = Path(result.filename or "FINAL.mp4").suffix.lower() or ".mp4"
    target = job_dir / f"FINAL{suffix}"
    await save_upload(result, target)
    job = json.loads((job_dir / "job.json").read_text(encoding="utf-8"))
    drive_path = mirror_completed_job(job_id, job_dir) if bool(job.get("mirror_drive")) else None
    update_status(
        job_id,
        status="completed",
        progress=100,
        stage="done",
        message="WanGP результат финализирован и готов для телефона.",
        result_file=target.name,
        result_bytes=target.stat().st_size,
        drive_path=drive_path,
    )
    return {"ok": True, "job_id": job_id, "result_file": target.name}


@app.delete("/jobs/{job_id}")
async def cancel_job(job_id: str, request: Request):
    require_token(request)
    _ = read_status(job_id)
    CANCELLED.add(job_id)
    with LOCK:
        proc = PROCESSES.get(job_id)
        if proc and proc.poll() is None:
            try:
                proc.terminate()
            except Exception:
                pass
    api_job = WANGP_JOBS.get(job_id)
    if api_job is not None:
        try:
            api_job.cancel()
        except Exception:
            pass
    update_status(job_id, status="cancelled", progress=0, stage="cancelled", message="Задание остановлено.")
    return JSONResponse({"ok": True, "job_id": job_id, "status": "cancelled"})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=7861)
    args = parser.parse_args()
    import uvicorn

    print("=" * 72)
    print("NOVA Remote GPU Worker")
    print("Token:", TOKEN)
    print("Job root:", JOB_ROOT)
    print("=" * 72)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
