#!/usr/bin/env python3
import json
import os
from pathlib import Path

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

ROOT = Path(__file__).resolve().parents[1]
META_PATH = ROOT / "youtube_output" / "metadata.json"
VIDEO_PATH = ROOT / "youtube_output" / "short.mp4"
RESULT_PATH = ROOT / "youtube_output" / "youtube_upload_result.json"

CLIENT_ID = os.environ["YOUTUBE_CLIENT_ID"]
CLIENT_SECRET = os.environ["YOUTUBE_CLIENT_SECRET"]
REFRESH_TOKEN = os.environ["YOUTUBE_REFRESH_TOKEN"]

meta = json.loads(META_PATH.read_text(encoding="utf-8"))
description = meta.get("description", "").strip()
hashtags = " ".join(meta.get("hashtags", []))
if hashtags:
    description = (description + "\n\n" + hashtags).strip()

requested_privacy = os.environ.get(
    "YOUTUBE_PRIVACY_STATUS",
    meta.get("privacy_status", "private"),
).strip().lower()
if requested_privacy not in {"private", "unlisted", "public"}:
    requested_privacy = "private"

credentials = Credentials(
    token=None,
    refresh_token=REFRESH_TOKEN,
    token_uri="https://oauth2.googleapis.com/token",
    client_id=CLIENT_ID,
    client_secret=CLIENT_SECRET,
    scopes=["https://www.googleapis.com/auth/youtube.upload"],
)

youtube = build("youtube", "v3", credentials=credentials, cache_discovery=False)

body = {
    "snippet": {
        "title": meta["title"][:100],
        "description": description[:5000],
        "categoryId": str(meta.get("category_id", "27")),
        "tags": meta.get("tags", [])[:30],
        "defaultLanguage": "ru",
    },
    "status": {
        "privacyStatus": requested_privacy,
        "selfDeclaredMadeForKids": False,
    },
}

media = MediaFileUpload(
    str(VIDEO_PATH),
    mimetype="video/mp4",
    chunksize=8 * 1024 * 1024,
    resumable=True,
)

request = youtube.videos().insert(
    part="snippet,status",
    body=body,
    media_body=media,
)

response = None
while response is None:
    status, response = request.next_chunk()
    if status:
        print(f"upload {int(status.progress() * 100)}%")

video_id = response["id"]
result = {
    "date": meta.get("date"),
    "title": meta.get("title"),
    "video_id": video_id,
    "privacy_status_requested": requested_privacy,
}
RESULT_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"YOUTUBE_VIDEO_ID={video_id}")
