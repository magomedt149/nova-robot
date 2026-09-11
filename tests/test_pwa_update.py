#!/usr/bin/env python3
"""Regression coverage for automatic PWA release pickup."""
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "app.js").read_text(encoding="utf-8")
WORKER = (ROOT / "service-worker.js").read_text(encoding="utf-8")


def test_auto_update_accepts_semantic_versions() -> None:
    assert r"/^\d+\.\d+\.\d+$/" in APP
    assert r"/^\\d+\\.\\d+\\.\\d+$/" not in APP


def test_github_pages_worker_url_changes_with_every_release() -> None:
    assert "service-worker.js?nova_release=${encodeURIComponent(VERSION)}" in APP
    assert "navigator.serviceWorker.register(workerUrl, { updateViaCache: 'none' })" in APP


def test_worker_precache_bypasses_stale_release_assets() -> None:
    assert "nova_release=${encodeURIComponent(APP_VERSION)}" in WORKER
    assert "cache: 'reload'" in WORKER
    assert "event.request.mode === 'navigate' ? { cache: 'no-store' }" in WORKER


def test_netlify_hostname_regex_is_not_double_escaped() -> None:
    assert APP.count(r"/(^|\.)netlify\.app$/i") >= 2
    assert r"/(^|\\.)netlify\\.app$/i" not in APP
