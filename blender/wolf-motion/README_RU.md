# Wolf Motion Workflow — FREE test branch

Это изолированный тестовый workflow для проверки связки GitHub Actions + Blender без платных API и без расхода AI-кредитов.

## Что проверяет CI
1. Устанавливает Blender на бесплатном GitHub-hosted Ubuntu runner.
2. Запускает Blender headless.
3. Создаёт простой proxy-объект и Armature.
4. Создаёт четыре Actions с фиксированными таймингами:
   - WOLF_IDLE — 72 кадра / 3.0 s / loop
   - WOLF_WALK — 48 кадров / 2.0 s / loop
   - WOLF_RUN — 24 кадра / 1.0 s / loop
   - WOLF_HOWL — 84 кадра / 3.5 s / non-loop
5. Экспортирует `exports/wolf_motion_smoke.glb`.
6. Проверяет, что GLB существует и Actions созданы.
7. Загружает GLB и JSON-отчёт как GitHub Actions artifact.

## Реальный волк
Когда готовый ригнутый `wolf.glb` будет добавлен в `assets/model/wolf.glb`, а motion-reference ролики будут лежать в `motion_refs/idle.mp4`, `walk.mp4`, `run.mp4`, `howl.mp4`, запускается `wolf_motion_setup.py` в Blender.

## FREE LOCK
Никакие Seedance/Tripo/Runway или другие платные внешние генерации автоматически не запускаются. Этот CI использует только Blender + GitHub Actions.
