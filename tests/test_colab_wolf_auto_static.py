#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FREE = (ROOT / "nova-free-runtime.js").read_text(encoding="utf-8")
CLIENT = (ROOT / "motion-studio" / "colab-wolf-auto.js").read_text(encoding="utf-8")
SW = (ROOT / "motion-studio" / "service-worker.js").read_text(encoding="utf-8")
WORKER = (ROOT / "automation" / "remote_gpu_worker_colab_auto.py").read_text(encoding="utf-8")
RENDER = (ROOT / "blender-colab" / "scripts" / "render_wolf_cinema_auto.py").read_text(encoding="utf-8")
NOTEBOOK = (ROOT / "blender-colab" / "NOVA_Wolf_Auto_Worker.ipynb").read_text(encoding="utf-8")


def test_voice_command_routes_to_wolf_motion_studio():
    assert "WOLF_COLAB_COMMAND" in FREE
    assert "Нова, включи Colab" in FREE
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


def test_dedicated_worker_is_free_blender_only():
    assert "remote_gpu_worker_colab_auto.py" in NOTEBOOK
    assert "render_wolf_cinema_auto.py" in NOTEBOOK
    assert "WanGP" in NOTEBOOK  # documentation explicitly says it is not used
    assert "без WanGP" in NOTEBOOK
    assert "google.colab import runtime" in NOTEBOOK
    assert "runtime.unassign()" in NOTEBOOK


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
    assert "paid_api\": False" in RENDER


if __name__ == "__main__":
    for name, value in sorted(globals().copy().items()):
        if name.startswith("test_") and callable(value):
            value()
    print("OK: NOVA Colab wolf auto static checks passed")
