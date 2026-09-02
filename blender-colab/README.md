# TUMSOEV Blender + WanGP Studio (Google Colab)

Бесплатный тестовый конвейер для 5-секундных роликов 9:16:

1. Загружает референс-видео.
2. Извлекает движение тела через MediaPipe.
3. Создаёт в настоящем Blender 3D-блокинг и `.blend`-файл.
4. Рендерит цветной pose-control ролик и нормализованный reference-control ролик.
5. Запускает локальный WanGP/Gradio на бесплатном GPU Colab.

[Открыть ноутбук в Google Colab](https://colab.research.google.com/github/magomedt149/nova-robot/blob/blender-colab-studio/blender-colab/TUMSOEV_Blender_WanGP_Studio.ipynb)

## Что использовать в WanGP

- **Wan 2.2 Animate 2** — фото персонажа + driving/reference video; лучший первый выбор для сохранения движения.
- **MiniMax H3 Ref2VA** — reference video/image/audio, если модель помещается в доступную память.
- **LTX 2.5 Control** — когда нужен pose/depth/control workflow.

Для точного движения сначала используйте `reference_control_9x16.mp4`. Файл
`blender_pose_control.mp4` нужен как чистая проверка скелета и дополнительный
control-вход. Blender не делает человека реалистичным сам: реализм создаёт
WanGP, используя фото персонажа и control/reference video.

## Ограничения

- Бесплатный Colab не гарантирует выдачу GPU и может завершить сессию.
- Первая загрузка весов занимает много времени и места.
- Этот ноутбук ничего не покупает и не использует платные API.
- Из одного видео нельзя математически восстановить скрытые части тела и
  точную 3D-камеру. Поэтому исходный reference-control сохраняется и передаётся
  модели вместе с Blender-блокингом.

Исходные проекты: [WanGP](https://github.com/deepbeepmeep/Wan2GP),
[Wan2GP-on-Colab](https://github.com/Square-Zero-Labs/Wan2GP-on-Colab) и
[Blender](https://github.com/blender/blender).
