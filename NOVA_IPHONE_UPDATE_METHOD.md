# NOVA — постоянный метод обновления iPhone PWA

Статус: **ЗАФИКСИРОВАНО**  
Версия метода: 1.0  
Production: https://dashing-otter-990b47.netlify.app/

## Шаг 0 — сначала проверить production

Перед очисткой iPhone проверить:

**https://dashing-otter-990b47.netlify.app/version.json**

Если файл показывает текущую версию — использовать update.html.

Если version.json даёт 404 или production показывает старую версию, проблема НЕ в iPhone: сначала нужно опубликовать свежий main на Netlify.

Текущий Netlify Project ID:

**ae7fa0fb-e73d-413a-b122-7b9ff9419244**

Netlify project:

**https://app.netlify.com/projects/dashing-otter-990b47**

GitHub repository:

**https://github.com/magomedt149/nova-robot**

Для постоянного автоматического обновления один раз связать существующий Netlify project с этим GitHub repository:

Project configuration → Build & deploy → Continuous deployment → Repository → Link repository → GitHub → magomedt149/nova-robot → branch main.

Publish directory: **.**

После этой привязки каждый push в main должен публиковать свежую NOVA, а iPhone обновляется через update.html без удаления памяти.

## Главное правило

Если установленная NOVA на iPhone показывает старую версию или старые кнопки, использовать:

**https://dashing-otter-990b47.netlify.app/update.html**

Этот экран обновления:

1. Отменяет регистрацию старого Service Worker.
2. Удаляет только кэши NOVA / Motion Studio.
3. **Не удаляет localStorage, IndexedDB, память NOVA и пользовательские настройки.**
4. Принудительно получает свежие index.html, app.js и service-worker.js.
5. Возвращает пользователя в свежую production NOVA.
6. Новая NOVA после запуска сама вызывает ServiceWorkerRegistration.update() с updateViaCache="none".
7. При смене активного Service Worker NOVA перезагружается один раз.

## Текущая контрольная версия

- NOVA: **27.1.0**
- PWA: **27.1.0**
- Service Worker cache: **nova-v38-pwa-update-irina-20260904**
- Голос Ирина: **Piper ru_RU-irina-medium**
- Motion + VFX: должен быть виден на главном экране
- Сделать видео: должен быть виден на главном экране

## Проверка после обновления

На главном экране должны быть:

- версия **v27.1**
- **✨ Motion + VFX**
- **☁️ Сделать видео**
- Hollywood 4K
- Перевод
- YouTube

Для русского TTS сохраняется locked MASTER-пресет Ирины.

## Не делать без необходимости

Не удалять приложение с домашнего экрана.
Не очищать данные сайта целиком.
Не удалять localStorage / IndexedDB для обычного обновления.
