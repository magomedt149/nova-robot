#!/usr/bin/env python3
"""Prepare one deterministic, validated NOVA Short queue for a California date.

An editor-created ``youtube_queue/today.json`` wins when its date matches the
requested date.  If it is stale, the script selects an original entry from the
local template bank.  Nothing is published and no paid service is contacted.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
from datetime import date, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CUSTOM_QUEUE = ROOT / "youtube_queue" / "today.json"
DEFAULT_TEMPLATE_BANK = ROOT / "youtube_queue" / "daily_templates.json"
DEFAULT_OUTPUT = ROOT / "youtube_output" / "prepared_queue.json"
TIMEZONE = "America/Los_Angeles"

VOICE_IDS = {
    "irina": "ru_RU-irina-medium",
    "denis": "ru_RU-denis-medium",
}


class QueueError(ValueError):
    """Raised when a queue cannot safely be rendered or published."""


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise QueueError(f"missing JSON file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise QueueError(f"invalid JSON in {path}: {exc}") from exc


def canonical_fingerprint(queue: dict[str, Any]) -> str:
    content = {
        key: queue.get(key)
        for key in (
            "title",
            "description",
            "hashtags",
            "tags",
            "category_id",
            "narrator",
            "first_frame",
            "scenes",
        )
    }
    raw = json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _require_text(value: Any, field: str, maximum: int) -> str:
    text = str(value or "").strip()
    if not text:
        raise QueueError(f"{field} must not be empty")
    if len(text) > maximum:
        raise QueueError(f"{field} is longer than {maximum} characters")
    return text


def validate_queue(queue: dict[str, Any], expected_date: str | None = None) -> None:
    if not isinstance(queue, dict):
        raise QueueError("queue root must be a JSON object")

    queue_date = _require_text(queue.get("date"), "date", 10)
    try:
        date.fromisoformat(queue_date)
    except ValueError as exc:
        raise QueueError("date must use YYYY-MM-DD") from exc
    if expected_date and queue_date != expected_date:
        raise QueueError(f"queue date {queue_date} does not match {expected_date}")

    _require_text(queue.get("title"), "title", 100)
    _require_text(queue.get("description"), "description", 599)
    _require_text(queue.get("first_frame"), "first_frame", 80)

    hashtags = queue.get("hashtags")
    if not isinstance(hashtags, list) or len(hashtags) != 5:
        raise QueueError("hashtags must contain exactly 5 items")
    if any(not isinstance(tag, str) or not tag.startswith("#") for tag in hashtags):
        raise QueueError("every hashtag must be text beginning with #")

    tags = queue.get("tags")
    if not isinstance(tags, list) or not tags or any(not str(tag).strip() for tag in tags):
        raise QueueError("tags must be a non-empty list")
    if len(",".join(str(tag) for tag in tags)) > 450:
        raise QueueError("combined tags are too long")

    narrator = str(queue.get("narrator", "irina")).strip().lower()
    if narrator not in VOICE_IDS:
        raise QueueError(f"unsupported narrator: {narrator}")

    try:
        score = int(queue.get("pre_publish_score", 0))
    except (TypeError, ValueError) as exc:
        raise QueueError("pre_publish_score must be an integer") from exc
    if not 70 <= score <= 100:
        raise QueueError("pre_publish_score must be between 70 and 100")

    privacy = str(queue.get("privacy_status", "private")).lower()
    if privacy not in {"private", "unlisted", "public"}:
        raise QueueError("privacy_status must be private, unlisted, or public")

    scenes = queue.get("scenes")
    if not isinstance(scenes, list) or not 5 <= len(scenes) <= 7:
        raise QueueError("scenes must contain 5 to 7 items")
    for index, scene in enumerate(scenes, 1):
        if not isinstance(scene, dict):
            raise QueueError(f"scene {index} must be an object")
        _require_text(scene.get("headline"), f"scene {index} headline", 80)
        _require_text(scene.get("caption"), f"scene {index} caption", 220)
        _require_text(scene.get("narration"), f"scene {index} narration", 500)

    source_urls = queue.get("source_urls", [])
    if not isinstance(source_urls, list):
        raise QueueError("source_urls must be a list")


def _template_for_date(bank: dict[str, Any], target_date: str) -> dict[str, Any]:
    templates = bank.get("templates") if isinstance(bank, dict) else None
    if not isinstance(templates, list) or not templates:
        raise QueueError("daily template bank has no templates")

    ids = [str(item.get("id", "")) for item in templates if isinstance(item, dict)]
    if len(ids) != len(templates) or any(not item for item in ids):
        raise QueueError("every daily template needs an id")
    if len(set(ids)) != len(ids):
        raise QueueError("daily template ids must be unique")

    digest = hashlib.sha256(target_date.encode("ascii")).digest()
    index = int.from_bytes(digest[:8], "big") % len(templates)
    return copy.deepcopy(templates[index])


def prepare_queue(
    target_date: str,
    custom_path: Path = DEFAULT_CUSTOM_QUEUE,
    bank_path: Path = DEFAULT_TEMPLATE_BANK,
    force_custom: bool = False,
) -> tuple[dict[str, Any], str]:
    try:
        date.fromisoformat(target_date)
    except ValueError as exc:
        raise QueueError("target date must use YYYY-MM-DD") from exc

    custom = read_json(custom_path)
    if force_custom and not isinstance(custom, dict):
        raise QueueError("forced custom queue must be a JSON object")
    custom_matches = isinstance(custom, dict) and str(custom.get("date", "")) == target_date
    if custom_matches or force_custom:
        queue = copy.deepcopy(custom)
        queue["date"] = target_date
        source = "custom" if custom_matches else "forced-custom"
        content_id = str(queue.get("content_id") or "").strip()
    else:
        queue = _template_for_date(read_json(bank_path), target_date)
        template_id = str(queue.pop("id"))
        queue["date"] = target_date
        source = "automatic-template"
        content_id = template_id

    queue["narrator"] = str(queue.get("narrator", "irina")).strip().lower()
    voice_id = VOICE_IDS.get(queue["narrator"])
    if not voice_id:
        raise QueueError(f"unsupported narrator: {queue['narrator']}")
    queue["voice_id"] = voice_id
    queue["content_fingerprint"] = canonical_fingerprint(queue)
    queue["content_id"] = content_id or f"custom-{queue['content_fingerprint'][:12]}"
    queue["automation"] = {
        "source": source,
        "timezone": TIMEZONE,
        "deterministic": True,
    }
    validate_queue(queue, expected_date=target_date)
    return queue, source


def california_today() -> str:
    return datetime.now(ZoneInfo(TIMEZONE)).date().isoformat()


def write_github_outputs(path: str | None, values: dict[str, str]) -> None:
    if not path:
        return
    with Path(path).open("a", encoding="utf-8") as handle:
        for key, value in values.items():
            handle.write(f"{key}={value}\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=california_today())
    parser.add_argument("--custom", type=Path, default=DEFAULT_CUSTOM_QUEUE)
    parser.add_argument("--bank", type=Path, default=DEFAULT_TEMPLATE_BANK)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--force-custom", action="store_true")
    parser.add_argument("--github-output", default=os.environ.get("GITHUB_OUTPUT"))
    args = parser.parse_args()

    queue, source = prepare_queue(args.date, args.custom, args.bank, args.force_custom)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(queue, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    values = {
        "ready": "true",
        "queue_path": args.output.as_posix(),
        "queue_date": queue["date"],
        "queue_source": source,
        "content_id": queue["content_id"],
        "voice_id": queue["voice_id"],
    }
    write_github_outputs(args.github_output, values)
    for key, value in values.items():
        print(f"{key.upper()}={value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
