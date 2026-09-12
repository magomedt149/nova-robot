#!/usr/bin/env python3
"""Update every NOVA release marker as one validated local transaction.

Use this tool before creating a release commit instead of editing version files
one at a time. If validation fails, every edited file is restored.

The service-worker cache revision may be one patch ahead of the app version for
cache-only hotfixes (for example app 27.28.0 with worker 27.28.1). Full NOVA
version bumps still synchronize every release marker in one transaction.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
VERSION_PATHS = (
    "version.json",
    "index.html",
    "app.js",
    "nova-health.js",
    "service-worker.js",
)


class VersionError(RuntimeError):
    """Raised when release markers are missing or inconsistent."""


def read_text(root: Path, relative: str) -> str:
    path = root / relative
    if not path.is_file():
        raise VersionError(f"missing release file: {relative}")
    return path.read_text(encoding="utf-8")


def load_version_data(root: Path) -> dict:
    try:
        return json.loads(read_text(root, "version.json"))
    except json.JSONDecodeError as exc:
        raise VersionError(f"invalid version.json: {exc}") from exc


def require_marker(text: str, marker: str, label: str) -> None:
    if marker not in text:
        raise VersionError(f"{label} is not synchronized: expected {marker!r}")


def semver_tuple(value: str) -> tuple[int, int, int]:
    match = SEMVER.fullmatch(value.strip())
    if not match:
        raise VersionError(f"invalid semantic version x.y.z: {value!r}")
    return tuple(int(part) for part in match.groups())


def service_worker_version(root: Path) -> str:
    worker = read_text(root, "service-worker.js")
    match = re.search(r"const\s+APP_VERSION\s*=\s*['\"]([^'\"]+)['\"]", worker)
    if not match:
        raise VersionError("service-worker APP_VERSION marker is missing")
    version = match.group(1).strip()
    semver_tuple(version)
    return version


def validate_consistency(root: Path) -> str:
    data = load_version_data(root)
    version = str(data.get("version", "")).strip()
    app_semver = semver_tuple(version)
    for field in ("pwa", "healthRuntimeVersion"):
        if str(data.get(field, "")).strip() != version:
            raise VersionError(f"version.json.{field} does not match {version}")

    index = read_text(root, "index.html")
    require_marker(index, f"<title>NOVA {version}", "index title")
    require_marker(index, f'<span class="version">v{version}</span>', "visible version badge")
    require_marker(index, f"styles.css?v={version}", "stylesheet cache marker")
    require_marker(index, f"app.js?v={version}", "app cache marker")
    require_marker(read_text(root, "app.js"), f"const VERSION = '{version}';", "app runtime")
    require_marker(read_text(root, "nova-health.js"), f"const BUILD = '{version}';", "health runtime")

    sw_version = service_worker_version(root)
    sw_semver = semver_tuple(sw_version)
    if sw_semver[:2] != app_semver[:2] or sw_semver[2] < app_semver[2]:
        raise VersionError(
            "service-worker cache version is stale or incompatible: "
            f"app={version}, service-worker={sw_version}"
        )
    return version


def replace_exact(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise VersionError(f"{label}: expected one {old!r} marker, found {count}")
    return text.replace(old, new, 1)


def collect_updates(root: Path, new_version: str) -> dict[str, str]:
    if not SEMVER.fullmatch(new_version):
        raise VersionError(f"new version must use x.y.z format: {new_version!r}")
    old_version = validate_consistency(root)
    if new_version == old_version:
        raise VersionError(f"NOVA is already {new_version}")

    data = load_version_data(root)
    for field in ("version", "pwa", "healthRuntimeVersion"):
        data[field] = new_version

    index = read_text(root, "index.html")
    old_count = index.count(old_version)
    if old_count < 4:
        raise VersionError(
            f"index.html: expected at least four {old_version!r} release markers, found {old_count}"
        )
    index = index.replace(old_version, new_version)

    app = replace_exact(
        read_text(root, "app.js"),
        f"const VERSION = '{old_version}';",
        f"const VERSION = '{new_version}';",
        "app.js",
    )
    health = replace_exact(
        read_text(root, "nova-health.js"),
        f"const BUILD = '{old_version}';",
        f"const BUILD = '{new_version}';",
        "nova-health.js",
    )
    old_sw_version = service_worker_version(root)
    worker = replace_exact(
        read_text(root, "service-worker.js"),
        f"const APP_VERSION = '{old_sw_version}';",
        f"const APP_VERSION = '{new_version}';",
        "service-worker.js",
    )

    return {
        "version.json": json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        "index.html": index,
        "app.js": app,
        "nova-health.js": health,
        "service-worker.js": worker,
    }


def apply_transaction(root: Path, updates: dict[str, str]) -> None:
    originals = {relative: read_text(root, relative) for relative in updates}
    try:
        for relative, content in updates.items():
            (root / relative).write_text(content, encoding="utf-8")
        subprocess.run(
            [sys.executable, "automation/validate_frontend.py"],
            cwd=root,
            check=True,
        )
        subprocess.run(
            [sys.executable, "tests/run_static_tests.py"],
            cwd=root,
            check=True,
        )
    except BaseException:
        for relative, content in originals.items():
            (root / relative).write_text(content, encoding="utf-8")
        raise


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Synchronize all NOVA version markers and validate before commit."
    )
    parser.add_argument("version", nargs="?", help="new semantic version, for example 27.29.0")
    parser.add_argument(
        "--check",
        action="store_true",
        help="check current release markers without changing files",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="verify that the requested update is possible without writing files",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.check:
            if args.version:
                raise VersionError("do not provide a version together with --check")
            version = validate_consistency(ROOT)
            print(f"OK: NOVA release markers are compatible with app version {version}")
            return 0
        if not args.version:
            raise VersionError("provide a new version or use --check")
        updates = collect_updates(ROOT, args.version)
        if args.dry_run:
            print("OK: version update is ready for one atomic commit")
            print("Files: " + ", ".join(updates))
            return 0
        apply_transaction(ROOT, updates)
        print(f"OK: NOVA {args.version} synchronized and validated")
        print("Commit all listed files together; never publish a partial version bump.")
        print("Files: " + ", ".join(updates))
        return 0
    except (VersionError, subprocess.CalledProcessError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
