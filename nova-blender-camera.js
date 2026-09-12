(() => {
  'use strict';

  if (window.NovaBlenderCamera) return;

  const $ = (selector, root = document) => root.querySelector(selector);
  const VERSION = '1.1.0';
  const REPO = 'magomedt149/nova-robot';
  const TRUE_3D_PATHS = new Set(['orbit', 'orbit360', 'arc', 'crane', 'topdown']);
  const state = { recording:false, samples:[], startedAt:0, lastSampleAt:0, timer:0, orientationHandler:null };

  function status(message) {
    const local = $('#novaMediaStatus');
    if (local) local.textContent = message;
    const global = $('#statusText');
    if (global) global.textContent = message;
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }

  function currentPlan() {
    const plan = window.Nova3DDirector?.getRenderPlan?.() || {};
    return {
      schema:'nova.scene-pack.v2', project:'NOVA 3D Director',
      source_prompt:String(plan.prompt || $('#nova3DPrompt')?.value || '').trim(),
      duration:clamp(plan.duration || $('#nova3DDuration')?.value || 5, 1, 15),
      format:plan.ratio || $('#nova3DRatio')?.value || '9:16',
      scene:plan.scene || $('#nova3DScene')?.value || 'car',
      camera:plan.path || $('#nova3DPath')?.value || 'orbit360',
      negative:plan.negative || '',
      render_policy:{ preview_first:true, paid_generation:false, external_compute_requires_confirmation:true }
    };
  }

  function degreesFor(path) { return path === 'orbit360' ? 360 : (path === 'orbit' || path === 'arc' ? 180 : 0); }

  function normalizedOrientationSamples() {
    if (!state.samples.length) return [];
    const first = state.samples[0];
    const delta = (value, base) => {
      let d = Number(value || 0) - Number(base || 0);
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      return Math.round(d * 1000) / 1000;
    };
    return state.samples.map((sample) => ({
      t:Math.round(sample.t * 1000) / 1000,
      yaw:delta(sample.alpha, first.alpha), pitch:delta(sample.beta, first.beta), roll:delta(sample.gamma, first.gamma)
    }));
  }

  function buildScenePack() {
    const plan = currentPlan();
    const degrees = degreesFor(plan.camera);
    return {
      ...plan,
      blocking:{
        subject_type:plan.scene === 'car' ? 'car' : plan.scene,
        camera_path:TRUE_3D_PATHS.has(plan.camera) ? {
          type:['orbit','orbit360','arc'].includes(plan.camera) ? 'circle' : plan.camera,
          degrees, radius:6, height:2.2, target:[0,0,plan.scene === 'car' ? 1.0 : 1.4], continuous:true, cuts:0, interpolation:'LINEAR'
        } : {
          type:'linear', start:plan.camera === 'pull' ? [0,-5.6,2.2] : [0,-7,2.2],
          end:plan.camera === 'pull' ? [0,-7,2.2] : [0,-5.6,2.2], target:[0,0,1.4], continuous:true, cuts:0, interpolation:'LINEAR'
        }
      },
      virtual_camera:{ source:state.samples.length ? 'iphone-deviceorientation' : 'none', samples:normalizedOrientationSamples(), note:'Rotation only; translation stays on the deterministic Blender path.' },
      truthfulness_guard:{ true_3d_required:TRUE_3D_PATHS.has(plan.camera), forbid_slideshow:true, forbid_crossfades:true, forbid_2d_panzoom_as_orbit:true, persistent_scene:true }
    };
  }

  function downloadText(name, text, type='application/json') {
    const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function exportScenePack() {
    const pack = buildScenePack();
    downloadText(`NOVA_scene_pack_${pack.camera}_${pack.duration}s_${pack.format.replace(':','x')}.json`, JSON.stringify(pack, null, 2));
    status('✅ Scene Pack сохранён. Совместим с Blender true-orbit pipeline.');
  }

  function buildCommand() {
    const pack = currentPlan(); const degrees = degreesFor(pack.camera) || 180;
    return `blender -b --python blender-colab/scripts/render_true_orbit.py -- --duration ${pack.duration} --fps 30 --ratio ${pack.format} --degrees ${degrees} --output NOVA_true_orbit.mp4`;
  }

  async function copyCommand() {
    const command = buildCommand();
    try { await navigator.clipboard.writeText(command); status('✅ Команда Blender скопирована.'); }
    catch (_) { if ($('#novaBlenderCommand')) $('#novaBlenderCommand').value = command; status('Команда готова ниже — скопируй вручную.'); }
  }

  function stopOrientationCapture(message='') {
    if (state.orientationHandler) window.removeEventListener('deviceorientation', state.orientationHandler);
    state.orientationHandler = null; if (state.timer) clearTimeout(state.timer); state.timer = 0; const was = state.recording; state.recording = false;
    if ($('#novaBlenderPhoneCamera')) $('#novaBlenderPhoneCamera').textContent = '📱 Записать iPhone Camera'; updateSummary();
    if (message) status(message); else if (was) status(`✅ iPhone Camera: записано ${state.samples.length} точек.`);
  }

  async function startOrientationCapture() {
    if (state.recording) return stopOrientationCapture('iPhone Camera остановлена.');
    const duration = currentPlan().duration;
    if (!('DeviceOrientationEvent' in window)) return status('Датчик ориентации недоступен. Blender camera path работает без него.');
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const permission = await DeviceOrientationEvent.requestPermission(); if (permission !== 'granted') throw new Error('доступ к датчику не разрешён');
      }
    } catch (error) { status(`iPhone Camera: ${error?.message || error}.`); return; }
    state.samples=[]; state.startedAt=performance.now(); state.lastSampleAt=0; state.recording=true;
    if ($('#novaBlenderPhoneCamera')) $('#novaBlenderPhoneCamera').textContent='⏹ Остановить iPhone Camera';
    state.orientationHandler=(event)=>{ if(!state.recording)return; const now=performance.now(); if(now-state.lastSampleAt<30)return; state.lastSampleAt=now; state.samples.push({t:(now-state.startedAt)/1000,alpha:Number(event.alpha||0),beta:Number(event.beta||0),gamma:Number(event.gamma||0)}); updateSummary(); };
    window.addEventListener('deviceorientation', state.orientationHandler, {passive:true}); state.timer=setTimeout(()=>stopOrientationCapture(),duration*1000); status(`📱 iPhone Camera: ${duration} сек.`);
  }

  function setControl(selector, value) { const node=$(selector); if(!node)return; node.value=value; node.dispatchEvent(new Event('change',{bubbles:true})); }
  function supraPreset() {
    setControl('#nova3DScene','car'); setControl('#nova3DPath','orbit360'); setControl('#nova3DDuration','5'); setControl('#nova3DRatio','9:16');
    const prompt=$('#nova3DPrompt'); if(prompt){ prompt.value='Toyota Supra стоит неподвижно. Одна камера делает непрерывный полный 360° облёт вокруг машины за 5 секунд, без склеек, без смены ракурсов, без слайдшоу. Вертикально 9:16.'; prompt.dispatchEvent(new Event('input',{bubbles:true})); }
    window.Nova3DDirector?.refresh?.(); updateSummary(); status('✅ Supra 360 preset: TRUE 3D · 5 сек · 9:16.');
  }

  function updateSummary() {
    const box=$('#novaBlenderSummary'), command=$('#novaBlenderCommand'); if(!box&&!command)return; const plan=currentPlan();
    if(box) box.textContent=`${TRUE_3D_PATHS.has(plan.camera)?'TRUE 3D':'LINEAR'} · ${plan.camera} · ${plan.duration}s · ${plan.format} · 0 cuts · phone samples: ${state.samples.length}`;
    if(command&&document.activeElement!==command) command.value=buildCommand();
  }

  function ensureStyles() {
    if ($('#novaBlenderCameraStyles')) return; const style=document.createElement('style'); style.id='novaBlenderCameraStyles'; style.textContent=`
.n3-blender{margin-top:12px;padding:12px;border:1px solid rgba(68,219,174,.24);border-radius:15px;background:linear-gradient(135deg,rgba(10,74,75,.17),rgba(24,56,120,.13))}.n3-blender-head{display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap}.n3-blender-head b{font-size:14px}.n3-blender-head span{font-size:10px;color:#79edc2;border:1px solid rgba(79,234,177,.24);border-radius:999px;padding:4px 7px}.n3-blender-note{margin:7px 0;font-size:11px;line-height:1.45;color:#9fc5d7}.n3-blender-actions{display:flex;gap:7px;flex-wrap:wrap;margin:8px 0}.n3-blender-actions button,.n3-blender-actions a{border:1px solid rgba(95,171,255,.23);border-radius:10px;background:rgba(255,255,255,.06);color:#fff;padding:8px 10px;font-weight:850;text-decoration:none}.n3-blender-actions .primary{border:0;background:linear-gradient(135deg,#0f9b73,#29c98e)}.n3-blender-summary{font-size:11px;color:#b7d6e8;margin:6px 0}.n3-blender-command{width:100%;box-sizing:border-box;min-height:68px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:#04101c;color:#dff7ff;padding:8px;font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical}
.nba-panel{margin-top:10px;padding:11px;border:1px solid rgba(133,100,255,.28);border-radius:13px;background:rgba(8,12,27,.7)}.nba-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}.nba-badge{font-size:9px;font-weight:900;color:#b8f9dc;border:1px solid rgba(93,239,181,.28);border-radius:999px;padding:4px 7px}.nba-dot{width:8px;height:8px;border-radius:50%;display:inline-block;background:#64748b;margin-right:5px}.nba-dot[data-state=on]{background:#38d996;box-shadow:0 0 9px #38d996}.nba-dot[data-state=busy]{background:#ffcd57;box-shadow:0 0 9px #ffcd57}.nba-grid{display:grid;grid-template-columns:1fr auto;gap:6px;margin-top:8px}.nba-grid input{min-width:0;border:1px solid rgba(255,255,255,.13);border-radius:9px;background:#030a16;color:#e5f5ff;padding:8px;font:10px ui-monospace,SFMono-Regular,Menlo,monospace}.nba-token{grid-column:1/-1}.nba-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.nba-actions button{border:1px solid rgba(112,162,255,.25);border-radius:9px;background:rgba(255,255,255,.06);color:#fff;padding:7px 9px;font-weight:800;font-size:10px}.nba-actions .primary{border:0;background:linear-gradient(135deg,#6a4df5,#10a77a)}.nba-actions .danger{border-color:rgba(255,96,96,.3)}.nba-actions button:disabled{opacity:.45}.nba-status{margin-top:8px;font-size:10px;line-height:1.4;color:#a8c9da}.nba-previews{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:5px;margin-top:8px}.nba-previews img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px;background:#020713}.nba-output{max-height:180px;overflow:auto;white-space:pre-wrap;margin:8px 0 0;padding:8px;border-radius:8px;background:#020713;color:#9fd6bf;font:9px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace}`; document.head.appendChild(style);
  }

  function ensurePanel() {
    const pane=$('#nova3DPane'); if(!pane||$('#novaBlenderCameraPanel',pane)) return Boolean(pane); ensureStyles(); const host=$('.n3-wrap',pane)||pane; const panel=document.createElement('section'); panel.id='novaBlenderCameraPanel'; panel.className='n3-blender';
    panel.innerHTML=`<div class="n3-blender-head"><b>🧊 Blender Camera Bridge</b><span>FREE · TRUE 3D · AGENT READY</span></div><div class="n3-blender-note">Orbit/360 — настоящая Blender camera path. Local Agent ниже: SCAN → LOOK → ANALYZE → FIX → FLOW → LOOP.</div><div class="n3-blender-actions"><button class="primary" id="novaBlenderSupra360" type="button">🚗 Supra 360 · 5s · 9:16</button><button id="novaBlenderPhoneCamera" type="button">📱 Записать iPhone Camera</button><button id="novaBlenderExportPack" type="button">⬇ Scene Pack JSON</button><button id="novaBlenderCopyCommand" type="button">📋 Blender command</button><a href="https://github.com/${REPO}/tree/main/blender-agent" target="_blank" rel="noopener">🤖 Agent files</a><a href="https://github.com/${REPO}/tree/blender-colab-studio" target="_blank" rel="noopener">☁ Blender Colab</a></div><div id="novaBlenderSummary" class="n3-blender-summary"></div><textarea id="novaBlenderCommand" class="n3-blender-command" readonly></textarea>`;
    host.appendChild(panel); $('#novaBlenderSupra360',panel)?.addEventListener('click',supraPreset); $('#novaBlenderPhoneCamera',panel)?.addEventListener('click',startOrientationCapture); $('#novaBlenderExportPack',panel)?.addEventListener('click',exportScenePack); $('#novaBlenderCopyCommand',panel)?.addEventListener('click',copyCommand);
    ['#nova3DScene','#nova3DPath','#nova3DDuration','#nova3DRatio','#nova3DPrompt'].forEach((s)=>{$(s)?.addEventListener('input',updateSummary);$(s)?.addEventListener('change',updateSummary);}); updateSummary(); return true;
  }

  function open(plan) { try{window.NovaUnifiedVideoStudio?.select?.('3d');}catch(_){} ensurePanel(); updateSummary(); $('#novaBlenderCameraPanel')?.scrollIntoView?.({behavior:'smooth',block:'nearest'}); const p=plan||currentPlan(); status(TRUE_3D_PATHS.has(p.path||p.camera)?'🧊 Blender stage открыт: непрерывный 3D camera path.':'Blender Camera Bridge готов.'); }
  function install() { if(ensurePanel())return; const observer=new MutationObserver(()=>{if(ensurePanel())observer.disconnect();}); observer.observe(document.documentElement,{childList:true,subtree:true}); }

  window.NovaBlenderCamera=Object.freeze({version:VERSION,ensurePanel,open,exportScenePack,startOrientationCapture,stopOrientationCapture,buildScenePack,buildCommand,isTrue3DPath:(path)=>TRUE_3D_PATHS.has(path)});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();

(() => {
  'use strict';
  if (window.NovaBlenderAgent) return;
  const $=(selector,root=document)=>root.querySelector(selector); const VERSION='1.0.0'; const DEFAULT_ENDPOINT='http://127.0.0.1:9877'; const EK='nova.blender.agent.endpoint',TK='nova.blender.agent.token';
  const state={endpoint:localStorage.getItem(EK)||DEFAULT_ENDPOINT,token:localStorage.getItem(TK)||'',connected:false,busy:false,lastHealth:null,lastResult:null};
  function status(message){const local=$('#novaBlenderAgentStatus');if(local)local.textContent=message;const global=$('#statusText');if(global&&message)global.textContent=message;}
  function setBusy(value,message=''){state.busy=Boolean(value);document.querySelectorAll('#novaBlenderAgentPanel button').forEach((b)=>{if(b.id!=='novaBlenderAgentConnect')b.disabled=state.busy;});const dot=$('#novaBlenderAgentDot');if(dot)dot.dataset.state=state.busy?'busy':(state.connected?'on':'off');if(message)status(message);}
  function normalizeEndpoint(value){return String(value||'').trim().replace(/\/+$/,'');}
  function saveSettings(){state.endpoint=normalizeEndpoint($('#novaBlenderAgentEndpoint')?.value||state.endpoint||DEFAULT_ENDPOINT)||DEFAULT_ENDPOINT;state.token=String($('#novaBlenderAgentToken')?.value||'').trim();localStorage.setItem(EK,state.endpoint);if(state.token)localStorage.setItem(TK,state.token);else localStorage.removeItem(TK);return state.endpoint;}
  async function request(path,init={},timeoutMs=20000){saveSettings();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs),headers=new Headers(init.headers||{});if(!headers.has('Content-Type')&&init.body)headers.set('Content-Type','application/json');if(state.token)headers.set('X-NOVA-Blender-Token',state.token);try{const response=await fetch(`${state.endpoint}${path}`,{...init,headers,cache:'no-store',signal:controller.signal});const text=await response.text();let payload;try{payload=text?JSON.parse(text):{};}catch(_){payload={ok:false,error:text||`HTTP ${response.status}`};}if(!response.ok||payload?.ok===false)throw new Error(payload?.error||payload?.detail||`HTTP ${response.status}`);return payload;}catch(error){if(error?.name==='AbortError')throw new Error('Blender Agent: тайм-аут соединения.');throw error;}finally{clearTimeout(timer);}}
  function renderJson(payload){const box=$('#novaBlenderAgentOutput');if(!box)return;const clone=JSON.parse(JSON.stringify(payload||{}));const scrub=(node)=>{if(!node||typeof node!=='object')return;for(const [k,v] of Object.entries(node)){if(typeof v==='string'&&v.startsWith('data:image/'))node[k]='[image/png]';else if(Array.isArray(v))v.forEach(scrub);else if(v&&typeof v==='object')scrub(v);}};scrub(clone);box.textContent=JSON.stringify(clone,null,2);}
  function renderImages(payload){const wrap=$('#novaBlenderAgentPreviews');if(!wrap)return;const images=[];const visit=(node)=>{if(!node||typeof node!=='object')return;for(const value of Object.values(node)){if(typeof value==='string'&&value.startsWith('data:image/'))images.push(value);else if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);}};visit(payload);wrap.replaceChildren();for(const src of [...new Set(images)].slice(0,8)){const img=document.createElement('img');img.src=src;img.alt='Blender local preview';img.loading='lazy';wrap.appendChild(img);}}
  function accept(payload,message){state.lastResult=payload;renderJson(payload);renderImages(payload);if(message)status(message);return payload;}
  async function connect(){setBusy(true,'🧊 Проверяю локальный Blender Agent…');try{const payload=await request('/health',{method:'GET'},10000);state.connected=true;state.lastHealth=payload;const blender=payload?.bridge?.result?.blender_version||'Blender';return accept(payload,`✅ Blender Agent подключён · ${blender} · FREE LOCAL`);}catch(error){state.connected=false;status(`❌ Blender Agent: ${error.message}`);renderJson({ok:false,error:error.message,endpoint:state.endpoint});throw error;}finally{setBusy(false);}}
  async function tool(name,args={},message=''){setBusy(true,`🧊 Blender: ${name}…`);try{const payload=await request('/tool',{method:'POST',body:JSON.stringify({tool:name,args})},['render_preview','preview_sequence','auto_refine','render_still'].includes(name)?360000:90000);state.connected=true;return accept(payload,message||`✅ Blender: ${name}`);}catch(error){state.connected=false;status(`❌ Blender ${name}: ${error.message}`);renderJson({ok:false,tool:name,error:error.message});throw error;}finally{setBusy(false);}}
  const scan=()=>tool('scan_scene',{},'✅ SCAN: сцена проанализирована.'); const preview=()=>tool('render_preview',{width:640,height:360},'✅ LOOK: preview готов.'); const previewSequence=()=>tool('preview_sequence',{width:400,height:225},'✅ LOOK: контрольные кадры готовы.'); const checkFlow=()=>tool('check_flow',{},'✅ FLOW проверен.'); const checkLoop=()=>tool('check_loop',{},'✅ LOOP проверен.'); const autoRefine=()=>tool('auto_refine',{max_passes:2,width:400,height:225},'✅ AUTO FIX завершён.');
  async function fullCycle(options={}){setBusy(true,'🤖 SCAN → LOOK → ANALYZE → FIX → FLOW → LOOP…');try{const payload=await request('/cycle',{method:'POST',body:JSON.stringify({make_loop:options.makeLoop!==false,refine:options.refine!==false,preview_width:400,preview_height:225})},600000);state.connected=true;return accept(payload,'✅ Blender closed-loop цикл завершён.');}catch(error){status(`❌ Blender closed-loop: ${error.message}`);renderJson({ok:false,error:error.message});throw error;}finally{setBusy(false);}}
  const saveCopy=()=>tool('save_blend',{filepath:'//NOVA_agent_scene.blend',copy:true},'✅ Сцена сохранена копией.');
  async function buildWolf(){if(!window.confirm('Перестроить сцену волка? Builder очищает текущую Blender-сцену; bridge попытается сохранить backup.'))return null;return tool('build_wolf_scene',{allow_clear_scene:true},'✅ Волк построен. Теперь SCAN/LOOK.');}
  function setEndpoint(endpoint,token=''){state.endpoint=normalizeEndpoint(endpoint)||DEFAULT_ENDPOINT;state.token=String(token||'').trim();localStorage.setItem(EK,state.endpoint);if(state.token)localStorage.setItem(TK,state.token);else localStorage.removeItem(TK);if($('#novaBlenderAgentEndpoint'))$('#novaBlenderAgentEndpoint').value=state.endpoint;if($('#novaBlenderAgentToken'))$('#novaBlenderAgentToken').value=state.token;}
  function ensurePanel(){const host=$('#novaBlenderCameraPanel');if(!host)return false;if($('#novaBlenderAgentPanel',host))return true;const panel=document.createElement('section');panel.id='novaBlenderAgentPanel';panel.className='nba-panel';panel.innerHTML=`<div class="nba-head"><b>🤖 Local Blender Agent</b><span class="nba-badge">FREE · CLOSED LOOP</span></div><div class="nba-grid"><input id="novaBlenderAgentEndpoint" aria-label="Blender Agent endpoint"><button id="novaBlenderAgentConnect" type="button"><span id="novaBlenderAgentDot" class="nba-dot" data-state="off"></span>CONNECT</button><input id="novaBlenderAgentToken" class="nba-token" aria-label="LAN token optional" type="password" placeholder="LAN token (только если gateway открыт в сети)"></div><div class="nba-actions"><button id="nbaScan" type="button">🔎 SCAN</button><button id="nbaPreview" type="button">👁 LOOK</button><button id="nbaFrames" type="button">🎞 5 FRAMES</button><button id="nbaFlow" type="button">〰 FLOW</button><button id="nbaLoop" type="button">🔁 LOOP</button><button id="nbaRefine" type="button">🛠 AUTO FIX</button><button id="nbaCycle" class="primary" type="button">🤖 FULL CYCLE</button><button id="nbaSave" type="button">💾 SAVE COPY</button><button id="nbaWolf" class="danger" type="button">🐺 BUILD WOLF</button></div><div id="novaBlenderAgentStatus" class="nba-status"></div><div id="novaBlenderAgentPreviews" class="nba-previews"></div><pre id="novaBlenderAgentOutput" class="nba-output">Ожидание подключения…</pre>`;host.appendChild(panel);$('#novaBlenderAgentEndpoint').value=state.endpoint;$('#novaBlenderAgentToken').value=state.token;$('#novaBlenderAgentStatus').textContent=`Gateway: ${state.endpoint} · CONNECT для проверки.`;$('#novaBlenderAgentConnect').addEventListener('click',()=>connect().catch(()=>{}));$('#nbaScan').addEventListener('click',()=>scan().catch(()=>{}));$('#nbaPreview').addEventListener('click',()=>preview().catch(()=>{}));$('#nbaFrames').addEventListener('click',()=>previewSequence().catch(()=>{}));$('#nbaFlow').addEventListener('click',()=>checkFlow().catch(()=>{}));$('#nbaLoop').addEventListener('click',()=>checkLoop().catch(()=>{}));$('#nbaRefine').addEventListener('click',()=>autoRefine().catch(()=>{}));$('#nbaCycle').addEventListener('click',()=>fullCycle().catch(()=>{}));$('#nbaSave').addEventListener('click',()=>saveCopy().catch(()=>{}));$('#nbaWolf').addEventListener('click',()=>buildWolf().catch(()=>{}));$('#novaBlenderAgentEndpoint').addEventListener('change',saveSettings);$('#novaBlenderAgentToken').addEventListener('change',saveSettings);return true;}
  function open(){try{window.NovaBlenderCamera?.open?.();}catch(_){}ensurePanel();$('#novaBlenderAgentPanel')?.scrollIntoView?.({behavior:'smooth',block:'nearest'});status('🤖 Blender Agent: CONNECT → SCAN → LOOK → FULL CYCLE.');}
  function install(){if(ensurePanel())return;const observer=new MutationObserver(()=>{if(ensurePanel())observer.disconnect();});observer.observe(document.documentElement,{childList:true,subtree:true});}
  window.NovaBlenderAgent=Object.freeze({version:VERSION,connect,scan,preview,previewSequence,checkFlow,checkLoop,autoRefine,fullCycle,saveCopy,buildWolf,open,setEndpoint,ensurePanel,getState:()=>({...state,token:state.token?'[set]':''})});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
