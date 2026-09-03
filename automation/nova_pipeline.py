#!/usr/bin/env python3
"""NOVA zero-credit local pipeline.
Builds a scene pack, continuity manifest and Blender blocking script. If Blender is
installed locally, --run-blender renders a low-cost blocking preview headlessly.
No network calls and no paid API keys are used.
"""
from __future__ import annotations
import argparse, json, re, shutil, subprocess
from pathlib import Path
from datetime import datetime, timezone

def choose(q: str, pairs, default):
    for pattern, value in pairs:
        if re.search(pattern, q, re.I):
            return value
    return default

def parse_prompt(prompt: str, duration: int, ratio: str):
    q = prompt.lower()
    camera = choose(q, [(r"orbit|обл[её]т|вокруг", "orbit"),(r"handheld|ручн.*камер|дрож", "handheld"),(r"push[- ]?in|наезд|камера.*впер", "push")], "static")
    vfx = choose(q, [(r"взрыв|explosion", "explosion"),(r"молн|lightning", "lightning"),(r"искр|sparks?", "sparks"),(r"дым|smoke", "smoke"),(r"туман|fog", "fog"),(r"дожд|rain", "rain"),(r"облом|debris", "debris"),(r"огонь|плам|fire", "fire")], "none")
    style = choose(q, [(r"золот|cinema|кино|gold", "gold"),(r"красн.*голуб|red.*cyan|3d", "redcyan"),(r"голог|hologram", "hologram"),(r"clean|чист|minimal", "clean")], "neon")
    count = 3 if re.search(r"трое|three people|three characters", q) else 2 if re.search(r"двое|two people|two characters|пара|мужчина.*девуш|девуш.*мужчин", q) else 1
    lens = 85 if re.search(r"крупн|close[- ]?up|портрет", q) else 24 if re.search(r"широк|wide|интерьер|комнат", q) else 35 if camera == "orbit" else 50
    shot_scale = choose(q, [(r"крупн|close[- ]?up", "close-up"),(r"общ|wide shot|full body", "wide")], "medium")
    light = choose(q, [(r"ноч|night|неон", "low-key neon practicals"),(r"день|day|sun", "soft daylight"),(r"золот|gold|sunset|закат", "warm cinematic key + rim")], "soft cinematic key + practical fill")
    location = choose(q, [(r"улиц|street", "city street"),(r"комнат|room|интерьер", "interior room"),(r"машин|car|авто", "car / roadside"),(r"студи|studio", "studio set"),(r"лес|forest", "forest")], "cinematic neutral set")
    intensity = 1.0 if re.search(r"сильн|много|макс|heavy|intense", q) else 0.35 if re.search(r"л[её]гк|слаб|subtle|light", q) else 0.65
    positions = [[0,0,0]] if count == 1 else [[-1.05,0,0],[1.05,0,0]] if count == 2 else [[-1.35,.15,0],[0,-.1,0],[1.35,.15,0]]
    paths = {
        "push":{"start":[0,-7,2.2],"end":[0,-5.6,2.2],"target":[0,0,1.4]},
        "orbit":{"start":[-5.4,-5.4,2.3],"end":[5.4,-5.4,2.3],"target":[0,0,1.4]},
        "handheld":{"start":[0,-6.2,2.0],"end":[.16,-6.0,2.08],"target":[0,0,1.4]},
        "static":{"start":[0,-6.2,2.1],"end":[0,-6.2,2.1],"target":[0,0,1.4]},
    }
    s1=min(1.2,duration*.24); s2=max(s1+.6,duration*.68)
    pack={
        "schema":"nova.scene-pack.v1","project":"NOVA Auto Director","created_at":datetime.now(timezone.utc).isoformat(),"source_prompt":prompt,
        "duration":duration,"format":ratio,"style":style,"camera":camera,"vfx":vfx,"vfx_intensity":intensity,"lens_mm":lens,"shot_scale":shot_scale,"lighting":light,"location":location,
        "shots":[{"name":"01_ESTABLISH","start":0,"end":round(s1,3),"purpose":"establish geometry and screen direction"},{"name":"02_PERFORMANCE","start":round(s1,3),"end":round(s2,3),"purpose":"hold identity, eyelines and performance"},{"name":"03_PAYOFF","start":round(s2,3),"end":duration,"purpose":"complete camera/VFX beat without continuity break"}],
        "blocking":{"subject_count":count,"positions":positions,"camera_path":paths[camera],"screen_direction":"locked","eyeline_target":[0,0,1.4]},
        "continuity":{"identity_lock":"STRICT — same face, age, hair, body proportions and skin tone in every shot","wardrobe_lock":"keep source wardrobe exactly unchanged","location_lock":"keep architecture, props, weather and time-of-day unchanged unless shot plan explicitly changes them","screen_direction_lock":"do not flip left/right positions across cuts","camera_lock":f"{lens}mm baseline lens; preserve height and perspective unless shot plan changes it","audio_lock":"preserve original dialogue timing; lip-sync after visual approval"},
        "render_policy":{"preview_first":True,"paid_generation":False,"max_paid_tests":1,"notes":"Use free blocking/preview first. Only approved shot may be sent to an external AI video model."}
    }
    pack["final_ai_prompt"] = f"CINEMATIC VIDEO SHOT. {location}. {count} character{'s' if count>1 else ''}. {shot_scale}, {lens}mm lens, {light}. Camera: {camera}. VFX: {vfx} at {int(intensity*100)}% intensity. STRICT CONTINUITY: {pack['continuity']['identity_lock']}; {pack['continuity']['wardrobe_lock']}; {pack['continuity']['screen_direction_lock']}. Preserve exact composition from the approved blocking preview, natural human motion, realistic weight and inertia, stable hands, stable face, consistent background geometry, physically plausible lighting, no morphing, no identity drift, no camera teleport, no extra limbs, no text artifacts. Duration {duration}s, aspect {ratio}."
    return pack

def blender_script(pack):
    payload=json.dumps(pack,ensure_ascii=False)
    return f'''# NOVA Auto Director — generated Blender blocking script
import bpy, json, os
from mathutils import Vector
PACK=json.loads(r"""{payload}""")
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene
scene.render.resolution_x=720 if PACK['format']=='9:16' else 1280
scene.render.resolution_y=1280 if PACK['format']=='9:16' else 720
scene.render.resolution_percentage=50; scene.render.fps=24; scene.frame_start=1; scene.frame_end=max(48,int(PACK['duration']*24))
scene.render.image_settings.file_format='FFMPEG'; scene.render.ffmpeg.format='MPEG4'; scene.render.ffmpeg.codec='H264'; scene.render.filepath=os.path.abspath('NOVA_blocking_preview.mp4')
bpy.ops.mesh.primitive_plane_add(size=18, location=(0,0,0))
for i,pos in enumerate(PACK['blocking']['positions']):
 x,y,z=pos; bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=.34,depth=1.55,location=(x,y,.8)); bpy.context.object.name=f'CHAR_{i+1}_BODY'; bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,radius=.25,location=(x,y,1.72)); bpy.context.object.name=f'CHAR_{i+1}_HEAD'
bpy.ops.object.camera_add(location=PACK['blocking']['camera_path']['start']); cam=bpy.context.object; scene.camera=cam; cam.data.lens=PACK['lens_mm']
def look_at(obj,target): obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
look_at(cam,PACK['blocking']['camera_path']['target']); cam.keyframe_insert(data_path='location',frame=1); cam.location=PACK['blocking']['camera_path']['end']; look_at(cam,PACK['blocking']['camera_path']['target']); cam.keyframe_insert(data_path='location',frame=scene.frame_end)
bpy.ops.object.light_add(type='AREA',location=(2.5,-3.5,5.0)); bpy.context.object.data.energy=1100; bpy.context.object.data.size=5
bpy.ops.object.light_add(type='AREA',location=(-3.5,-1,2.6)); bpy.context.object.data.energy=420; bpy.context.object.data.size=4
for marker in PACK['shots']: scene.timeline_markers.new(marker['name'],frame=max(1,int(marker['start']*24)+1))
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath('NOVA_blocking_scene.blend')); bpy.ops.render.render(animation=True)
print('NOVA blocking ready:',scene.render.filepath)
'''

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--prompt',default='TUMSOEV cinematic 5 sec, push-in, rain')
    ap.add_argument('--duration',type=int,default=5)
    ap.add_argument('--ratio',choices=['16:9','9:16'],default='16:9')
    ap.add_argument('--scene-pack',help='Use an exported NOVA_scene_pack.json instead of --prompt')
    ap.add_argument('--out',default='build/nova_scene')
    ap.add_argument('--run-blender',action='store_true')
    args=ap.parse_args()
    out=Path(args.out); out.mkdir(parents=True,exist_ok=True)
    if args.scene_pack:
        pack=json.loads(Path(args.scene_pack).read_text(encoding='utf-8'))
    else:
        pack=parse_prompt(args.prompt,args.duration,args.ratio)
    script=blender_script(pack); pack['blender_script']=script
    (out/'NOVA_scene_pack.json').write_text(json.dumps(pack,ensure_ascii=False,indent=2),encoding='utf-8')
    (out/'NOVA_continuity.json').write_text(json.dumps(pack['continuity'],ensure_ascii=False,indent=2),encoding='utf-8')
    (out/'NOVA_final_AI_prompt.txt').write_text(pack['final_ai_prompt'],encoding='utf-8')
    blender_py=out/'NOVA_blender_blocking.py'; blender_py.write_text(script,encoding='utf-8')
    print('NOVA plan ready:',out.resolve())
    print('Paid API calls: 0')
    if args.run_blender:
        blender=shutil.which('blender')
        if not blender:
            print('Blender not found. Install Blender locally, then run this command again with --run-blender.')
            return 2
        subprocess.run([blender,'-b','-P',str(blender_py.resolve())],cwd=str(out.resolve()),check=True)
        print('Blocking preview:',(out/'NOVA_blocking_preview.mp4').resolve())
    return 0

if __name__=='__main__':
    raise SystemExit(main())
