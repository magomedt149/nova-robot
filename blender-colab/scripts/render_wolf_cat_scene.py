#!/usr/bin/env python3
"""Nova Super App FREE Blender scene: quadruped wolf approaches a ginger cat; cat turns left."""
from __future__ import annotations
import argparse, json, math, shutil, subprocess, sys
from pathlib import Path
import bpy
from mathutils import Vector

MARKER = "NOVA_SUPER_APP_WOLF_CAT_V2"

def argv():
    return sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []

def parse_args():
    p=argparse.ArgumentParser()
    p.add_argument("--output", default="NOVA_SUPER_APP_WOLF_CAT.mp4")
    p.add_argument("--duration", type=float, default=5.0)
    p.add_argument("--fps", type=int, default=24)
    p.add_argument("--preview", action="store_true")
    return p.parse_args(argv())

def clear():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

def mat(name, color, rough=.72, emission=None, strength=0):
    m=bpy.data.materials.new(name); m.use_nodes=True; m.diffuse_color=(*color,1.0)
    b=m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value=(*color,1)
    b.inputs["Roughness"].default_value=rough
    if emission is not None:
        key="Emission Color" if "Emission Color" in b.inputs else "Emission"
        b.inputs[key].default_value=(*emission,1)
        if "Emission Strength" in b.inputs: b.inputs["Emission Strength"].default_value=strength
    return m

def smooth(o):
    if o.type=="MESH":
        for p in o.data.polygons: p.use_smooth=True
    return o

def uv(name, loc, scale, m, parent=None, seg=28, rings=18):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, location=loc)
    o=bpy.context.object; o.name=name; o.scale=scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    smooth(o); o.data.materials.append(m)
    if parent: o.parent=parent
    return o

def cone(name, loc, radius, depth, m, parent=None, rot=(0,0,0)):
    bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=radius, radius2=0.01, depth=depth, location=loc, rotation=rot)
    o=bpy.context.object; o.name=name; smooth(o); o.data.materials.append(m)
    if parent: o.parent=parent
    return o

def cyl(name, loc, radius, depth, m, parent=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=radius, depth=depth, location=loc)
    o=bpy.context.object; o.name=name; smooth(o); o.data.materials.append(m)
    if parent: o.parent=parent
    return o

def empty(name, loc=(0,0,0)):
    o=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(o); o.location=loc; return o

def kf(obj, path, frame, index=None):
    if index is None: obj.keyframe_insert(data_path=path, frame=frame)
    else: obj.keyframe_insert(data_path=path, index=index, frame=frame)

def linearize(obj):
    ad=obj.animation_data
    if not ad or not ad.action: return
    try:
        curves=ad.action.fcurves
    except Exception:
        curves=[]
    for fc in curves:
        for k in fc.keyframe_points: k.interpolation="LINEAR"

def look_at(o, target):
    d=Vector(target)-o.matrix_world.translation
    o.rotation_euler=d.to_track_quat("-Z","Y").to_euler()

def area(name, loc, energy, size, color, target):
    d=bpy.data.lights.new(name,"AREA"); d.energy=energy; d.shape="DISK"; d.size=size; d.color=color
    o=bpy.data.objects.new(name,d); bpy.context.collection.objects.link(o); o.location=loc; look_at(o,target); return o

def build_ground():
    ground=mat("Ground",(0.018,0.022,0.026),.96)
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0,0,0))
    bpy.context.object.data.materials.append(ground)
    bpy.context.object.name="Studio_Ground"
    scene=bpy.context.scene
    scene.world.color=(0.006,0.008,0.012)
    area("Warm_Key",(-3,-4,7),1000,5.0,(1.0,.48,.20),(0,0,1.2))
    area("Cool_Rim",(4,2,5),700,4.0,(.18,.38,1.0),(0,0,1.4))
    area("Soft_Fill",(0,-5,3),400,4.0,(1.0,.82,.65),(0,0,1.0))

def build_wolf():
    rig=empty("WOLF_MASTER",(6.0,0,0))
    dark=mat("WolfDark",(.035,.045,.055),.9)
    grey=mat("WolfGrey",(.23,.27,.31),.88)
    light=mat("WolfLight",(.53,.57,.60),.9)
    black=mat("WolfBlack",(.008,.008,.01),.5)
    eye=mat("WolfEye",(.82,.62,.18),.32, emission=(.34,.17,.02), strength=.6)

    body=uv("Wolf_Body",(0,0,1.35),(1.25,.52,.60),grey,rig)
    chest=uv("Wolf_Chest",(-.78,0,1.45),(.63,.56,.72),light,rig)
    uv("Wolf_Neck",(-1.18,0,1.82),(.46,.46,.66),dark,rig)
    head=uv("Wolf_Head",(-1.58,0,2.20),(.55,.45,.50),grey,rig)
    uv("Wolf_Muzzle",(-1.96,-.02,2.18),(.50,.31,.27),light,rig)
    uv("Wolf_Nose",(-2.33,-.02,2.20),(.12,.14,.12),black,rig)
    for s,y in (("L",-.25),("R",.25)):
        cone("Wolf_Ear_"+s,(-1.48,y,2.68),.22,.72,dark,rig,rot=(0,0,0))
        uv("Wolf_Eye_"+s,(-1.86,y*.9,2.32),(.06,.045,.06),eye,rig,20,12)

    leg_defs=((-0.82,-.30),(-0.82,.30),(.78,-.30),(.78,.30))
    legs=[]; paws=[]
    for i,(x,y) in enumerate(leg_defs):
        leg=cyl("Wolf_Leg_"+str(i),(x,y,.72),.13,1.05,grey,rig); legs.append(leg)
        paw=uv("Wolf_Paw_"+str(i),(x-.05,y,.16),(.31,.23,.14),dark,rig,22,14); paws.append(paw)
    tail=uv("Wolf_Tail",(1.30,.02,1.45),(.82,.28,.25),dark,rig); tail.rotation_euler[1]=math.radians(-28)

    # TRUE ROOT MOTION: wolf visibly travels across the scene while the walk cycle plays.
    root_keys=((1,6.0,0.00),(25,5.25,.07),(49,4.45,0.00),(73,3.65,.07),
               (97,2.85,0.00),(121,2.05,.07),(145,1.35,0.00),(168,.85,0.00))
    for f,x,z in root_keys:
        rig.location=(x,0,z); kf(rig,"location",f)
    linearize(rig)

    # Four-beat quadruped walk. Paws remain low during stance and lift during swing.
    # Diagonal pairs are offset by half a cycle, matching the tutorial principle.
    cycle=24
    for i,(leg,paw) in enumerate(zip(legs,paws)):
        phase=0 if i in (0,3) else 12
        base_x=leg_defs[i][0]-0.05
        base_z=.16
        for start in range(1-phase,145,cycle):
            keys=((0,.34,base_z,-24),(6,.08,base_z,-7),(12,-.34,base_z,22),
                  (18,-.05,.42,5),(24,.34,base_z,-24))
            for off,dx,z,ang in keys:
                fr=start+off
                if 1 <= fr <= 145:
                    paw.location.x=base_x+dx
                    paw.location.z=z
                    kf(paw,"location",fr)
                    leg.rotation_euler[1]=math.radians(ang)
                    kf(leg,"rotation_euler",fr)
        # settle when the wolf reaches the cat
        paw.location.x=base_x; paw.location.z=base_z; kf(paw,"location",168)
        leg.rotation_euler[1]=0; kf(leg,"rotation_euler",168)
        linearize(paw); linearize(leg)

    # Body/shoulder bob and attention.
    for f,zang in ((1,-2),(13,2),(25,-2),(37,2),(49,-2),(61,2),(73,-2),
                   (85,2),(97,-2),(109,2),(121,-2),(133,2),(145,0),(168,0)):
        body.rotation_euler[1]=math.radians(zang); kf(body,"rotation_euler",f)
        chest.rotation_euler[1]=math.radians(-zang*.6); kf(chest,"rotation_euler",f)
    head.rotation_euler[1]=0; kf(head,"rotation_euler",1)
    head.rotation_euler[1]=math.radians(-10); kf(head,"rotation_euler",128)
    head.rotation_euler[1]=math.radians(-5); kf(head,"rotation_euler",168)
    tail.rotation_euler[1]=math.radians(-28); kf(tail,"rotation_euler",1)
    tail.rotation_euler[1]=math.radians(-10); kf(tail,"rotation_euler",90)
    tail.rotation_euler[1]=math.radians(-24); kf(tail,"rotation_euler",168)
    linearize(body); linearize(chest); linearize(head); linearize(tail)
    return rig

def build_cat():
    rig=empty("GINGER_CAT_MASTER",(-1.30,0,0))
    orange=mat("GingerBase",(.72,.16,.025),.88)
    cream=mat("GingerCream",(.92,.55,.25),.9)
    stripe=mat("GingerStripe",(.28,.035,.008),.94)
    pink=mat("CatPink",(.70,.20,.17),.68)
    eye=mat("CatAmber",(.88,.48,.04),.34, emission=(.22,.07,.00), strength=.35)
    black=mat("CatPupil",(.004,.004,.004),.5)

    # Feline proportions: horizontal torso, small head, slim legs, low paws.
    uv("Cat_Body",(0,0,.76),(1.02,.35,.39),orange,rig)
    chest=uv("Cat_Chest",(.56,-.01,.81),(.40,.32,.43),cream,rig)
    neck=uv("Cat_Neck",(.73,0,1.02),(.25,.25,.29),orange,rig)
    head=uv("Cat_Head",(.91,0,1.27),(.36,.32,.34),orange,rig)
    uv("Cat_Muzzle",(1.18,-.01,1.20),(.24,.23,.16),cream,rig)
    uv("Cat_Nose",(1.37,-.01,1.22),(.055,.065,.045),pink,rig)
    for s,y in (("L",-.18),("R",.18)):
        cone("Cat_Ear_"+s,(.84,y,1.59),.145,.43,orange,rig)
        uv("Cat_Eye_"+s,(1.15,y*.9,1.33),(.047,.034,.050),eye,rig,20,12)
        uv("Cat_Pupil_"+s,(1.19,y*.9,1.33),(.014,.012,.035),black,rig,16,10)

    legs=[]
    for i,(x,y) in enumerate(((.50,-.23),(.50,.23),(-.52,-.23),(-.52,.23))):
        leg=cyl("Cat_Leg_"+str(i),(x,y,.36),.075,.55,orange,rig); legs.append(leg)
        uv("Cat_Paw_"+str(i),(x+.04,y,.085),(.17,.12,.07),cream,rig,22,14)

    tail1=uv("Cat_Tail_1",(-.96,0,.82),(.66,.13,.13),orange,rig); tail1.rotation_euler[1]=math.radians(18)
    tail2=uv("Cat_Tail_2",(-1.47,0,1.02),(.55,.105,.105),stripe,rig); tail2.rotation_euler[1]=math.radians(42)

    # Ginger tabby markings kept subtle so the silhouette reads as a real quadruped cat.
    for i,x in enumerate((-.50,-.23,.04,.30,.55)):
        s=uv("Cat_Stripe_"+str(i),(x,-.315,.98+(.025 if i==2 else 0)),(.065,.025,.20),stripe,rig,18,10)
        s.rotation_euler[1]=math.radians(14 if i<2 else -8)

    # Cat notices the approaching wolf, turns its head first, then pivots LEFT clearly.
    rig.rotation_mode="XYZ"
    rig.rotation_euler=(0,0,0); kf(rig,"rotation_euler",1)
    rig.rotation_euler=(0,0,0); kf(rig,"rotation_euler",92)
    rig.rotation_euler=(0,0,math.radians(28)); kf(rig,"rotation_euler",112)
    rig.rotation_euler=(0,0,math.radians(62)); kf(rig,"rotation_euler",132)
    rig.rotation_euler=(0,0,math.radians(92)); kf(rig,"rotation_euler",150)
    rig.rotation_euler=(0,0,math.radians(96)); kf(rig,"rotation_euler",168)

    # Head reacts before the body.
    head.rotation_euler[2]=0; kf(head,"rotation_euler",72)
    head.rotation_euler[2]=math.radians(20); kf(head,"rotation_euler",92)
    head.rotation_euler[2]=math.radians(42); kf(head,"rotation_euler",112)
    head.rotation_euler[2]=math.radians(20); kf(head,"rotation_euler",150)

    # Tail flicks while the cat turns.
    tail2.rotation_euler[2]=math.radians(-18); kf(tail2,"rotation_euler",82)
    tail2.rotation_euler[2]=math.radians(24); kf(tail2,"rotation_euler",104)
    tail2.rotation_euler[2]=math.radians(-22); kf(tail2,"rotation_euler",128)
    tail2.rotation_euler[2]=math.radians(12); kf(tail2,"rotation_euler",150)
    tail2.rotation_euler[2]=math.radians(0); kf(tail2,"rotation_euler",168)
    linearize(rig); linearize(head); linearize(tail2)

    # Mirrored collection-style demonstration object: hidden from render, kept in .blend.
    mirror=empty("GINGER_CAT_MIRROR",(0,0,0))
    mirror.scale.x=-1
    mirror.hide_render=True
    mirror["note"]="Mirror reference: Scale X = -1. MASTER remains the rendered cat."
    return rig, mirror

def camera():
    # Deterministic front camera: local -Z points toward +Y after X rotation.
    d=bpy.data.cameras.new("Camera")
    cam=bpy.data.objects.new("Camera",d)
    bpy.context.collection.objects.link(cam)
    cam.location=(0.35,-12.0,3.05)
    cam.rotation_mode="XYZ"
    cam.rotation_euler=(math.radians(80.0),0.0,0.0)
    d.lens=46
    d.sensor_width=36
    d.clip_start=0.05
    d.clip_end=100.0
    bpy.context.scene.camera=cam
    return cam

def setup_render(a, out):
    scene=bpy.context.scene
    # Keep the designed animation on its native 168-frame / 24 fps timeline.
    # Preview rendering samples this timeline instead of moving/scaling keyframes.
    scene.frame_start=1; scene.frame_end=168
    scene.render.fps=24
    # Blender 5.2 exposes Eevee as BLENDER_EEVEE. Workbench is intentionally
    # forbidden for Nova Super App 3D output because it hides material/lighting bugs.
    try:
        scene.render.engine="BLENDER_EEVEE"
    except Exception as exc:
        raise RuntimeError(f"Eevee unavailable in this Blender build: {exc}")
    if a.preview:
        w,h=320,180
    else:
        w,h=1280,720
    scene.render.resolution_x=w; scene.render.resolution_y=h; scene.render.resolution_percentage=100
    scene.render.image_settings.file_format="PNG"
    frames_dir=out.with_suffix("")
    frames_dir=frames_dir.parent/(frames_dir.name+"_frames")
    if frames_dir.exists(): shutil.rmtree(frames_dir)
    frames_dir.mkdir(parents=True)
    scene.render.filepath=str(frames_dir/"frame_")
    return frames_dir,(w,h)

def encode(frames,out,fps):
    ff=shutil.which("ffmpeg")
    if not ff: raise RuntimeError("ffmpeg missing")
    subprocess.run([ff,"-y","-hide_banner","-loglevel","error","-framerate",str(fps),"-start_number","1","-i",str(frames/"frame_%04d.png"),"-c:v","libx264","-pix_fmt","yuv420p","-crf","20","-movflags","+faststart",str(out)],check=True)
    shutil.rmtree(frames)

def main():
    a=parse_args(); out=Path(a.output).resolve(); out.parent.mkdir(parents=True,exist_ok=True)
    clear(); build_ground(); wolf=build_wolf(); cat,mirror=build_cat(); cam=camera()
    frames,res=setup_render(a,out)
    scene=bpy.context.scene
    blend=out.with_suffix(".blend")
    report=out.with_suffix(".json")
    report.write_text(json.dumps({
        "marker":MARKER,"output":str(out),"blend":str(blend),"duration":a.duration,
        "fps":a.fps,"resolution":list(res),"wolf":"WOLF_MASTER","cat":"GINGER_CAT_MASTER",
        "mirror":"GINGER_CAT_MIRROR","mirror_scale_x":-1,"paid_api":False,"render_engine":scene.render.engine,"anatomy":"quadruped-v2"
    },indent=2),encoding="utf-8")
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    if a.preview:
        # Render a small number of evenly spaced samples across the whole
        # 168-frame animation. This preserves the wolf approach and cat turn.
        sample_count=max(2,int(round(a.duration*a.fps)))
        source_frames=[
            int(round(1 + i*(167.0/(sample_count-1))))
            for i in range(sample_count)
        ]
        for idx,src_frame in enumerate(source_frames,1):
            scene.frame_set(src_frame)
            scene.render.filepath=str(frames/f"frame_{idx:04d}.png")
            bpy.ops.render.render(write_still=True)
    else:
        scene.frame_set(1)
        scene.render.filepath=str(frames/"frame_")
        bpy.ops.render.render(animation=True)
    encode(frames,out,a.fps)
    if not out.exists() or out.stat().st_size<1000: raise RuntimeError("MP4 missing")
    print("NOVA SUPER APP WOLF+CAT READY",out)

if __name__=="__main__": main()

# RENDER_REQUEST_2026_10_05: wolf approaches ginger cat; cat turns left.
