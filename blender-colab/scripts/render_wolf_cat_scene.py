#!/usr/bin/env python3
"""TUMVEXA FREE Blender scene: our stylized wolf approaches a ginger cat; cat turns left."""
from __future__ import annotations
import argparse, json, math, shutil, subprocess, sys
from pathlib import Path
import bpy
from mathutils import Vector

MARKER = "TUMVEXA_WOLF_CAT_V1"

def argv():
    return sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []

def parse_args():
    p=argparse.ArgumentParser()
    p.add_argument("--output", default="TUMVEXA_WOLF_CAT.mp4")
    p.add_argument("--duration", type=float, default=7.0)
    p.add_argument("--fps", type=int, default=24)
    p.add_argument("--preview", action="store_true")
    return p.parse_args(argv())

def clear():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

def mat(name, color, rough=.72, emission=None, strength=0):
    m=bpy.data.materials.new(name); m.use_nodes=True
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
        for k in fc.keyframe_points: k.interpolation="BEZIER"

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
    rig=empty("WOLF_MASTER",(4.9,0,0))
    dark=mat("WolfDark",(.035,.045,.055),.9)
    grey=mat("WolfGrey",(.23,.27,.31),.88)
    light=mat("WolfLight",(.53,.57,.60),.9)
    black=mat("WolfBlack",(.008,.008,.01),.5)
    eye=mat("WolfEye",(.82,.62,.18),.32, emission=(.34,.17,.02), strength=.6)

    uv("Wolf_Body",(0,0,1.35),(1.25,.52,.60),grey,rig)
    uv("Wolf_Chest",(-.78,0,1.45),(.63,.56,.72),light,rig)
    uv("Wolf_Neck",(-1.18,0,1.82),(.46,.46,.66),dark,rig)
    head=uv("Wolf_Head",(-1.58,0,2.20),(.55,.45,.50),grey,rig)
    uv("Wolf_Muzzle",(-1.96,-.02,2.18),(.50,.31,.27),light,rig)
    uv("Wolf_Nose",(-2.33,-.02,2.20),(.12,.14,.12),black,rig)
    for s,y in (("L",-.25),("R",.25)):
        cone("Wolf_Ear_"+s,(-1.48,y,2.68),.22,.72,dark,rig,rot=(0,0,0))
        uv("Wolf_Eye_"+s,(-1.86,y*.9,2.32),(.06,.045,.06),eye,rig,20,12)
    legs=[]
    for i,(x,y) in enumerate(((-.78,-.28),(-.78,.28),(.78,-.28),(.78,.28))):
        leg=cyl("Wolf_Leg_"+str(i),(x,y,.72),.13,1.05,grey,rig); legs.append(leg)
        uv("Wolf_Paw_"+str(i),(x-.08,y,.20),(.30,.22,.13),dark,rig,22,14)
    tail=uv("Wolf_Tail",(1.30,.02,1.45),(.82,.28,.25),dark,rig); tail.rotation_euler[1]=math.radians(-28)

    # Approach: right -> center, with gentle body bob.
    for f,x,z in ((1,5.2,0),(48,3.7,.04),(96,2.25,0),(132,1.65,.02),(168,1.45,0)):
        rig.location=(x,0,z); kf(rig,"location",f)
    # Four-step leg swing.
    for leg_i,leg in enumerate(legs):
        base=leg.rotation_euler.copy()
        phase=0 if leg_i in (0,3) else 12
        for f,ang in ((1+phase,-12),(13+phase,12),(25+phase,-12),(37+phase,12),(49+phase,-12),(73+phase,12),(97+phase,-10),(121+phase,7),(145+phase,0)):
            if f<=168:
                leg.rotation_euler=base; leg.rotation_euler[1]=math.radians(ang); kf(leg,"rotation_euler",f)
        linearize(leg)
    # Tail and head attention near the cat.
    tail.rotation_euler[1]=math.radians(-28); kf(tail,"rotation_euler",1)
    tail.rotation_euler[1]=math.radians(-15); kf(tail,"rotation_euler",84)
    tail.rotation_euler[1]=math.radians(-22); kf(tail,"rotation_euler",168)
    head.rotation_euler[1]=math.radians(0); kf(head,"rotation_euler",1)
    head.rotation_euler[1]=math.radians(-7); kf(head,"rotation_euler",138)
    head.rotation_euler[1]=math.radians(-3); kf(head,"rotation_euler",168)
    return rig

def build_cat():
    rig=empty("GINGER_CAT_MASTER",(-1.30,0,0))
    orange=mat("GingerBase",(.78,.20,.035),.82)
    cream=mat("GingerCream",(.95,.63,.30),.86)
    stripe=mat("GingerStripe",(.36,.055,.012),.9)
    pink=mat("CatPink",(.76,.22,.18),.62)
    eye=mat("CatAmber",(.95,.52,.05),.30, emission=(.30,.10,.00), strength=.55)
    black=mat("CatPupil",(.006,.006,.006),.45)

    uv("Cat_Body",(0,0,1.02),(.90,.43,.47),orange,rig)
    chest=uv("Cat_Chest",(.58,-.01,1.05),(.42,.40,.54),cream,rig)
    neck=uv("Cat_Neck",(.70,0,1.38),(.32,.34,.38),orange,rig)
    head=uv("Cat_Head",(.88,0,1.67),(.46,.39,.42),orange,rig)
    uv("Cat_Muzzle",(1.20,-.01,1.58),(.30,.28,.21),cream,rig)
    uv("Cat_Nose",(1.42,-.01,1.61),(.075,.085,.065),pink,rig)
    for s,y in (("L",-.22),("R",.22)):
        cone("Cat_Ear_"+s,(.82,y,2.05),.19,.55,orange,rig)
        uv("Cat_Eye_"+s,(1.17,y*.88,1.75),(.07,.047,.07),eye,rig,20,12)
        uv("Cat_Pupil_"+s,(1.225,y*.88,1.75),(.022,.018,.048),black,rig,16,10)

    legs=[]
    for i,(x,y) in enumerate(((.42,-.25),(.42,.25),(-.48,-.25),(-.48,.25))):
        leg=cyl("Cat_Leg_"+str(i),(x,y,.48),.11,.68,orange,rig); legs.append(leg)
        uv("Cat_Paw_"+str(i),(x+.06,y,.14),(.24,.18,.10),cream,rig,22,14)

    tail1=uv("Cat_Tail_1",(-.88,0,1.12),(.58,.18,.18),orange,rig); tail1.rotation_euler[1]=math.radians(22)
    tail2=uv("Cat_Tail_2",(-1.28,0,1.42),(.48,.15,.15),stripe,rig); tail2.rotation_euler[1]=math.radians(45)

    # Tabby stripes as dark soft masses along back.
    for i,x in enumerate((-.48,-.22,.05,.31,.56)):
        s=uv("Cat_Stripe_"+str(i),(x,-.39,1.33+(.04 if i==2 else 0)),(.08,.035,.28),stripe,rig,18,10)
        s.rotation_euler[1]=math.radians(18 if i<2 else -10)

    # Cat holds, notices wolf, then turns LEFT (counter-clockwise viewed from above).
    rig.rotation_mode="XYZ"
    rig.rotation_euler=(0,0,0); kf(rig,"rotation_euler",1)
    rig.rotation_euler=(0,0,0); kf(rig,"rotation_euler",88)
    rig.rotation_euler=(0,0,math.radians(24)); kf(rig,"rotation_euler",118)
    rig.rotation_euler=(0,0,math.radians(58)); kf(rig,"rotation_euler",150)
    rig.rotation_euler=(0,0,math.radians(64)); kf(rig,"rotation_euler",168)
    # Head turns first.
    head.rotation_euler[2]=0; kf(head,"rotation_euler",72)
    head.rotation_euler[2]=math.radians(18); kf(head,"rotation_euler",105)
    head.rotation_euler[2]=math.radians(30); kf(head,"rotation_euler",132)
    # Tail flick.
    tail2.rotation_euler[2]=math.radians(-8); kf(tail2,"rotation_euler",70)
    tail2.rotation_euler[2]=math.radians(18); kf(tail2,"rotation_euler",102)
    tail2.rotation_euler[2]=math.radians(-16); kf(tail2,"rotation_euler",132)
    tail2.rotation_euler[2]=math.radians(5); kf(tail2,"rotation_euler",168)
    linearize(rig); linearize(head); linearize(tail2)

    # Mirrored collection-style demonstration object: hidden from render, kept in .blend.
    mirror=empty("GINGER_CAT_MIRROR",(0,0,0))
    mirror.scale.x=-1
    mirror.hide_render=True
    mirror["note"]="Mirror reference: Scale X = -1. MASTER remains the rendered cat."
    return rig, mirror

def camera():
    target=empty("Camera_Target",(0.4,0,1.15))
    d=bpy.data.cameras.new("Camera"); cam=bpy.data.objects.new("Camera",d); bpy.context.collection.objects.link(cam)
    cam.location=(.45,-11.6,3.10); d.lens=52; look_at(cam,target.location); bpy.context.scene.camera=cam
    return cam

def setup_render(a, out):
    scene=bpy.context.scene
    scene.frame_start=1; scene.frame_end=max(2,int(round(a.duration*a.fps)))
    scene.render.fps=a.fps
    try: scene.render.engine="BLENDER_EEVEE_NEXT"
    except Exception: pass
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
    # Ensure animation length matches requested duration by scaling fixed 168-frame design.
    scene=bpy.context.scene
    end=scene.frame_end
    if end!=168:
        scale=end/168.0
        for obj in bpy.data.objects:
            ad=obj.animation_data
            if ad and ad.action:
                try: curves=ad.action.fcurves
                except Exception: curves=[]
                for fc in curves:
                    for kp in fc.keyframe_points:
                        kp.co.x=max(1.0,kp.co.x*scale)
                        kp.handle_left.x=max(1.0,kp.handle_left.x*scale)
                        kp.handle_right.x=max(1.0,kp.handle_right.x*scale)
    blend=out.with_suffix(".blend")
    report=out.with_suffix(".json")
    report.write_text(json.dumps({
        "marker":MARKER,"output":str(out),"blend":str(blend),"duration":a.duration,
        "fps":a.fps,"resolution":list(res),"wolf":"WOLF_MASTER","cat":"GINGER_CAT_MASTER",
        "mirror":"GINGER_CAT_MIRROR","mirror_scale_x":-1,"paid_api":False
    },indent=2),encoding="utf-8")
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    scene.frame_set(1); bpy.ops.render.render(animation=True)
    encode(frames,out,a.fps)
    if not out.exists() or out.stat().st_size<1000: raise RuntimeError("MP4 missing")
    print("TUMVEXA WOLF+CAT READY",out)

if __name__=="__main__": main()
