# NOVA Call — one-host self-hosted deployment

This folder automates a self-hosted Jitsi + Coturn stack for:

- `https://call.tumsoev.com`
- `turn.call.tumsoev.com`
- HTTPS via Let's Encrypt
- Jitsi Videobridge media on UDP 10000
- TURN UDP/TCP on 3478
- TURN/TLS on 5349
- dynamic TURN credentials shared with Jitsi Prosody
- automatic weekly certificate renewal
- UFW firewall rules
- health checks

## DNS first

Both A records must point to the public IPv4 of the Ubuntu host:

```text
call.tumsoev.com       A  SERVER_PUBLIC_IP
turn.call.tumsoev.com  A  SERVER_PUBLIC_IP
```

The server must be reachable from the Internet. If it is behind a home router, forward TCP 80/443/3478/5349 and UDP 10000/3478/5349/49160-49260. Carrier-grade NAT will prevent ordinary inbound hosting unless you obtain a public IP or use a server with one.

## One-command install

On Ubuntu:

```bash
export NOVA_CALL_EMAIL='YOUR_REAL_EMAIL'
sudo -E bash install.sh
```

The installer is idempotent. It downloads the latest official `jitsi/docker-jitsi-meet` release, generates internal passwords, generates the TURN REST secret, configures Coturn, firewall, certificates, and starts the stack.

Check:

```bash
sudo bash healthcheck.sh
sudo cat /opt/nova-call/STATUS.json
```

## GitHub automated deploy

The manual workflow `.github/workflows/deploy-nova-call.yml` can install/update the server when these GitHub repository secrets exist:

- `NOVA_CALL_HOST` — server IPv4 or SSH hostname
- `NOVA_CALL_USER` — SSH user with passwordless sudo
- `NOVA_CALL_SSH_KEY` — private SSH key
- `NOVA_CALL_EMAIL` — email for Let's Encrypt

No paid telephony is enabled. This stack provides WebRTC Internet calls, not calls to arbitrary PSTN/mobile numbers.
