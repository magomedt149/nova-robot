#!/usr/bin/env python3
"""Render a true continuous Blender camera orbit around one persistent 3D subject.

Run:
  blender -b --python blender-colab/scripts/render_true_orbit.py -- \
    --asset car.glb --duration 5 --fps 30 --ratio 9:16 --degrees 360 \
    --output NOVA_true_orbit.mp4

If --asset is omitted, a clearly labelled proxy car is created for blockout only.
No network calls or paid APIs are used.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def argv_after_separator():
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--asset", help="Licensed/user-owned .glb/.gltf/.fbx/.obj/.blend asset")
    ap.add_argument("--output", default="NOVA_true_orbit.mp4")
    ap.add_argument("--duration", type=float, default=5.0)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--ratio", choices=["9:16", "16:9"], default="9:16")
    ap.add_argument("--degrees", type=float, default=360.0)
    ap.add_argument("--radius", type=float, default=0.0, help="0 = auto from subject bounds")
    ap.add_argument("--camera-height", type=float, default=0.0, help="0 = auto")
    ap.add_argument("--lens", type=float, default=35.0)
    ap.add_argument("--quality", choices=["preview", "final"], default="preview")
    ap.add_argument("--clockwise", action="store_true")
    return ap.parse_args(argv_after_separator())


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def make_material(name, color, metallic=0.0, roughness=0.45):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = roughness
    return mat


def add_cube(name, location, scale, mat):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    return obj


def add_wheel(name, location, radius, width, mat):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=48, radius=radius, depth=width, location=location, rotation=(math.pi / 2, 0, 0)
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def create_proxy_car():
    """Simple geometry proxy. This is NOT an exact branded vehicle model."""
    body_mat = make_material("ProxyBody", (0.018, 0.022, 0.03), metallic=0.75, roughness=0.22)
    glass_mat = make_material("ProxyGlass", (0.025, 0.05, 0.075), metallic=0.2, roughness=0.12)
    tire_mat = make_material("ProxyTire", (0.012, 0.012, 0.012), metallic=0.0, roughness=0.65)
    objects = []
    objects.append(add_cube("PROXY_CAR_BODY", (0, 0, 0.72), (2.15, 0.90, 0.34), body_mat))
    hood = add_cube("PROXY_CAR_HOOD", (0.62, 0, 1.02), (1.25, 0.86, 0.16), body_mat)
    objects.append(hood)
    cabin = add_cube("PROXY_CAR_CABIN", (-0.42, 0, 1.28), (0.92, 0.74, 0.38), glass_mat)
    cabin.rotation_euler[1] = math.radians(-6)
    objects.append(cabin)
    rear = add_cube("PROXY_CAR_REAR", (-1.45, 0, 0.92), (0.62, 0.88, 0.22), body_mat)
    objects.append(rear)
    for x in (-1.32, 1.30):
        for y in (-0.93, 0.93):
            objects.append(add_wheel(f"PROXY_WHEEL_{x}_{y}", (x, y, 0.49), 0.43, 0.27, tire_mat))
    return objects


def import_asset(path: Path):
    ext = path.suffix.lower()
    if ext in {".glb", ".gltf"}:
        bpy.ops.import_scene.gltf(filepath=str(path))
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(path))
    elif ext == ".obj":
        try:
            bpy.ops.wm.obj_import(filepath=str(path))
        except Exception:
            bpy.ops.import_scene.obj(filepath=str(path))
    elif ext == ".blend":
        with bpy.data.libraries.load(str(path), link=False) as (src, dst):
            dst.objects = list(src.objects)
        for obj in dst.objects:
            if obj and obj.name not in bpy.context.scene.objects:
                bpy.context.collection.objects.link(obj)
    else:
        raise RuntimeError(f"Unsupported asset format: {ext}")
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def bounds_world(objects):
    points = []
    for obj in objects:
        for corner in obj.bound_box:
            points.append(obj.matrix_world @ Vector(corner))
    if not points:
        raise RuntimeError("No mesh geometry found for orbit target")
    mn = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    mx = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return mn, mx


def add_ground(min_z, center, radius):
    mat = make_material("Ground", (0.025, 0.03, 0.04), metallic=0.05, roughness=0.34)
    bpy.ops.mesh.primitive_plane_add(size=max(20.0, radius * 4.0), location=(center.x, center.y, min_z - 0.02))
    ground = bpy.context.object
    ground.name = "NOVA_GROUND"
    ground.data.materials.append(mat)
    return ground


def add_lighting(center, radius, height):
    scene = bpy.context.scene
    scene.world.color = (0.018, 0.022, 0.035)
    for idx, (dx, dy, dz, power, size) in enumerate([
        (radius * 0.55, -radius * 0.55, height + 3.5, 1200, 5.0),
        (-radius * 0.6, radius * 0.25, height + 2.5, 800, 4.0),
        (0, radius * 0.75, height + 4.5, 900, 4.5),
    ]):
        bpy.ops.object.light_add(type="AREA", location=(center.x + dx, center.y + dy, dz))
        light = bpy.context.object
        light.name = f"NOVA_AREA_{idx+1}"
        light.data.energy = power
        light.data.shape = "DISK"
        light.data.size = size


def setup_orbit_camera(center, dims, args):
    scene = bpy.context.scene
    radius = args.radius if args.radius > 0 else max(dims.x, dims.y) * 1.65 + 1.5
    camera_z = args.camera_height if args.camera_height > 0 else center.z + max(1.2, dims.z * 0.40)
    target_z = center.z + dims.z * 0.08

    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(center.x, center.y, target_z))
    target = bpy.context.object
    target.name = "NOVA_ORBIT_TARGET"

    bpy.ops.curve.primitive_bezier_circle_add(radius=radius, location=(center.x, center.y, camera_z))
    path = bpy.context.object
    path.name = "NOVA_CAMERA_ORBIT_PATH"
    path.data.resolution_u = 24
    path.data.render_resolution_u = 24

    bpy.ops.object.camera_add(location=(center.x + radius, center.y, camera_z))
    cam = bpy.context.object
    cam.name = "NOVA_CAMERA"
    cam.data.lens = args.lens
    cam.data.sensor_width = 36.0
    scene.camera = cam

    follow = cam.constraints.new(type="FOLLOW_PATH")
    follow.name = "NOVA_TRUE_ORBIT"
    follow.target = path
    follow.use_fixed_location = True
    follow.use_curve_follow = False

    track = cam.constraints.new(type="TRACK_TO")
    track.name = "NOVA_TARGET_LOCK"
    track.target = target
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"

    frame_start = 1
    frame_end = max(2, int(round(args.duration * args.fps)))
    scene.frame_start = frame_start
    scene.frame_end = frame_end
    fraction = max(-1.0, min(1.0, args.degrees / 360.0))
    if args.clockwise:
        fraction = -abs(fraction)

    follow.offset_factor = 0.0
    follow.keyframe_insert(data_path="offset_factor", frame=frame_start)
    follow.offset_factor = fraction
    follow.keyframe_insert(data_path="offset_factor", frame=frame_end)

    action = cam.animation_data.action if cam.animation_data else None
    if action:
        for fc in action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"

    return cam, path, target, radius, frame_start, frame_end


def configure_render(args, output: Path):
    scene = bpy.context.scene
    scene.render.fps = args.fps
    if args.ratio == "9:16":
        width, height = ((720, 1280) if args.quality == "preview" else (1080, 1920))
    else:
        width, height = ((1280, 720) if args.quality == "preview" else (1920, 1080))
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except Exception:
        try:
            scene.render.engine = "BLENDER_EEVEE"
        except Exception:
            pass
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    try:
        scene.render.ffmpeg.constant_rate_factor = "MEDIUM"
    except Exception:
        pass
    raw = output.with_name(output.stem + ".blender.mp4")
    scene.render.filepath = str(raw)
    return raw, width, height


def camera_location(scene, cam, frame):
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    return cam.matrix_world.translation.copy()


def verify_orbit(scene, cam, objects, frame_start, frame_end, degrees):
    before = {o.name: [list(row) for row in o.matrix_world] for o in objects}
    p0 = camera_location(scene, cam, frame_start)
    pm = camera_location(scene, cam, (frame_start + frame_end) // 2)
    p1 = camera_location(scene, cam, frame_end)
    closure = (p1 - p0).length
    travelled = (pm - p0).length
    after = {o.name: [list(row) for row in o.matrix_world] for o in objects}
    subject_static = before == after
    full = abs(abs(degrees) - 360.0) < 1e-6
    ok = travelled > 0.1 and subject_static and (not full or closure < 0.02)
    return {
        "ok": ok,
        "true_3d_scene": True,
        "continuous_shot": True,
        "camera_moves_in_world_space": travelled > 0.1,
        "subject_static": subject_static,
        "requested_degrees": degrees,
        "start_camera": list(map(float, p0)),
        "mid_camera": list(map(float, pm)),
        "end_camera": list(map(float, p1)),
        "start_end_distance": float(closure),
        "mid_displacement": float(travelled),
    }


def transcode_faststart(raw: Path, output: Path):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        if raw != output:
            shutil.move(str(raw), str(output))
        return
    subprocess.run(
        [
            ffmpeg, "-y", "-i", str(raw),
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", "-an", str(output)
        ],
        check=True,
    )
    raw.unlink(missing_ok=True)


def main():
    args = parse_args()
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    clear_scene()
    proxy = not bool(args.asset)
    if args.asset:
        asset = Path(args.asset).expanduser().resolve()
        if not asset.is_file():
            raise RuntimeError(f"Asset not found: {asset}")
        import_asset(asset)
    else:
        create_proxy_car()

    subjects = mesh_objects()
    mn, mx = bounds_world(subjects)
    center = (mn + mx) * 0.5
    dims = mx - mn
    ground = add_ground(mn.z, center, max(dims.x, dims.y) * 1.65 + 1.5)
    subjects = [o for o in mesh_objects() if o != ground]
    add_lighting(center, max(dims.x, dims.y) * 1.65 + 1.5, mx.z)

    cam, path, target, radius, frame_start, frame_end = setup_orbit_camera(center, dims, args)
    raw, width, height = configure_render(args, output)
    report = verify_orbit(bpy.context.scene, cam, subjects, frame_start, frame_end, args.degrees)
    report.update({
        "proxy_subject": proxy,
        "asset": str(Path(args.asset).expanduser().resolve()) if args.asset else None,
        "output": str(output),
        "duration": args.duration,
        "fps": args.fps,
        "resolution": [width, height],
        "ratio": args.ratio,
        "radius": radius,
        "camera_path_object": path.name,
        "target_object": target.name,
    })

    verify_path = output.with_suffix(".orbit.json")
    verify_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    if not report["ok"]:
        raise RuntimeError(f"Orbit quality gate failed. See {verify_path}")

    bpy.ops.wm.save_as_mainfile(filepath=str(output.with_suffix(".blend")))
    bpy.ops.render.render(animation=True)
    if not raw.is_file():
        raise RuntimeError(f"Blender did not create expected video: {raw}")
    transcode_faststart(raw, output)
    print("NOVA TRUE ORBIT READY:", output)
    print("VERIFY:", verify_path)
    print("PROXY:", proxy)


if __name__ == "__main__":
    main()
