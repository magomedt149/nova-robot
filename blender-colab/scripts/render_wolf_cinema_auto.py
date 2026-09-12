#!/usr/bin/env python3
"""NOVA FREE wolf cinematic renderer for the dedicated Colab workflow.

Deterministic Blender-only scene: stylized grey howling wolf, rocky night set,
full moon, TRUE 360 camera orbit, 10 seconds / 24 fps by default.
No paid APIs, no cloud generation services, no external model calls.
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

import bpy
from mathutils import Vector

MARKER = "NOVA_WOLF_AUTO_V1"


def args_after_separator() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--output", default="NOVA_WOLF_FINAL.mp4")
    p.add_argument("--duration", type=float, default=10.0)
    p.add_argument("--fps", type=int, default=24)
    p.add_argument("--ratio", choices=["16:9", "9:16"], default="16:9")
    p.add_argument("--quality", choices=["preview", "final"], default="final")
    p.add_argument(
        "--ci-smoke",
        action="store_true",
        help="Render a lightweight sampled preview, then encode the required output FPS/size.",
    )
    return p.parse_args(args_after_separator())


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def smooth(obj):
    if obj and obj.type == "MESH":
        for poly in obj.data.polygons:
            poly.use_smooth = True
    return obj


def material(name, color, roughness=0.65, metallic=0.0, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        if "Base Color" in bsdf.inputs:
            bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        if "Roughness" in bsdf.inputs:
            bsdf.inputs["Roughness"].default_value = roughness
        if "Metallic" in bsdf.inputs:
            bsdf.inputs["Metallic"].default_value = metallic
        if emission is not None:
            if "Emission Color" in bsdf.inputs:
                bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
            elif "Emission" in bsdf.inputs:
                bsdf.inputs["Emission"].default_value = (*emission, 1.0)
            if "Emission Strength" in bsdf.inputs:
                bsdf.inputs["Emission Strength"].default_value = strength
    return m


def uv(name, loc, scale, mat, segments=32, rings=20):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    smooth(o)
    o.data.materials.append(mat)
    return o


def ico(name, loc, scale, mat, subdivisions=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1.0, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    smooth(o)
    o.data.materials.append(mat)
    return o


def cylinder(name, loc, radius, depth, mat, rotation=(0.0, 0.0, 0.0), scale=(1.0, 1.0, 1.0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=radius, depth=depth, location=loc, rotation=rotation)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    smooth(o)
    o.data.materials.append(mat)
    return o


def cone(name, base, direction, length, radius, mat):
    direction = Vector(direction).normalized()
    center = Vector(base) + direction * (length * 0.5)
    bpy.ops.mesh.primitive_cone_add(vertices=28, radius1=radius, radius2=0.006, depth=length, location=center)
    o = bpy.context.object
    o.name = name
    o.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    smooth(o)
    o.data.materials.append(mat)
    return o


def look_at(obj, target):
    direction = Vector(target) - obj.matrix_world.translation
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_area(name, loc, energy, size, color, target):
    data = bpy.data.lights.new(name, type="AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    look_at(obj, target)
    return obj


def animation_fcurves(obj, data_path, indices):
    """Return matching curves across Blender's legacy and layered Action APIs."""
    animation = obj.animation_data
    action = animation.action if animation else None
    if not action:
        return []

    ensure = getattr(action, "fcurve_ensure_for_datablock", None)
    if ensure:
        return [ensure(obj, data_path, index=index) for index in indices]

    return [
        fc for fc in getattr(action, "fcurves", ())
        if fc.data_path == data_path and fc.array_index in indices
    ]


def build_wolf(frames: int = 240):
    dark = material("WolfDark", (0.055, 0.065, 0.075), 0.92)
    grey = material("WolfGrey", (0.25, 0.29, 0.33), 0.92)
    light = material("WolfLight", (0.54, 0.59, 0.64), 0.94)
    black = material("WolfBlack", (0.008, 0.009, 0.012), 0.5)
    ivory = material("WolfTeeth", (0.90, 0.86, 0.72), 0.36)
    tongue = material("WolfTongue", (0.32, 0.045, 0.060), 0.55)

    body = uv("Wolf_Body", (0.25, 0.0, 2.30), (1.45, 0.62, 0.72), grey, 40, 24)
    chest = uv("Wolf_Chest", (-0.78, 0.0, 2.55), (0.76, 0.69, 0.92), light, 36, 22)
    neck = uv("Wolf_Neck", (-1.42, 0.0, 3.05), (0.54, 0.50, 0.86), dark, 36, 22)
    head = uv("Wolf_Head", (-1.92, 0.0, 3.80), (0.66, 0.51, 0.60), grey, 40, 24)
    muzzle = uv("Wolf_Muzzle", (-2.18, 0.0, 4.23), (0.62, 0.34, 0.31), light, 36, 22)
    uv("Wolf_Nose", (-2.30, 0.0, 4.58), (0.16, 0.19, 0.16), black, 32, 18)
    mouth = uv("Wolf_Mouth", (-2.12, 0.0, 3.96), (0.38, 0.26, 0.20), black, 32, 18)
    jaw = uv("Wolf_Jaw", (-2.08, 0.0, 3.67), (0.48, 0.31, 0.15), light, 34, 20)
    uv("Wolf_Tongue", (-2.25, 0.0, 3.70), (0.30, 0.12, 0.07), tongue, 28, 16)

    for idx, y in enumerate((0.19, -0.19), 1):
        cone(f"Wolf_Fang_{idx}", (-2.16, y, 4.02), (-0.12, 0.0, -1.0), 0.30, 0.075, ivory)
    for side, y in (("L", 0.33), ("R", -0.33)):
        cone(f"Wolf_Ear_{side}", (-1.88, y, 4.16), (-0.10, 0.0, 1.0), 0.90, 0.27, dark)
        uv(f"Wolf_Eye_{side}", (-2.08, y * 0.72, 4.05), (0.075, 0.055, 0.065), ivory, 24, 14)
        uv(f"Wolf_Pupil_{side}", (-2.13, y * 0.72, 4.06), (0.028, 0.030, 0.045), black, 20, 12)

    for idx, y in enumerate((0.36, -0.36), 1):
        cylinder(f"Wolf_FrontLeg_{idx}", (-0.86, y, 1.52), 0.17, 1.30, grey)
        uv(f"Wolf_FrontPaw_{idx}", (-0.98, y, 0.83), (0.34, 0.25, 0.14), dark, 28, 16)
    for idx, y in enumerate((0.38, -0.38), 1):
        uv(f"Wolf_RearThigh_{idx}", (1.05, y, 1.72), (0.48, 0.33, 0.63), grey, 32, 18)
        cylinder(f"Wolf_RearLeg_{idx}", (1.25, y, 1.12), 0.15, 0.82, light)
        uv(f"Wolf_RearPaw_{idx}", (1.18, y, 0.75), (0.34, 0.25, 0.14), dark, 28, 16)

    # Tail as three tapered masses for a readable silhouette.
    tail1 = uv("Wolf_Tail_1", (1.55, 0.0, 2.34), (0.72, 0.31, 0.29), dark, 30, 18)
    tail1.rotation_euler[1] = math.radians(-28)
    tail2 = uv("Wolf_Tail_2", (2.08, 0.0, 2.15), (0.66, 0.25, 0.24), grey, 30, 18)
    tail2.rotation_euler[1] = math.radians(-18)
    cone("Wolf_Tail_Tip", (2.45, 0.0, 2.05), (1.0, 0.0, -0.15), 0.70, 0.22, dark)

    # Stylized fur tufts.
    for i, x in enumerate((-1.25, -0.95, -0.65, -0.30, 0.05, 0.42, 0.80, 1.15)):
        cone(f"Wolf_BackFur_{i}", (x, 0.0, 3.05 - 0.08 * i), (0.05, 0.0, 1.0), 0.34, 0.085, dark if i % 2 == 0 else light)
    for i, y in enumerate((-0.36, -0.18, 0.0, 0.18, 0.36)):
        cone(f"Wolf_ChestFur_{i}", (-1.05, y, 2.50), (-0.18, y * 0.25, -1.0), 0.48, 0.09, light)

    # Gentle howl motion: head + muzzle + jaw. Small enough to preserve framing.
    animated = [head, muzzle, mouth, jaw]
    start = 1
    mid = max(2, 1 + frames // 2)
    end_plus = frames + 1
    for obj in animated:
        obj.rotation_mode = "XYZ"
        base = obj.rotation_euler.copy()
        obj.rotation_euler = base
        obj.keyframe_insert(data_path="rotation_euler", frame=start)
        obj.rotation_euler[1] = base[1] - math.radians(3.0 if obj is not jaw else 1.0)
        obj.keyframe_insert(data_path="rotation_euler", frame=mid)
        obj.rotation_euler = base
        obj.keyframe_insert(data_path="rotation_euler", frame=end_plus)
        for fc in animation_fcurves(obj, "rotation_euler", range(3)):
            for kp in fc.keyframe_points:
                kp.interpolation = "BEZIER"
    return body, chest, neck, head


def build_world():
    rock_mat = material("Rock", (0.045, 0.055, 0.075), 0.98)
    rock_top = material("RockTop", (0.075, 0.095, 0.125), 0.96)
    moon_mat = material("Moon", (0.75, 0.84, 1.0), 0.3, emission=(0.62, 0.76, 1.0), strength=5.0)
    ground_mat = material("Ground", (0.012, 0.018, 0.030), 1.0)

    ico("Main_Rock", (0.1, 0.0, 0.52), (2.8, 2.0, 0.85), rock_mat, 3)
    ico("Rock_Shelf", (-0.15, 0.0, 0.98), (2.15, 1.35, 0.35), rock_top, 2)
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0.0, 0.0, -0.05))
    bpy.context.object.name = "NOVA_GROUND"
    bpy.context.object.data.materials.append(ground_mat)
    uv("Moon", (-1.0, 8.5, 10.0), (1.75, 1.75, 1.75), moon_mat, 48, 28)

    scene = bpy.context.scene
    scene.world.color = (0.006, 0.010, 0.025)
    add_area("Moon_Key", (-1.0, 5.5, 9.0), 1400, 5.0, (0.36, 0.54, 1.0), (-1.1, 0.0, 3.0))
    add_area("Blue_Rim", (5.0, -4.5, 6.0), 900, 4.0, (0.12, 0.30, 1.0), (-0.5, 0.0, 3.0))
    add_area("Face_Fill", (-4.8, -3.4, 5.0), 260, 3.0, (0.20, 0.30, 0.50), (-1.9, 0.0, 4.0))


def setup_orbit(frames: int):
    scene = bpy.context.scene
    target = Vector((-0.45, 0.0, 2.75))
    target_obj = bpy.data.objects.new("NOVA_WOLF_TARGET", None)
    bpy.context.collection.objects.link(target_obj)
    target_obj.location = target

    rig = bpy.data.objects.new("NOVA_WOLF_ORBIT_RIG", None)
    bpy.context.collection.objects.link(rig)
    rig.location = target
    rig.rotation_mode = "XYZ"

    data = bpy.data.cameras.new("NOVA_WOLF_CAMERA")
    cam = bpy.data.objects.new("NOVA_WOLF_CAMERA", data)
    bpy.context.collection.objects.link(cam)
    cam.parent = rig
    cam.location = (8.8, 0.0, 1.75)
    data.lens = 52
    data.sensor_width = 36
    track = cam.constraints.new(type="DAMPED_TRACK")
    track.target = target_obj
    track.track_axis = "TRACK_NEGATIVE_Z"
    scene.camera = cam

    rig.rotation_euler = (0.0, 0.0, math.radians(218))
    rig.keyframe_insert(data_path="rotation_euler", index=2, frame=1)
    rig.rotation_euler = (0.0, 0.0, math.radians(218) + math.tau)
    rig.keyframe_insert(data_path="rotation_euler", index=2, frame=frames + 1)
    for fc in animation_fcurves(rig, "rotation_euler", (2,)):
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"

    return cam, rig, target_obj


def camera_position(scene, cam, frame):
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    return cam.matrix_world.translation.copy()


def verify_orbit(scene, cam, frames):
    current = scene.frame_current
    try:
        p0 = camera_position(scene, cam, 1)
        pm = camera_position(scene, cam, max(2, frames // 2))
        pn = camera_position(scene, cam, frames + 1)
    finally:
        scene.frame_set(current)
    return {
        "ok": (pm - p0).length > 0.5 and (pn - p0).length < 0.01,
        "camera_moves": float((pm - p0).length),
        "loop_seam": float((pn - p0).length),
        "frames": frames,
    }


def configure_render(args, output: Path):
    scene = bpy.context.scene
    render_fps = min(int(args.fps), 2) if args.ci_smoke else int(args.fps)
    frames = max(render_fps, int(round(args.duration * render_fps)))
    scene.frame_start = 1
    scene.frame_end = frames
    scene.render.fps = render_fps
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except Exception:
        try:
            scene.render.engine = "BLENDER_EEVEE"
        except Exception:
            pass

    if args.ratio == "16:9":
        resolution = (1920, 1080) if args.quality == "final" else (960, 540)
        render_resolution = (320, 180) if args.ci_smoke else resolution
    else:
        resolution = (1080, 1920) if args.quality == "final" else (540, 960)
        render_resolution = (180, 320) if args.ci_smoke else resolution
    scene.render.resolution_x, scene.render.resolution_y = render_resolution
    scene.render.resolution_percentage = 100
    raw = output.with_name(output.stem + ".blender.mp4")
    try:
        scene.render.image_settings.file_format = "FFMPEG"
        scene.render.ffmpeg.format = "MPEG4"
        scene.render.ffmpeg.codec = "H264"
        scene.render.ffmpeg.constant_rate_factor = "MEDIUM"
        scene.render.filepath = str(raw)
    except (TypeError, ValueError):
        # Some Blender 5.x Linux builds omit the built-in FFMPEG output enum.
        # Render lossless frames and let the system ffmpeg create the MP4.
        raw = output.with_name(output.stem + "_frames")
        if raw.exists():
            shutil.rmtree(raw)
        raw.mkdir(parents=True)
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = str(raw / "frame_")
    return frames, raw, resolution, render_fps, render_resolution


def faststart(raw: Path, output: Path, input_fps: int, output_fps: int, output_resolution):
    ffmpeg = shutil.which("ffmpeg")
    video_filter = (
        f"scale={output_resolution[0]}:{output_resolution[1]}:"
        f"flags=lanczos,fps={output_fps}"
    )
    if raw.is_dir():
        if not ffmpeg:
            raise RuntimeError("ffmpeg is required to encode Blender PNG frames")
        subprocess.run([
            ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
            "-framerate", str(input_fps), "-start_number", "1",
            "-i", str(raw / "frame_%04d.png"),
            "-vf", video_filter,
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", "-an", str(output)
        ], check=True)
        shutil.rmtree(raw)
        return
    if not ffmpeg:
        if raw != output:
            shutil.move(str(raw), str(output))
        return
    subprocess.run([
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(raw),
        "-vf", video_filter,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", str(output)
    ], check=True)
    if raw != output:
        raw.unlink(missing_ok=True)


def main():
    args = parse_args()
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    clear_scene()
    frames, raw, resolution, render_fps, render_resolution = configure_render(args, output)
    build_world()
    build_wolf(frames)
    cam, rig, target = setup_orbit(frames)
    report = verify_orbit(bpy.context.scene, cam, frames)
    report.update({
        "marker": MARKER,
        "duration": args.duration,
        "fps": args.fps,
        "render_fps": render_fps,
        "ratio": args.ratio,
        "quality": args.quality,
        "ci_smoke": args.ci_smoke,
        "resolution": list(resolution),
        "render_resolution": list(render_resolution),
        "output": str(output),
        "camera": cam.name,
        "rig": rig.name,
        "target": target.name,
        "paid_api": False,
    })
    report_path = output.with_suffix(".wolf-report.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if not report["ok"]:
        raise RuntimeError(f"Wolf orbit verification failed: {report_path}")

    bpy.ops.wm.save_as_mainfile(filepath=str(output.with_suffix(".blend")))
    scene = bpy.context.scene
    scene.frame_set(1)
    bpy.ops.render.render(animation=True)
    if raw.is_dir():
        if not any(raw.glob("frame_*.png")):
            raise RuntimeError(f"Blender did not produce frame sequence: {raw}")
    elif not raw.is_file() or raw.stat().st_size <= 0:
        raise RuntimeError(f"Blender did not produce video: {raw}")
    faststart(raw, output, render_fps, args.fps, resolution)
    if not output.is_file() or output.stat().st_size <= 0:
        raise RuntimeError(f"Final MP4 is missing: {output}")
    print("NOVA WOLF AUTO READY:", output)
    print("REPORT:", report_path)


if __name__ == "__main__":
    main()
