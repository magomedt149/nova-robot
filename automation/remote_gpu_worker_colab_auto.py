#!/usr/bin/env python3
"""Dedicated FREE Colab wrapper for NOVA wolf automation.

It reuses the existing NOVA Remote GPU API, replaces only the Blender handler
for the exact [NOVA_WOLF_AUTO_V1] workflow, and exposes a token-protected
runtime-stop request. The notebook kernel performs the actual Colab disconnect
when it sees the stop marker.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from automation import remote_gpu_worker as base  # noqa: E402
from fastapi import Request  # noqa: E402

WOLF_MARKER = "[NOVA_WOLF_AUTO_V1]"
STOP_MARKER = Path(os.environ.get("NOVA_RUNTIME_STOP_MARKER", "/content/NOVA_STOP_RUNTIME"))
ORIGINAL_RUN_BLENDER_JOB = base.run_blender_job


def is_wolf_auto(job: dict[str, Any]) -> bool:
    prompt = str(job.get("source_prompt") or job.get("prompt") or "")
    workflow = str(job.get("workflow") or "")
    return WOLF_MARKER in prompt or workflow == "wolf_cinema_auto_v1"


def run_wolf_auto_job(job_id: str, job: dict[str, Any], job_dir: Path) -> Path:
    if not base.command_exists("blender"):
        raise RuntimeError("Blender is not installed in this Colab runtime")
    if not base.command_exists("ffmpeg"):
        raise RuntimeError("FFmpeg is not installed in this Colab runtime")

    script = REPO_ROOT / "blender-colab" / "scripts" / "render_wolf_cinema_auto.py"
    if not script.is_file():
        raise RuntimeError(f"Wolf renderer is missing: {script}")

    # The dedicated voice command is intentionally deterministic: exactly the
    # current free Night Wolf production target, independent of generic UI defaults.
    duration = 10.0
    fps = 24
    ratio = "16:9"
    quality = "final"
    target = job_dir / "FINAL.mp4"

    base.update_status(
        job_id,
        progress=10,
        stage="wolf_scene",
        engine="blender",
        quality=quality,
        message="NOVA: строю бесплатную 3D-сцену волка и TRUE 360° камеру.",
        workflow="wolf_cinema_auto_v1",
        free_only=True,
    )

    cmd = [
        "blender",
        "--background",
        "--python",
        str(script),
        "--",
        "--output",
        str(target),
        "--duration",
        f"{duration:g}",
        "--fps",
        str(fps),
        "--ratio",
        ratio,
        "--quality",
        quality,
    ]
    base.append_log(job_id, "[NOVA WOLF AUTO] " + " ".join(cmd))
    process = subprocess.Popen(
        cmd,
        cwd=str(REPO_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    base.PROCESSES[job_id] = process
    try:
        if process.stdout:
            for line in process.stdout:
                base.append_log(job_id, line.rstrip())
                if job_id in base.CANCELLED:
                    try:
                        process.terminate()
                    except Exception:
                        pass
                    raise RuntimeError("Job cancelled")
        code = process.wait()
    finally:
        base.PROCESSES.pop(job_id, None)

    if code != 0:
        raise RuntimeError(f"Blender wolf render failed with exit code {code}")
    if not target.is_file() or target.stat().st_size <= 0:
        raise RuntimeError("Blender wolf render finished but FINAL.mp4 is missing")

    report = target.with_suffix(".wolf-report.json")
    report_data = None
    if report.is_file():
        try:
            report_data = json.loads(report.read_text(encoding="utf-8"))
        except Exception:
            report_data = None
    base.update_status(
        job_id,
        progress=96,
        stage="wolf_verify",
        message="Волк отрендерен. Проверяю MP4 перед возвратом в NOVA.",
        wolf_report=report_data,
    )
    return target


def patched_run_blender_job(job_id: str, job: dict[str, Any], job_dir: Path) -> Path:
    if is_wolf_auto(job):
        return run_wolf_auto_job(job_id, job, job_dir)
    return ORIGINAL_RUN_BLENDER_JOB(job_id, job, job_dir)


base.run_blender_job = patched_run_blender_job


@base.app.post("/runtime/shutdown")
async def request_runtime_shutdown(request: Request):
    """Request Colab runtime shutdown after NOVA has copied the result locally."""
    base.require_token(request)
    STOP_MARKER.parent.mkdir(parents=True, exist_ok=True)
    STOP_MARKER.write_text("NOVA requested runtime stop after result transfer\n", encoding="utf-8")
    return {
        "ok": True,
        "runtime_stop_requested": True,
        "marker": str(STOP_MARKER),
        "note": "Notebook watchdog will call google.colab.runtime.unassign().",
    }


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=7861)
    return p.parse_args()


def main():
    args = parse_args()
    import uvicorn

    uvicorn.run(base.app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
