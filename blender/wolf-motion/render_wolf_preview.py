import bpy, math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent
MODEL = ROOT / 'assets' / 'model' / 'wolf.glb'
OUT_DIR = ROOT / 'renders'
OUT_DIR.mkdir(parents=True, exist_ok=True)
PNG = OUT_DIR / 'wolf_blender_preview.png'
BLEND = OUT_DIR / 'wolf_blender_preview.blend'

# Clean scene and import generated GLB.
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(MODEL))
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = str(PNG)
scene.render.film_transparent = False
scene.world.color = (0.015, 0.02, 0.035)

# Pick the armature and show a recognizable howl pose if available.
rigs = [o for o in scene.objects if o.type == 'ARMATURE']
rig = max(rigs, key=lambda o: len(o.data.bones)) if rigs else None
if rig:
    rig.animation_data_create()
    action = bpy.data.actions.get('WOLF_HOWL')
    if action:
        if rig.animation_data:
            for track in rig.animation_data.nla_tracks:
                track.mute = True
        rig.animation_data.action = action
        scene.frame_start = 1
        scene.frame_end = 84
        scene.frame_set(55)

# Ground.
bpy.ops.mesh.primitive_plane_add(size=20, location=(0,0,0.12))
plane = bpy.context.object
plane.name = 'Preview_Ground'
mat = bpy.data.materials.new('GroundMat')
mat.diffuse_color = (0.025,0.035,0.05,1.0)
plane.data.materials.append(mat)

# Give unmaterialed wolf parts a neutral gray material.
wolfmat = bpy.data.materials.new('WolfPreviewMat')
wolfmat.diffuse_color = (0.22,0.25,0.29,1.0)
wolfmat.roughness = 0.72
for obj in scene.objects:
    if obj.type == 'MESH' and obj is not plane and len(obj.data.materials) == 0:
        obj.data.materials.append(wolfmat)

# Camera side/profile view.
bpy.ops.object.camera_add(location=(0,-8.0,2.65))
cam = bpy.context.object
cam.name = 'Preview_Camera'
scene.camera = cam

def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat('-Z','Y').to_euler()

look_at(cam, (0,0,1.25))
cam.data.lens = 58

# Key light.
bpy.ops.object.light_add(type='AREA', location=(1.5,-3.0,5.0))
key = bpy.context.object
key.data.energy = 900
key.data.shape = 'DISK'
key.data.size = 5.0
look_at(key, (0,0,1.2))

# Rim light.
bpy.ops.object.light_add(type='AREA', location=(-3.0,2.5,3.2))
rim = bpy.context.object
rim.data.energy = 650
rim.data.size = 4.0
look_at(rim, (0,0,1.4))

# Soft fill.
bpy.ops.object.light_add(type='AREA', location=(3.0,1.0,2.2))
fill = bpy.context.object
fill.data.energy = 350
fill.data.size = 3.0
look_at(fill, (0,0,1.0))

bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
bpy.ops.render.render(write_still=True)
print('WOLF_PREVIEW_PASS', PNG, BLEND)
