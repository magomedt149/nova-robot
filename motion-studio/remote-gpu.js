(()=>{
const $=id=>document.getElementById(id);
const LS_URL='nova.remoteGpu.url',LS_TOKEN='nova.remoteGpu.token',LS_JOB='nova.remoteGpu.job';
let pollTimer=0,lastJobId='';

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
function setStatus(text,kind=''){
  const el=$('remoteStatus');if(!el)return;
  el.textContent=text;el.dataset.kind=kind;
}
function setProgress(value){
  const n=Math.max(0,Math.min(100,Number(value)||0));
  const bar=$('remoteProgressBar');if(bar)bar.style.width=n+'%';
  const label=$('remoteProgressText');if(label)label.textContent=Math.round(n)+'%';
}
function chosenEngine(){
  const raw=$('remoteEngine')?.value||'auto';
  if(raw!=='auto')return raw;
  const q=($('prompt')?.value||'').toLowerCase();
  if(/wang|wan2|ai video|генер.*видео|реалистичн.*генер/.test(q))return 'wangp';
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
  if(!url||!tok){setStatus('Вставь Worker URL и Token из Google Colab.','error');return}
  saveConnection();setStatus('Проверяю Colab worker…','busy');setProgress(0);
  try{
    const data=await jsonFetch(url+'/health',{headers:authHeaders()});
    const gpu=data.gpu?.available?(data.gpu.name||'NVIDIA GPU'):'GPU не обнаружен';
    const bits=[gpu,data.blender?'Blender ✓':'Blender —',data.ffmpeg?'FFmpeg ✓':'FFmpeg —',data.free_disk_gb!=null?data.free_disk_gb+' GB free':''];
    setStatus('Подключено: '+bits.filter(Boolean).join(' • '),'ok');
  }catch(error){setStatus('Не подключено: '+error.message,'error')}
}
function clearPoll(){if(pollTimer){clearTimeout(pollTimer);pollTimer=0}}
async function downloadResult(jobId){
  try{
    const r=await fetch(endpoint()+'/jobs/'+encodeURIComponent(jobId)+'/result',{headers:authHeaders()});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const blob=await r.blob();
    const url=URL.createObjectURL(blob);
    const a=$('remoteResult');
    if(a){a.href=url;a.download='NOVA_'+jobId+'.mp4';a.classList.remove('hidden');a.textContent='Открыть / сохранить готовый MP4'}
    const video=$('video');if(video){video.src=url;video.classList.remove('hidden')}
  }catch(error){setStatus('Рендер готов, но файл не загрузился: '+error.message,'error')}
}
async function poll(jobId){
  clearPoll();
  try{
    const data=await jsonFetch(endpoint()+'/jobs/'+encodeURIComponent(jobId),{headers:authHeaders()});
    setProgress(data.progress||0);
    const state=data.status||'running';
    setStatus((data.message||state)+(data.engine?' • '+data.engine:''),state==='error'?'error':state==='completed'?'ok':'busy');
    if(state==='completed'){localStorage.removeItem(LS_JOB);await downloadResult(jobId);return}
    if(state==='error'||state==='cancelled'){localStorage.removeItem(LS_JOB);return}
    if(state==='waiting_wangp'){
      const note=$('remoteHint');if(note)note.textContent='WanGP входы готовы в Colab. Запусти WanGP UI там и финализируй результат — NOVA продолжит отслеживание.';
    }
    pollTimer=setTimeout(()=>poll(jobId),2200);
  }catch(error){
    setStatus('Связь с worker потеряна: '+error.message+'. Повторю…','error');
    pollTimer=setTimeout(()=>poll(jobId),5000);
  }
}
async function send(){
  const url=endpoint(),tok=token();
  if(!url||!tok){setStatus('Сначала подключи Colab worker.','error');return}
  saveConnection();
  const job=buildJob();
  const source=$('remoteSource')?.files?.[0]||null;
  if(job.engine==='ffmpeg'&&!source){setStatus('Для FFmpeg выбери исходное видео.','error');return}
  const fd=new FormData();
  fd.append('job_json',JSON.stringify(job));
  if(source)fd.append('source',source,source.name);
  const btn=$('remoteSend');if(btn)btn.disabled=true;
  const result=$('remoteResult');if(result)result.classList.add('hidden');
  setProgress(1);setStatus('Отправляю задачу'+(source?' и видео':'')+' в Colab…','busy');
  try{
    const data=await jsonFetch(url+'/jobs',{method:'POST',headers:authHeaders(),body:fd});
    lastJobId=data.job_id;localStorage.setItem(LS_JOB,lastJobId);
    setStatus('Colab принял '+lastJobId+'. Запускаю preview/render…','busy');
    poll(lastJobId);
  }catch(error){setStatus('Не удалось отправить: '+error.message,'error')}
  finally{if(btn)btn.disabled=false}
}
async function cancel(){
  const jobId=lastJobId||localStorage.getItem(LS_JOB);
  if(!jobId){setStatus('Активного задания нет.');return}
  try{
    await jsonFetch(endpoint()+'/jobs/'+encodeURIComponent(jobId),{method:'DELETE',headers:authHeaders()});
    clearPoll();localStorage.removeItem(LS_JOB);setProgress(0);setStatus('Задание остановлено.','ok');
  }catch(error){setStatus('Не удалось остановить: '+error.message,'error')}
}
function restore(){
  if($('remoteUrl'))$('remoteUrl').value=localStorage.getItem(LS_URL)||'';
  if($('remoteToken'))$('remoteToken').value=localStorage.getItem(LS_TOKEN)||'';
  const saved=localStorage.getItem(LS_JOB);
  if(saved&&endpoint()&&token()){lastJobId=saved;poll(saved)}
}

$('remoteConnect')?.addEventListener('click',connect);
$('remoteSend')?.addEventListener('click',send);
$('remoteCancel')?.addEventListener('click',cancel);
$('remoteUrl')?.addEventListener('change',saveConnection);
$('remoteToken')?.addEventListener('change',saveConnection);
restore();
})();