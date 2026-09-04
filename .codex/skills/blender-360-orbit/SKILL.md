---
name: blender-360-orbit
description: Build and verify a true continuous Blender camera orbit around a stationary 3D subject, then optionally hand the rendered control MP4 to an AI video stage for photorealistic refinement. Use for 360 orbit, fly-around, camera around car/object, and Russian equivalents.
---

# Blender 360 Orbit

Use this skill when the requested motion is a continuous camera move around a subject. Do not substitute image sequences, crossfades, morphing, pan/zoom, or CSS/parallax.

## Required interpretation

For "360 orbit", "full orbit", "камера вокруг машины", "облёт 360", or "3D полёт камеры":
- one persistent Blender scene;
- subject fixed in world space;
- camera follows one cyclic curve around the subject;
- camera continuously tracks one target;
- no cuts;
- start and end camera world locations match after one revolution.

For "orbit" without "360", use 180 degrees by default unless the prompt gives another angle.

## Preferred pipeline

1. Asset: use a user-owned/licensed GLB/GLTF/FBX/OBJ/BLEND asset when supplied. If no real asset exists, build a clearly labelled proxy/blockout.
2. Normalize scene: compute subject world-space bounds, target the visual center, keep subject transforms fixed, add a ground plane for parallax.
3. Camera path: create a cyclic Bezier circle; camera FOLLOW_PATH with fixed position; camera TRACK_TO target Empty using TRACK_NEGATIVE_Z / UP_Y; animate offset_factor; use linear interpolation.
4. Render: 5 sec default; 9:16 final 1080x1920 or smaller preview; H.264 MP4; Eevee for cheap blocking.
5. Verify: camera translates; path is cyclic; 360 start/end camera locations match; subject matrix is unchanged; no cuts; one Blender frame sequence.
6. Photorealistic second stage: use the Blender MP4 as the motion/depth/camera reference for WanGP or another continuous-video model. Preserve the approved camera path.

## NOVA commands

Standalone:

    blender -b --python blender-colab/scripts/render_true_orbit.py -- --duration 5 --fps 30 --ratio 9:16 --degrees 360 --output NOVA_true_orbit.mp4

With an asset:

    blender -b --python blender-colab/scripts/render_true_orbit.py -- --asset /path/to/car.glb --duration 5 --fps 30 --ratio 9:16 --degrees 360 --output NOVA_true_orbit.mp4

NOVA pipeline:

    python automation/nova_pipeline.py --prompt "Toyota Supra proxy, true 360 camera orbit, 5 sec, 9:16" --duration 5 --ratio 9:16 --out build/orbit --run-blender

## Failure behavior

If Blender is unavailable, the 3D asset is missing, or a continuous-video model is unavailable: report the missing dependency and never fake a continuous 3D orbit with independent images.
