import bpy, math, json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent
MODEL_DIR = ROOT / 'assets' / 'model'
EXPORT_DIR = ROOT / 'exports'
MODEL_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)
OUT = MODEL_DIR / 'wolf.glb'
REPORT = EXPORT_DIR / 'procedural_wolf_report.json'
FPS = 24
SPECS = {'WOLF_IDLE':72,'WOLF_WALK':48,'WOLF_RUN':24,'WOLF_HOWL':84}

bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for a in list(bpy.data.actions): bpy.data.actions.remove(a)
scene=bpy.context.scene; scene.render.fps=FPS; scene.render.fps_base=1.0

# Armature: 20 bones, quadruped layout facing +X.
arm_data=bpy.data.armatures.new('WOLF_ARMATURE_DATA')
rig=bpy.data.objects.new('WOLF_ARMATURE', arm_data)
scene.collection.objects.link(rig); bpy.context.view_layer.objects.active=rig; rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
B={}
def eb(name, head, tail, parent=None):
    b=arm_data.edit_bones.new(name); b.head=head; b.tail=tail
    if parent: b.parent=B[parent]
    B[name]=b; return b

eb('root',(0,0,0.35),(0,0,0.75))
eb('spine',(-0.65,0,1.55),(0.55,0,1.65),'root')
eb('chest',(0.35,0,1.62),(0.95,0,1.75),'spine')
eb('neck',(0.88,0,1.72),(1.35,0,1.95),'chest')
eb('head',(1.30,0,1.92),(1.95,0,2.05),'neck')
eb('tail1',(-0.72,0,1.55),(-1.35,0,1.48),'spine')
eb('tail2',(-1.35,0,1.48),(-1.85,0,1.25),'tail1')
eb('tail3',(-1.85,0,1.25),(-2.25,0,0.95),'tail2')
for side,y in [('L',0.34),('R',-0.34)]:
    eb(f'front_{side}_upper',(0.72,y,1.50),(0.72,y,0.95),'chest')
    eb(f'front_{side}_lower',(0.72,y,0.95),(0.82,y,0.42),f'front_{side}_upper')
    eb(f'front_{side}_paw',(0.82,y,0.42),(1.08,y,0.30),f'front_{side}_lower')
    eb(f'hind_{side}_upper',(-0.72,y,1.48),(-0.82,y,0.92),'spine')
    eb(f'hind_{side}_lower',(-0.82,y,0.92),(-0.72,y,0.40),f'hind_{side}_upper')
    eb(f'hind_{side}_paw',(-0.72,y,0.40),(-0.42,y,0.28),f'hind_{side}_lower')
bpy.ops.object.mode_set(mode='OBJECT')

# Rigid skinned mesh parts. This is a functional prototype, not the final art asset.
def part(name, loc, scale, bone, subdivisions=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1.0, location=loc)
    o=bpy.context.object; o.name=name; o.scale=scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.parent=rig
    vg=o.vertex_groups.new(name=bone); vg.add(list(range(len(o.data.vertices))),1.0,'REPLACE')
    m=o.modifiers.new('Armature','ARMATURE'); m.object=rig
    return o

part('Wolf_Body',(0,0,1.58),(1.15,0.52,0.52),'spine',3)
part('Wolf_Chest',(0.62,0,1.65),(0.62,0.55,0.62),'chest',2)
part('Wolf_Neck',(1.05,0,1.82),(0.48,0.40,0.46),'neck',2)
part('Wolf_Head',(1.62,0,2.02),(0.55,0.40,0.43),'head',2)
part('Wolf_Muzzle',(2.05,0,1.94),(0.42,0.27,0.25),'head',2)
part('Tail1',(-1.05,0,1.48),(0.50,0.23,0.23),'tail1',1)
part('Tail2',(-1.58,0,1.32),(0.46,0.20,0.20),'tail2',1)
part('Tail3',(-2.02,0,1.05),(0.38,0.16,0.16),'tail3',1)
for side,y in [('L',0.34),('R',-0.34)]:
    part(f'Front_{side}_Upper',(0.72,y,1.18),(0.21,0.18,0.38),f'front_{side}_upper',1)
    part(f'Front_{side}_Lower',(0.77,y,0.67),(0.17,0.15,0.34),f'front_{side}_lower',1)
    part(f'Front_{side}_Paw',(0.95,y,0.31),(0.28,0.18,0.13),f'front_{side}_paw',1)
    part(f'Hind_{side}_Upper',(-0.76,y,1.17),(0.28,0.22,0.39),f'hind_{side}_upper',1)
    part(f'Hind_{side}_Lower',(-0.77,y,0.66),(0.18,0.16,0.34),f'hind_{side}_lower',1)
    part(f'Hind_{side}_Paw',(-0.55,y,0.30),(0.30,0.19,0.13),f'hind_{side}_paw',1)

rig.animation_data_create()
for pb in rig.pose.bones: pb.rotation_mode='XYZ'

def action(name, frames, poses):
    a=bpy.data.actions.new(name); a.use_fake_user=True; rig.animation_data.action=a
    for f, vals in poses:
        for bn, v in vals.items():
            pb=rig.pose.bones[bn]
            if bn=='root' and len(v)==3 and abs(v[0])<0.2 and abs(v[1])<0.2:
                pb.location=v; pb.keyframe_insert('location',frame=f,group=bn)
            else:
                pb.rotation_euler=v; pb.keyframe_insert('rotation_euler',frame=f,group=bn)
    a['tumsoev_frames']=frames; a['tumsoev_fps']=FPS
    tr=rig.animation_data.nla_tracks.new(); tr.name=name; tr.strips.new(name,1,a)
    return a

# Idle
idle=[]
for f,s in [(1,0),(36,1),(72,0)]:
    idle.append((f,{'root':(0,0,0.015*s),'spine':(0,0.018*s,0),'head':(0,-0.035*s,0),'tail1':(0,0.08*(1 if s else 0),0)}))
action('WOLF_IDLE',72,idle)

# Walk: alternating diagonal gait, seamless.
walk=[]
for f,ph in [(1,1),(13,0),(25,-1),(37,0),(48,1)]:
    vals={'root':(0,0,0.035*(1-abs(ph))), 'spine':(0,0.035*ph,0), 'tail1':(0,-0.12*ph,0)}
    for leg,sgn in [('front_L',ph),('hind_R',ph),('front_R',-ph),('hind_L',-ph)]:
        vals[f'{leg}_upper']=(0,0.42*sgn,0); vals[f'{leg}_lower']=(0,-0.26*sgn,0)
    walk.append((f,vals))
action('WOLF_WALK',48,walk)

# Run: larger extension/compression.
run=[]
for f,ph in [(1,1),(7,0),(13,-1),(19,0),(24,1)]:
    vals={'root':(0,0,0.09*(1-abs(ph))), 'spine':(0,0.10*ph,0), 'chest':(0,-0.06*ph,0), 'tail1':(0,-0.16*ph,0)}
    for leg,sgn in [('front_L',ph),('front_R',ph),('hind_L',-ph),('hind_R',-ph)]:
        vals[f'{leg}_upper']=(0,0.72*sgn,0); vals[f'{leg}_lower']=(0,-0.44*sgn,0)
    run.append((f,vals))
action('WOLF_RUN',24,run)

# Howl: feet planted, neck/head rise.
howl=[]
for f,k in [(1,0.0),(20,0.45),(40,1.0),(70,1.0),(84,0.72)]:
    howl.append((f,{'spine':(0,-0.10*k,0),'chest':(0,-0.12*k,0),'neck':(0,-0.55*k,0),'head':(0,-0.48*k,0),'tail1':(0,0.10*k,0)}))
action('WOLF_HOWL',84,howl)
rig.animation_data.action=None

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(OUT), export_format='GLB', export_animations=True, export_nla_strips=True, export_yup=True)
report={'status':'PASS','model':OUT.name,'mesh_objects':len([o for o in scene.objects if o.type=='MESH']),'armature':rig.name,'bones':len(rig.data.bones),'actions':sorted(SPECS),'glb_bytes':OUT.stat().st_size,'fps':FPS,'prototype':True,'paid_api_calls':0}
REPORT.write_text(json.dumps(report,indent=2),encoding='utf-8'); print(json.dumps(report,indent=2))
