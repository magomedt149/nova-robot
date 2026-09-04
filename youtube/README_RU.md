# NOVA → YouTube Shorts: бесплатный pipeline

Цель: каждый день готовить вертикальный Short, озвучивать только голосом Ирины `ru_RU-irina-medium`, собирать MP4 через FFmpeg и после одноразовой авторизации загружать на YouTube через официальный YouTube Data API.

## Что бесплатно

- Репозиторий `magomedt149/nova-robot` публичный.
- Используется стандартный `ubuntu-latest` GitHub-hosted runner.
- Piper TTS, FFmpeg, Pillow и Python — бесплатные/open-source.
- YouTube Data API не требует оплаты за каждый upload, но действует API quota.
- Платные Runway / Higgsfield / HeyGen / Netlify не используются.

Google Colab для этой ежедневной публикации не обязателен. Его можно оставить для тяжёлого Blender/AI-render.

## Безопасность

Никогда не коммитить OAuth client secret или refresh token в публичный репозиторий.

Нужно один раз добавить в GitHub Actions Secrets:

- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REFRESH_TOKEN`

До появления всех трёх secrets workflow только соберёт MP4 и thumbnail и положит их в Actions artifact — на YouTube ничего не отправится.

## Ограничение YouTube API

Для новых/непроверенных API-проектов YouTube может принудительно оставлять загруженные видео в режиме Private. Поэтому первый безопасный этап — автоматическая сборка + private upload. Для полностью автоматической публичной публикации OAuth/API-проект должен соответствовать требованиям YouTube и при необходимости пройти audit.

## Ежедневный файл темы

`youtube_queue/today.json` содержит:

- дату;
- заголовок;
- описание;
- хэштеги и теги;
- источники;
- сцены с крупным текстом;
- отдельную реплику Ирины для каждой сцены.

Если дата файла не совпадает с текущей датой California, плановый workflow не публикует старый ролик повторно.
