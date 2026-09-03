#!/usr/bin/env python3
"""Render NOVA two-person Blender skeleton motion into a pose-control MP4.

Usage:
  blender --background --python make_dual_walk_laugh_control.py -- \
    --motion NOVA_DUO_WALK_LAUGH_SKELETON_5s.json --output-dir /content/NOVA_DUO_CONTROL
"""
from __future__ import annotations
import argparse, json, math, sys
from pathlib import Path
import bpy
from mathutils import Vector

BONES = (
    ('pelvis','shoulder_center'), ('shoulder_center','neck'), ('neck','head'),
    ('shoulder_l','elbow_l'), ('elbow_l','wrist_l'), ('shoulder_r','elbow_r'), ('elbow_r','wrist_r'),
    ('pelvis','hip_l'), ('hip_l','knee_l'), ('knee_l','ankle_l'),
    ('pelvis','hip_r'), ('hip_r','knee_r'), ('knee_r','ankle_r'),
    ('shoulder_l','shoulder_r'), ('hip_l','hip_r')
)
COLORS = {
    'man': (0.12,0.72,1.0,1.0),
    'woman': (1.0,0.18,0.62,1.0),
}

def args():
    argv = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    p=argparse.ArgumentParser(); p.add_argument('--motion',required=True,type=Path); p.add_argument('--output-dir',required=True,type=Path)
    p.add_argument('--width',type=int,default=432); p.add_argument('--height',type=int,default=768); return p.parse_args(argv)

def clear():
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)

def mat(name,color):
    m=bpy.data.materials.new(name); m.diffuse_color=color; m.use_nodes=True
    bsdf=m.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value=color
        if 'Emission Color' in bsdf.inputs:
            bsdf.inputs['Emission Color'].default_value=color
        if 'Emission Strength' in bsdf.inputs:
            bsdf.inputs['Emission Strength'].default_value=1.6
    return m

def sphere(name, material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=.045)
    o=bpy.context.object; o.name=name; o.data.materials.append(material); return o

def stick(name, material):
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=.035, depth=1.0)
    o=bpy.context.object; o.name=name; o.rotation_mode='QUATERNION'; o.data.materials.append(material); return o

def kf(o, f):
    o.keyframe_insert(data_path='location',frame=f); o.keyframe_insert(data_path='rotation_quaternion',frame=f); o.keyframe_insert(data_path='scale',frame=f)

def point(v): return Vector((float(v[0]), float(v[1]), float(v[2])))

def main():
    a=args(); data=json.loads(a.motion.read_text()); frames=data.get('frames') or []
    if not frames: raise RuntimeError('No frames in motion JSON')
    fps=int(round(float(data.get('fps',30)))); a.output_dir.mkdir(parents=True,exist_ok=True); clear()
    sc=bpy.context.scene; sc.frame_start=1; sc.frame_end=len(frames); sc.render.fps=fps; sc.render.resolution_x=a.width; sc.render.resolution_y=a.height; sc.render.resolution_percentage=100
    try: sc.render.engine='BLENDER_EEVEE_NEXT'
    except Exception: sc.render.engine='BLENDER_WORKBENCH'
    sc.world.color=(0,0,0)
    sc.render.image_settings.file_format='FFMPEG'; sc.render.ffmpeg.format='MPEG4'; sc.render.ffmpeg.codec='H264'; sc.render.filepath=str(a.output_dir/'nova_duo_skeleton_control.mp4')

    objects={}
    for actor_id in ('man','woman'):
        material=mat(f'{actor_id}_mat', COLORS[actor_id])
        joints={j:sphere(f'{actor_id}_{j}',material) for j in ('pelvis','shoulder_center','neck','head','hip_l','hip_r','knee_l','knee_r','ankle_l','ankle_r','shoulder_l','shoulder_r','elbow_l','elbow_r','wrist_l','wrist_r')}
        limbs={(s,e):stick(f'{actor_id}_{s}_{e}',material) for s,e in BONES}
        objects[actor_id]=(joints,limbs)

    for fi,frame in enumerate(frames,1):
        byid={x['id']:x for x in frame['actors']}
        for actor_id,(joints,limbs) in objects.items():
            jf=byid[actor_id]['joints']
            for name,o in joints.items():
                o.location=point(jf[name]); o.rotation_quaternion=(1,0,0,0); o.scale=(1,1,1); kf(o,fi)
            for (s,e),o in limbs.items():
                p0,p1=point(jf[s]),point(jf[e]); d=p1-p0; L=max(d.length,.001)
                o.location=(p0+p1)*.5; o.rotation_quaternion=d.to_track_quat('Z','Y'); o.scale=(1,1,L); kf(o,fi)

    cam_data=bpy.data.cameras.new('NOVA_Camera'); cam=bpy.data.objects.new('NOVA_Camera',cam_data); sc.collection.objects.link(cam)
    cam.data.type='ORTHO'; cam.data.ortho_scale=2.7; cam.location=(0,-7.5,1.25)
    direction=Vector((0,0,1.15))-cam.location; cam.rotation_euler=direction.to_track_quat('-Z','Y').to_euler(); sc.camera=cam

    blend=a.output_dir/'nova_duo_walk_laugh_skeleton.blend'; bpy.ops.wm.save_as_mainfile(filepath=str(blend)); bpy.ops.render.render(animation=True)
    print(f'BLEND={blend}'); print(f'VIDEO={sc.render.filepath}')

if __name__=='__main__': main()
