#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "prepare_daily_queue",
    ROOT / "youtube" / "prepare_daily_queue.py",
)
queue_tools = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(queue_tools)


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def sample_custom(target_date: str) -> dict:
    return {
        "date": target_date,
        "title": "Тестовый оригинальный Short",
        "description": "Тестовое описание собственного ролика NOVA.",
        "hashtags": ["#NOVA", "#Test", "#Video", "#Tumsoev", "#Shorts"],
        "tags": ["NOVA", "test", "video"],
        "category_id": "28",
        "privacy_status": "private",
        "pre_publish_score": 80,
        "narrator": "irina",
        "first_frame": "ТЕСТ NOVA ГОТОВ",
        "source_urls": [],
        "scenes": [
            {"headline": f"СЦЕНА {number}", "caption": "Тестовая подпись.", "narration": "Тестовая русская фраза для проверки."}
            for number in range(1, 6)
        ],
    }


def test_current_custom_queue_wins():
    with TemporaryDirectory() as raw:
        folder = Path(raw)
        custom = sample_custom("2026-09-07")
        write_json(folder / "today.json", custom)
        write_json(folder / "bank.json", {"templates": []})
        queue, source = queue_tools.prepare_queue(
            "2026-09-07", folder / "today.json", folder / "bank.json"
        )
        assert source == "custom"
        assert queue["title"] == custom["title"]
        assert queue["voice_id"] == "ru_RU-irina-medium"
        assert queue["content_id"].startswith("custom-")


def test_stale_custom_queue_uses_deterministic_bank():
    with TemporaryDirectory() as raw:
        folder = Path(raw)
        stale = sample_custom("2026-09-05")
        write_json(folder / "today.json", stale)
        bank = json.loads((ROOT / "youtube_queue" / "daily_templates.json").read_text(encoding="utf-8"))
        write_json(folder / "bank.json", bank)
        first, first_source = queue_tools.prepare_queue(
            "2026-09-07", folder / "today.json", folder / "bank.json"
        )
        second, second_source = queue_tools.prepare_queue(
            "2026-09-07", folder / "today.json", folder / "bank.json"
        )
        assert first_source == second_source == "automatic-template"
        assert first == second
        assert first["date"] == "2026-09-07"
        assert first["content_id"]
        assert first["content_fingerprint"] == queue_tools.canonical_fingerprint(first)


def test_every_template_passes_quality_gate():
    bank = json.loads((ROOT / "youtube_queue" / "daily_templates.json").read_text(encoding="utf-8"))
    seen = set()
    for template in bank["templates"]:
        queue = copy.deepcopy(template)
        content_id = queue.pop("id")
        assert content_id not in seen
        seen.add(content_id)
        queue["date"] = "2026-09-07"
        queue["voice_id"] = queue_tools.VOICE_IDS[queue["narrator"]]
        queue["content_id"] = content_id
        queue["content_fingerprint"] = queue_tools.canonical_fingerprint(queue)
        queue_tools.validate_queue(queue, expected_date="2026-09-07")
    assert len(seen) >= 7


def test_content_fingerprint_ignores_only_schedule_date():
    first = sample_custom("2026-09-07")
    second = copy.deepcopy(first)
    second["date"] = "2026-09-08"
    assert queue_tools.canonical_fingerprint(first) == queue_tools.canonical_fingerprint(second)


def test_unsupported_narrator_is_blocked():
    with TemporaryDirectory() as raw:
        folder = Path(raw)
        custom = sample_custom("2026-09-07")
        custom["narrator"] = "unknown"
        write_json(folder / "today.json", custom)
        write_json(folder / "bank.json", {"templates": []})
        try:
            queue_tools.prepare_queue("2026-09-07", folder / "today.json", folder / "bank.json")
        except queue_tools.QueueError as exc:
            assert "unsupported narrator" in str(exc)
        else:
            raise AssertionError("unsupported narrator was accepted")


if __name__ == "__main__":
    for name, value in sorted(globals().items()):
        if name.startswith("test_") and callable(value):
            value()
            print("PASS", name)
