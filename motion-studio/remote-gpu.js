(()=>{
const $=id=>document.getElementById(id);
const LS_URL='nova.remoteGpu.url',LS_TOKEN='nova.remoteGpu.token',LS_JOB='nova.remoteGpu.job',LS_FULLAUTO='nova.remoteGpu.fullAuto',LS_PENDING='nova.remoteGpu.pendingPrompt';
let pollTimer=0,lastJobId='',wakeLock=null,lastHealth=null,sendBusy=false;

function endpoint(){
  return ($('remoteUrl')?.value||'').trim().replace(/\/+$/,'');
}
function token(){
  return ($('remoteToken')?.value||'').trim();
}
function authHeaders(){
  return {'X-NOVA-Token':token()};
}
function saveConnection(){
  localStorage.setItem(LS_URL,endpoint());
  localStorage.setItem(LS_TOKEN,token());
}
async function holdWakeLock(){
  try{
    if('wakeLock' in navigator&&!wakeLock)wakeLock=await navigator.wakeLock.request('screen');
  }catch(_){}
}
async function releaseWakeLock(){
  try{if(wakeLock){await wakeLock.release();wakeLock=null}}catch(_){wakeLock=null}
}
async function readClipboardCode(){
  if(!navigator.clipboard?.readText)throw new Error('Буфер обмена недоступен в этом браузере');
  const text=await navigator.clipboard.readText();
  if(!parseConnectCode(text))throw new Error('В буфере нет NOVA CONNECT CODE');
  if($('remoteConnectCode'))$('remoteConnectCode').value=text;
  return true;
}
async function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function parseConnectCode(value){
  const raw=String(value||'').trim();
  if(!raw)return false;
  let data=null;
  try{
    if(raw.startsWith('{'))data=JSON.parse(raw);
    else if(raw.startsWith('NOVA_CONNECT='))data=JSON.parse(raw.slice('NOVA_CONNECT='.length));
    else if(raw.includes('|')){
      const [url,tok]=raw.split('|',2);
      data={url,token:tok};
    }
  }catch(_){data=null}
  if(!data||!data.url||!data.token)return false;
  if($('remoteUrl'))$('remoteUrl').value=String(data.url).trim();
  if($('remoteToken'))$('remoteToken').value=String(data.token).trim();
  saveConnection();
  return true;
}
function setStatus(text,kind=''){
  const el=$('remoteStatus');if(!el)return;
  el.textContent=text;el.dataset.kind=kind;
}
function setProgress(value){
  const n=Math.max(0,Math.min(100,Number(value)||0));
  const bar=$('remoteProgressBar');if(bar)bar.style.width=n+'%';
  const label=$('remoteProgressText');if(label)label.textContent=Math.round(n)+'%';
}
function fullAutoEnabled(){
  return Boolean($('remoteAutoFinal')?.checked||localStorage.getItem(LS_FULLAUTO)==='1');
}
function setFullAuto(enabled){
  const on=Boolean(enabled);
  if($('remoteAutoFinal'))$('remoteAutoFinal').checked=on;
  if(on)localStorage.setItem(LS_FULLAUTO,'1');else localStorage.removeItem(LS_FULLAUTO);
}
function hasRenderableIntent(){
  return Boolean(($('remoteSource')?.files?.[0])||(($('prompt')?.value||'').trim()));
}
async function maybeAutoSend(){
  if(!fullAutoEnabled()||localStorage.getItem(LS_JOB)||!endpoint()||!token()||!hasRenderableIntent())return false;
  await send();
  return true;
}
function chosenEngine(){
  const raw=$('remoteEngine')?.value||'auto';
  if(raw!=='auto')return raw;
  const q=($('prompt')?.value||'').toLowerCase();
  const hasSource=Boolean($('remoteSource')?.files?.[0]);
  if(/ffmpeg|конверт|перекод|encode|transcod|upscale|апскейл/.test(q)&&hasSource)return 'ffmpeg';
  if(/wang|wan2|ai video|генер.*видео|сгенер.*видео|реалистичн.*генер|замен.*персонаж|video.?to.?video/.test(q))return 'wangp';
  if(!hasSource&&!/blender|3d|блокинг|blocking/.test(q))return 'wangp';
  return 'blender';
}
function buildJob(){
  if($('applyPrompt'))$('applyPrompt').click();
  const c=window.config?window.config():{};
  const quality=$('remoteQuality')?.value||'preview';
  const prompt=($('prompt')?.value||'').trim();
  const pack={
    schema:'nova.scene-pack.v1',
    project:'NOVA Remote GPU',
    source_prompt:prompt,
    duration:Number(c.duration||5),
    format:c.ratio||'9:16',
    style:c.style||'neon',
    motion:c.motion||'slide',
    camera:c.camera||'static',
    vfx:c.vfx||'none',
    vfx_intensity:Number(c.intensity||.65),
    render_policy:{preview_first:true,paid_generation:false,max_paid_tests:1}
  };
  return {
    schema:'nova.remote-job.v1',
    created_at:new Date().toISOString(),
    source_prompt:prompt||'TUMSOEV cinematic scene',
    engine:chosenEngine(),
    quality,
    duration:Number(c.duration||5),
    ratio:c.ratio||'9:16',
    fps:quality==='preview'?24:30,
    style:c.style||'neon',
    motion:c.motion||'slide',
    camera:c.camera||'static',
    vfx:c.vfx||'none',
    intensity:Number(c.intensity||.65),
    mirror_drive:Boolean($('remoteMirrorDrive')?.checked),
    scene_pack:pack
  };
}
async function jsonFetch(url,options={}){
  const response=await fetch(url,options);
  let data=null;try{data=await response.json()}catch(_){}
  if(!response.ok)throw new Error(data?.detail||data?.message||('HTTP '+response.status));
  return data||{};
}
async function connect(){
  const url=endpoint(),tok=token();
  if(!url||!tok){setStatus('Вставь NOVA CONNECT CODE или Worker URL + Token.','error');return null}
  saveConnection();setStatus('Проверяю Colab worker…','busy');setProgress(0);
  try{
    const data=await jsonFetch(url+'/health',{headers:authHeaders()});
    lastHealth=data;
    const gpu=data.gpu?.available?(data.gpu.name||'NVIDIA GPU'):'GPU не обнаружен';
    const protocol=data.protocol_version!=null?'P'+data.protocol_version:'old';
    const bits=[gpu,data.blender?'Blender ✓':'Blender —',data.ffmpeg?'FFmpeg ✓':'FFmpeg —',data.wangp_api_ready?'WanGP API ✓':'WanGP —',protocol,data.free_disk_gb!=null?data.free_disk_gb+' GB free':''];
    setStatus('Подключено: '+bits.filter(Boolean).join(' • '),'ok');
    if(data.protocol_version!=null&&Number(data.protocol_version)<2){
      setStatus('Worker устарел. Перезапусти актуальный Colab notebook.','error');
      return null;
    }
    setTimeout(()=>{maybeAutoSend().catch(()=>{})},0);
    return data;
  }catch(error){lastHealth=null;setStatus('Не подключено: '+error.message,'error');return null}
}
function clearPoll(){if(pollTimer){clearTimeout(pollTimer);pollTimer=0}}
async function downloadResult(jobId){
  try{
    const ticket=await jsonFetch(endpoint()+'/jobs/'+encodeURIComponent(jobId)+'/download-ticket',{method:'POST',headers:authHeaders()});
    const url=endpoint()+ticket.path;
    const a=$('remoteResult');
    if(a){a.href=url;a.download=ticket.filename||('NOVA_'+jobId+'.mp4');a.classList.remove('hidden');a.textContent='Открыть / сохранить готовый MP4'}
    const video=$('video');if(video){video.src=url;video.classList.remove('hidden')}
  }catch(error){setStatus('Рендер готов, но ссылка на файл не создалась: '+error.message,'error')}
}
async function poll(jobId){
  clearPoll();
  try{
    const data=await jsonFetch(endpoint()+'/jobs/'+encodeURIComponent(jobId),{headers:authHeaders()});
    setProgress(data.progress||0);
    const state=data.status||'running';
    setStatus((data.message||state)+(data.engine?' • '+data.engine:''),state==='error'?'error':state==='completed'?'ok':'busy');
    if(state==='completed'){
      localStorage.removeItem(LS_JOB);
      const quality=String(data.quality||'preview').toLowerCase();
      if(fullAutoEnabled()&&quality==='preview'&&lastHealth?.capabilities?.preview_promote){
        setStatus('Preview готов. FULL AUTO запускает Final без повторной загрузки…','busy');
        try{
          const promoted=await jsonFetch(endpoint()+'/jobs/'+encodeURIComponent(jobId)+'/promote',{method:'POST',headers:authHeaders()});
          lastJobId=promoted.job_id;localStorage.setItem(LS_JOB,lastJobId);setProgress(0);poll(lastJobId);return;
        }catch(error){
          setStatus('Preview готов, но Final не запустился автоматически: '+error.message,'error');
        }
      }
      await releaseWakeLock();await downloadResult(jobId);return
    }
    if(state==='error'||state==='cancelled'){localStorage.removeItem(LS_JOB);await releaseWakeLock();return}
    if(state==='waiting_wangp'){
      const note=$('remoteHint');if(note)note.textContent='Подключена старая версия worker. Перезапусти актуальный Colab notebook: WanGP теперь работает через Python API автоматически.';
    }
    pollTimer=setTimeout(()=>poll(jobId),2200);
  }catch(error){
    setStatus('Связь с worker потеряна: '+error.message+'. Повторю…','error');
    pollTimer=setTimeout(()=>poll(jobId),5000);
  }
}
async function uploadVideoChunks(jobId,file){
  const chunkSize=8*1024*1024;
  const total=Math.max(1,Math.ceil(file.size/chunkSize));
  for(let index=0;index<total;index++){
    const start=index*chunkSize,end=Math.min(file.size,start+chunkSize);
    const fd=new FormData();
    fd.append('index',String(index));fd.append('total',String(total));fd.append('filename',file.name);
    fd.append('chunk',file.slice(start,end),file.name+'.part');
    let uploaded=false,lastError=null;
    for(let attempt=1;attempt<=3&&!uploaded;attempt++){
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
  }
}
function openColab(){
  const link=$('remoteColabLink');
  const url=link?.href||'https://colab.research.google.com/github/magomedt149/nova-robot/blob/main/blender-colab/NOVA_Remote_GPU_Worker.ipynb';
  const win=window.open(url,'_blank','noopener');
  setStatus('Colab открыт. Нажми Runtime → Run all, потом Copy NOVA CONNECT CODE и вернись сюда.','busy');
  return Boolean(win);
}
async function autoStart(){
  setFullAuto(true);
  const active=lastJobId||localStorage.getItem(LS_JOB);
  if(active&&endpoint()&&token()){
    lastJobId=active;
    await holdWakeLock();
    setStatus('FULL AUTO: возобновляю активный GPU-рендер…','busy');
    poll(active);
    return;
  }
  if(endpoint()&&token()){
    const health=await connect();
    if(health){
      if(await maybeAutoSend())return;
      setStatus('FULL AUTO готов. Добавь описание или выбери видео — после этого отправка начнётся автоматически.','ok');
      return;
    }
  }
  const opened=openColab();
  if(!opened)setStatus('Нужен один тап: нажми «Открыть NOVA Colab Worker», затем Run all. Остальное сделает FULL AUTO.','error');
}
async function preflight(engine,hasSource){
  const health=lastHealth||await connect();
  if(!health)throw new Error('Colab worker не подключён');
  if(engine==='wangp'&&!health.wangp_api_ready){
    if(hasSource&&health.blender){
      setStatus('WanGP ещё не готов — временно переключаю на Blender.','busy');
      return 'blender';
    }
    throw new Error('WanGP API не готов. Перезапусти Colab notebook с Run all.');
  }
  if(engine==='blender'&&!health.blender){
    if(hasSource&&health.ffmpeg){
      setStatus('Blender недоступен — временно переключаю на FFmpeg.','busy');
      return 'ffmpeg';
    }
    throw new Error('Blender не готов в Colab.');
  }
  if(engine==='ffmpeg'&&!health.ffmpeg)throw new Error('FFmpeg не готов в Colab.');
  return engine;
}
async function testRender(){
  const health=await connect();
  if(!health)return;
  if(!health.blender){setStatus('Для теста нужен Blender. Перезапусти Colab notebook.','error');return}
  await holdWakeLock();
  const fd=new FormData();
  fd.append('job_json',JSON.stringify({
    schema:'nova.remote-job.v1',
    source_prompt:'NOVA Remote GPU self test, clean blocking scene',
    engine:'blender',
    quality:'preview',
    duration:1,
    ratio:'9:16',
    fps:24,
    mirror_drive:false
  }));
  setProgress(1);setStatus('Запускаю тестовый Blender-рендер 1 сек…','busy');
  try{
    const data=await jsonFetch(endpoint()+'/jobs',{method:'POST',headers:authHeaders(),body:fd});
    lastJobId=data.job_id;localStorage.setItem(LS_JOB,lastJobId);
    poll(lastJobId);
  }catch(error){
    await releaseWakeLock();setStatus('Тест не запустился: '+error.message,'error');
  }
}
async function send(){
  if(sendBusy)return;
  const url=endpoint(),tok=token();
  if(!url||!tok){setStatus('Сначала подключи Colab worker.','error');return}
  sendBusy=true;
  saveConnection();await holdWakeLock();
  const job=buildJob();
  const source=$('remoteSource')?.files?.[0]||null;
  try{job.engine=await preflight(job.engine,Boolean(source))}catch(error){await releaseWakeLock();setStatus(error.message,'error');return}
  if(job.engine==='ffmpeg'&&!source){await releaseWakeLock();setStatus('Для FFmpeg выбери исходное видео.','error');return}
  if(source)job.defer_start=true;
  const fd=new FormData();
  fd.append('job_json',JSON.stringify(job));
  const btn=$('remoteSend');if(btn)btn.disabled=true;
  const result=$('remoteResult');if(result)result.classList.add('hidden');
  setProgress(1);setStatus('Создаю задачу на Colab GPU…','busy');
  try{
    const data=await jsonFetch(url+'/jobs',{method:'POST',headers:authHeaders(),body:fd});
    lastJobId=data.job_id;localStorage.setItem(LS_JOB,lastJobId);
    if(source){
      await uploadVideoChunks(lastJobId,source);
      await jsonFetch(url+'/jobs/'+encodeURIComponent(lastJobId)+'/start',{method:'POST',headers:authHeaders()});
    }
    setStatus('Colab принял '+lastJobId+'. Запускаю preview/render…','busy');
    poll(lastJobId);
  }catch(error){await releaseWakeLock();setStatus('Не удалось отправить: '+error.message,'error')}
  finally{sendBusy=false;if(btn)btn.disabled=false}
}
async function cancel(){
  const jobId=lastJobId||localStorage.getItem(LS_JOB);
  if(!jobId){setStatus('Активного задания нет.');return}
  try{
    await jsonFetch(endpoint()+'/jobs/'+encodeURIComponent(jobId),{method:'DELETE',headers:authHeaders()});
    clearPoll();localStorage.removeItem(LS_JOB);await releaseWakeLock();setProgress(0);setStatus('Задание остановлено.','ok');
  }catch(error){setStatus('Не удалось остановить: '+error.message,'error')}
}
function restore(){
  if($('remoteUrl'))$('remoteUrl').value=localStorage.getItem(LS_URL)||'';
  if($('remoteToken'))$('remoteToken').value=localStorage.getItem(LS_TOKEN)||'';
  if($('remoteConnectCode'))$('remoteConnectCode').value='';
  const autoParam=new URLSearchParams(location.search).get('auto')==='1';
  if(autoParam)setFullAuto(true);else setFullAuto(localStorage.getItem(LS_FULLAUTO)==='1');
  const pending=localStorage.getItem(LS_PENDING)||'';
  if(pending&&$('prompt')){
    $('prompt').value=pending;
    localStorage.removeItem(LS_PENDING);
    $('applyPrompt')?.click();
  }
  const saved=localStorage.getItem(LS_JOB);
  if(saved&&endpoint()&&token()){lastJobId=saved;holdWakeLock();poll(saved)}
  else if(autoParam&&endpoint()&&token()){setTimeout(()=>autoStart(),180)}
}

$('remoteAutoStart')?.addEventListener('click',autoStart);
$('remoteAutoFinal')?.addEventListener('change',e=>setFullAuto(e.target.checked));
$('remoteTest')?.addEventListener('click',testRender);
$('remoteSource')?.addEventListener('change',()=>{maybeAutoSend().catch(()=>{})});
$('prompt')?.addEventListener('change',()=>{maybeAutoSend().catch(()=>{})});
$('remoteConnect')?.addEventListener('click',connect);
$('remotePasteCode')?.addEventListener('click',async()=>{
  try{
    setStatus('Читаю NOVA CONNECT CODE из буфера…','busy');
    await readClipboardCode();
    await connect();
  }catch(error){setStatus(error.message,'error')}
});
$('remoteSend')?.addEventListener('click',send);
$('remoteCancel')?.addEventListener('click',cancel);
$('remoteUrl')?.addEventListener('change',saveConnection);
$('remoteToken')?.addEventListener('change',saveConnection);
$('remoteConnectCode')?.addEventListener('change',async(e)=>{
  if(parseConnectCode(e.target.value)){
    setStatus('Connect Code принят. Проверяю GPU…','busy');
    await connect();
  }else if(e.target.value.trim()){
    setStatus('Не удалось прочитать NOVA CONNECT CODE.','error');
  }
});
$('remoteConnectCode')?.addEventListener('paste',()=>{
  setTimeout(async()=>{
    const el=$('remoteConnectCode');
    if(el&&parseConnectCode(el.value)){
      setStatus('Connect Code принят. Проверяю GPU…','busy');
      await connect();
    }
  },0);
});
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'&&(lastJobId||localStorage.getItem(LS_JOB)))holdWakeLock();
});
restore();
})();