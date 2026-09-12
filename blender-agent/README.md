# NOVA Local Blender Agent — FREE

NOVA теперь может управлять установленным **TUMSOEV Blender Agent FREE v3** из вкладки 3D без платного API.

Схема: `NOVA browser → HTTP localhost gateway :9877 → Blender bridge :9876 → bpy / EEVEE / Cycles`.

## Запуск

1. В Blender запусти установленный `tumsoev_blender_bridge.py` / плагин. В консоли: `FREE local bridge v3.0.0 started`.
2. Из корня NOVA запусти `python blender-agent/nova_blender_http_gateway.py`.
3. NOVA → VIDEO STUDIO → 3D → Blender Camera Bridge → **Local Blender Agent**.
4. `CONNECT` → `SCAN` → `LOOK` → при необходимости `FULL CYCLE`.

`FULL CYCLE` выполняет бесплатный локальный closed loop: `SCAN → LOOK → ANALYZE → small FIX → LOOK → FLOW → LOOP → VERIFY`. Он не очищает сцену и не сохраняет её автоматически. `BUILD WOLF` требует отдельного подтверждения, потому что builder очищает сцену. `SAVE COPY` сохраняет `NOVA_agent_scene.blend` отдельной копией.

Gateway по умолчанию слушает только `127.0.0.1:9877`, не открывает arbitrary Python exec и не подключает Higgsfield, Runway, платные API или render farms.

## iPhone / другой компьютер

`127.0.0.1` на iPhone — это iPhone, а не компьютер с Blender. Для локальной сети запускай явно и только с токеном:

`python blender-agent/nova_blender_http_gateway.py --host 0.0.0.0 --allow-lan --token "СИЛЬНЫЙ_СЕКРЕТ"`

В NOVA укажи `http://IP_КОМПЬЮТЕРА:9877` и тот же token. HTTPS-браузер может блокировать обычный HTTP LAN endpoint; тогда нужен локальный HTTPS/reverse proxy. Не выставляй gateway напрямую в Интернет.
