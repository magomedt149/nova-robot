# NOVA → YouTube Shorts: бесплатный pipeline

Цель: ежедневно готовить один оригинальный вертикальный Short, озвучивать только Ириной `ru_RU-irina-medium`, собирать MP4 через FFmpeg, показывать владельцу на просмотр и публиковать только после явной команды.

## Что бесплатно

- Публичный репозиторий `magomedt149/nova-robot`.
- Стандартный GitHub-hosted runner для public repo.
- Piper TTS, FFmpeg, Pillow и Python.
- Официальный YouTube Data API в пределах квоты.
- Платные Runway / Higgsfield / HeyGen / Netlify по умолчанию не используются.

Google Colab для ежедневных Shorts не обязателен. Его оставляем для тяжёлого Blender/AI-render и для одноразового OAuth-подключения.

## Двухступенчатая защита публикации

1. `Daily YouTube Short - PREVIEW ONLY` собирает MP4 + thumbnail + metadata. **На YouTube ничего не отправляет.**
2. Владелец смотрит готовый ролик.
3. Только после явной команды «публикуй» файл `youtube_queue/publish_approved.json` переводится в `approved=true` для даты текущего ролика.
4. `Publish Approved YouTube Short` проверяет approval, защиту от дубля и OAuth, повторно детерминированно собирает тот же ролик и загружает его.
5. После успешной загрузки approval автоматически сбрасывается в false.

Даже наличие OAuth secrets само по себе не разрешает публикацию.

## OAuth

Никогда не коммитить OAuth client secret или refresh token в публичный репозиторий.

GitHub Actions Secrets:

- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REFRESH_TOKEN`

Запрашиваем scopes:

- `youtube.upload`
- `youtube.readonly`

Readonly нужен для проверки, к какому каналу подключён OAuth, и будущего анализа статистики.

## Ежедневный файл темы

`youtube_queue/today.json` содержит дату, заголовок, описание, хэштеги, теги, источники и 5–7 сцен с headline/caption/narration.

## Контент-качество

Одинаковая оболочка допустима, но содержание каждого ролика должно быть реально новым и полезным. Не штамповать взаимозаменяемые слайды с минимальными изменениями. Использовать собственный сценарий, проверенные источники, новый хук и заметно отличающуюся структуру/визуальный акцент по теме.

Если применяется реалистичный AI-контент, который изображает событие/место/человека так, будто это произошло в реальности, учитывать требование YouTube о disclosure altered/synthetic content.
