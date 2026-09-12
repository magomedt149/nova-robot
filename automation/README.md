# NOVA Auto Director — Zero Credit Pipeline

This folder contains the local, no-API pipeline used by NOVA Motion + VFX Studio.

## One command

```bash
python3 automation/nova_pipeline.py --prompt "two people in a room, 5 sec, orbit camera, light rain" --duration 5 --ratio 16:9
```

Outputs:
- `NOVA_scene_pack.json` — shot plan + blocking + render policy;
- `NOVA_continuity.json` — identity / wardrobe / location / screen-direction locks;
- `NOVA_final_AI_prompt.txt` — final prompt for an external video model **only after preview approval**;
- `NOVA_blender_blocking.py` — generated Blender scene script.

If Blender is installed locally:

```bash
python3 automation/nova_pipeline.py --prompt "two people in a room, 5 sec, orbit camera" --run-blender
```

Blender runs headlessly and saves `NOVA_blocking_scene.blend` + `NOVA_blocking_preview.mp4` in the output directory.

## Credit policy

The default pipeline performs zero paid calls. It intentionally stops at the approved preview + final prompt. External generation is a separate explicit step so NOVA cannot silently burn credits.
