# TUMSOEV Wolf Motion — точный запуск

Цель: пройти от папки проекта до первого GLB без платных API и без автоматического расхода кредитов.

## Вариант A — через GitHub Actions (самый простой)

1. Открой репозиторий `magomedt149/nova-robot`.
2. Переключись на ветку `test/wolf-motion-full-pipeline`.
3. Открой папку `blender/wolf-motion/assets/model/`.
4. Загрузить настоящий файл модели под точным именем `wolf.glb`.
5. Открой `blender/wolf-motion/motion_refs/` и загрузить:
   - `idle.mp4`
   - `walk.mp4`
   - `run.mp4`
   - `howl.mp4`
6. Любой commit внутри `blender/wolf-motion/**` автоматически запускает workflow `Wolf Blender FREE Full Pipeline Test`.
7. Открой вкладку **Actions** → `Wolf Blender FREE Full Pipeline Test` → последний run.
8. Проверить шаги:
   - `Proxy smoke test` = PASS;
   - `Asset preflight` покажет наличие 5 файлов;
   - если `wolf.glb` имеет Armature, `Real wolf structure/export validation` экспортирует проверочный GLB;
   - если Armature нет, отчёт честно покажет `NEEDS_RIG`.
9. Внизу run открыть **Artifacts** и скачать результаты.

## Вариант B — вручную в Blender 4.x

1. Скачай/клонируй ветку `test/wolf-motion-full-pipeline`.
2. Убедись, что существуют файлы:
   - `blender/wolf-motion/assets/model/wolf.glb`
   - `blender/wolf-motion/motion_refs/idle.mp4`
   - `blender/wolf-motion/motion_refs/walk.mp4`
   - `blender/wolf-motion/motion_refs/run.mp4`
   - `blender/wolf-motion/motion_refs/howl.mp4`
3. Запусти Blender 4.x.
4. В верхней части окна выбери workspace **Scripting**.
5. В Text Editor нажми **Open**.
6. Открой `blender/wolf-motion/real_model_validate.py` для структурного теста реальной модели.
7. Нажми кнопку **Run Script**.
8. Если модель ригнута, появится файл:
   `blender/wolf-motion/exports/wolf_real_pipeline_validation.glb`.
9. Для рабочего проекта открой `blender/wolf-motion/wolf_motion_setup.py` и снова нажми **Run Script**.
10. Скрипт выставит 24 fps, найдёт Armature, подготовит Actions и motion-reference окружение.
11. В Dope Sheet переключи режим на **Action Editor**.
12. Проверить Action slots:
   - `WOLF_IDLE` — 72 кадра / 3.0 s;
   - `WOLF_WALK` — 48 кадров / 2.0 s;
   - `WOLF_RUN` — 24 кадра / 1.0 s;
   - `WOLF_HOWL` — 84 кадра / 3.5 s.
13. Перед финальным экспортом визуально проверить:
   - все 4 лапы корректно касаются земли;
   - нет foot sliding;
   - walk/run циклы без скачка на шве;
   - spine/head/tail двигаются естественно;
   - в howl лапы не сдвигаются.
14. Для экспорта: **File → Export → glTF 2.0 (.glb/.gltf)**.
15. Справа выбрать **Format: glTF Binary (.glb)**.
16. Включить **Animation** и skin/armature export.
17. Сохранить как `blender/wolf-motion/exports/wolf_animated.glb`.

## Что делает proxy-тест

`ci_smoke_test.py` — бесплатный технический тест. Он создаёт временную skinned proxy-модель, 4 Action, экспортирует GLB и доказывает, что GitHub runner + Blender + glTF exporter работают. Proxy не выдаётся за настоящий волчий риг или готовый motion-retarget.

## Что считается готовностью настоящего волка

Минимум:
- импортируется mesh;
- присутствует Armature;
- GLB экспортируется без ошибки;
- создаются/сохраняются 4 Action slots;
- motion references доступны для визуального retarget/коррекции;
- финальная визуальная проверка пройдена.

## Free-first

Workflow не вызывает Seedance, Tripo, Runway или другие платные API. Любая генерация, расходующая кредиты/квоту, запускается только отдельно после явного разрешения пользователя.
