# NOVA → Colab → Blender Wolf Auto — FREE

Команда: **«Нова, включи Colab»**.

## Что делает NOVA

1. Главная NOVA распознаёт точную команду и создаёт одноразовое разрешение только для бесплатной задачи волка.
2. Открывает Motion Studio с маркером `wolf=1`.
3. Motion Studio фиксирует задачу `[NOVA_WOLF_AUTO_V1]`: Blender, 10 секунд, 24 fps, 16:9, TRUE 360°, Final, без WanGP и платных API.
4. Если живой worker уже подключён — использует его. Иначе открывает `blender-colab/NOVA_Wolf_Auto_Worker.ipynb`.
5. В Colab пользователь при необходимости делает только действие, которое Google не разрешает обходить: подключает бесплатный GPU/нажимает `Run all`.
6. Notebook устанавливает Blender + FFmpeg, поднимает token-protected NOVA worker и временный HTTPS Cloudflare tunnel.
7. `COPY & RETURN TO NOVA` передаёт `NOVA_CONNECT={url,token}` через clipboard; дополнительно делается best-effort `postMessage`.
8. NOVA Auto Recovery подключается к новому worker и автоматически отправляет уже одобренный wolf job.
9. Worker запускает `render_wolf_cinema_auto.py`: процедурный серый волк, скала, луна, ночной свет, 10s/24fps, TRUE 360° rotating-rig camera, EEVEE, H.264 MP4.
10. После `completed` NOVA получает одноразовый download ticket и **сначала полностью копирует MP4 в локальный browser Blob на телефоне**.
11. Только после успешного локального переноса NOVA вызывает `POST /runtime/shutdown`.
12. Notebook видит `/content/NOVA_STOP_RUNTIME` и вызывает `google.colab.runtime.unassign()`; worker/tunnel завершаются.

## FREE LOCK

- Платные API не запускаются.
- WanGP в dedicated wolf notebook не устанавливается и не нужен.
- Команда пользователя считается разрешением **только для точного wolf workflow**; глобальный Full Auto остаётся выключенным.
- Если MP4 не удалось скопировать на телефон, runtime **не выключается**, чтобы результат не потерялся.
- Старый generic Colab worker остаётся без изменений для других задач NOVA.

## Неизбежное ограничение Google Colab Free

NOVA может открыть notebook, подготовить задачу, подхватить Connect Code, продолжить job и запросить остановку runtime. Но она не может обходить Google authorization, CAPTCHA, кнопку Connect/Run all или программно гарантировать выдачу T4. Если Google просит это действие, пользователь выполняет его один раз.

## Основные файлы

- `nova-free-runtime.js` — голосовая команда + сохранение approved-job recovery под FREE LOCK.
- `motion-studio/colab-wolf-auto.js` — подготовка wolf job, Connect Code bridge, безопасное локальное копирование MP4, shutdown.
- `motion-studio/service-worker.js` — гарантирует загрузку wolf-auto клиента в Motion Studio.
- `blender-colab/NOVA_Wolf_Auto_Worker.ipynb` — минимальный бесплатный Colab worker для Blender/FFmpeg.
- `automation/remote_gpu_worker_colab_auto.py` — wrapper существующего API + exact wolf routing + `/runtime/shutdown`.
- `blender-colab/scripts/render_wolf_cinema_auto.py` — deterministic Blender wolf renderer.
- `tests/test_colab_wolf_auto_static.py` — статические проверки связки.
