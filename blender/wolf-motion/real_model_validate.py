import bpy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MODEL = ROOT / "assets" / "model" / "wolf.glb"
EXPORT_DIR = ROOT / "exports"
EXPORT_DIR.mkdir(parents=True, exist_ok=True)
OUT_GLB = EXPORT_DIR / "wolf_real_pipeline_validation.glb"
REPORT = EXPORT_DIR / "real_model_validation_report.json"
FPS = 24
SPECS = {
    "WOLF_IDLE": (72, True),
    "WOLF_WALK": (48, True),
    "WOLF_RUN": (24, True),
    "WOLF_HOWL": (84, False),
}


def write_report(data):
    REPORT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(data, ensure_ascii=False, indent=2))


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def import_model():
    if not MODEL.exists():
        write_report({"status": "WAITING_FOR_WOLF_GLB", "model": str(MODEL)})
        raise SystemExit(0)
    bpy.ops.import_scene.gltf(filepath=str(MODEL))


def find_armature():
    arms = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    if not arms:
        return None
    return max(arms, key=lambda o: len(o.data.bones))


def ensure_actions(rig):
    rig.animation_data_create()
    for i, (name, (frames, loop)) in enumerate(SPECS.items()):
        action = bpy.data.actions.get(name) or bpy.data.actions.new(name=name)
        fc = action.fcurves.find("location", index=2)
        if fc is None:
            fc = action.fcurves.new(data_path="location", index=2)
        fc.keyframe_points.clear()
        z = rig.location.z
        fc.keyframe_points.insert(1, z)
        fc.keyframe_points.insert(max(2, frames // 2), z + 0.001 * (i + 1))
        fc.keyframe_points.insert(frames, z if loop else z + 0.001)
        action["tumsoev_frames"] = frames
        action["tumsoev_loop"] = loop
        action["tumsoev_structure_only"] = True
        action.use_fake_user = True
        track = rig.animation_data.nla_tracks.get(name) or rig.animation_data.nla_tracks.new()
        track.name = name
        for strip in list(track.strips):
            track.strips.remove(strip)
        track.strips.new(name=name, start=1, action=action)
    rig.animation_data.action = None


def export_glb():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(OUT_GLB),
        export_format="GLB",
        export_animations=True,
        export_nla_strips=True,
        export_yup=True,
    )


def main():
    clear_scene()
    bpy.context.scene.render.fps = FPS
    bpy.context.scene.render.fps_base = 1.0
    import_model()

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    rig = find_armature()
    if not meshes:
        write_report({"status": "FAIL_NO_MESH", "model": MODEL.name})
        raise SystemExit(2)
    if rig is None:
        write_report({
            "status": "NEEDS_RIG",
            "model": MODEL.name,
            "mesh_objects": len(meshes),
            "note": "Model imported, but no Armature was found. Rigging is required before animation retargeting."
        })
        raise SystemExit(3)

    ensure_actions(rig)
    export_glb()
    actions = sorted(a.name for a in bpy.data.actions if a.name in SPECS)
    if not OUT_GLB.exists() or OUT_GLB.stat().st_size < 1000:
        write_report({"status": "FAIL_EXPORT", "model": MODEL.name})
        raise SystemExit(4)

    report = {
        "status": "PASS_STRUCTURE_ONLY",
        "model": MODEL.name,
        "blender_version": bpy.app.version_string,
        "fps": FPS,
        "mesh_objects": len(meshes),
        "armature": rig.name,
        "bones": len(rig.data.bones),
        "actions": actions,
        "glb": OUT_GLB.name,
        "glb_bytes": OUT_GLB.stat().st_size,
        "important": "This validates the real model, rig, action slots and GLB export. It does NOT claim that Seedance motion has already been retargeted.",
        "paid_api_calls": 0,
    }
    write_report(report)


if __name__ == "__main__":
    main()
