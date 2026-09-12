# NOVA GitHub MCP — настройка

Версия: NOVA 27.28.0 / MCP Bridge 1.1.0.

## Схема

NOVA PWA -> NOVA GitHub MCP Gateway -> официальный GitHub MCP Server

Официальный upstream:
https://api.githubcopilot.com/mcp/

Прямое подключение браузера к upstream не используется: GitHub блокирует cross-origin MCP-запросы браузерных клиентов.

## Безопасный режим

Gateway принудительно отправляет:
- X-MCP-Readonly: true
- X-MCP-Lockdown: true
- X-MCP-Tools: get_me,get_file_contents

GitHub PAT хранится только на gateway-сервере в GITHUB_PERSONAL_ACCESS_TOKEN.
Его нельзя записывать в репозиторий, index.html, nova-mcp.js или localStorage.

Опционально задай NOVA_MCP_GATEWAY_KEY. В NOVA тогда вводится только gateway key.

## Локальный запуск

Нужен Node.js 20+.

Переменные окружения:
GITHUB_PERSONAL_ACCESS_TOKEN=<fine-grained GitHub PAT>
NOVA_MCP_GATEWAY_KEY=<длинный случайный ключ>
NOVA_ALLOWED_ORIGINS=https://magomedt149.github.io,http://localhost:8000
PORT=8787

Запуск:
node mcp-gateway/github-gateway.js

Локальный endpoint:
http://127.0.0.1:8787/mcp/github

Health:
http://127.0.0.1:8787/health

localhost подходит только для NOVA, открытой на том же компьютере. Для iPhone нужен публичный HTTPS адрес gateway.

## Публичный адрес для iPhone

Размести gateway на HTTPS-хосте и используй:
https://YOUR_HOST/mcp/github

В NOVA:
1. MCP
2. GitHub MCP
3. В поле endpoint укажи публичный HTTPS gateway.
4. Если задан NOVA_MCP_GATEWAY_KEY, введи его в Bearer token.
5. Подключить
6. Тест GitHub

## GitHub PAT

Рекомендуется fine-grained PAT:
- Resource owner: magomedt149
- Repository access: Only select repositories -> nova-robot
- Repository permissions: Contents = Read-only
- Metadata = Read-only
- Expiration: ограниченный срок, например 30 дней

Для write-функций нужен отдельный профиль и отдельный токен. Read-only профиль не расширяй без необходимости.

## Проверка вызова

Кнопка Тест GitHub вызывает:
get_file_contents

Аргументы:
owner = magomedt149
repo = nova-robot
path = version.json
ref = refs/heads/main

Успешно:
- MCP ON
- "GitHub MCP проверен: version.json прочитан"
- показан результат version.json

Write-инструменты в этом профиле отсутствуют.
