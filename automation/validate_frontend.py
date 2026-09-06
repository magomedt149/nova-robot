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

    version = str(json.loads(version_path.read_text(encoding="utf-8")).get("version", "")).strip()
    if not version:
        fail("version.json has no version")
    if f"NOVA {version}" not in index or f">v{version}<" not in index:
        fail(f"index visible version is not synchronized with version.json ({version})")

    script_order = [local_path(src) for src in parser.scripts]
    for required in ("nova-health.js", "nova-auto-montage.js", "app.js"):
        if required not in script_order:
            fail(f"{required} is not loaded by index.html")
    if script_order.index("nova-health.js") > script_order.index("app.js"):
        fail("nova-health.js must load before app.js")
    if script_order.index("nova-auto-montage.js") > script_order.index("app.js"):
        fail("nova-auto-montage.js must load before app.js")

    print(f"OK: {len(local_assets)} local index assets")
    print(f"OK: {len(core)} service-worker CORE files")
    print(f"OK: version {version}")
    print("OK: NOVA frontend structural validation passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
