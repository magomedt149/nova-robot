import bpy
import json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent
EXPORT_DIR = ROOT / "exports"
EXPORT_DIR.mkdir(parents=True, exist_ok=True)
GLB_PATH = EXPORT_DIR / "wolf_motion_smoke.glb"
REPORT_PATH = EXPORT_DIR / "wolf_motion_smoke_report.json"
FPS = 24
SPECS = {
    "WOLF_IDLE": (72, True),
    "WOLF_WALK": (48, True),
    "WOLF_RUN": (24, True),
    "WOLF_HOWL": (84, False),
}


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)


def create_proxy():
    # Minimal but valid skinned mesh + armature.  The old proxy had an
    # Armature modifier without any vertex weights, which trips Blender 4.0's
    # glTF exporter while it tries to create neutral bones.
    bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 1.0))
    body = bpy.context.object
    body.name = "WOLF_PROXY_BODY"
    body.scale = (1.8, 0.55, 0.65)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
    rig = bpy.context.object
    rig.name = "WOLF_PROXY_RIG"
    bone = rig.data.edit_bones[0]
    bone.name = "root"
    bone.head = Vector((0, 0, 0.3))
    bone.tail = Vector((0, 0, 1.8))
    bpy.ops.object.mode_set(mode="OBJECT")

    # Give every vertex a real deform weight for the root bone so the GLB
    # contains a proper skin/joint relationship instead of a dangling rig.
    group = body.vertex_groups.new(name="root")
    group.add([vertex.index for vertex in body.data.vertices], 1.0, "REPLACE")

    body.parent = rig
    body.parent_type = "OBJECT"
    modifier = body.modifiers.new(name="Armature", type="ARMATURE")
    modifier.object = rig
    modifier.use_vertex_groups = True

    # Keep object transforms clean and make sure both objects are enabled for export.
    body.hide_render = False
    rig.hide_render = False
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    body.select_set(True)
    return body, rig


def make_actions(rig):
    rig.animation_data_create()
    for index, (name, (frames, loop)) in enumerate(SPECS.items()):
        action = bpy.data.actions.new(name=name)
        fc = action.fcurves.new(data_path="location", index=2)
        z0 = rig.location.z
        fc.keyframe_points.insert(1, z0)
        fc.keyframe_points.insert(max(2, frames // 2), z0 + 0.03 * (index + 1))
        fc.keyframe_points.insert(frames, z0 if loop else z0 + 0.02)
        action["frames"] = frames
        action["loop"] = loop
        action.use_fake_user = True

        track = rig.animation_data.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name=name, start=1, action=action)
        strip.action_frame_start = 1
        strip.action_frame_end = frames

    rig.animation_data.action = None


def configure_scene():
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.render.fps_base = 1.0
    scene.frame_start = 1
    scene.frame_end = 84


def export_glb():
    bpy.ops.object.select_all(action="SELECT")
    result = bpy.ops.export_scene.gltf(
        filepath=str(GLB_PATH),
        export_format="GLB",
        export_animations=True,
        export_nla_strips=True,
        export_yup=True,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"GLB exporter returned {result}")


def validate():
    if not GLB_PATH.exists() or GLB_PATH.stat().st_size < 1000:
        raise RuntimeError("GLB export missing or unexpectedly small")
    names = sorted(action.name for action in bpy.data.actions)
    expected = sorted(SPECS.keys())
    if names != expected:
        raise RuntimeError(f"Action mismatch: expected={expected}, actual={names}")
    report = {
        "status": "PASS",
        "blender_version": bpy.app.version_string,
        "fps": FPS,
        "glb": GLB_PATH.name,
        "glb_bytes": GLB_PATH.stat().st_size,
        "actions": names,
        "skinned_proxy": True,
        "note": "FREE headless Blender proxy smoke test; no paid API and no AI credits used."
    }
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("WOLF_SMOKE_TEST_PASS")
    print(json.dumps(report, ensure_ascii=False))


def main():
    clear_scene()
    configure_scene()
    _, rig = create_proxy()
    make_actions(rig)
    export_glb()
    validate()


if __name__ == "__main__":
    main()
