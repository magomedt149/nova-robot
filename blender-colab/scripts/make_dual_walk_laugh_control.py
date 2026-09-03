#!/usr/bin/env python3
"""Render NOVA two-person Blender skeleton motion into a real pose-control MP4.

Consumes NOVA v3 motion JSON with explicit foot contact states.  The skeleton is
rendered in the same 3.6 x 6.4 portrait coordinate space used by the reference
video, so a contact-check overlay can verify alignment before Wan Animate.
"""
from __future__ import annotations
import argparse, json, sys
from pathlib import Path
import bpy
from mathutils import Vector

JOINTS = (
    'pelvis','shoulder_center','neck','head',
    'hip_l','hip_r','knee_l','knee_r','ankle_l','ankle_r','toe_l','toe_r',
    'shoulder_l','shoulder_r','elbow_l','elbow_r','wrist_l','wrist_r'
)
BONES = (
    ('pelvis','shoulder_center'),('shoulder_center','neck'),('neck','head'),
    ('shoulder_l','shoulder_r'),('hip_l','hip_r'),
    ('shoulder_l','elbow_l'),('elbow_l','wrist_l'),
    ('shoulder_r','elbow_r'),('elbow_r','wrist_r'),
    ('pelvis','hip_l'),('hip_l','knee_l'),('knee_l','ankle_l'),('ankle_l','toe_l'),
    ('pelvis','hip_r'),('hip_r','knee_r'),('knee_r','ankle_r'),('ankle_r','toe_r'),
)
COLORS={'man':(0.10,0.72,1.0,1.0),'woman':(1.0,0.16,0.58,1.0)}

def parse_args():
    argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    p=argparse.ArgumentParser()
    p.add_argument('--motion',required=True,type=Path)
    p.add_argument('--output-dir',required=True,type=Path)
    p.add_argument('--width',type=int,default=432)
    p.add_argument('--height',type=int,default=768)
    return p.parse_args(argv)

def clear_scene():
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    for blocks in (bpy.data.meshes,bpy.data.curves,bpy.data.materials,bpy.data.cameras):
        for block in list(blocks):
            if block.users==0: blocks.remove(block)

def material(name,color):
    m=bpy.data.materials.new(name); m.use_nodes=True
    nodes=m.node_tree.nodes; links=m.node_tree.links; nodes.clear()
    out=nodes.new('ShaderNodeOutputMaterial'); em=nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value=color; em.inputs['Strength'].default_value=2.2
    links.new(em.outputs['Emission'],out.inputs['Surface'])
    return m

def joint(name,mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=.052)
    o=bpy.context.object; o.name=name; o.data.materials.append(mat); o.rotation_mode='QUATERNION'; return o

def bone(name,mat):
    bpy.ops.mesh.primitive_cylinder_add(vertices=10,radius=.032,depth=1.0)
    o=bpy.context.object; o.name=name; o.data.materials.append(mat); o.rotation_mode='QUATERNION'; return o

def kf(o,frame):
    o.keyframe_insert(data_path='location',frame=frame)
    o.keyframe_insert(data_path='rotation_quaternion',frame=frame)
    o.keyframe_insert(data_path='scale',frame=frame)

def linear(o):
    if not o.animation_data or not o.animation_data.action: return
    for curve in o.animation_data.action.fcurves:
        for key in curve.keyframe_points: key.interpolation='BEZIER'

def V(v): return Vector((float(v[0]),float(v[1]),float(v[2])))

def main():
    a=parse_args(); payload=json.loads(a.motion.read_text(encoding='utf-8')); frames=payload.get('frames') or []
    if not frames: raise RuntimeError('Motion JSON has no frames')
    fps=max(1,round(float(payload.get('fps') or 30)))
    a.output_dir.mkdir(parents=True,exist_ok=True); clear_scene()

    sc=bpy.context.scene; sc.frame_start=1; sc.frame_end=len(frames); sc.render.fps=fps
    sc.render.resolution_x=a.width; sc.render.resolution_y=a.height; sc.render.resolution_percentage=100
    try: sc.render.engine='BLENDER_EEVEE_NEXT'
    except Exception:
        try: sc.render.engine='BLENDER_EEVEE'
        except Exception: sc.render.engine='BLENDER_WORKBENCH'
    sc.render.image_settings.file_format='FFMPEG'; sc.render.ffmpeg.format='MPEG4'; sc.render.ffmpeg.codec='H264'; sc.render.ffmpeg.constant_rate_factor='MEDIUM'
    sc.render.filepath=str(a.output_dir/'nova_duo_skeleton_control.mp4')
    sc.world.use_nodes=True
    bg=sc.world.node_tree.nodes.get('Background')
    if bg: bg.inputs['Color'].default_value=(0,0,0,1); bg.inputs['Strength'].default_value=0.0

    rigs={}
    for actor_id in ('man','woman'):
        mat=material(f'{actor_id}_emission',COLORS[actor_id])
        joints={name:joint(f'{actor_id}_{name}',mat) for name in JOINTS}
        bones={(s,e):bone(f'{actor_id}_{s}_{e}',mat) for s,e in BONES}
        rigs[actor_id]=(joints,bones)

    for fi,frame in enumerate(frames,start=1):
        actors={item['id']:item for item in frame.get('actors',[])}
        for actor_id,(joints,bones) in rigs.items():
            item=actors.get(actor_id)
            if not item: continue
            jf=item['joints']; contacts=item.get('contacts') or {}; ground=float(contacts.get('ground_z',payload.get('ground_z',-3.02)))
            # Hard contact guard: planted ankles/toes are mathematically snapped to ground.
            for side in ('l','r'):
                if contacts.get(f'foot_{side}'):
                    jf[f'ankle_{side}'][2]=ground; jf[f'toe_{side}'][2]=ground
            for name,o in joints.items():
                p=V(jf[name]); o.location=p; o.rotation_quaternion=(1,0,0,0); o.scale=(1,1,1); kf(o,fi)
            for (s,e),o in bones.items():
                p0,p1=V(jf[s]),V(jf[e]); d=p1-p0; L=max(d.length,.001)
                o.location=(p0+p1)*.5; o.rotation_quaternion=d.to_track_quat('Z','Y'); o.scale=(1,1,L); kf(o,fi)

    for joints,bones in rigs.values():
        for o in list(joints.values())+list(bones.values()): linear(o)

    # Orthographic camera maps 3.6x6.4 scene space directly to 9:16 pixels.
    cam_data=bpy.data.cameras.new('NOVA_Control_Camera'); cam=bpy.data.objects.new('NOVA_Control_Camera',cam_data); sc.collection.objects.link(cam)
    cam.data.type='ORTHO'; cam.data.ortho_scale=6.4; cam.location=(0,-10,0)
    cam.rotation_euler=(Vector((0,0,0))-cam.location).to_track_quat('-Z','Y').to_euler(); sc.camera=cam

    blend=a.output_dir/'nova_duo_walk_laugh_footlock.blend'; bpy.ops.wm.save_as_mainfile(filepath=str(blend)); bpy.ops.render.render(animation=True)
    print(f'BLEND={blend}'); print(f'VIDEO={sc.render.filepath}')

if __name__=='__main__': main()
