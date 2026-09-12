#!/usr/bin/env python3
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FREE_PATH = ROOT / "nova-free-runtime.js"
CLIENT_PATH = ROOT / "motion-studio" / "colab-wolf-auto.js"
SW_PATH = ROOT / "motion-studio" / "service-worker.js"
WORKER_PATH = ROOT / "automation" / "remote_gpu_worker_colab_auto.py"
RENDER_PATH = ROOT / "blender-colab" / "scripts" / "render_wolf_cinema_auto.py"
NOTEBOOK_PATH = ROOT / "blender-colab" / "NOVA_Wolf_Auto_Worker.ipynb"

FREE = FREE_PATH.read_text(encoding="utf-8")
CLIENT = CLIENT_PATH.read_text(encoding="utf-8")
SW = SW_PATH.read_text(encoding="utf-8")
WORKER = WORKER_PATH.read_text(encoding="utf-8")
RENDER = RENDER_PATH.read_text(encoding="utf-8")
NOTEBOOK = NOTEBOOK_PATH.read_text(encoding="utf-8")


def test_voice_command_routes_to_wolf_motion_studio():
    assert "WOLF_COLAB_COMMAND" in FREE
    assert "(?:включи|запусти|открой)" in FREE
    assert "(?:colab|колаб|коллаб)" in FREE
    assert "nova.colab.wolf.voiceApprovedAt" in FREE
    assert "target.searchParams.set('wolf', '1')" in FREE


def test_free_lock_preserves_only_approved_active_remote_job():
    assert "approvedRemoteFlow" in FREE
    assert "nova.remoteGpu.fullAuto', '0'" in FREE
    assert "storage.setItem('nova.remoteGpu.autoRecover', '1')" in FREE


def test_motion_client_uses_dedicated_free_notebook_and_blender():
    assert "NOVA_Wolf_Auto_Worker.ipynb" in CLIENT
    assert "remoteEngine" in CLIENT and "'blender'" in CLIENT
    assert "remoteQuality" in CLIENT and "'final'" in CLIENT
    assert "WOLF_PROMPT" in CLIENT
    assert "[NOVA_WOLF_AUTO_V1]" in CLIENT


def test_result_is_localized_before_runtime_shutdown():
    localize = CLIENT.index("const blob = await response.blob()")
    shutdown = CLIENT.index("await requestRuntimeStop()")
    assert localize < shutdown
    assert "URL.createObjectURL(blob)" in CLIENT
    assert "Runtime оставляю включённым" in CLIENT


def test_service_worker_loads_colab_auto_client():
    assert "/motion-studio/colab-wolf-auto.js" in SW
    assert "injectColabWolfAuto" in SW


def test_dedicated_notebook_is_valid_direct_and_has_no_wangp_install():
    data = json.loads(NOTEBOOK)
    assert data.get("nbformat") == 4
    assert data.get("cells")
    assert "remote_gpu_worker_colab_auto.py" in NOTEBOOK
    assert "render_wolf_cinema_auto.py" in NOTEBOOK
    assert "Blender 5.2.1" in NOTEBOOK
    assert "download.blender.org/release/Blender5.2" in NOTEBOOK
    assert "Wan2GP-on-Colab" not in NOTEBOOK
    assert "NOVA_WANGP_ROOT" not in NOTEBOOK
    assert "shared/api.py" not in NOTEBOOK
    assert "google.colab import runtime" in NOTEBOOK
    assert "runtime.unassign()" in NOTEBOOK
    assert "Не зависит от GitHub Actions workflow" in NOTEBOOK


def test_worker_routes_exact_marker_and_exposes_shutdown():
    assert "[NOVA_WOLF_AUTO_V1]" in WORKER
    assert '@base.app.post("/runtime/shutdown")' in WORKER
    assert "STOP_MARKER.write_text" in WORKER
    assert "ORIGINAL_RUN_BLENDER_JOB" in WORKER


def test_wolf_render_target_is_10s_24fps_true_orbit():
    assert "default=10.0" in RENDER
    assert "default=24" in RENDER
    assert "math.tau" in RENDER
    assert "frames + 1" in RENDER
    assert "DAMPED_TRACK" in RENDER
    assert '"paid_api": False' in RENDER


def test_new_javascript_parses_when_node_is_available():
    node = shutil.which("node")
    if not node:
        return
    for path in (FREE_PATH, CLIENT_PATH, SW_PATH):
        subprocess.run([node, "--check", str(path)], check=True, capture_output=True, text=True)


if __name__ == "__main__":
    for name, value in sorted(globals().copy().items()):
        if name.startswith("test_") and callable(value):
            value()
    print("OK: NOVA Colab wolf auto static checks passed")
