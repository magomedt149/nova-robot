#!/usr/bin/env python3
"""Fast stdlib regression checks for NOVA Hybrid Animate wiring.

This test intentionally does not import FastAPI/WanGP. It validates that the
GitHub source tree keeps the single-photo Hybrid path wired end-to-end.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def must(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print("PASS", message)


def main() -> None:
    worker = read("automation/remote_gpu_worker.py")
    remote = read("motion-studio/remote-gpu.js")
    unified = read("nova-unified-video-studio.js")
    motion_sw = read("motion-studio/service-worker.js")
    diagnostics = read("motion-studio/diagnostics.js")
    index = read("index.html")
    hollywood = read("hollywood-studio.js")
    version = json.loads(read("version.json"))

    must('WORKER_VERSION = "2.3.0"' in worker, "GPU worker is 2.3.0")
    must("has_reference: bool = False" in worker, "WanGP router accepts single-photo references")
    must('settings["image_start"] = str(character_reference)' in worker, "single photo becomes WanGP image_start")
    must('"natural": "Natural living full-body motion' in worker, "natural full-body motion prompt exists")
    must('"hybrid_image_to_video": True' in worker, "worker exposes Hybrid image-to-video capability")
    must('results["hybrid_router"]' in worker, "worker self-test covers Hybrid router")

    must("NOVA_HYBRID_REFERENCE" in remote, "Motion Studio accepts Hybrid photo bridge")
    must("mode='natural'" in remote, "Motion Studio detects natural motion")
    must("Hybrid Photo→Motion ✓" in remote, "full self-test reports Hybrid status")
    must("pushHybridReferenceToMotion" in unified, "Video PRO auto-bridges photo into Motion Studio")

    must("const MOTION_VERSION = 'v30';" in motion_sw, "Motion Studio service worker is v30")
    must("tumsoev-motion-vfx-studio-v30-hybrid-image-motion" in motion_sw, "Hybrid cache name is v30")
    must("EXPECTED_VERSION='v30'" in diagnostics, "diagnostics expect Motion Studio v30")
    must("service-worker.js?v=30" in diagnostics, "forced diagnostics update registers v30 worker")
    must("service-worker.js?v=24" not in diagnostics, "no stale v24 forced worker registration remains")

    must('nova-video-pro.js?v=31.2.0' in index, "main page loads Video PRO 31.2.0")
    must('nova-unified-video-studio.js?v=1.3.0' in index, "main page loads Hybrid bridge 1.3.0")
    must('nova-video-pro.js?v=31.2.0' in hollywood, "fallback loader matches Video PRO 31.2.0")

    current_version = str(version.get("version", ""))
    must(bool(current_version), "NOVA version is present")
    must(version.get("hybridAnimate") is True, "Hybrid Animate is enabled")
    must(version.get("hybridSinglePhotoImageToVideo") is True, "single-photo image-to-video flag is enabled")
    must(version.get("hybridZeroCreditRouterSelfTest") is True, "zero-credit Hybrid router self-test is enabled")
    must(version.get("motionStudioVersion") == "30", "version.json Motion Studio is v30")
    must(version.get("remoteGpuWorkerVersion") == "2.3.0", "version.json worker is 2.3.0")
    must(version.get("healthRuntimeVersion") == current_version, "health runtime version matches NOVA")

    print("OK: NOVA Hybrid Animate GitHub regression checks passed")


if __name__ == "__main__":
    main()
