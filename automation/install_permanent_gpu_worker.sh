#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
HOME_DIR="${NOVA_PERMANENT_HOME:-$HOME/.nova-gpu}"
VENV="$HOME_DIR/venv"
PY="$VENV/bin/python"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE="$SERVICE_DIR/nova-gpu-worker.service"

mkdir -p "$HOME_DIR" "$SERVICE_DIR"
python3 -m venv "$VENV"
"$PY" -m pip install --upgrade pip
"$PY" -m pip install fastapi uvicorn python-multipart mediapipe opencv-python-headless

cat > "$SERVICE" <<EOF
[Unit]
Description=NOVA Permanent GPU Worker
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$REPO
ExecStart=$PY $REPO/automation/permanent_gpu_worker.py --home $HOME_DIR
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now nova-gpu-worker.service

if command -v tailscale >/dev/null 2>&1; then
  tailscale funnel --bg 7861 || true
fi

echo
echo "NOVA Permanent GPU Worker installed."
echo "No Colab. No Run all. It starts automatically with your session."
echo
if [ -f "$HOME_DIR/NOVA_CONNECT_CODE.txt" ]; then
  cat "$HOME_DIR/NOVA_CONNECT_CODE.txt"
else
  echo "Connect code will appear at: $HOME_DIR/NOVA_CONNECT_CODE.txt"
fi
