(()=>{
const $=id=>document.getElementById(id);
const LS_URL='nova.remoteGpu.url';
const LS_TOKEN='nova.remoteGpu.token';
const LS_JOB='nova.remoteGpu.job';
const LS_FULLAUTO='nova.remoteGpu.fullAuto';
const LS_PENDING='nova.remoteGpu.pendingPrompt';
const LS_AUTORECOVER='nova.remoteGpu.autoRecover';
const LS_RECOVERY='nova.remoteGpu.recovery';
const DB_NAME='nova-remote-gpu-recovery-v1';
const DB_STORE='state';
const DB_KEY='current';
const MAX_SOURCE_CACHE=600*1024*1024;

let pollTimer=0,recoveryTimer=0,lastJobId='',wakeLock=null,lastHealth=null,sendBusy=false;
let pollFailures=0,recoveryAttempt=0,currentSourceFile=null;

function endpoint(){return ($('remoteUrl')?.value||'').trim().replace(/\/+$/,'')}
function token(){return ($('remoteToken')?.value||'').trim()}
function authHeaders(){return {'X-NOVA-Token':token()}}
function saveConnection(){
  localStorage.setItem(LS_URL,endpoint());
  localStorage.setItem(LS_TOKEN,token());
}
function setStatus(text,kind=''){
  const el=$('remoteStatus');if(!el)return;
  el.textContent=text;el.dataset.kind=kind;
}
function setRecoveryStatus(text,kind=''){
  const el=$('remoteRecoveryStatus');if(!el)return;
  el.textContent=text;el.dataset.kind=kind;
}
function setProgress(value){
  const n=Math.max(0,Math.min(100,Number(value)||0));
  const bar=$('remoteProgressBar');if(bar)bar.style.width=n+'%';
  const label=$('remoteProgressText');if(label)label.textContent=Math.round(n)+'%';
}
async function holdWakeLock(){
  try{if('wakeLock' in navigator&&!wakeLock)wakeLock=await navigator.wakeLock.request('screen')}catch(_){}
}
async function releaseWakeLock(){
  try{if(wakeLock){await wakeLock.release();wakeLock=null}}catch(_){wakeLock=null}
}
async function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function fullAutoEnabled(){return Boolean($('remoteAutoFinal')?.checked||localStorage.getItem(LS_FULLAUTO)==='1')}
function setFullAuto(enabled){
  const on=Boolean(enabled);
  if($('remoteAutoFinal'))$('remoteAutoFinal').checked=on;
  if(on)localStorage.setItem(LS_FULLAUTO,'1');else localStorage.removeItem(LS_FULLAUTO);
}
function autoRecoverEnabled(){
  const stored=localStorage.getItem(LS_AUTORECOVER);
  return $('remoteAutoRecover')?.checked ?? (stored!=='0');
}
function setAutoRecover(enabled){
  const on=Boolean(enabled);
  if($('remoteAutoRecover'))$('remoteAutoRecover').checked=on;
  localStorage.setItem(LS_AUTORECOVER,on?'1':'0');
  setRecoveryStatus(on?'Auto Recovery: включён.':'Auto Recovery: выключен.',on?'ok':'');
}
function recoveryMeta(){
  try{return JSON.parse(localStorage.getItem(LS_RECOVERY)||'null')}catch(_){return null}
}
function saveRecoveryMeta(meta){
  if(meta)localStorage.setItem(LS_RECOVERY,JSON.stringify(meta));
  else localStorage.removeItem(LS_RECOVERY);
}
function openRecoveryDb(){
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window)){reject(new Error('IndexedDB unavailable'));return}
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(DB_STORE))db.createObjectStore(DB_STORE,{keyPath:'id'})};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('IndexedDB open failed'));
  });
}
async function dbGet(){
  const db=await openRecoveryDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(DB_STORE,'readonly');
    const req=tx.objectStore(DB_STORE).get(DB_KEY);
    req.onsuccess=()=>resolve(req.result||null);
    req.onerror=()=>reject(req.error);
    tx.oncomplete=()=>db.close();
  });
}
async function dbPut(record){
  const db=await openRecoveryDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(DB_STORE,'readwrite');
    tx.objectStore(DB_STORE).put(record);
    tx.oncomplete=()=>{db.close();resolve(true)};
    tx.onerror=()=>{db.close();reject(tx.error)};
  });
}
async function dbDelete(){
  try{
    const db=await openRecoveryDb();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(DB_STORE,'readwrite');
      tx.objectStore(DB_STORE).delete(DB_KEY);
      tx.oncomplete=()=>resolve(true);
      tx.onerror=()=>reject(tx.error);
    });
    db.close();
  }catch(_){}
}
async function canCacheSource(source){
  if(!source||!source.size)return false;
  if(source.size>MAX_SOURCE_CACHE)return false;
  try{
    const estimate=await navigator.storage?.estimate?.();
    const free=(estimate?.quota||0)-(estimate?.usage||0);
    if(free>0&&source.size>free*.65)return false;
  }catch(_){}
  return true;
}
async function beginRecovery(job,source,sourceName){
  const name=sourceName||source?.name||'source.mp4';
  const meta={
    version:1,
    phase:'prepared',
    job:{...job,defer_start:false},
    remoteJobId:'',
    workerUrl:endpoint(),
    workerSessionId:lastHealth?.session_id||'',
    sourceName:name,
    sourceType:source?.type||'video/mp4',
    sourceSize:Number(source?.size||0),
    sourceCached:false,
    updatedAt:Date.now()
  };
  saveRecoveryMeta(meta);
  let cachedSource=null;
  if(source&&await canCacheSource(source))cachedSource=source;
  try{
    await dbPut({id:DB_KEY,job:meta.job,source:cachedSource,sourceName:name,sourceType:meta.sourceType,meta});
    if(cachedSource){
      meta.sourceCached=true;saveRecoveryMeta(meta);
      await dbPut({id:DB_KEY,job:meta.job,source:cachedSource,sourceName:name,sourceType:meta.sourceType,meta});
    }
    setRecoveryStatus(meta.sourceSize?(meta.sourceCached?'Auto Recovery: исходник сохранён на iPhone.':'Auto Recovery: job сохранён; большой исходник держится пока страница открыта.'):'Auto Recovery: Scene Pack сохранён.','ok');
  }catch(_){
    meta.sourceCached=false;saveRecoveryMeta(meta);
    setRecoveryStatus('Auto Recovery: сохранены параметры job; локальный файл-кэш недоступен.','');
  }
  return meta;
}
async function patchRecovery(patch={},jobPatch=null){
  const meta={...(recoveryMeta()||{}),...patch,updatedAt:Date.now()};
  if(jobPatch)meta.job={...(meta.job||{}),...jobPatch};
  saveRecoveryMeta(meta);
  try{
    const record=await dbGet()||{id:DB_KEY,source:null,sourceName:meta.sourceName,sourceType:meta.sourceType};
    record.meta=meta;
    record.job={...(record.job||meta.job||{}),...(jobPatch||{})};
    await dbPut(record);
  }catch(_){}
  return meta;
}
async function getRecoveryBundle(){
  const meta=recoveryMeta();
  if(!meta)return null;
  let record=null;
  try{record=await dbGet()}catch(_){}
  return {meta,job:{...(record?.job||meta.job||{})},source:currentSourceFile||record?.source||null,sourceName:record?.sourceName||meta.sourceName||'source.mp4'};
}
async function clearRecovery(){
  saveRecoveryMeta(null);
  await dbDelete();
  currentSourceFile=null;
  setRecoveryStatus('Auto Recovery: готов.','ok');
}
async function readClipboardCode(){
  if(!navigator.clipboard?.readText)throw new Error('Буфер обмена недоступен в этом браузере');
  const text=await navigator.clipboard.readText();
  if(!parseConnectCode(text))throw new Error('В буфере нет NOVA CONNECT CODE');
  if($('remoteConnectCode'))$('remoteConnectCode').value=text;
  return true;
}
async function tryClipboardReconnect(){
  if(!autoRecoverEnabled()||!recoveryMeta()||!navigator.clipboard?.readText)return false;
  try{
    const text=await navigator.clipboard.readText();
    if(!text||!parseConnectCode(text))return false;
    if($('remoteConnectCode'))$('remoteConnectCode').value=text;
    setRecoveryStatus('Auto Recovery: найден новый Connect Code в буфере. Переподключаюсь…','busy');
    await connect();
    return true;
  }catch(_){return false}
}
function parseConnectCode(value){
  const raw=String(value||'').trim();
  if(!raw)return false;
  let data=null;
  try{
    if(raw.startsWith('{'))data=JSON.parse(raw);
    else if(raw.startsWith('NOVA_CONNECT='))data=JSON.parse(raw.slice('NOVA_CONNECT='.length));
    else if(raw.includes('|')){const [url,tok]=raw.split('|',2);data={url,token:tok}}
  }catch(_){data=null}
  if(!data?.url||!data?.token)return false;
  if($('remoteUrl'))$('remoteUrl').value=String(data.url).trim();
  if($('remoteToken'))$('remoteToken').value=String(data.token).trim();
  saveConnection();
  return true;
}
function hasRenderableIntent(){return Boolean(($('remoteSource')?.files?.[0])||(($('prompt')?.value||'').trim()))}
function chosenEngine(){
  const raw=$('remoteEngine')?.value||'auto';
  if(raw!=='auto')return raw;
  const q=($('prompt')?.value||'').toLowerCase();
  const hasSource=Boolean($('remoteSource')?.files?.[0]||currentSourceFile);
  if(/ffmpeg|конверт|перекод|encode|transcod|upscale|апскейл/.test(q)&&hasSource)return 'ffmpeg';
  if(/wang|wan2|ai video|генер.*видео|сгенер.*видео|реалистичн.*генер|замен.*персонаж|video.?to.?video/.test(q))return 'wangp';
  if(!hasSource&&!/blender|3d|блокинг|blocking/.test(q))return 'wangp';
  return 'blender';
}
function motionConfig(){
  try{return window.NOVA_MOTION_CONFIG?.()||{}}catch(_){return {}}
}
function buildJob(){
  $('applyPrompt')?.click();
  const c=motionConfig();
  const quality=$('remoteQuality')?.value||'preview';
  const prompt=($('prompt')?.value||'').trim();
  const pack={
    schema:'nova.scene-pack.v1',project:'NOVA Remote GPU',source_prompt:prompt,
    duration:Number(c.duration||$('duration')?.value||5),format:c.ratio||$('ratio')?.value||'9:16',
    style:c.style||$('style')?.value||'neon',motion:c.motion||$('motion')?.value||'slide',
    camera:c.camera||$('camera')?.value||'static',vfx:c.vfx||$('vfx')?.value||'none',
    vfx_intensity:Number(c.intensity||$('intensity')?.value||.65),
    render_policy:{preview_first:true,paid_generation:false,max_paid_tests:1}
  };
  return {
    schema:'nova.remote-job.v1',created_at:new Date().toISOString(),
    source_prompt:prompt||'TUMSOEV cinematic scene',engine:chosenEngine(),quality,
    duration:Number(pack.duration||5),ratio:pack.format||'9:16',fps:quality==='preview'?24:30,
    style:pack.style,motion:pack.motion,camera:pack.camera,vfx:pack.vfx,
    intensity:Number(pack.vfx_intensity||.65),mirror_drive:Boolean($('remoteMirrorDrive')?.checked),
    scene_pack:pack
  };
}
async function jsonFetch(url,options={}){
  let response;
  try{response=await fetch(url,options)}catch(error){error.network=true;throw error}
  let data=null;try{data=await response.json()}catch(_){}
  if(!response.ok){
    const error=new Error(data?.detail||data?.message||('HTTP '+response.status));
    error.status=response.status;throw error;
  }
  return data||{};
}
function clearPoll(){if(pollTimer){clearTimeout(pollTimer);pollTimer=0}}
function clearRecoveryTimer(){if(recoveryTimer){clearTimeout(recoveryTimer);recoveryTimer=0}}
async function connect({resume=true}={}){
  const url=endpoint(),tok=token();
  if(!url||!tok){setStatus('Вставь NOVA CONNECT CODE или Worker URL + Token.','error');return null}
  saveConnection();setStatus('Проверяю Colab worker…','busy');setProgress(0);
  try{
    const data=await jsonFetch(url+'/health',{headers:authHeaders()});
    lastHealth=data;pollFailures=0;recoveryAttempt=0;clearRecoveryTimer();
    const gpu=data.gpu?.available?(data.gpu.name||'NVIDIA GPU'):'GPU не обнаружен';
    const protocol=data.protocol_version!=null?'P'+data.protocol_version:'old';
    const bits=[gpu,data.blender?'Blender ✓':'Blender —',data.ffmpeg?'FFmpeg ✓':'FFmpeg —',data.wangp_api_ready?'WanGP API ✓':'WanGP —',protocol,data.free_disk_gb!=null?data.free_disk_gb+' GB free':''];
    setStatus('Подключено: '+bits.filter(Boolean).join(' • '),'ok');
    if(data.drive_mounted&&autoRecoverEnabled()&&$('remoteMirrorDrive'))$('remoteMirrorDrive').checked=true;
    if(Number(data.protocol_version||0)<3){
      setRecoveryStatus('Auto Recovery: worker старой версии. Для полного восстановления перезапусти актуальный notebook.','error');
    }else if(autoRecoverEnabled()){
      setRecoveryStatus('Auto Recovery: worker '+(data.session_id||'')+' на связи.'+(data.drive_mounted?' Drive checkpoint включён.':''),'ok');
    }
    if(resume&&autoRecoverEnabled()&&recoveryMeta())setTimeout(()=>resumeOrRecover().catch(()=>{}),0);
    else setTimeout(()=>{maybeAutoSend().catch(()=>{})},0);
    return data;
  }catch(error){
    lastHealth=null;
    setStatus('Не подключено: '+error.message,'error');
    return null;
  }
}
async function preflight(engine,hasSource){
  const health=lastHealth||await connect({resume:false});
  if(!health)throw new Error('Colab worker не подключён');
  if(engine==='wangp'&&!health.wangp_api_ready){
    if(hasSource&&health.blender){setStatus('WanGP ещё не готов — временно переключаю на Blender.','busy');return 'blender'}
    throw new Error('WanGP API не готов. Перезапусти Colab notebook с Run all.')
  }
  if(engine==='blender'&&!health.blender){
    if(hasSource&&health.ffmpeg){setStatus('Blender недоступен — временно переключаю на FFmpeg.','busy');return 'ffmpeg'}
    throw new Error('Blender не готов в Colab.')
  }
  if(engine==='ffmpeg'&&!health.ffmpeg)throw new Error('FFmpeg не готов в Colab.');
  return engine;
}
async function downloadResult(jobId){
  try{
    const ticket=await jsonFetch(endpoint()+'/jobs/'+encodeURIComponent(jobId)+'/download-ticket',{method:'POST',headers:authHeaders()});
    const url=endpoint()+ticket.path;
    const a=$('remoteResult');
    if(a){a.href=url;a.download=ticket.filename||('NOVA_'+jobId+'.mp4');a.classList.remove('hidden');a.textContent='Открыть / сохранить готовый MP4'}
    const video=$('video');if(video){video.src=url;video.classList.remove('hidden')}
  }catch(error){setStatus('Рендер готов, но ссылка на файл не создалась: '+error.message,'error')}
}
async function uploadVideoChunks(jobId,file,filename){
  const chunkSize=8*1024*1024;
  const total=Math.max(1,Math.ceil(file.size/chunkSize));
  for(let index=0;index<total;index++){
    const start=index*chunkSize,end=Math.min(file.size,start+chunkSize);
    let uploaded=false,lastError=null;
    for(let attempt=1;attempt<=3&&!uploaded;attempt++){
      const fd=new FormData();
      fd.append('index',String(index));fd.append('total',String(total));fd.append('filename',filename||file.name||'source.mp4');
      fd.append('chunk',file.slice(start,end),(filename||file.name||'source.mp4')+'.part');
      try{
        await jsonFetch(endpoint()+'/jobs/'+encodeURIComponent(jobId)+'/upload-chunk',{method:'POST',headers:authHeaders(),body:fd});
        uploaded=true;
      }catch(error){
        lastError=error;
        if(attempt<3){setStatus('Сеть прервалась. Повтор части '+(index+1)+'…','busy');await sleep(800*attempt)}
      }
    }
    if(!uploaded)throw lastError||new Error('Не удалось загрузить часть видео');
    const pct=Math.round(((index+1)/total)*12);
    setProgress(pct);setStatus('Загружаю видео в Colab: '+(index+1)+'/'+total+' частей…','busy');
    await patchRecovery({phase:'uploading',uploadPart:index+1,uploadTotal:total});
  }
}
async function submitPreparedJob(inputJob,source,sourceName,{recovery=false}={}){
  if(sendBusy)return false;
  if(!endpoint()||!token())throw new Error('Colab worker не подключён');
  sendBusy=true;await holdWakeLock();
  const btn=$('remoteSend');if(btn)btn.disabled=true;
  const result=$('remoteResult');if(result)result.classList.add('hidden');
  try{
    const job={...inputJob};
    job.engine=await preflight(job.engine||'auto',Boolean(source));
    if(job.engine==='ffmpeg'&&!source)throw new Error('Для FFmpeg нужен исходный файл.');
    if(source)job.defer_start=true;
    await patchRecovery({workerUrl:endpoint(),workerSessionId:lastHealth?.session_id||'',phase:'submitting'},job);
    const fd=new FormData();fd.append('job_json',JSON.stringify(job));
    setProgress(1);setStatus(recovery?'Auto Recovery: создаю job в новой Colab-сессии…':'Создаю задачу на Colab GPU…','busy');
    const data=await jsonFetch(endpoint()+'/jobs',{method:'POST',headers:authHeaders(),body:fd});
    lastJobId=data.job_id;localStorage.setItem(LS_JOB,lastJobId);
    await patchRecovery({remoteJobId:lastJobId,workerUrl:endpoint(),workerSessionId:lastHealth?.session_id||'',phase:source?'uploading':'running'},job);
    if(source){
      await uploadVideoChunks(lastJobId,source,sourceName||source.name||'source.mp4');
      await jsonFetch(endpoint()+'/jobs/'+encodeURIComponent(lastJobId)+'/start',{method:'POST',headers:authHeaders()});
      await patchRecovery({phase:'running'});
    }
    setStatus((recovery?'Восстановлено. ':'')+'Colab принял '+lastJobId+'. Рендер продолжается…','busy');
    setRecoveryStatus('Auto Recovery: job '+lastJobId+' защищён.','ok');
    poll(lastJobId);
    return true;
  }catch(error){
    setStatus((recovery?'Восстановление не завершено: ':'Не удалось отправить: ')+error.message,'error');
    if(autoRecoverEnabled())enterRecovery('submit failed: '+error.message);
    else await releaseWakeLock();
    return false;
  }finally{
    sendBusy=false;if(btn)btn.disabled=false;
  }
}
async function poll(jobId){
  clearPoll();
  try{
    const data=await jsonFetch(endpoint()+'/jobs/'+encodeURIComponent(jobId),{headers:authHeaders()});
    pollFailures=0;recoveryAttempt=0;
    setProgress(data.progress||0);
    const state=data.status||'running';
    await patchRecovery({phase:state,remoteJobId:jobId,workerUrl:endpoint(),workerSessionId:lastHealth?.session_id||''});
    setStatus((data.message||state)+(data.engine?' • '+data.engine:''),state==='error'?'error':state==='completed'?'ok':'busy');
    if(state==='completed'){
      localStorage.removeItem(LS_JOB);
      const quality=String(data.quality||'preview').toLowerCase();
      if(fullAutoEnabled()&&quality==='preview'&&lastHealth?.capabilities?.preview_promote){
        setStatus('Preview готов. FULL AUTO запускает Final без повторной загрузки…','busy');
        await patchRecovery({phase:'promoting'}, {quality:'final',fps:30});
        try{
          const promoted=await jsonFetch(endpoint()+'/jobs/'+encodeURIComponent(jobId)+'/promote',{method:'POST',headers:authHeaders()});
          lastJobId=promoted.job_id;localStorage.setItem(LS_JOB,lastJobId);
          await patchRecovery({phase:'final',remoteJobId:lastJobId,workerSessionId:lastHealth?.session_id||''},{quality:'final',fps:30});
          setProgress(0);poll(lastJobId);return;
        }catch(error){
          setStatus('Preview готов, но Final не запустился автоматически: '+error.message,'error');
          if(autoRecoverEnabled())enterRecovery('final promote failed');
          return;
        }
      }
      await releaseWakeLock();await downloadResult(jobId);await clearRecovery();return;
    }
    if(state==='error'||state==='cancelled'){
      localStorage.removeItem(LS_JOB);await releaseWakeLock();
      setRecoveryStatus(state==='error'?'Auto Recovery: job завершился ошибкой; автоматический цикл остановлен.':'Auto Recovery: job отменён.','error');
      return;
    }
    pollTimer=setTimeout(()=>poll(jobId),2200);
  }catch(error){
    pollFailures+=1;
    if(error.status===404||pollFailures>=2){
      enterRecovery(error.status===404?'job disappeared':'worker unreachable');
      return;
    }
    setStatus('Связь с worker прервалась. Проверяю ещё раз…','error');
    pollTimer=setTimeout(()=>poll(jobId),3500);
  }
}
function recoveryDelay(){return Math.min(60000,5000*Math.pow(2,Math.min(recoveryAttempt,3)))}
function enterRecovery(reason){
  clearPoll();
  if(!autoRecoverEnabled()){
    setRecoveryStatus('Auto Recovery выключен.','error');releaseWakeLock();return;
  }
  patchRecovery({phase:'recovering',reason}).catch(()=>{});
  setStatus('Colab-связь потеряна. NOVA пытается восстановить Remote GPU…','error');
  setRecoveryStatus('Auto Recovery: '+reason+'. Проверяю старую сессию и жду новую, если Google её завершил.','busy');
  scheduleRecoveryProbe(500);
}
function scheduleRecoveryProbe(delay=recoveryDelay()){
  clearRecoveryTimer();
  recoveryTimer=setTimeout(()=>recoveryProbe().catch(()=>{}),delay);
}
async function recoveryProbe(){
  if(!autoRecoverEnabled()||!recoveryMeta())return;
  recoveryAttempt+=1;
  if(endpoint()&&token()){
    const health=await connect({resume:false});
    if(health){
      await resumeOrRecover();
      return;
    }
  }
  const seconds=Math.round(recoveryDelay()/1000);
  setRecoveryStatus('Auto Recovery: Colab пока недоступен. Повтор через '+seconds+' сек. Если runtime завершён Google, открой новый notebook; после нового Connect Code job восстановится сам.','busy');
  scheduleRecoveryProbe();
}
async function tryDriveRestore(meta){
  if(!lastHealth?.drive_mounted||!lastHealth?.capabilities?.drive_restore||!meta.remoteJobId)return false;
  try{
    const data=await jsonFetch(endpoint()+'/recovery/'+encodeURIComponent(meta.remoteJobId)+'/restore',{method:'POST',headers:authHeaders()});
    lastJobId=data.job_id;localStorage.setItem(LS_JOB,lastJobId);
    await patchRecovery({phase:'recovered-drive',remoteJobId:lastJobId,workerUrl:endpoint(),workerSessionId:lastHealth?.session_id||''});
    setRecoveryStatus('Auto Recovery: job восстановлен из Google Drive checkpoint.','ok');
    poll(lastJobId);return true;
  }catch(error){
    if(error.status!==404&&error.status!==409)setRecoveryStatus('Drive restore не сработал: '+error.message,'');
    return false;
  }
}
async function resubmitRecovery(){
  const bundle=await getRecoveryBundle();
  if(!bundle?.job)return false;
  const needsSource=Number(bundle.meta.sourceSize||0)>0;
  const source=bundle.source;
  if(needsSource&&!source){
    setRecoveryStatus('Auto Recovery сохранил job, но исходник слишком большой для iPhone-кэша. Выбери тот же видеофайл — отправка продолжится автоматически.','error');
    return false;
  }
  localStorage.removeItem(LS_JOB);lastJobId='';
  setRecoveryStatus('Auto Recovery: пересоздаю '+String(bundle.job.quality||'preview')+' job в новой Colab-сессии…','busy');
  return submitPreparedJob({...bundle.job,job_id:undefined,defer_start:false},source,bundle.sourceName,{recovery:true});
}
async function resumeOrRecover(){
  if(!autoRecoverEnabled())return false;
  const meta=recoveryMeta();if(!meta)return false;
  const currentSession=lastHealth?.session_id||'';
  const sameSession=Boolean(currentSession&&meta.workerSessionId&&currentSession===meta.workerSessionId&&endpoint()===meta.workerUrl);
  if(sameSession&&meta.remoteJobId){
    try{
      const data=await jsonFetch(endpoint()+'/jobs/'+encodeURIComponent(meta.remoteJobId),{headers:authHeaders()});
      lastJobId=meta.remoteJobId;localStorage.setItem(LS_JOB,lastJobId);await holdWakeLock();
      setRecoveryStatus('Auto Recovery: старая Colab-сессия вернулась, продолжаю job.','ok');
      if(data.status==='completed'){poll(lastJobId)}else poll(lastJobId);
      return true;
    }catch(error){
      if(error.status!==404){scheduleRecoveryProbe();return false}
    }
  }
  if(await tryDriveRestore(meta))return true;
  return resubmitRecovery();
}
async function maybeAutoSend(){
  if(!fullAutoEnabled()||localStorage.getItem(LS_JOB)||!endpoint()||!token()||!hasRenderableIntent())return false;
  const meta=recoveryMeta();
  if(meta&&['submitting','uploading','running','final','recovering','promoting'].includes(meta.phase))return false;
  await send();return true;
}
function openColab(){
  const link=$('remoteColabLink');
  const url=link?.href||'https://colab.research.google.com/github/magomedt149/nova-robot/blob/main/blender-colab/NOVA_Remote_GPU_Worker.ipynb';
  const win=window.open(url,'_blank','noopener');
  setStatus('Colab открыт. Нажми Runtime → Run all, потом Copy NOVA CONNECT CODE и вернись сюда.','busy');
  setRecoveryStatus('Auto Recovery продолжит job автоматически после нового Connect Code.','busy');
  return Boolean(win);
}
async function autoStart(){
  setFullAuto(true);setAutoRecover(true);
  const active=lastJobId||localStorage.getItem(LS_JOB);
  if(active&&endpoint()&&token()){lastJobId=active;await holdWakeLock();poll(active);return}
  if(endpoint()&&token()){
    const health=await connect();
    if(health){
      if(recoveryMeta()){await resumeOrRecover();return}
      if(await maybeAutoSend())return;
      setStatus('FULL AUTO готов. Добавь описание или выбери видео — отправка начнётся автоматически.','ok');return;
    }
  }
  openColab();
}
async function testRender(){
  const health=await connect({resume:false});if(!health)return;
  if(!health.blender){setStatus('Для теста нужен Blender. Перезапусти Colab notebook.','error');return}
  const job={schema:'nova.remote-job.v1',source_prompt:'NOVA Remote GPU self test, clean blocking scene',engine:'blender',quality:'preview',duration:1,ratio:'9:16',fps:24,mirror_drive:false};
  await beginRecovery(job,null,'');
  await submitPreparedJob(job,null,'',{recovery:false});
}
async function send(){
  if(sendBusy)return;
  if(!endpoint()||!token()){setStatus('Сначала подключи Colab worker.','error');return}
  saveConnection();
  const job=buildJob();
  const source=$('remoteSource')?.files?.[0]||currentSourceFile||null;
  currentSourceFile=source;
  await beginRecovery(job,source,source?.name||'source.mp4');
  await submitPreparedJob(job,source,source?.name||'source.mp4',{recovery:false});
}
async function cancel(){
  const jobId=lastJobId||localStorage.getItem(LS_JOB);
  clearPoll();clearRecoveryTimer();
  if(jobId&&endpoint()&&token()){
    try{await jsonFetch(endpoint()+'/jobs/'+encodeURIComponent(jobId),{method:'DELETE',headers:authHeaders()})}catch(_){}
  }
  localStorage.removeItem(LS_JOB);lastJobId='';await releaseWakeLock();await clearRecovery();setProgress(0);setStatus('Задание остановлено.','ok');
}
async function recoverNow(){
  setAutoRecover(true);
  if(!endpoint()||!token()){openColab();return}
  const health=await connect({resume:false});
  if(health)await resumeOrRecover();
  else scheduleRecoveryProbe(1000);
}
async function restore(){
  if($('remoteUrl'))$('remoteUrl').value=localStorage.getItem(LS_URL)||'';
  if($('remoteToken'))$('remoteToken').value=localStorage.getItem(LS_TOKEN)||'';
  if($('remoteConnectCode'))$('remoteConnectCode').value='';
  const autoParam=new URLSearchParams(location.search).get('auto')==='1';
  setFullAuto(autoParam||localStorage.getItem(LS_FULLAUTO)==='1');
  setAutoRecover(localStorage.getItem(LS_AUTORECOVER)!=='0');
  const pending=localStorage.getItem(LS_PENDING)||'';
  if(pending&&$('prompt')){$('prompt').value=pending;localStorage.removeItem(LS_PENDING);$('applyPrompt')?.click()}
  const saved=localStorage.getItem(LS_JOB);
  const meta=recoveryMeta();
  if(meta)setRecoveryStatus('Auto Recovery: найден незавершённый '+String(meta.job?.quality||'')+' job.','busy');
  if(saved&&endpoint()&&token()){lastJobId=saved;await holdWakeLock();poll(saved)}
  else if(meta&&endpoint()&&token()&&autoRecoverEnabled()){setTimeout(()=>recoverNow(),220)}
  else if(autoParam&&endpoint()&&token()){setTimeout(()=>autoStart(),220)}
}

$('remoteAutoStart')?.addEventListener('click',autoStart);
$('remoteAutoFinal')?.addEventListener('change',e=>setFullAuto(e.target.checked));
$('remoteAutoRecover')?.addEventListener('change',e=>setAutoRecover(e.target.checked));
$('remoteRecoverNow')?.addEventListener('click',recoverNow);
$('remoteTest')?.addEventListener('click',testRender);
$('remoteSource')?.addEventListener('change',async e=>{
  currentSourceFile=e.target.files?.[0]||null;
  const meta=recoveryMeta();
  if(meta&&meta.sourceSize&&currentSourceFile){
    await beginRecovery(meta.job||buildJob(),currentSourceFile,currentSourceFile.name);
    if(autoRecoverEnabled()&&endpoint()&&token())await recoverNow();
  }else{maybeAutoSend().catch(()=>{})}
});
$('prompt')?.addEventListener('change',()=>{maybeAutoSend().catch(()=>{})});
$('remoteConnect')?.addEventListener('click',()=>connect());
$('remotePasteCode')?.addEventListener('click',async()=>{
  try{setStatus('Читаю NOVA CONNECT CODE из буфера…','busy');await readClipboardCode();await connect()}
  catch(error){setStatus(error.message,'error')}
});
$('remoteSend')?.addEventListener('click',send);
$('remoteCancel')?.addEventListener('click',cancel);
$('remoteUrl')?.addEventListener('change',saveConnection);
$('remoteToken')?.addEventListener('change',saveConnection);
$('remoteConnectCode')?.addEventListener('change',async e=>{
  if(parseConnectCode(e.target.value)){setStatus('Connect Code принят. Проверяю GPU…','busy');await connect()}
  else if(e.target.value.trim())setStatus('Не удалось прочитать NOVA CONNECT CODE.','error');
});
$('remoteConnectCode')?.addEventListener('paste',()=>setTimeout(async()=>{
  const el=$('remoteConnectCode');
  if(el&&parseConnectCode(el.value)){setStatus('Connect Code принят. Проверяю GPU…','busy');await connect()}
},0));
window.addEventListener('online',()=>{if(autoRecoverEnabled()&&recoveryMeta())recoverNow().catch(()=>{})});
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'){
    if(lastJobId||localStorage.getItem(LS_JOB))holdWakeLock();
    if(autoRecoverEnabled()&&recoveryMeta()){
      tryClipboardReconnect().then(found=>{if(!found)recoverNow().catch(()=>{})}).catch(()=>recoverNow().catch(()=>{}));
    }
  }
});
restore().catch(()=>{});
})();