# Подключение YouTube к NOVA — один раз

Сейчас NOVA уже умеет ежедневно собирать Short и загружать его через официальный YouTube Data API, но Google требует отдельное разрешение именно на YouTube upload. Подключённые Gmail/Drive не передают этот scope автоматически.

## 1. В Google Cloud

1. Открой API Library и включи **YouTube Data API v3**.
2. В Google Auth Platform / Clients создай OAuth client типа **TVs and Limited Input devices**.
3. Сохрани Client ID и Client Secret.

Никаких ключей/секретов в публичный репозиторий не коммитить.

## 2. Получить refresh token

Запусти:

```bash
python youtube/authorize_device.py
```

Скрипт покажет адрес Google Device Authorization и одноразовый код. На iPhone войди именно в Google-аккаунт нужного YouTube-канала и нажми **Allow**.

После подтверждения скрипт покажет refresh token.

## 3. GitHub Actions Secrets

В репозитории `magomedt149/nova-robot` добавь:

- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REFRESH_TOKEN`

После этого workflow **Daily YouTube Short - FREE** начнёт выполнять шаг YouTube upload.

## 4. Безопасный первый тест

Первый upload остаётся `private`, чтобы проверить, что OAuth попал именно на нужный канал. После подтверждения канала можно менять policy.

## Важное ограничение YouTube

Google указывает, что uploads через `videos.insert` из непроверенных API-проектов, созданных после 28 июля 2020 года, могут быть принудительно ограничены режимом **Private** до прохождения YouTube API audit. Это ограничение Google, а не NOVA.
