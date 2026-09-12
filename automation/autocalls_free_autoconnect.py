#!/usr/bin/env python3
"""
NOVA Autocalls FREE autoconnect.

Uses an existing GitHub Actions secret if one is already configured for this repo.
Accepted secret env names are resolved by the workflow without exposing their value.

Read-only discovery:
  GET /api/user/assistants/get

Free test only:
  POST /api/conversations  {"assistant_id": <uuid>, "type": "test"}
  POST /api/conversations/{uuid}/messages

This script never calls phone, SMS, WhatsApp, number purchase, campaign-start,
or any other spend endpoint.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE_URL = "https://app.autocalls.ai/api"
STATUS_PATH = Path("autocalls/FREE_CONNECT_STATUS.json")


def request_json(method: str, url: str, *, token: str | None = None, payload: dict | None = None) -> dict:
    headers = {
        "Accept": "application/json",
        "User-Agent": "NOVA-Autocalls-Free-Autoconnect/1.0",
    }
    body = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload).encode("utf-8")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
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


def write_status(data: dict) -> None:
    STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATUS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def extract_assistants(payload: dict) -> list[dict]:
    data = payload.get("data")
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    nested = payload.get("assistants")
    if isinstance(nested, list):
        return [x for x in nested if isinstance(x, dict)]
    return []


def main() -> int:
    token = (os.getenv("AUTOCALLS_API_KEY") or "").strip()
    if not token:
        status = {
            "status": "WAITING_FOR_EXISTING_CREDENTIAL",
            "mode": "FREE_TEST_ONLY",
            "message": "No existing AUTOCALLS API credential was available to this GitHub Actions run.",
            "paid_actions_enabled": False,
        }
        write_status(status)
        print(json.dumps(status, ensure_ascii=False))
        return 0

    status: dict = {
        "status": "DISCOVERING",
        "mode": "FREE_TEST_ONLY",
        "paid_actions_enabled": False,
    }

    try:
        assistants_payload = request_json(
            "GET",
            f"{BASE_URL}/user/assistants/get?per_page=100&page=1",
            token=token,
        )
        assistants = extract_assistants(assistants_payload)
        if not assistants:
            status.update({
                "status": "NO_ASSISTANTS_FOUND",
                "assistant_count": 0,
                "message": "Credential worked, but no Autocalls assistants were found.",
            })
            write_status(status)
            print(json.dumps(status, ensure_ascii=False))
            return 0

        chosen = assistants[0]
        assistant_uuid = str(chosen.get("uuid") or "").strip()
        assistant_id = chosen.get("id")
        assistant_name = chosen.get("name")

        status.update({
            "assistant_count": len(assistants),
            "assistant": {
                "id": assistant_id,
                "uuid": assistant_uuid or None,
                "name": assistant_name,
            },
        })

        if not assistant_uuid:
            status.update({
                "status": "ASSISTANT_UUID_MISSING",
                "message": "Assistant was found, but its public UUID was not returned.",
            })
            write_status(status)
            print(json.dumps(status, ensure_ascii=False))
            return 0

        created = request_json(
            "POST",
            f"{BASE_URL}/conversations",
            payload={"assistant_id": assistant_uuid, "type": "test"},
        )
        conversation_uuid = created.get("conversation_id") or created.get("uuid")
        status["conversation_created"] = bool(conversation_uuid)
        status["conversation_uuid"] = conversation_uuid

        if not conversation_uuid:
            status.update({
                "status": "FREE_TEST_CREATE_FAILED",
                "response": created,
            })
            write_status(status)
            print(json.dumps(status, ensure_ascii=False))
            return 1

        reply = request_json(
            "POST",
            f"{BASE_URL}/conversations/{urllib.parse.quote(str(conversation_uuid))}/messages",
            payload={"message": "Привет! Это бесплатный тест NOVA. Ответь одним коротким предложением."},
        )
        status.update({
            "status": "CONNECTED_FREE_TEST_OK",
            "free_test_reply": reply.get("message"),
            "function_call_count": len(reply.get("function_calls") or []),
            "message": "Autocalls free test connection is working through GitHub Actions.",
        })
        write_status(status)
        print(json.dumps(status, ensure_ascii=False))
        return 0
    except Exception as exc:
        status.update({
            "status": "ERROR",
            "error": str(exc),
        })
        write_status(status)
        print(json.dumps(status, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
