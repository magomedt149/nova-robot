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


def run_wangp_job(job_id: str, job: dict[str, Any], job_dir: Path) -> Path | None:
    """Prepare a WanGP job.

    Fully automatic WanGP is enabled only when NOVA_WANGP_API_URL and a compatible
    Gradio api_name/kwargs are configured. Otherwise the job is staged for the
    verified WanGP Colab UI without pretending that generation finished.
    """
    profile = profile_for(job)
    source = source_file(job_dir)
    prepared = None
    if source is not None:
        update_status(job_id, progress=18, stage="wangp_prepare", message="Готовлю WanGP reference video.")
        prepared = job_dir / "WAN_GP_INPUT.mp4"
        normalize_video(job_id, source, prepared, profile, keep_audio=True)

    prompt = str(job.get("source_prompt") or job.get("prompt") or "cinematic realistic motion")
    (job_dir / "WAN_GP_PROMPT.txt").write_text(prompt, encoding="utf-8")
    handoff = {
        "prompt": prompt,
        "input_video": str(prepared) if prepared else None,
        "ratio": profile["ratio"],
        "duration": profile["duration"],
        "quality": profile["quality"],
        "recommended_model": "Wan 2.2 Animate 2",
        "note": "Use the verified WanGP Colab UI unless a Gradio API is configured.",
    }
    (job_dir / "WANGP_HANDOFF.json").write_text(json.dumps(handoff, ensure_ascii=False, indent=2), encoding="utf-8")

    api_url = os.environ.get("NOVA_WANGP_API_URL")
    api_name = os.environ.get("NOVA_WANGP_API_NAME")
    kwargs = (job.get("wangp") or {}).get("kwargs") if isinstance(job.get("wangp"), dict) else None
    if api_url and api_name and isinstance(kwargs, dict):
        update_status(job_id, progress=45, stage="wangp", message="Отправляю задачу в настроенный WanGP Gradio API.")
        try:
            from gradio_client import Client
            client = Client(api_url)
            result = client.predict(api_name=api_name, **kwargs)
            candidate = None
            if isinstance(result, str):
                candidate = Path(result)
            elif isinstance(result, (list, tuple)):
                for item in result:
                    if isinstance(item, str) and Path(item).suffix.lower() in {".mp4", ".webm", ".mov"}:
                        candidate = Path(item)
                        break
            if candidate and candidate.is_file():
                target = job_dir / ("FINAL.mp4" if profile["quality"] == "final" else "preview.mp4")
                shutil.copy2(candidate, target)
                return target
            raise RuntimeError("WanGP API returned no video file")
        except Exception as exc:
            append_log(job_id, f"WanGP API bridge failed: {exc}")

    update_status(
        job_id,
        status="waiting_wangp",
        progress=70,
        stage="wangp_handoff",
        message="WanGP inputs готовы. Открой WanGP в Colab, запусти генерацию и финализируй результат.",
        handoff_file="WANGP_HANDOFF.json",
    )
    return None


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


def execute_job(job_id: str) -> None:
    job_dir = JOB_ROOT / job_id
    try:
        job = json.loads((job_dir / "job.json").read_text(encoding="utf-8"))
        engine = str(job.get("engine") or "auto").lower()
        if engine == "auto":
            engine = "blender" if command_exists("blender") else "ffmpeg"
        update_status(job_id, status="running", engine=engine, progress=5, stage="start", message=f"Запускаю {engine}.")
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
        "gpu": gpu_info(),
        "blender": command_exists("blender"),
        "ffmpeg": command_exists("ffmpeg"),
        "wangp_api_configured": bool(os.environ.get("NOVA_WANGP_API_URL") and os.environ.get("NOVA_WANGP_API_NAME")),
        "job_root": str(JOB_ROOT),
        "drive_mounted": Path("/content/drive/MyDrive").exists(),
        "free_disk_gb": round(disk.free / 1024**3, 1),
    }


@app.post("/jobs")
async def create_job(request: Request, job_json: str = Form(...), source: UploadFile | None = File(None)):
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

    update_status(
        job_id,
        job_id=job_id,
        status="queued",
        progress=0,
        stage="queued",
        message="Задание принято Colab worker.",
        upload_bytes=upload_bytes,
        created_at=time.time(),
    )
    asyncio.create_task(asyncio.to_thread(execute_job, job_id))
    return {"ok": True, "job_id": job_id, "status": "queued"}


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
