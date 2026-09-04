#!/usr/bin/env python3
"""NOVA Permanent GPU Worker supervisor.

Runs the existing NOVA Remote GPU Worker as a long-lived process, restarts it on
failure, and optionally publishes it over a stable Tailscale Funnel URL.

This is designed for a home GPU PC or a persistent cloud GPU VM. It does not
create a GPU by itself.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
WORKER = REPO_ROOT / "automation" / "remote_gpu_worker.py"
DEFAULT_HOME = Path(os.environ.get("NOVA_PERMANENT_HOME", Path.home() / ".nova-gpu")).expanduser().resolve()


def load_or_create_config(home: Path, port: int) -> dict:
    home.mkdir(parents=True, exist_ok=True)
    cfg_path = home / "config.json"
    cfg = {}
    if cfg_path.is_file():
        try:
            cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        except Exception:
            cfg = {}
    token = str(cfg.get("token") or os.environ.get("NOVA_REMOTE_TOKEN") or secrets.token_urlsafe(32))
    cfg.update({
        "token": token,
        "port": int(cfg.get("port") or port),
        "job_root": str(Path(cfg.get("job_root") or home / "jobs").expanduser().resolve()),
        "wangp_root": str(Path(cfg.get("wangp_root") or os.environ.get("NOVA_WANGP_ROOT") or home / "Wan2GP").expanduser().resolve()),
        "use_tailscale_funnel": bool(cfg.get("use_tailscale_funnel", True)),
    })
    cfg_path.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    return cfg


def tailscale_url(port: int) -> str | None:
    if not shutil.which("tailscale"):
        return None
    try:
        subprocess.run(
            ["tailscale", "funnel", "--bg", str(port)],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        status = subprocess.run(
            ["tailscale", "funnel", "status"],
            check=False,
            capture_output=True,
            text=True,
            timeout=15,
        )
        text = (status.stdout or "") + "\n" + (status.stderr or "")
        match = re.search(r"https://[A-Za-z0-9.-]+\.ts\.net", text)
        return match.group(0) if match else None
    except Exception:
        return None


def write_connection(home: Path, url: str | None, token: str) -> None:
    payload = {"url": url, "token": token, "updated_at": int(time.time())}
    (home / "connection.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    if url:
        code = "NOVA_CONNECT=" + json.dumps({"url": url, "token": token}, separators=(",", ":"))
        (home / "NOVA_CONNECT_CODE.txt").write_text(code + "\n", encoding="utf-8")
        print("\n" + "=" * 80, flush=True)
        print("NOVA PERMANENT GPU: READY", flush=True)
        print("URL:", url, flush=True)
        print("NOVA CONNECT CODE:", code, flush=True)
        print("=" * 80 + "\n", flush=True)
    else:
        print("NOVA worker is running locally, but no stable HTTPS URL was detected.", flush=True)
        print("Install/login to Tailscale, then run: tailscale funnel --bg 7861", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", type=Path, default=DEFAULT_HOME)
    parser.add_argument("--port", type=int, default=7861)
    parser.add_argument("--no-funnel", action="store_true")
    args = parser.parse_args()

    if not WORKER.is_file():
        raise SystemExit(f"Missing worker: {WORKER}")

    home = args.home.expanduser().resolve()
    cfg = load_or_create_config(home, args.port)
    port = int(cfg["port"])
    job_root = Path(cfg["job_root"])
    job_root.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    env["NOVA_REMOTE_TOKEN"] = cfg["token"]
    env["NOVA_REMOTE_JOB_ROOT"] = str(job_root)
    env["NOVA_WANGP_ROOT"] = cfg["wangp_root"]
    env["NOVA_PERMANENT_MODE"] = "1"

    stopping = False
    child: subprocess.Popen | None = None

    def stop(*_):
        nonlocal stopping, child
        stopping = True
        if child and child.poll() is None:
            try:
                child.terminate()
            except Exception:
                pass

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    url = None
    if cfg.get("use_tailscale_funnel") and not args.no_funnel:
        url = tailscale_url(port)
    write_connection(home, url, cfg["token"])

    backoff = 2
    while not stopping:
        log_path = home / "worker.log"
        with log_path.open("a", encoding="utf-8", errors="replace") as log:
            log.write(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] starting NOVA worker\n")
            log.flush()
            child = subprocess.Popen(
                [sys.executable, str(WORKER), "--host", "127.0.0.1", "--port", str(port)],
                cwd=str(REPO_ROOT),
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
            code = child.wait()
            if stopping:
                break
            log.write(f"[supervisor] worker exited with {code}; restarting in {backoff}s\n")
            log.flush()
        time.sleep(backoff)
        backoff = min(30, backoff * 2)
        if cfg.get("use_tailscale_funnel") and not args.no_funnel and not url:
            url = tailscale_url(port)
            if url:
                write_connection(home, url, cfg["token"])

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
