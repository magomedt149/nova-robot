#!/usr/bin/env python3
"""Regression checks for the fast, no-login NOVA FREE CALL path."""
from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def js_version(source: str) -> str:
    match = re.search(r"const VERSION = '([^']+)';", source)
    assert match, "JavaScript VERSION marker is missing"
    return match.group(1)


def test_call_modules_and_cache_tags_are_synchronized() -> None:
    calls = read("nova-free-calls.js")
    diagnostics = read("nova-call-diagnostics.js")
    index = read("index.html")
    launch_check = read("nova-call-check.html")
    version = json.loads(read("version.json"))

    call_version = js_version(calls)
    diagnostics_version = js_version(diagnostics)
    assert f"nova-free-calls.js?v={call_version}" in index
    assert f"nova-free-calls.js?v={call_version}" in launch_check
    assert f"nova-call-diagnostics.js?v={diagnostics_version}" in index
    assert version["novaFreeInternetCallsModuleVersion"] == call_version
    assert version["novaCallEasyModeVersion"] == diagnostics_version


def test_normal_fallback_is_anonymous_and_meet_jit_is_emergency_only() -> None:
    calls = read("nova-free-calls.js")
    version = json.loads(read("version.json"))

    assert "const TEMP_PUBLIC_FALLBACK_BASE = 'https://jitsi.member.fsf.org/';" in calls
    assert "const MODERATOR_FALLBACK_BASE = 'https://meet.jit.si/';" in calls
    assert "requiresModeratorLogin: true" in calls
    assert "inline: false" in calls
    assert version["novaFreeInternetCallsAnonymousFallbackUrl"] == "https://jitsi.member.fsf.org/"
    assert version["novaFreeInternetCallsEmergencyFallbackRequiresModeratorLogin"] is True


def test_call_startup_does_not_use_false_positive_no_cors_probe() -> None:
    calls = read("nova-free-calls.js")
    diagnostics = read("nova-call-diagnostics.js")
    app = read("app.js")

    assert "mode: 'no-cors'" not in calls
    assert "probeImage" in calls
    assert "const room = await calls.createAndOpen();" in app
    assert "window.setTimeout(runCheck" not in diagnostics


def test_failed_call_has_timeout_events_and_recovery_ui() -> None:
    calls = read("nova-free-calls.js")

    for marker in (
        "CONNECTION_TIMEOUT_MS",
        "handleRoomFailure",
        "showExternalFallback",
        "'errorOccurred'",
        "'participantJoined'",
        "'participantLeft'",
        "'micError'",
        "'videoConferenceLeft'",
        "'readyToClose'",
    ):
        assert marker in calls


def test_service_worker_serves_call_ui_cache_first_and_refreshes_it() -> None:
    worker = read("service-worker.js")

    assert "./nova-free-calls.js', './nova-call-diagnostics.js'" in worker
    assert "sameOrigin && ALWAYS_FRESH_STATIC.test(url.pathname)" in worker
    assert "caches.match(event.request, { ignoreSearch: true })" in worker
    assert "event.waitUntil(network.then(() => undefined, () => undefined))" in worker

