#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


class IndexParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: list[str] = []
        self.assets: list[str] = []
        self.scripts: list[str] = []

    def handle_starttag(self, tag: str, attrs):
        values = dict(attrs)
        if values.get("id"):
            self.ids.append(values["id"])
        if tag == "script" and values.get("src"):
            src = values["src"]
            self.assets.append(src)
            self.scripts.append(src)
        if tag == "link" and values.get("href"):
            rel = (values.get("rel") or "").lower()
            if "stylesheet" in rel or "manifest" in rel or "icon" in rel:
                self.assets.append(values["href"])


def local_path(url: str) -> str | None:
    parts = urlsplit(url)
    if parts.scheme or parts.netloc:
        return None
    path = parts.path
    if path.startswith("./"):
        path = path[2:]
    if not path or path.startswith("/"):
        return None
    return path


def fail(message: str) -> None:
    print("ERROR:", message)
    raise SystemExit(1)


def main() -> int:
    index_path = ROOT / "index.html"
    sw_path = ROOT / "service-worker.js"
    version_path = ROOT / "version.json"
    for path in (index_path, sw_path, version_path):
        if not path.exists():
            fail(f"missing critical file: {path.relative_to(ROOT)}")

    index = index_path.read_text(encoding="utf-8")
    parser = IndexParser()
    parser.feed(index)

    duplicates = sorted({item for item in parser.ids if parser.ids.count(item) > 1})
    if duplicates:
        fail("duplicate HTML ids: " + ", ".join(duplicates))

    missing_assets: list[str] = []
    local_assets: list[str] = []
    for raw in parser.assets:
        path = local_path(raw)
        if not path:
            continue
        local_assets.append(path)
        if not (ROOT / path).is_file():
            missing_assets.append(path)
    if missing_assets:
        fail("index references missing assets: " + ", ".join(sorted(set(missing_assets))))

    sw = sw_path.read_text(encoding="utf-8")
    match = re.search(r"const\s+CORE\s*=\s*\[([\s\S]*?)\];", sw)
    if not match:
        fail("service-worker CORE list not found")
    core = set(re.findall(r"['\"]\./([^'\"]+)['\"]", match.group(1)))
    missing_core = sorted(path for path in core if not (ROOT / path).is_file())
    if missing_core:
        fail("service-worker CORE references missing files: " + ", ".join(missing_core))

    required_offline = {
        local_path(src)
        for src in parser.scripts
        if local_path(src)
    } | {"index.html", "styles.css", "version.json"}
    absent_from_core = sorted(path for path in required_offline if path and path not in core)
    if absent_from_core:
        fail("critical index assets absent from service-worker CORE: " + ", ".join(absent_from_core))

    version_data = json.loads(version_path.read_text(encoding="utf-8"))
    version = str(version_data.get("version", "")).strip()
    if not version:
        fail("version.json has no version")
    if version_data.get("pwa") != version:
        fail(f"version.json pwa is not synchronized with version ({version})")
    if version_data.get("healthRuntimeVersion") != version:
        fail(f"version.json healthRuntimeVersion is not synchronized with version ({version})")
    if f"NOVA {version}" not in index:
        fail(f"index title is not synchronized with version.json ({version})")
    if f'<span class="version">v{version}</span>' not in index:
        fail(f"visible version badge is not synchronized with version.json ({version})")
    if f"styles.css?v={version}" not in index:
        fail(f"stylesheet cache marker is not synchronized with version.json ({version})")
    if f"app.js?v={version}" not in index:
        fail(f"app cache marker is not synchronized with version.json ({version})")
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    if f"const VERSION = '{version}';" not in app:
        fail(f"app.js runtime version is not synchronized with version.json ({version})")
    if "versionBadge.textContent = `v${VERSION}`" not in app:
        fail("app.js does not synchronize the visible version badge at runtime")
    health = (ROOT / "nova-health.js").read_text(encoding="utf-8")
    if f"const BUILD = '{version}';" not in health:
        fail(f"nova-health.js build is not synchronized with version.json ({version})")
    if f"const APP_VERSION = '{version}';" not in sw:
        fail(f"service-worker cache version is not synchronized with version.json ({version})")

    script_order = [local_path(src) for src in parser.scripts]
    for required in ("nova-health.js", "nova-auto-montage.js", "app.js"):
        if required not in script_order:
            fail(f"{required} is not loaded by index.html")
    if script_order.index("nova-health.js") > script_order.index("app.js"):
        fail("nova-health.js must load before app.js")
    if script_order.index("nova-auto-montage.js") > script_order.index("app.js"):
        fail("nova-auto-montage.js must load before app.js")

    worker = (ROOT / "automation" / "remote_gpu_worker.py").read_text(encoding="utf-8")
    remote = (ROOT / "motion-studio" / "remote-gpu.js").read_text(encoding="utf-8")
    unified = (ROOT / "nova-unified-video-studio.js").read_text(encoding="utf-8")
    motion_sw = (ROOT / "motion-studio" / "service-worker.js").read_text(encoding="utf-8")
    diagnostics = (ROOT / "motion-studio" / "diagnostics.js").read_text(encoding="utf-8")
    hollywood = (ROOT / "hollywood-studio.js").read_text(encoding="utf-8")

    hybrid_checks = [
        ('WORKER_VERSION = "2.2.0"' in worker, "GPU worker version 2.2.0"),
        ("has_reference: bool = False" in worker, "WanGP single-photo reference routing"),
        ('settings["image_start"] = str(character_reference)' in worker, "single photo becomes WanGP image_start"),
        ('"natural": "Natural living full-body motion' in worker, "natural full-body motion prompt"),
        ('results["hybrid_router"]' in worker, "Hybrid router self-test"),
        ("NOVA_HYBRID_REFERENCE" in remote, "Motion Studio Hybrid bridge receiver"),
        ("mode='natural'" in remote, "natural motion routing"),
        ("Hybrid Photo→Motion ✓" in remote, "Hybrid status in full self-test"),
        ("pushHybridReferenceToMotion" in unified, "Video PRO to Motion Studio photo bridge"),
        ("const MOTION_VERSION = 'v30';" in motion_sw, "Motion Studio v30"),
        ("tumsoev-motion-vfx-studio-v30-hybrid-image-motion" in motion_sw, "Motion Studio v30 Hybrid cache"),
        ("EXPECTED_VERSION='v30'" in diagnostics, "diagnostics expect v30"),
        ("service-worker.js?v=30" in diagnostics, "forced diagnostics update uses v30"),
        ("service-worker.js?v=24" not in diagnostics, "no stale v24 diagnostics worker"),
        ('nova-video-pro.js?v=31.2.0' in hollywood, "fallback Video PRO loader 31.2.0"),
        (version_data.get("hybridAnimate") is True, "Hybrid Animate enabled"),
        (version_data.get("hybridSinglePhotoImageToVideo") is True, "single-photo image-to-video enabled"),
        (version_data.get("hybridZeroCreditRouterSelfTest") is True, "Hybrid zero-credit router self-test enabled"),
        (version_data.get("motionStudioVersion") == "30", "version.json Motion Studio v30"),
        (version_data.get("remoteGpuWorkerVersion") == "2.2.0", "version.json worker 2.2.0"),
        (version_data.get("healthRuntimeVersion") == version, "health runtime matches NOVA version"),
    ]
    failed_hybrid = [label for ok, label in hybrid_checks if not ok]
    if failed_hybrid:
        fail("Hybrid Animate regression: " + "; ".join(failed_hybrid))

    print(f"OK: {len(local_assets)} local index assets")
    print(f"OK: {len(core)} service-worker CORE files")
    print(f"OK: version {version}")
    print("OK: NOVA frontend structural validation passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
