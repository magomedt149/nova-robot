#!/usr/bin/env python3
"""NOVA zero-credit local scene pipeline.

Builds a scene pack, continuity manifest and Blender blocking script. For true
camera-orbit requests it renders one persistent 3D scene with a real circular
Blender camera path. Independent still-image stitching is never used here.

No network calls and no paid API keys are used.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path


def choose(q: str, pairs, default):
    for pattern, value in pairs:
        if re.search(pattern, q, re.I):
            return value
    return default


def parse_prompt(prompt: str, duration: int, ratio: str):
    q = prompt.lower()

    wants_orbit = bool(re.search(r"orbit|обл[её]т|вокруг|fly.?around|camera.*around", q, re.I))
    wants_360 = bool(re.search(r"360|полный круг|full circle|full orbit", q, re.I))
    if wants_orbit and wants_360:
        camera = "orbit360"
    elif wants_orbit:
        camera = "orbit"
    else:
        camera = choose(
            q,
            [
                (r"handheld|ручн.*камер|дрож", "handheld"),
                (r"push[- ]?in|наезд|камера.*впер", "push"),
                (r"pull[- ]?out|отъезд|камера.*назад", "pull"),
            ],
            "static",
        )

    subject_type = "car" if re.search(
        r"\bcar\b|\bauto\b|машин|автомоб|supra|prius|camry|toyota|bmw|mercedes|porsche|vehicle",
        q,
        re.I,
    ) else "character"

    vfx = choose(
        q,
        [
            (r"взрыв|explosion", "explosion"),
            (r"молн|lightning", "lightning"),
            (r"искр|sparks?", "sparks"),
            (r"дым|smoke", "smoke"),
            (r"туман|fog", "fog"),
            (r"дожд|rain", "rain"),
            (r"облом|debris", "debris"),
            (r"огонь|плам|fire", "fire"),
        ],
        "none",
    )
    style = choose(
        q,
        [
            (r"золот|cinema|кино|gold|sunset|закат", "gold"),
            (r"красн.*голуб|red.*cyan", "redcyan"),
            (r"голог|hologram", "hologram"),
            (r"clean|чист|minimal", "clean"),
        ],
        "neon",
    )
    count = (
        3
        if re.search(r"трое|three people|three characters", q)
        else 2
        if re.search(r"двое|two people|two characters|пара|мужчина.*девуш|девуш.*мужчин", q)
        else 1
    )
    lens = 85 if re.search(r"крупн|close[- ]?up|портрет", q) else 35 if camera.startswith("orbit") else 50
    if re.search(r"широк|wide|интерьер|комнат", q):
        lens = 24

    shot_scale = choose(q, [(r"крупн|close[- ]?up", "close-up"), (r"общ|wide shot|full body", "wide")], "medium")
    light = choose(
        q,
        [
            (r"ноч|night|неон", "low-key neon practicals"),
            (r"день|day|sun", "soft daylight"),
            (r"золот|gold|sunset|закат", "warm cinematic key + rim"),
        ],
        "soft cinematic key + practical fill",
    )
    location = choose(
        q,
        [
            (r"roof|rooftop|парков.*кры|крыше", "rooftop parking deck"),
            (r"улиц|street", "city street"),
            (r"комнат|room|интерьер", "interior room"),
            (r"машин|car|авто", "car / roadside"),
            (r"студи|studio", "studio set"),
            (r"лес|forest", "forest"),
        ],
        "cinematic neutral set",
    )
    intensity = 1.0 if re.search(r"сильн|много|макс|heavy|intense", q) else 0.35 if re.search(r"л[её]гк|слаб|subtle|light", q) else 0.65
    positions = (
        [[0, 0, 0]]
        if count == 1
        else [[-1.05, 0, 0], [1.05, 0, 0]]
        if count == 2
        else [[-1.35, 0.15, 0], [0, -0.1, 0], [1.35, 0.15, 0]]
    )

    paths = {
        "push": {"type": "linear", "start": [0, -7, 2.2], "end": [0, -5.6, 2.2], "target": [0, 0, 1.4]},
        "pull": {"type": "linear", "start": [0, -5.6, 2.2], "end": [0, -7, 2.2], "target": [0, 0, 1.4]},
        "orbit": {"type": "circle", "degrees": 180.0, "radius": 6.0, "height": 2.2, "target": [0, 0, 1.0]},
        "orbit360": {"type": "circle", "degrees": 360.0, "radius": 6.0, "height": 2.2, "target": [0, 0, 1.0]},
        "handheld": {"type": "linear", "start": [0, -6.2, 2.0], "end": [0.16, -6.0, 2.08], "target": [0, 0, 1.4]},
        "static": {"type": "linear", "start": [0, -6.2, 2.1], "end": [0, -6.2, 2.1], "target": [0, 0, 1.4]},
    }

    s1 = min(1.2, duration * 0.24)
    s2 = max(s1 + 0.6, duration * 0.68)
    continuity = {
        "identity_lock": "STRICT — same face/object identity, body proportions and materials in every frame",
        "wardrobe_lock": "keep source wardrobe exactly unchanged",
        "location_lock": "keep architecture, props, weather and time-of-day unchanged unless the shot plan explicitly changes them",
        "screen_direction_lock": "do not flip left/right positions across cuts",
        "camera_lock": f"{lens}mm baseline lens; preserve height and perspective unless the shot plan changes it",
        "audio_lock": "preserve original dialogue timing; lip-sync after visual approval",
    }
    if subject_type == "car":
        continuity["vehicle_lock"] = "same exact vehicle geometry, wheelbase, wheels, paint, lights and trim across the full shot"

    pack = {
        "schema": "nova.scene-pack.v2",
        "project": "NOVA Auto Director",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source_prompt": prompt,
        "duration": duration,
        "format": ratio,
        "style": style,
        "camera": camera,
        "vfx": vfx,
        "vfx_intensity": intensity,
        "lens_mm": lens,
        "shot_scale": shot_scale,
        "lighting": light,
        "location": location,
        "subject_type": subject_type,
        "shots": [
            {"name": "01_CONTINUOUS_SHOT", "start": 0, "end": duration, "purpose": "one persistent scene; no cuts"},
        ] if camera.startswith("orbit") else [
            {"name": "01_ESTABLISH", "start": 0, "end": round(s1, 3), "purpose": "establish geometry and screen direction"},
            {"name": "02_PERFORMANCE", "start": round(s1, 3), "end": round(s2, 3), "purpose": "hold identity, eyelines and performance"},
            {"name": "03_PAYOFF", "start": round(s2, 3), "end": duration, "purpose": "complete camera/VFX beat without continuity break"},
        ],
        "blocking": {
            "subject_count": count,
            "subject_type": subject_type,
            "positions": positions,
            "camera_path": paths[camera],
            "screen_direction": "locked",
            "eyeline_target": [0, 0, 1.4],
        },
        "continuity": continuity,
        "render_policy": {
            "preview_first": True,
            "paid_generation": False,
            "max_paid_tests": 1,
            "notes": "For orbit shots render true Blender camera geometry first. AI realism is stage two and must use the approved control video.",
        },
    }

    if camera.startswith("orbit"):
        camera_text = f"TRUE BLENDER CAMERA ORBIT {paths[camera]['degrees']:.0f} degrees around a stationary subject, one continuous shot, constant target lock"
    else:
        camera_text = camera

    pack["final_ai_prompt"] = (
        f"CINEMATIC VIDEO SHOT. {location}. {shot_scale}, {lens}mm lens, {light}. "
        f"Camera: {camera_text}. VFX: {vfx} at {int(intensity * 100)}% intensity. "
        f"STRICT CONTINUITY: {continuity['identity_lock']}; {continuity['screen_direction_lock']}. "
        "Use the approved Blender control MP4 as the camera/depth/motion reference. "
        "Preserve the exact camera trajectory and stable background geometry. "
        "No cuts, no camera teleport, no object morphing, no duplicated vehicle/subject, no text artifacts. "
        f"Duration {duration}s, aspect {ratio}."
    )
    return pack


def blender_script(pack):
    payload = json.dumps(pack, ensure_ascii=False)
    return f'''# NOVA Auto Director — generated Blender blocking script
import bpy, json, math, os
from mathutils import Vector
PACK=json.loads(r"""{payload}""")

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene
scene.render.resolution_x=720 if PACK['format']=='9:16' else 1280
scene.render.resolution_y=1280 if PACK['format']=='9:16' else 720
scene.render.resolution_percentage=100
scene.render.fps=30
scene.frame_start=1
scene.frame_end=max(2,int(round(float(PACK['duration'])*scene.render.fps)))
scene.render.image_settings.file_format='FFMPEG'
scene.render.ffmpeg.format='MPEG4'
scene.render.ffmpeg.codec='H264'
scene.render.filepath=os.path.abspath('NOVA_blocking_preview.mp4')

def mat(name,color,metal=0.0,rough=.45):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
 b=m.node_tree.nodes.get('Principled BSDF')
 if b:
  b.inputs['Base Color'].default_value=(*color,1);b.inputs['Metallic'].default_value=metal;b.inputs['Roughness'].default_value=rough
 return m

def cube(name,loc,scale,material):
 bpy.ops.mesh.primitive_cube_add(location=loc);o=bpy.context.object;o.name=name;o.scale=scale
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(material);return o

def wheel(name,loc,material):
 bpy.ops.mesh.primitive_cylinder_add(vertices=40,radius=.43,depth=.25,location=loc,rotation=(math.pi/2,0,0))
 o=bpy.context.object;o.name=name;o.data.materials.append(material);return o

if PACK.get('subject_type')=='car':
 body=mat('ProxyBody',(0.018,.022,.03),.75,.22);glass=mat('ProxyGlass',(.025,.05,.075),.2,.12);tire=mat('ProxyTire',(.012,.012,.012),0,.65)
 cube('PROXY_CAR_BODY',(0,0,.72),(2.15,.90,.34),body)
 cube('PROXY_CAR_HOOD',(.62,0,1.02),(1.25,.86,.16),body)
 cab=cube('PROXY_CAR_CABIN',(-.42,0,1.28),(.92,.74,.38),glass);cab.rotation_euler[1]=math.radians(-6)
 cube('PROXY_CAR_REAR',(-1.45,0,.92),(.62,.88,.22),body)
 for x in (-1.32,1.30):
  for y in (-.93,.93): wheel(f'PROXY_WHEEL_{{x}}_{{y}}',(x,y,.49),tire)
 target=(0,0,.85)
else:
 bpy.ops.mesh.primitive_plane_add(size=18, location=(0,0,0))
 for i,pos in enumerate(PACK['blocking']['positions']):
  x,y,z=pos
  bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=.34,depth=1.55,location=(x,y,.8));bpy.context.object.name=f'CHAR_{{i+1}}_BODY'
  bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,radius=.25,location=(x,y,1.72));bpy.context.object.name=f'CHAR_{{i+1}}_HEAD'
 target=tuple(PACK['blocking']['camera_path'].get('target',[0,0,1.4]))

if PACK.get('subject_type')=='car':
 bpy.ops.mesh.primitive_plane_add(size=22,location=(0,0,0))
 ground=bpy.context.object;ground.name='NOVA_GROUND';ground.data.materials.append(mat('Ground',(.025,.03,.04),.05,.34))

path=PACK['blocking']['camera_path']
bpy.ops.object.empty_add(type='PLAIN_AXES',location=target)
look=bpy.context.object;look.name='NOVA_CAMERA_TARGET'

if path.get('type')=='circle':
 radius=float(path.get('radius',6.0));height=float(path.get('height',2.2))
 bpy.ops.curve.primitive_bezier_circle_add(radius=radius,location=(target[0],target[1],height))
 curve=bpy.context.object;curve.name='NOVA_TRUE_ORBIT_PATH';curve.data.resolution_u=24;curve.data.render_resolution_u=24
 bpy.ops.object.camera_add(location=(target[0]+radius,target[1],height))
 cam=bpy.context.object;scene.camera=cam;cam.data.lens=PACK['lens_mm']
 follow=cam.constraints.new(type='FOLLOW_PATH');follow.target=curve;follow.use_fixed_location=True;follow.use_curve_follow=False
 track=cam.constraints.new(type='TRACK_TO');track.target=look;track.track_axis='TRACK_NEGATIVE_Z';track.up_axis='UP_Y'
 follow.offset_factor=0.0;follow.keyframe_insert(data_path='offset_factor',frame=scene.frame_start)
 follow.offset_factor=float(path.get('degrees',180.0))/360.0;follow.keyframe_insert(data_path='offset_factor',frame=scene.frame_end)
 if cam.animation_data and cam.animation_data.action:
  for fc in cam.animation_data.action.fcurves:
   for kp in fc.keyframe_points:kp.interpolation='LINEAR'
else:
 start=path['start'];end=path['end']
 bpy.ops.object.camera_add(location=start);cam=bpy.context.object;scene.camera=cam;cam.data.lens=PACK['lens_mm']
 def look_at(obj,t):obj.rotation_euler=(Vector(t)-obj.location).to_track_quat('-Z','Y').to_euler()
 look_at(cam,target);cam.keyframe_insert(data_path='location',frame=scene.frame_start);cam.keyframe_insert(data_path='rotation_euler',frame=scene.frame_start)
 cam.location=end;look_at(cam,target);cam.keyframe_insert(data_path='location',frame=scene.frame_end);cam.keyframe_insert(data_path='rotation_euler',frame=scene.frame_end)

bpy.ops.object.light_add(type='AREA',location=(3,-4,6));bpy.context.object.data.energy=1200;bpy.context.object.data.size=5
bpy.ops.object.light_add(type='AREA',location=(-4,2,4));bpy.context.object.data.energy=650;bpy.context.object.data.size=4
scene.world.color=(.018,.022,.035)

for marker in PACK['shots']:
 scene.timeline_markers.new(marker['name'],frame=max(1,int(float(marker['start'])*scene.render.fps)+1))

bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath('NOVA_blocking_scene.blend'))
bpy.ops.render.render(animation=True)
print('NOVA blocking ready:',scene.render.filepath)
'''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", default="TUMSOEV cinematic 5 sec, true 360 orbit")
    ap.add_argument("--duration", type=int, default=5)
    ap.add_argument("--ratio", choices=["16:9", "9:16"], default="16:9")
    ap.add_argument("--scene-pack", help="Use an exported NOVA_scene_pack.json instead of --prompt")
    ap.add_argument("--asset", help="Optional licensed/user-owned 3D asset path. Stored in the scene pack for downstream tools.")
    ap.add_argument("--out", default="build/nova_scene")
    ap.add_argument("--run-blender", action="store_true")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    if args.scene_pack:
        pack = json.loads(Path(args.scene_pack).read_text(encoding="utf-8"))
    else:
        pack = parse_prompt(args.prompt, args.duration, args.ratio)
    if args.asset:
        pack["asset_path"] = str(Path(args.asset).expanduser().resolve())

    script = blender_script(pack)
    pack["blender_script"] = script
    (out / "NOVA_scene_pack.json").write_text(json.dumps(pack, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "NOVA_continuity.json").write_text(json.dumps(pack["continuity"], ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "NOVA_final_AI_prompt.txt").write_text(pack["final_ai_prompt"], encoding="utf-8")
    blender_py = out / "NOVA_blender_blocking.py"
    blender_py.write_text(script, encoding="utf-8")

    print("NOVA plan ready:", out.resolve())
    print("Camera:", pack.get("camera"), pack.get("blocking", {}).get("camera_path"))
    print("Paid API calls: 0")

    if args.run_blender:
        blender = shutil.which("blender")
        if not blender:
            print("Blender not found. Install Blender locally, then run this command again with --run-blender.")
            return 2
        subprocess.run([blender, "-b", "-P", str(blender_py.resolve())], cwd=str(out.resolve()), check=True)
        print("Blocking preview:", (out / "NOVA_blocking_preview.mp4").resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
