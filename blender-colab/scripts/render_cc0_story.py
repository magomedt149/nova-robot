#!/usr/bin/env python3
import bpy, math, sys, argparse, shutil, subprocess, json
from pathlib import Path
from mathutils import Vector

MARKER='TUMVEXA_CC0_STORY_V1'

def args():
    av=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    p=argparse.ArgumentParser()
    p.add_argument('--cat', required=True)
    p.add_argument('--wolf', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--duration', type=float, default=60)
    p.add_argument('--fps', type=int, default=6)
    return p.parse_args(av)

def clear():
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)

def key(obj,path,fr): obj.keyframe_insert(data_path=path, frame=fr)

def lin(obj):
    ad=obj.animation_data
    if not ad: return
    act=getattr(ad,'action',None)
    if not act: return
    try: curves=act.fcurves
    except: return
    for fc in curves:
        for kp in fc.keyframe_points: kp.interpolation='LINEAR'

def add_cube(name,loc,scale,color):
    bpy.ops.mesh.primitive_cube_add(location=loc); o=bpy.context.object; o.name=name; o.scale=scale; o.color=(*color,1); return o

def add_cyl(name,loc,radius,depth,color):
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=radius, depth=depth, location=loc); o=bpy.context.object; o.name=name; o.color=(*color,1); return o

def add_cone(name,loc,r1,depth,color):
    bpy.ops.mesh.primitive_cone_add(vertices=12, radius1=r1, radius2=0.03, depth=depth, location=loc); o=bpy.context.object; o.name=name; o.color=(*color,1); return o

def append_all(path,label):
    before=set(bpy.data.objects)
    with bpy.data.libraries.load(str(path), link=False) as (src,dst):
        dst.objects=list(src.objects)
    new=[o for o in bpy.data.objects if o not in before]
    for o in new:
        if not o.users_collection:
            bpy.context.collection.objects.link(o)
    root=bpy.data.objects.new(label,None); bpy.context.collection.objects.link(root)
    newset=set(new)
    for o in new:
        if o.parent not in newset:
            mw=o.matrix_world.copy(); o.parent=root; o.matrix_world=mw
    return root,new

def bbox(objects):
    pts=[]
    for o in objects:
        if o.type!='MESH' or o.hide_render: continue
        try:
            for c in o.bound_box: pts.append(o.matrix_world @ Vector(c))
        except: pass
    if not pts: return Vector((-1,-1,0)),Vector((1,1,2))
    lo=Vector((min(p.x for p in pts),min(p.y for p in pts),min(p.z for p in pts)))
    hi=Vector((max(p.x for p in pts),max(p.y for p in pts),max(p.z for p in pts)))
    return lo,hi

def normalize(root,objects,target_height,pos,color):
    lo,hi=bbox(objects); h=max(.001,hi.z-lo.z); s=target_height/h
    root.scale=(s,s,s)
    center=(lo+hi)*.5
    root.location=(pos[0]-center.x*s,pos[1]-center.y*s,pos[2]-lo.z*s)
    for o in objects:
        if o.type=='MESH':
            o.color=(*color,1)
            for m in o.data.materials:
                if m: m.diffuse_color=(*color,1)
    return s

def f(sec,fps): return max(1,int(round(sec*fps))+1)

def set_loc(root,sec,x,y,z,fps): root.location=(x,y,z); key(root,'location',f(sec,fps))
def set_rot(root,sec,zdeg,fps): root.rotation_euler[2]=math.radians(zdeg); key(root,'rotation_euler',f(sec,fps))

def look_at(o,target):
    d=Vector(target)-o.location
    o.rotation_euler=d.to_track_quat('-Z','Y').to_euler()

def build_world():
    scene=bpy.context.scene
    scene.world.color=(.012,.018,.030)
    add_cube('Ground',(0,1,-.15),(9,7,.15),(.035,.07,.055))
    for x,y,s in [(-7,3,1.3),(-5,4,1.0),(-3,5,1.4),(3,5,1.2),(5,4,1.4),(7,3,1.1),(-6,7,1.7),(0,7,1.4),(6,7,1.7)]:
        add_cyl('TreeTrunk',(x,y,1.3*s),.18*s,2.6*s,(.10,.055,.025))
        add_cone('TreeCrown',(x,y,3.0*s),1.05*s,2.9*s,(.025,.12,.06))
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=(0,6.5,6.2), radius=1.0)
    moon=bpy.context.object; moon.name='Moon'; moon.color=(1,.82,.35,1)
    for x in (-4.5,-2.6,2.8,4.7):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=.4,location=(x,1,.25)); bpy.context.object.color=(.12,.14,.13,1)

def camera_setup(fps):
    d=bpy.data.cameras.new('Camera'); cam=bpy.data.objects.new('Camera',d); bpy.context.collection.objects.link(cam)
    cam.location=(0,-14,4.2); d.lens=48; look_at(cam,(0,1.0,1.5)); bpy.context.scene.camera=cam
    key(cam,'location',1); cam.location=(0,-12.4,3.8); key(cam,'location',f(60,fps)); lin(cam)
    return cam

def animate(cat,wolf,fps):
    set_loc(cat,0,-6,0,0,fps); set_rot(cat,0,0,fps)
    set_loc(cat,8,-2.7,0,0,fps); set_rot(cat,8,0,fps)
    set_loc(cat,12,-2.5,0,0,fps)
    set_loc(wolf,0,7,1,0,fps); set_rot(wolf,0,180,fps)
    set_loc(wolf,10,6.5,1,0,fps); set_loc(wolf,22,2.4,.4,0,fps); set_rot(wolf,22,180,fps)
    set_rot(cat,12,0,fps); set_rot(cat,18,-38,fps); set_rot(cat,24,-68,fps)
    set_rot(wolf,22,180,fps); set_rot(wolf,27,174,fps); set_rot(wolf,30,181,fps)
    set_loc(cat,28,-2.5,0,0,fps); set_loc(cat,38,-.8,.2,0,fps); set_rot(cat,38,-18,fps)
    set_loc(wolf,32,2.4,.4,0,fps); set_loc(wolf,40,1.1,.2,0,fps)
    set_rot(cat,44,90,fps); set_rot(wolf,44,90,fps)
    set_loc(cat,46,-.55,.2,0,fps); set_loc(wolf,46,.65,.2,0,fps)
    set_loc(cat,60,-.55,5.0,0,fps); set_loc(wolf,60,.65,5.0,0,fps)
    for root,start,end,x0,y0,x1,y1 in [
        (cat,0,8,-6,0,-2.7,0),(wolf,10,22,6.5,1,2.4,.4),(cat,28,38,-2.5,0,-.8,.2),(wolf,32,40,2.4,.4,1.1,.2),
        (cat,46,60,-.55,.2,-.55,5.0),(wolf,46,60,.65,.2,.65,5.0)]:
        steps=max(2,int((end-start)/.8))
        for i in range(steps+1):
            t=start+(end-start)*i/steps; q=i/steps
            x=x0+(x1-x0)*q; y=y0+(y1-y0)*q; z=.07 if i%2 else 0
            set_loc(root,t,x,y,z,fps)
    lin(cat); lin(wolf)

def write_srt(path):
    subs=[
      ('00:00:00,000','00:00:05,500','ВОЛК И РЫЖИК'),
      ('00:00:05,500','00:00:12,000','Рыжик: Какая тихая ночь...'),
      ('00:00:12,000','00:00:20,000','Рыжик: Кто там?'),
      ('00:00:20,000','00:00:29,000','Волк: Не бойся. Я просто ищу дорогу.'),
      ('00:00:29,000','00:00:38,000','Рыжик: Тогда пойдём вместе.'),
      ('00:00:38,000','00:00:46,000','Волк: Ты правда меня не боишься?'),
      ('00:00:46,000','00:00:54,000','Рыжик: Друзей узнают не по виду.'),
      ('00:00:54,000','00:01:00,000','Иногда дружба начинается с одного шага.')]
    lines=[]
    for i,(a,b,t) in enumerate(subs,1): lines += [str(i),f'{a} --> {b}',t,'']
    path.write_text('\n'.join(lines),encoding='utf-8')

def main():
    a=args(); out=Path(a.output).resolve(); out.parent.mkdir(parents=True,exist_ok=True)
    clear(); build_world()
    cat,catobjs=append_all(Path(a.cat),'GINGER_CAT_MASTER')
    wolf,wolfobjs=append_all(Path(a.wolf),'WOLF_MASTER')
    normalize(cat,catobjs,2.1,(-6,0,0),(.95,.28,.045))
    normalize(wolf,wolfobjs,2.7,(7,1,0),(.32,.36,.40))
    animate(cat,wolf,a.fps); camera_setup(a.fps)
    scene=bpy.context.scene; scene.frame_start=1; scene.frame_end=f(a.duration,a.fps); scene.render.fps=a.fps
    scene.render.resolution_x=640; scene.render.resolution_y=360; scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    scene.render.engine='BLENDER_WORKBENCH'; scene.display.shading.light='STUDIO'; scene.display.shading.color_type='OBJECT'; scene.display.shading.show_shadows=True; scene.display.shading.show_cavity=True
    frames=out.parent/'frames_cc0_story'
    if frames.exists(): shutil.rmtree(frames)
    frames.mkdir(parents=True)
    scene.render.filepath=str(frames/'frame_')
    blend=out.with_suffix('.blend'); srt=out.with_suffix('.srt')
    write_srt(srt)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    bpy.ops.render.render(animation=True)
    ff=shutil.which('ffmpeg')
    subprocess.run([ff,'-y','-hide_banner','-loglevel','error','-framerate',str(a.fps),'-start_number','1','-i',str(frames/'frame_%04d.png'),'-c:v','libx264','-pix_fmt','yuv420p','-crf','22','-movflags','+faststart',str(out)],check=True)
    shutil.rmtree(frames)
    report={'marker':MARKER,'duration':a.duration,'fps':a.fps,'cat_source':a.cat,'wolf_source':a.wolf,'output':str(out)}
    out.with_suffix('.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print('READY',out)
if __name__=='__main__': main()
