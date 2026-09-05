#!/usr/bin/env bash
set -Eeuo pipefail

DOMAIN="${NOVA_CALL_DOMAIN:-call.tumsoev.com}"
TURN_DOMAIN="${NOVA_CALL_TURN_DOMAIN:-turn.call.tumsoev.com}"
INSTALL_ROOT="${NOVA_CALL_ROOT:-/opt/nova-call}"
JITSI_DIR="${INSTALL_ROOT}/jitsi"
CFG_DIR="${INSTALL_ROOT}/jitsi-cfg"
EMAIL="${NOVA_CALL_EMAIL:-}"
PUBLIC_IP="${NOVA_CALL_PUBLIC_IP:-}"
RELAY_MIN="${NOVA_CALL_TURN_MIN_PORT:-49160}"
RELAY_MAX="${NOVA_CALL_TURN_MAX_PORT:-49260}"

log(){ printf '[NOVA CALL] %s\n' "$*"; }
die(){ printf '[NOVA CALL] ERROR: %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root: sudo -E bash install.sh"
command -v apt-get >/dev/null || die "Ubuntu/Debian with apt is required."

if [[ -z "$EMAIL" ]]; then
  if [[ -t 0 ]]; then
    read -r -p "Let's Encrypt email: " EMAIL
  else
    die "Set NOVA_CALL_EMAIL before unattended install."
  fi
fi

log "Installing base packages"
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y   ca-certificates curl unzip openssl dnsutils ufw certbot docker.io docker-compose-plugin

systemctl enable --now docker

resolve_ipv4(){
  dig +short A "$1" | grep -E '^[0-9]+(\.[0-9]+){3}$' | head -n1 || true
}

DOMAIN_IP="$(resolve_ipv4 "$DOMAIN")"
TURN_IP="$(resolve_ipv4 "$TURN_DOMAIN")"
[[ -n "$DOMAIN_IP" ]] || die "DNS A record for $DOMAIN is not ready."
[[ -n "$TURN_IP" ]] || die "DNS A record for $TURN_DOMAIN is not ready."
[[ "$DOMAIN_IP" == "$TURN_IP" ]] || die "$DOMAIN and $TURN_DOMAIN must point to the same server for this one-host setup."
PUBLIC_IP="${PUBLIC_IP:-$DOMAIN_IP}"
log "Using public IP $PUBLIC_IP"

mkdir -p "$INSTALL_ROOT" "$CFG_DIR"

if [[ ! -f "$JITSI_DIR/docker-compose.yml" ]]; then
  log "Downloading latest official docker-jitsi-meet release"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  release_url="$(curl -fsSL https://api.github.com/repos/jitsi/docker-jitsi-meet/releases/latest     | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["zipball_url"])')"
  curl -fsSL "$release_url" -o "$tmp/jitsi.zip"
  mkdir -p "$JITSI_DIR"
  unzip -q "$tmp/jitsi.zip" -d "$tmp/unzip"
  src="$(find "$tmp/unzip" -mindepth 1 -maxdepth 1 -type d | head -n1)"
  cp -a "$src"/. "$JITSI_DIR"/
fi

cd "$JITSI_DIR"
[[ -f .env ]] || cp env.example .env

set_env(){
  local key="$1" value="$2"
  if grep -qE "^#?${key}=" .env; then
    sed -i -E "s|^#?${key}=.*|${key}=${value}|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

set_env CONFIG "$CFG_DIR"
set_env TZ "America/Los_Angeles"
set_env HTTP_PORT "80"
set_env HTTPS_PORT "443"
set_env PUBLIC_URL "https://$DOMAIN"
set_env ENABLE_LETSENCRYPT "1"
set_env LETSENCRYPT_DOMAIN "$DOMAIN"
set_env LETSENCRYPT_EMAIL "$EMAIL"
set_env ENABLE_HTTP_REDIRECT "1"
set_env ENABLE_HSTS "1"
set_env JVB_ADVERTISE_IPS "$PUBLIC_IP"
set_env ENABLE_AUTH "0"
set_env ENABLE_GUESTS "1"
set_env ENABLE_P2P "0"
set_env JVB_DISABLE_STUN "1"
set_env START_AUDIO_ONLY "1"
set_env START_WITH_VIDEO_MUTED "1"
set_env ENABLE_RECORDING "0"
set_env ENABLE_LIVESTREAMING "0"
set_env ENABLE_TRANSCRIPTIONS "0"

if grep -qE '^(JICOFO_AUTH_PASSWORD|JVB_AUTH_PASSWORD)=$' .env || ! grep -q '^JICOFO_AUTH_PASSWORD=' .env; then
  log "Generating Jitsi internal passwords"
  ./gen-passwords.sh
fi

TURN_SECRET_FILE="$INSTALL_ROOT/turn-secret"
if [[ ! -s "$TURN_SECRET_FILE" ]]; then
  umask 077
  openssl rand -hex 32 > "$TURN_SECRET_FILE"
fi
TURN_SECRET="$(cat "$TURN_SECRET_FILE")"

set_env TURN_HOST "$TURN_DOMAIN"
set_env TURN_PORT "3478"
set_env TURNS_HOST "$TURN_DOMAIN"
set_env TURNS_PORT "5349"
set_env TURN_TRANSPORT "udp,tcp"
set_env TURN_TTL "86400"
set_env TURN_CREDENTIALS "$TURN_SECRET"

mkdir -p "$INSTALL_ROOT/coturn"
cat > "$INSTALL_ROOT/coturn/turnserver.conf" <<EOF
listening-port=3478
tls-listening-port=5349
realm=$TURN_DOMAIN
server-name=$TURN_DOMAIN
fingerprint
use-auth-secret
static-auth-secret=$TURN_SECRET
cert=/etc/letsencrypt/live/$TURN_DOMAIN/fullchain.pem
pkey=/etc/letsencrypt/live/$TURN_DOMAIN/privkey.pem
min-port=$RELAY_MIN
max-port=$RELAY_MAX
no-multicast-peers
no-cli
stale-nonce=600
EOF

if [[ ! -d "/etc/letsencrypt/live/$TURN_DOMAIN" ]]; then
  log "Issuing TURN TLS certificate"
  certbot certonly --standalone     -d "$TURN_DOMAIN"     --email "$EMAIL"     --agree-tos     --non-interactive
fi

cat > docker-compose.override.yml <<EOF
services:
  coturn:
    image: coturn/coturn:latest
    restart: unless-stopped
    network_mode: host
    command: ["-c", "/etc/coturn/turnserver.conf"]
    volumes:
      - $INSTALL_ROOT/coturn/turnserver.conf:/etc/coturn/turnserver.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
EOF

log "Configuring firewall"
ufw allow 22/tcp >/dev/null || true
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 10000/udp >/dev/null
ufw allow 3478/udp >/dev/null
ufw allow 3478/tcp >/dev/null
ufw allow 5349/tcp >/dev/null
ufw allow 5349/udp >/dev/null
ufw allow "${RELAY_MIN}:${RELAY_MAX}/udp" >/dev/null
ufw allow "${RELAY_MIN}:${RELAY_MAX}/tcp" >/dev/null
ufw --force enable >/dev/null

log "Starting NOVA Call"
docker compose pull
docker compose up -d

cat > /usr/local/sbin/nova-call-cert-renew <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
cd "$JITSI_DIR"
docker compose stop web
trap 'docker compose start web >/dev/null 2>&1 || true' EXIT
certbot renew --standalone --quiet
docker compose start web
trap - EXIT
docker compose restart coturn
EOF
chmod 0755 /usr/local/sbin/nova-call-cert-renew

cat > /etc/systemd/system/nova-call-cert-renew.service <<'EOF'
[Unit]
Description=NOVA Call TURN certificate renewal
After=docker.service network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/nova-call-cert-renew
EOF

cat > /etc/systemd/system/nova-call-cert-renew.timer <<'EOF'
[Unit]
Description=Renew NOVA Call TURN TLS certificate weekly

[Timer]
OnCalendar=Sun *-*-* 03:37:00
RandomizedDelaySec=1200
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now nova-call-cert-renew.timer

log "Waiting for HTTPS"
for _ in {1..30}; do
  if curl -fsS --max-time 5 "https://$DOMAIN/" >/dev/null 2>&1; then
    break
  fi
  sleep 4
done

if curl -fsS --max-time 10 "https://$DOMAIN/" >/dev/null; then
  log "HTTPS OK: https://$DOMAIN"
else
  docker compose ps
  die "Jitsi HTTPS health check failed. Check: docker compose logs web prosody jicofo jvb"
fi

if timeout 8 openssl s_client -connect "$TURN_DOMAIN:5349" -servername "$TURN_DOMAIN" </dev/null 2>/dev/null   | grep -q "BEGIN CERTIFICATE"; then
  log "TURN/TLS OK: turns:$TURN_DOMAIN:5349"
else
  docker compose logs --tail=100 coturn || true
  die "TURN/TLS health check failed."
fi

cat > "$INSTALL_ROOT/STATUS.json" <<EOF
{
  "status": "READY",
  "domain": "$DOMAIN",
  "turn_domain": "$TURN_DOMAIN",
  "public_ip": "$PUBLIC_IP",
  "https": true,
  "turn_tls": true,
  "free_internet_calls": true,
  "pstn_calls": false
}
EOF

log "NOVA Call is READY."
