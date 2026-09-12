import bpy, math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent
MODEL = ROOT / 'assets' / 'model' / 'wolf.glb'
OUT_DIR = ROOT / 'renders' / 'howl_frames'
OUT_DIR.mkdir(parents=True, exist_ok=True)
BLEND = ROOT / 'renders' / 'wolf_howl_preview.blend'

# Clean scene and import the generated rigged wolf.
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(MODEL))
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 640
scene.render.resolution_y = 360
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False
scene.world.color = (0.018, 0.022, 0.03)
scene.render.fps = 24
scene.frame_start = 1
scene.frame_end = 84
scene.frame_step = 2  # 42 frames -> compact 12 fps GIF after ffmpeg

# Armature + howl animation.
rigs = [o for o in scene.objects if o.type == 'ARMATURE']
rig = max(rigs, key=lambda o: len(o.data.bones)) if rigs else None
if not rig:
    raise RuntimeError('No armature found')
rig.animation_data_create()
for track in rig.animation_data.nla_tracks:
    track.mute = True

action = bpy.data.actions.get('WOLF_HOWL')
if not action:
    # fall back to first matching imported action
    matches = [a for a in bpy.data.actions if 'HOWL' in a.name.upper()]
    action = matches[0] if matches else None
if not action:
    raise RuntimeError('WOLF_HOWL action not found')
rig.animation_data.action = action

# Exaggerate the howl slightly so it reads clearly in a small GIF.
for pb in rig.pose.bones:
    pb.rotation_mode = 'XYZ'
# Add a little extra chest/head lift as an additive visual cue using constraints-free keyframes.
# Existing action remains the main motion; these bones are nudged only if present.
if 'neck' in rig.pose.bones and 'head' in rig.pose.bones:
    for frame, k in [(1,0.0),(18,0.25),(36,1.0),(68,1.0),(84,0.55)]:
        scene.frame_set(frame)
        neck = rig.pose.bones['neck']
        head = rig.pose.bones['head']
        neck.rotation_euler.y += -0.18 * k
        head.rotation_euler.y += -0.22 * k
        neck.keyframe_insert(data_path='rotation_euler', frame=frame, group='neck')
        head.keyframe_insert(data_path='rotation_euler', frame=frame, group='head')

# Neutral gray materials for a gray wolf.
wolfmat = bpy.data.materials.new('HowlGrayWolf')
wolfmat.diffuse_color = (0.34, 0.36, 0.39, 1.0)
wolfmat.roughness = 0.82
for obj in scene.objects:
    if obj.type == 'MESH':
        obj.data.materials.clear()
        obj.data.materials.append(wolfmat)

# Ground.
bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=4.2, depth=0.10, location=(0,0,0.08))
ground = bpy.context.object
ground.name = 'Howl_Ground'
gmat = bpy.data.materials.new('HowlGroundMat')
gmat.diffuse_color = (0.075,0.085,0.10,1.0)
gmat.roughness = 0.9
ground.data.materials.append(gmat)

# Camera: side profile like the reference Blender clip.
bpy.ops.object.camera_add(location=(0,-8.2,2.55))
cam = bpy.context.object
cam.name = 'Howl_Camera'
scene.camera = cam

def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat('-Z','Y').to_euler()

look_at(cam, (0.15,0,1.35))
cam.data.lens = 56

# Lighting.
bpy.ops.object.light_add(type='AREA', location=(1.8,-3.2,5.2))
key = bpy.context.object
key.data.energy = 1050
key.data.size = 5.5
look_at(key, (0,0,1.3))

bpy.ops.object.light_add(type='AREA', location=(-3.2,2.6,3.6))
rim = bpy.context.object
rim.data.energy = 720
rim.data.size = 4.0
look_at(rim, (-0.4,0,1.5))

bpy.ops.object.light_add(type='AREA', location=(3.3,1.4,2.5))
fill = bpy.context.object
fill.data.energy = 300
fill.data.size = 3.0
look_at(fill, (0.5,0,1.2))

# Render animation frames.
scene.render.filepath = str(OUT_DIR / 'howl_')
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
bpy.ops.render.render(animation=True)
print('WOLF_HOWL_FRAMES_PASS', OUT_DIR, BLEND, action.name)
