#!/usr/bin/env bash
set -Eeuo pipefail

DOMAIN="${NOVA_CALL_DOMAIN:-call.tumsoev.com}"
TURN_DOMAIN="${NOVA_CALL_TURN_DOMAIN:-turn.call.tumsoev.com}"
ROOT="${NOVA_CALL_ROOT:-/opt/nova-call}"
JITSI_DIR="$ROOT/jitsi"

fail=0
check(){
  if "$@"; then
    printf 'OK  %s\n' "$*"
  else
    printf 'FAIL %s\n' "$*" >&2
    fail=1
  fi
}

check curl -fsS --max-time 8 "https://$DOMAIN/"
check bash -c "timeout 8 openssl s_client -connect '$TURN_DOMAIN:5349' -servername '$TURN_DOMAIN' </dev/null 2>/dev/null | grep -q 'BEGIN CERTIFICATE'"
check bash -c "cd '$JITSI_DIR' && docker compose ps --status running | grep -q web"
check bash -c "cd '$JITSI_DIR' && docker compose ps --status running | grep -q prosody"
check bash -c "cd '$JITSI_DIR' && docker compose ps --status running | grep -q jicofo"
check bash -c "cd '$JITSI_DIR' && docker compose ps --status running | grep -q jvb"
check bash -c "cd '$JITSI_DIR' && docker compose ps --status running | grep -q coturn"

exit "$fail"
