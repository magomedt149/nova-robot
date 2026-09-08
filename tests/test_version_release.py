#!/usr/bin/env python3
"""Regression tests for atomic NOVA version updates."""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from automation.bump_nova_version import VersionError, collect_updates, validate_consistency


def write_fixture(root: Path, version: str = "1.2.3") -> None:
    (root / "version.json").write_text(
        json.dumps(
            {
                "version": version,
                "pwa": version,
                "healthRuntimeVersion": version,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    (root / "index.html").write_text(
        f'<title>NOVA {version}</title>\n'
        f'<span class="version">v{version}</span>\n'
        f'<link href="styles.css?v={version}">\n'
        f'<script src="app.js?v={version}-release"></script>\n',
        encoding="utf-8",
    )
    (root / "app.js").write_text(f"const VERSION = '{version}';\n", encoding="utf-8")
    (root / "nova-health.js").write_text(f"const BUILD = '{version}';\n", encoding="utf-8")
    (root / "service-worker.js").write_text(
        f"const APP_VERSION = '{version}';\nconst CACHE = `nova-v${{APP_VERSION}}`;\n",
        encoding="utf-8",
    )


def test_current_repository_release_markers_are_consistent() -> None:
    expected = json.loads((ROOT / "version.json").read_text(encoding="utf-8"))["version"]
    assert validate_consistency(ROOT) == expected


def test_release_update_changes_every_marker_together() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        write_fixture(root)
        updates = collect_updates(root, "1.2.4")
        assert set(updates) == {
            "version.json",
            "index.html",
            "app.js",
            "nova-health.js",
            "service-worker.js",
        }
        for relative, content in updates.items():
            (root / relative).write_text(content, encoding="utf-8")
        assert validate_consistency(root) == "1.2.4"


def test_release_update_rejects_an_inconsistent_source() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        write_fixture(root)
        (root / "app.js").write_text("const VERSION = '9.9.9';\n", encoding="utf-8")
        try:
            collect_updates(root, "1.2.4")
        except VersionError:
            return
        raise AssertionError("inconsistent source must block a release update")
