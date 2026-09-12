#!/usr/bin/env python3
"""
NOVA -> Autocalls FREE test bridge.

Uses only the documented Autocalls test-conversation endpoints:
  POST https://app.autocalls.ai/api/conversations
  POST https://app.autocalls.ai/api/conversations/{uuid}/messages

The conversation is always created with type="test".
This script intentionally contains no phone-call, SMS, WhatsApp, number-purchase,
or other paid/spend endpoints.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request

BASE_URL = "https://app.autocalls.ai/api"


def post_json(url: str, payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "NOVA-Autocalls-Free-Test/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(raw)
        except Exception:
            detail = {"raw": raw}
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Network error: {exc}") from exc


def start_test_conversation(assistant_uuid: str) -> dict:
    return post_json(
        f"{BASE_URL}/conversations",
        {
            "assistant_id": assistant_uuid,
            "type": "test",
        },
    )


def send_test_message(conversation_uuid: str, message: str) -> dict:
    return post_json(
        f"{BASE_URL}/conversations/{conversation_uuid}/messages",
        {"message": message},
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Free Autocalls test bridge for NOVA")
    parser.add_argument("--assistant-uuid", required=True, help="Autocalls assistant UUID")
    parser.add_argument("--message", default="", help="Optional free test message")
    args = parser.parse_args()

    assistant_uuid = args.assistant_uuid.strip()
    if not assistant_uuid:
        print("assistant UUID is required", file=sys.stderr)
        return 2

    result = {
        "mode": "FREE_TEST_ONLY",
        "assistant_uuid": assistant_uuid,
    }

    try:
        created = start_test_conversation(assistant_uuid)
        result["conversation"] = created

        conversation_uuid = created.get("conversation_id") or created.get("uuid")
        if args.message.strip() and conversation_uuid:
            result["reply"] = send_test_message(conversation_uuid, args.message.strip())

        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        result["error"] = str(exc)
        print(json.dumps(result, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
