#!/usr/bin/env python3
"""Create a Blender 3D blocking scene and render a pose-control video.

Run with Blender:
  blender --background --python make_blender_control.py -- \
    --motion motion.json --output-dir /content/TUMSOEV_CONTROL
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector


JOINT_IDS = (0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 33, 34)
LIMBS = (
    (11, 12),
    (11, 13),
    (13, 15),
    (12, 14),
    (14, 16),
    (11, 23),
    (12, 24),
    (23, 24),
    (23, 25),
    (25, 27),
    (24, 26),
    (26, 28),
    (0, 33),
    (33, 34),
)
PALETTE = (
    (1.00, 0.18, 0.08, 1.0),
    (1.00, 0.58, 0.05, 1.0),
    (0.96, 0.93, 0.08, 1.0),
    (0.15, 0.95, 0.30, 1.0),
    (0.05, 0.82, 1.00, 1.0),
    (0.16, 0.32, 1.00, 1.0),
    (0.66, 0.18, 1.00, 1.0),
    (1.00, 0.08, 0.68, 1.0),
)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--motion", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--width", type=int, default=432)
    parser.add_argument("--height", type=int, default=768)
    return parser.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def emission_material(name: str, color: tuple[float, float, float, float]):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = color
    emission.inputs["Strength"].default_value = 2.0
    material.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def add_joint(name: str, material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=0.085)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    return obj


def add_limb(name: str, material):
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=1.0, depth=2.0)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.data.materials.append(material)
    return obj


def camera_look_at(camera, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def to_scene_point(raw: list[float]) -> Vector:
    x, y, depth = raw[:3]
    return Vector(((x - 0.5) * 3.6, -max(-1.0, min(1.0, depth)) * 1.3, (0.5 - y) * 6.4))


def frame_points(landmarks: list[list[float]]) -> dict[int, tuple[Vector, float]]:
    points = {index: (to_scene_point(landmarks[index]), float(landmarks[index][3])) for index in JOINT_IDS if index < 33}
    neck = (points[11][0] + points[12][0]) * 0.5
    pelvis = (points[23][0] + points[24][0]) * 0.5
    points[33] = (neck, min(points[11][1], points[12][1]))
    points[34] = (pelvis, min(points[23][1], points[24][1]))
    return points


def keyframe_object(obj, frame: int) -> None:
    obj.keyframe_insert(data_path="location", frame=frame)
    obj.keyframe_insert(data_path="rotation_quaternion", frame=frame)
    obj.keyframe_insert(data_path="scale", frame=frame)


def make_linear(obj) -> None:
    if obj.animation_data is None or obj.animation_data.action is None:
        return
    for curve in obj.animation_data.action.fcurves:
        for key in curve.keyframe_points:
            key.interpolation = "LINEAR"


def main() -> None:
    args = parse_args()
    payload = json.loads(args.motion.read_text(encoding="utf-8"))
    frames = payload.get("frames") or []
    if not frames:
        raise RuntimeError("The motion JSON has no frames")
    fps = max(1, round(float(payload.get("fps") or 24)))
    args.output_dir.mkdir(parents=True, exist_ok=True)

    clear_scene()
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = len(frames)
    scene.render.fps = fps
    scene.render.resolution_x = args.width
    scene.render.resolution_y = args.height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "MEDIUM"
    scene.render.filepath = str(args.output_dir / "blender_pose_control.mp4")
    scene.render.film_transparent = False

    if hasattr(scene, "eevee"):
        scene.render.engine = "BLENDER_EEVEE"
    else:
        try:
            scene.render.engine = "BLENDER_EEVEE_NEXT"
        except Exception:
            scene.render.engine = "BLENDER_WORKBENCH"

    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    if background:
        background.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
        background.inputs["Strength"].default_value = 0.0

    white = emission_material("Joint_White", (1.0, 1.0, 1.0, 1.0))
    limb_materials = [emission_material(f"Limb_{i:02d}", PALETTE[i % len(PALETTE)]) for i in range(len(LIMBS))]
    joints = {index: add_joint(f"Joint_{index:02d}", white) for index in JOINT_IDS}
    limbs = {
        pair: add_limb(f"Limb_{pair[0]:02d}_{pair[1]:02d}", limb_materials[i])
        for i, pair in enumerate(LIMBS)
    }

    for frame_number, item in enumerate(frames, start=1):
        points = frame_points(item["landmarks"])
        for index, obj in joints.items():
            position, visibility = points[index]
            obj.location = position
            radius = 1.0 if visibility >= 0.2 else 0.02
            obj.scale = (radius, radius, radius)
            obj.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
            keyframe_object(obj, frame_number)

        for pair, obj in limbs.items():
            start, start_visibility = points[pair[0]]
            end, end_visibility = points[pair[1]]
            delta = end - start
            length = max(delta.length, 0.001)
            visible = min(start_visibility, end_visibility) >= 0.2
            thickness = 0.055 if visible else 0.001
            obj.location = (start + end) * 0.5
            obj.rotation_quaternion = delta.to_track_quat("Z", "Y")
            obj.scale = (thickness, thickness, length * 0.5)
            keyframe_object(obj, frame_number)

    for obj in (*joints.values(), *limbs.values()):
        make_linear(obj)

    camera_data = bpy.data.cameras.new("Control_Camera")
    camera = bpy.data.objects.new("Control_Camera", camera_data)
    scene.collection.objects.link(camera)
    camera.location = (0.0, -12.0, 0.0)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 7.2
    camera_look_at(camera, Vector((0.0, 0.0, 0.0)))
    scene.camera = camera

    try:
        scene.view_settings.look = "Medium High Contrast"
    except Exception:
        pass

    blend_path = args.output_dir / "tumsoev_motion_blocking.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    bpy.ops.render.render(animation=True)
    print(f"BLEND={blend_path}")
    print(f"VIDEO={scene.render.filepath}")


if __name__ == "__main__":
    main()
