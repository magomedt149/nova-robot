"""Offline regression checks for model files, phone endpoint gates and TLS CLI."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def test_phone_and_model_runtime_without_network():
    subprocess.run(['node', str(ROOT / 'tests/iphone_3d.runtime.cjs')], cwd=ROOT, check=True)


def test_tls_requires_certificate_and_key_together():
    result = subprocess.run([sys.executable, str(ROOT / 'blender-agent/nova_blender_http_gateway.py'),
                             '--tls-cert', 'not-read.pem'], capture_output=True, text=True)
    assert result.returncode == 2
    assert '--tls-cert and --tls-key must be supplied together' in result.stderr


def test_render_is_manual_and_does_not_fake_interpolated_motion():
    workflow = (ROOT / '.github/workflows/tumvexa-wolf-cat-render.yml').read_text()
    assert '\n  push:' not in workflow
    assert 'workflow_dispatch:' in workflow
    assert 'minterpolate' not in workflow
    assert 'frame repetition, no interpolation' in workflow
