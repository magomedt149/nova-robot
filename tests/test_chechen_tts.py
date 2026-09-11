from pathlib import Path
import json


ROOT = Path(__file__).resolve().parents[1]


def read(name: str) -> str:
    return (ROOT / name).read_text(encoding="utf-8")


def test_ramzan_frontend_is_wired_and_free():
    module = read("nova-chechen-tts.js")
    assert "facebook/mms-tts-che" in module
    assert "Рамзан — чеченский" in module
    assert "nova.remoteGpu.url" in module
    assert "nova.remoteGpu.token" in module
    assert "X-NOVA-Token" in module
    assert "/tts/chechen" in module
    assert "paidApi: false" in module
    assert "nova-chechen-tts.js?v=1.1.0" in read("index.html")
    assert "'./nova-chechen-tts.js'" in read("service-worker.js")


def test_ramzan_voice_selector_is_registered():
    voices = read("neural-russian-tts.js")
    assert "nova:ramzan" in voices
    assert "speakRamzan" in voices
    assert "Meta MMS (FREE Worker)" in voices


def test_experimental_song_mode_is_truthfully_labeled():
    module = read("nova-chechen-tts.js")
    worker = read("automation/remote_gpu_worker.py")
    assert "/tts/chechen-song" in module
    assert "Это не клон певца" in module or "это не клон певца" in module
    assert "singRamzan" in module
    assert '@app.post("/tts/chechen-song")' in worker
    assert "experimental rhythmic/melodic TTS preview, not a cloned singer" in worker
    assert "rubberband=tempo=" in worker
    assert '"Am,D,G,Em"' in worker


def test_worker_has_protected_chechen_tts_endpoint():
    worker = read("automation/remote_gpu_worker.py")
    route = worker.index('@app.post("/tts/chechen")')
    body = worker[route:route + 1800]
    assert "require_token(request)" in body
    assert "CHECHEN_TTS_MAX_CHARS" in body
    assert "asyncio.to_thread(synthesize_chechen_tts, text)" in body
    assert "BackgroundTask(output.unlink, missing_ok=True)" in body
    assert 'CHECHEN_TTS_MODEL_ID = "facebook/mms-tts-che"' in worker


def test_free_worker_installers_include_tts_dependencies():
    for name in (
        "automation/install_permanent_gpu_worker.sh",
        "automation/install_permanent_gpu_worker.ps1",
        "blender-colab/NOVA_Remote_GPU_Worker.ipynb",
    ):
        text = read(name)
        assert "torch" in text
        assert "transformers" in text
        assert "scipy" in text


def test_version_manifest_declares_ramzan_truthfully():
    data = json.loads(read("version.json"))
    assert data["chechenTts"] is True
    assert data["chechenTtsVoice"] == "ramzan"
    assert data["chechenTtsPaidApi"] is False
    assert data["chechenTtsWorkerRequired"] is True
    assert data["remoteGpuWorkerVersion"] == "2.3.0"
    assert data["remoteGpuProtocolVersion"] == 9
    assert data["chechenTtsSongTest"] is True
    assert "not singer cloning" in data["chechenTtsSongMode"]
