#!/usr/bin/env python3
"""
One-time YouTube OAuth device authorization helper.

Security:
- client id / secret are read from terminal input (not committed).
- refresh token is printed once for the owner to save as GitHub Actions secret.
- nothing is written to the repository.
"""
import getpass
import json
import time
import urllib.parse
import urllib.request
import urllib.error

DEVICE_ENDPOINT = "https://oauth2.googleapis.com/device/code"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
SCOPE = "https://www.googleapis.com/auth/youtube.upload"


def post_form(url, payload):
    data = urllib.parse.urlencode(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.getcode(), json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = {"raw": body}
        return exc.code, parsed


def main():
    print("NOVA → YouTube: одноразовое подключение")
    print("Нужен OAuth client типа: TVs and Limited Input devices.")
    client_id = input("YOUTUBE_CLIENT_ID: ").strip()
    client_secret = getpass.getpass("YOUTUBE_CLIENT_SECRET (скрыт): ").strip()

    if not client_id or not client_secret:
        raise SystemExit("Client ID и Client Secret обязательны.")

    status, device = post_form(
        DEVICE_ENDPOINT,
        {"client_id": client_id, "scope": SCOPE},
    )
    if status != 200:
        raise SystemExit(f"Не удалось получить device code: HTTP {status}: {device}")

    verification_url = device["verification_url"]
    user_code = device["user_code"]
    device_code = device["device_code"]
    interval = int(device.get("interval", 5))
    expires_in = int(device.get("expires_in", 1800))

    print("\nОткрой на iPhone:")
    print(verification_url)
    print("\nВведи код:")
    print(user_code)
    print("\nВойди именно в Google/YouTube аккаунт нужного канала и нажми Allow.")
    print("Жду подтверждение...")

    deadline = time.time() + expires_in
    while time.time() < deadline:
        time.sleep(interval)
        status, token = post_form(
            TOKEN_ENDPOINT,
            {
                "client_id": client_id,
                "client_secret": client_secret,
                "device_code": device_code,
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            },
        )

        if status == 200 and token.get("refresh_token"):
            print("\nГОТОВО. Сохрани эти 3 значения как GitHub Actions Secrets:")
            print("YOUTUBE_CLIENT_ID =", client_id)
            print("YOUTUBE_CLIENT_SECRET = [то значение, которое ввёл]")
            print("YOUTUBE_REFRESH_TOKEN =", token["refresh_token"])
            print("\nВАЖНО: refresh token никому не отправляй и не коммить в репозиторий.")
            return

        err = token.get("error")
        if err == "authorization_pending":
            continue
        if err == "slow_down":
            interval += 5
            continue
        raise SystemExit(f"OAuth ошибка: HTTP {status}: {token}")

    raise SystemExit("Код истёк. Запусти помощник ещё раз.")


if __name__ == "__main__":
    main()
