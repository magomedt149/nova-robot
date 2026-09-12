import bpy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG = json.loads((ROOT / "workflow_config.json").read_text(encoding="utf-8"))
FPS = int(CONFIG.get("fps", 24))
ORDER = ["idle", "walk", "run", "howl"]


def log(message):
    print(f"[WOLF-MOTION] {message}")


def set_scene():
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.render.fps_base = 1.0
    scene.frame_start = 1
    scene.frame_end = max(round(v["seconds"] * FPS) for v in CONFIG["motion_refs"].values())
    log(f"Scene configured at {FPS} fps")


def import_model_if_present():
    model_path = ROOT / CONFIG["model_file"]
    if not model_path.exists():
        log(f"Model not present yet: {model_path}")
        return False
    if any(obj.type in {"MESH", "ARMATURE"} for obj in bpy.context.scene.objects):
        log("Scene already contains model objects; import skipped")
        return True
    suffix = model_path.suffix.lower()
    if suffix in {".glb", ".gltf"}:
        bpy.ops.import_scene.gltf(filepath=str(model_path))
    elif suffix == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(model_path))
    else:
        raise RuntimeError(f"Unsupported model format: {suffix}")
    log(f"Imported {model_path.name}")
    return True


def find_armature():
    arms = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if not arms:
        return None
    return max(arms, key=lambda obj: len(obj.data.bones))


def ensure_actions(armature):
    if armature is None:
        log("No armature yet; action creation deferred")
        return
    armature.animation_data_create()
    for key in ORDER:
        item = CONFIG["motion_refs"][key]
        name = CONFIG["actions"][key]
        frames = max(2, int(round(float(item["seconds"]) * FPS)))
        action = bpy.data.actions.get(name) or bpy.data.actions.new(name=name)
        curve = action.fcurves.find("location", index=2)
        if curve is None:
            curve = action.fcurves.new(data_path="location", index=2)
        curve.keyframe_points.clear()
        curve.keyframe_points.insert(1, armature.location.z)
        curve.keyframe_points.insert(frames, armature.location.z)
        action.use_fake_user = True
        action["duration_seconds"] = float(item["seconds"])
        action["frames"] = frames
        action["loop"] = bool(item["loop"])
        log(f"Prepared {name}: {frames} frames, loop={item['loop']}")
    armature.animation_data.action = bpy.data.actions.get(CONFIG["actions"]["idle"])


def load_motion_refs():
    scene = bpy.context.scene
    if scene.sequence_editor is None:
        scene.sequence_editor_create()
    seqs = scene.sequence_editor.sequences
    for strip in list(seqs):
        if strip.name.startswith("WOLF_REF_"):
            seqs.remove(strip)
    channel = 1
    for key in ORDER:
        ref_path = ROOT / CONFIG["motion_refs"][key]["file"]
        if not ref_path.exists():
            log(f"Motion reference not present yet: {ref_path.name}")
            continue
        seqs.new_movie(
            name=f"WOLF_REF_{key.upper()}",
            filepath=str(ref_path),
            channel=channel,
            frame_start=1,
        )
        channel += 1
        log(f"Loaded reference {ref_path.name}")


def write_diagnostics(armature):
    lines = [
        "TUMSOEV WOLF MOTION DIAGNOSTICS",
        f"Blender: {bpy.app.version_string}",
        f"FPS: {FPS}",
        f"Armature: {armature.name if armature else 'NOT FOUND'}",
        f"Mesh objects: {sum(1 for o in bpy.context.scene.objects if o.type == 'MESH')}",
    ]
    for key in ORDER:
        name = CONFIG["actions"][key]
        lines.append(f"{name}: {'READY' if bpy.data.actions.get(name) else 'WAITING FOR RIG'}")
    text = "\n".join(lines)
    block = bpy.data.texts.get("WOLF_MOTION_DIAGNOSTICS") or bpy.data.texts.new("WOLF_MOTION_DIAGNOSTICS")
    block.clear()
    block.write(text)
    print(text)


def save_working_copy():
    output = ROOT / "WolfMotion_WORKING.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(output))
    log(f"Saved working copy: {output}")


def main():
    set_scene()
    import_model_if_present()
    armature = find_armature()
    ensure_actions(armature)
    load_motion_refs()
    write_diagnostics(armature)
    save_working_copy()
    log("Setup complete")


if __name__ == "__main__":
    main()
