(()=>{
const $=id=>document.getElementById(id),state={pack:null};
const pick=(q,pairs,f)=>{for(const x of pairs)if(x[0].test(q))return x[1];return f};
const round=n=>Math.round(n*1000)/1000;
function subjectCount(q){if(/трое|three people|three characters/.test(q))return 3;if(/двое|two people|two characters|пара|мужчина.*девуш|девуш.*мужчин/.test(q))return 2;return 1}
function lensFor(c,q){if(/крупн|close[- ]?up|портрет/.test(q))return 85;if(/широк|wide|интерьер|комнат/.test(q))return 24;if(c==='orbit')return 35;return 50}
function positions(n){return n===1?[[0,0,0]]:n===2?[[-1.05,0,0],[1.05,0,0]]:[[-1.35,.15,0],[0,-.1,0],[1.35,.15,0]]}
function cameraPath(c){if(c==='push')return{start:[0,-7,2.2],end:[0,-5.6,2.2],target:[0,0,1.4]};if(c==='orbit')return{start:[-5.4,-5.4,2.3],end:[5.4,-5.4,2.3],target:[0,0,1.4]};if(c==='handheld')return{start:[0,-6.2,2],end:[.16,-6,2.08],target:[0,0,1.4]};return{start:[0,-6.2,2.1],end:[0,-6.2,2.1],target:[0,0,1.4]}}
function blender(pack){
 const p=JSON.stringify(pack).replace(/\/g,'\\').replace(/'''/g,"\'\'\'");
 return [
 '# NOVA Auto Director — Blender blocking','import bpy, json, os','from mathutils import Vector',"PACK=json.loads(r'''"+p+"''')",
 "bpy.ops.object.select_all(action='SELECT')","bpy.ops.object.delete(use_global=False)",'scene=bpy.context.scene',
 "scene.render.resolution_x=720 if PACK['format']=='9:16' else 1280","scene.render.resolution_y=1280 if PACK['format']=='9:16' else 720",'scene.render.resolution_percentage=50','scene.render.fps=24','scene.frame_start=1',"scene.frame_end=max(48,int(PACK['duration']*24))",
 "scene.render.image_settings.file_format='FFMPEG'","scene.render.ffmpeg.format='MPEG4'","scene.render.ffmpeg.codec='H264'","scene.render.filepath=os.path.abspath('NOVA_blocking_preview.mp4')",
 "bpy.ops.mesh.primitive_plane_add(size=18, location=(0,0,0))",
 "for i,pos in enumerate(PACK['blocking']['positions']):\n x,y,z=pos\n bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=.34,depth=1.55,location=(x,y,.8))\n bpy.context.object.name='CHAR_%s_BODY'%(i+1)\n bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,radius=.25,location=(x,y,1.72))\n bpy.context.object.name='CHAR_%s_HEAD'%(i+1)",
 "bpy.ops.object.camera_add(location=PACK['blocking']['camera_path']['start'])","cam=bpy.context.object","scene.camera=cam","cam.data.lens=PACK['lens_mm']",
 "def look_at(obj,target):\n obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()",
 "look_at(cam,PACK['blocking']['camera_path']['target'])","cam.keyframe_insert(data_path='location',frame=1)","cam.location=PACK['blocking']['camera_path']['end']","look_at(cam,PACK['blocking']['camera_path']['target'])","cam.keyframe_insert(data_path='location',frame=scene.frame_end)",
 "bpy.ops.object.light_add(type='AREA',location=(2.5,-3.5,5))","bpy.context.object.data.energy=1100","bpy.context.object.data.size=5","bpy.ops.object.light_add(type='AREA',location=(-3.5,-1,2.6))","bpy.context.object.data.energy=420","bpy.context.object.data.size=4",
 "for marker in PACK['shots']:\n scene.timeline_markers.new(marker['name'],frame=max(1,int(marker['start']*24)+1))",
 "bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath('NOVA_blocking_scene.blend'))","bpy.ops.render.render(animation=True)","print('NOVA blocking ready:',scene.render.filepath)"
 ].join('\n');
}
function buildPack(){
 const raw=$('prompt').value.trim(),q=raw.toLowerCase();if(!q)return null;const c=window.config?window.config():{};
 const n=subjectCount(q),camera=c.camera||'static',duration=Number(c.duration||5),lens=lensFor(camera,q),s1=Math.min(1.2,duration*.24),s2=Math.max(s1+.6,duration*.68);
 const shotScale=pick(q,[[/крупн|close[- ]?up/,'close-up'],[/общ|wide shot|full body/,'wide']], 'medium');
 const lighting=pick(q,[[/ноч|night|неон/,'low-key neon practicals'],[/день|day|sun/,'soft daylight'],[/золот|gold|sunset|закат/,'warm cinematic key + rim']],'soft cinematic key + practical fill');
 const location=pick(q,[[/улиц|street/,'city street'],[/комнат|room|интерьер/,'interior room'],[/машин|car|авто/,'car / roadside'],[/студи|studio/,'studio set'],[/лес|forest/,'forest']],'cinematic neutral set');
 const wardrobe=/костюм|suit/.test(q)?'dark tailored suit':/куртк|jacket/.test(q)?'dark jacket':'keep source wardrobe exactly unchanged';
 const shots=[{name:'01_ESTABLISH',start:0,end:round(s1),purpose:'establish geometry and screen direction'},{name:'02_PERFORMANCE',start:round(s1),end:round(s2),purpose:'hold identity, eyelines and performance'},{name:'03_PAYOFF',start:round(s2),end:duration,purpose:'complete camera/VFX beat without continuity break'}];
 const pack={schema:'nova.scene-pack.v1',project:'NOVA Auto Director',created_at:new Date().toISOString(),source_prompt:raw,duration:duration,format:c.ratio||'16:9',style:c.style||'neon',motion:c.motion||'slide',camera:camera,vfx:c.vfx||'none',vfx_intensity:Number(c.intensity||.65),lens_mm:lens,shot_scale:shotScale,lighting:lighting,location:location,shots:shots,blocking:{subject_count:n,positions:positions(n),camera_path:cameraPath(camera),screen_direction:'locked',eyeline_target:[0,0,1.4]},continuity:{identity_lock:'STRICT — same face, age, hair, body proportions and skin tone in every shot',wardrobe_lock:wardrobe,location_lock:'keep architecture, props, weather and time-of-day unchanged unless shot plan explicitly changes them',screen_direction_lock:'do not flip left/right positions across cuts',camera_lock:lens+'mm baseline lens; preserve height and perspective unless shot plan changes it',audio_lock:'preserve original dialogue timing; lip-sync after visual approval'},render_policy:{preview_first:true,paid_generation:false,max_paid_tests:1,notes:'Use free blocking/preview first. Only approved shot may be sent to an external AI video model.'}};
 pack.final_ai_prompt='CINEMATIC VIDEO SHOT. '+location+'. '+n+' character'+(n>1?'s':'')+'. '+shotScale+', '+lens+'mm lens, '+lighting+'. Camera: '+camera+'. Motion: '+pack.motion+'. VFX: '+pack.vfx+' at '+Math.round(pack.vfx_intensity*100)+'% intensity. STRICT CONTINUITY: '+pack.continuity.identity_lock+'; '+pack.continuity.wardrobe_lock+'; '+pack.continuity.screen_direction_lock+'. Preserve exact composition from the approved blocking preview, natural human motion, realistic weight and inertia, stable hands, stable face, consistent background geometry, physically plausible lighting, no morphing, no identity drift, no camera teleport, no extra limbs, no text artifacts. Duration '+duration+'s, aspect '+pack.format+'.';
 pack.blender_script=blender(pack);return pack;
}
function plan(pack){const a=['NOVA AUTO DIRECTOR — '+pack.format+', '+pack.duration+'s','Location: '+pack.location,'Lens: '+pack.lens_mm+'mm | Camera: '+pack.camera+' | Light: '+pack.lighting,''];pack.shots.forEach(s=>a.push(s.name+'  '+s.start.toFixed(1)+'–'+s.end.toFixed(1)+'s  — '+s.purpose));a.push('','Identity: '+pack.continuity.identity_lock,'Wardrobe: '+pack.continuity.wardrobe_lock,'Screen direction: '+pack.continuity.screen_direction_lock);return a.join('\n')}
function save(name,data,type){const b=new Blob([data],{type:type||'application/json'}),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1200)}
function run(){const p=buildPack();if(!p){$('directorSummary').textContent='Сначала опиши сцену выше.';return}state.pack=p;$('directorSummary').textContent='🎬 '+p.shots.length+' shots • '+p.lens_mm+'mm • '+p.camera+' • '+p.blocking.subject_count+' actor'+(p.blocking.subject_count>1?'s':'')+' • '+p.vfx+' • continuity LOCKED';$('shotPlan').textContent=plan(p);$('shotPlan').classList.remove('hidden');['downloadScenePack','copyFinalPrompt','downloadBlender'].forEach(id=>$(id).disabled=false);if($('applyPrompt'))$('applyPrompt').click();if(window.restart)window.restart();$('status').textContent='Авто-режиссёр собрал shot plan, blocking и continuity. Сначала проверь бесплатный preview.'}
$('autoDirector').addEventListener('click',run);
$('downloadScenePack').addEventListener('click',()=>state.pack&&save('NOVA_scene_pack.json',JSON.stringify(state.pack,null,2)));
$('downloadBlender').addEventListener('click',()=>state.pack&&save('NOVA_blender_blocking.py',state.pack.blender_script,'text/x-python'));
$('copyFinalPrompt').addEventListener('click',async()=>{if(!state.pack)return;try{await navigator.clipboard.writeText(state.pack.final_ai_prompt);$('status').textContent='Финальный AI prompt скопирован. Платную модель используй только после одобрения preview.'}catch(e){save('NOVA_final_AI_prompt.txt',state.pack.final_ai_prompt,'text/plain')}});
})();