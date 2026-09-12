# NOVA repository guidance for coding agents

## Media truthfulness rules

These rules are non-negotiable for video features.

1. Never call a slideshow, crossfade, morph, 2D pan/zoom, CSS transform, or parallax effect a "true 3D camera orbit".
2. A request such as "camera flies around the car", "360 orbit", "3D fly-around", or Russian equivalents ("облёт 360", "камера вокруг машины", "3D полёт камеры") must use one of:
   - a real Blender camera moving through one persistent 3D scene; or
   - a real video-generation model that produces continuous video motion from one consistent scene.
3. For the Blender path, the subject stays fixed. The camera must travel on a continuous curve around one target. For a 360 request, the camera starts and ends at the same spatial point after a full revolution.
4. All preview frames for a Blender orbit must come from the same Blender scene. Do not regenerate independent angle images and stitch them together.
5. "3D Block" means geometry-based blockout. If only a proxy car is available, label it as a proxy/blockout and do not claim it is an exact Toyota Supra model.
6. "AI Render" is a separate second stage. Use the approved Blender control video as the motion/depth/camera reference for the realistic render. Do not replace the control video with a storyboard.
7. Before any external or paid render, respect NOVA FREE LOCK and require the existing confirmation flow. Local Blender/FFmpeg work is allowed without paid credits.
8. If a requested result cannot be produced with the currently connected tools, say so clearly instead of returning a fake approximation.

## 360 orbit quality gate

For a 5 second 9:16 orbit test:
- one continuous shot, no cuts;
- 360 degrees around the same stationary subject;
- constant target lock on the subject;
- stable focal length and camera height unless explicitly requested otherwise;
- linear path timing for a constant-speed orbit unless the prompt asks for easing;
- start/end camera world positions nearly identical;
- render from one scene at one frame rate;
- final MP4 H.264, yuv420p, faststart.

When implementing or reviewing Blender orbit work, read:
`.codex/skills/blender-360-orbit/SKILL.md`

## CI maintenance and self-check rule

Treat GitHub Actions failures as a release-blocking signal, not as a reason to ignore or bypass validation.

1. Before declaring a NOVA update complete, inspect the latest `Validate NOVA` and `NOVA FREE — Check & GitHub Pages` runs for the current `main` head.
2. If a validation job fails, inspect the failed step and its logs first. Apply the smallest repository fix that addresses the actual cause; do not blindly re-run a broken job.
3. After a fix, confirm a fresh `Validate NOVA` run succeeds. A run cancelled only because a newer commit superseded it is not itself a product failure.
4. Change the NOVA release number only with `python automation/bump_nova_version.py X.Y.Z`. It synchronizes `version.json`, `index.html`, `app.js`, `nova-health.js`, and the service-worker cache marker, then validates the result. Commit every generated change together in one atomic commit; never publish the version files as separate GitHub commits.
5. Never weaken, skip, or delete a regression check merely to make CI green unless the check is demonstrably obsolete and the replacement provides equal or stronger protection.
6. Preserve NOVA FREE LOCK: no paid API, paid render, credit use, or external paid compute may be enabled as part of an automatic repair.
7. Prefer minimal, reversible fixes and preserve existing working behavior.
8. When a failure is already fixed by a newer commit, do not revert the newer working state just to repair the historical failed run.
9. Before pushing any release commit, run `python automation/bump_nova_version.py --check`, `python automation/validate_frontend.py`, and `python tests/run_static_tests.py` locally. Do not push when any command fails.

## User command: «добавь и допиши»

When the user says «добавь и допиши», follow the permanent method in:
`docs/TUMSOEV_ADD_AND_APPEND_METHOD.md`

Do not create duplicate scheduled tasks when an existing task can be safely extended. Preserve unique important tasks, NOVA FREE LOCK, and verify the saved result.
