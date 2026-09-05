(()=>{
'use strict';

const EXPECTED_VERSION='v24';
const EXPECTED_CACHE='tumsoev-motion-vfx-studio-v24-character-motion-lock';
const LEGACY_CACHE_RE=/tumsoev-motion-vfx-studio-v(?:22|23)(?:-|$)/i;
const FORCE_PENDING='nova.motion.diagnostics.forcePending';
const FORCE_RESULT='nova.motion.diagnostics.forceResult';
const AUTO_OPEN='nova.motion.diagnostics.autoOpen';

const $=id=>document.getElementById(id);
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

function ensureUi(){
  if($('novaMotionDiagnostics'))return;
  const button=document.createElement('button');
  button.id='novaDiagnosticsOpen';
  button.type='button';
  button.className='nova-diag-open nova-easy-visible';
  button.textContent='🩺 Диагностика';
  button.addEventListener('click',()=>openDiagnostics());

  const panel=document.querySelector('.panel');
  const lead=panel?.querySelector('.lead');
  if(lead)lead.after(button); else document.body.prepend(button);

  const overlay=document.createElement('div');
  overlay.id='novaMotionDiagnostics';
  overlay.className='nova-diag-overlay hidden';
  overlay.innerHTML=`
    <section class="nova-diag-screen" role="dialog" aria-modal="true" aria-labelledby="novaDiagTitle">
      <header class="nova-diag-head">
        <div>
          <div class="nova-diag-kicker">NOVA / MOTION STUDIO</div>
          <h2 id="novaDiagTitle">Диагностика обновления</h2>
          <p>Проверяет Motion Studio, Service Worker и кэш на этом iPhone.</p>
        </div>
        <button id="novaDiagnosticsClose" class="nova-diag-close" type="button" aria-label="Закрыть">×</button>
      </header>

      <div id="novaDiagOverall" class="nova-diag-overall" data-kind="busy">Проверяю…</div>

      <div class="nova-diag-grid">
        <div class="nova-diag-card"><span>Версия Motion Studio</span><b id="novaDiagVersion">—</b><small id="novaDiagVersionNote"></small></div>
        <div class="nova-diag-card"><span>Страница под Service Worker</span><b id="novaDiagControlled">—</b><small id="novaDiagController"></small></div>
        <div class="nova-diag-card"><span>Активный Service Worker</span><b id="novaDiagWorkerState">—</b><small id="novaDiagWorkerUrl"></small></div>
        <div class="nova-diag-card"><span>Активный cache name</span><b id="novaDiagCache">—</b><small id="novaDiagCacheNote"></small></div>
        <div class="nova-diag-card"><span>Старые кэши v22 / v23</span><b id="novaDiagLegacy">—</b><small id="novaDiagLegacyList"></small></div>
        <div class="nova-diag-card"><span>Принудительное обновление v24</span><b id="novaDiagForce">—</b><small id="novaDiagForceNote"></small></div>
      </div>

      <details class="nova-diag-details">
        <summary>Технические данные</summary>
        <pre id="novaDiagRaw"></pre>
      </details>

      <div class="nova-diag-actions">
        <button id="novaDiagRefresh" class="secondary" type="button">↻ Проверить заново</button>
        <button id="novaDiagForceUpdate" type="button">⬆ Принудительно обновить до v24</button>
      </div>
      <div id="novaDiagActionStatus" class="nova-diag-action-status">Проверка ничего не запускает на GPU и не расходует кредиты.</div>
    </section>`;

  document.body.appendChild(overlay);
  $('novaDiagnosticsClose')?.addEventListener('click',closeDiagnostics);
  overlay.addEventListener('click',event=>{if(event.target===overlay)closeDiagnostics()});
  $('novaDiagRefresh')?.addEventListener('click',()=>inspect({showBusy:true}));
  $('novaDiagForceUpdate')?.addEventListener('click',forceUpdateToV24);
}

function setText(id,value,note=''){
  const el=$(id);if(el)el.textContent=value;
  const noteEl=$(id+'Note');if(noteEl)noteEl.textContent=note;
}
function setOverall(text,kind=''){
  const el=$('novaDiagOverall');if(el){el.textContent=text;el.dataset.kind=kind}
}
function setAction(text,kind=''){
  const el=$('novaDiagActionStatus');if(el){el.textContent=text;el.dataset.kind=kind}
}

async function cacheNames(){
  if(!('caches' in window))return [];
  try{return await caches.keys()}catch(_){return []}
}

async function getRegistration(){
  if(!('serviceWorker' in navigator))return null;
  try{
    return await navigator.serviceWorker.getRegistration('./')
      || await navigator.serviceWorker.getRegistration();
  }catch(_){return null}
}

function askController(){
  return new Promise(resolve=>{
    const controller=navigator.serviceWorker?.controller;
    if(!controller){resolve(null);return}
    const channel=new MessageChannel();
    let done=false;
    const finish=value=>{if(done)return;done=true;clearTimeout(timer);resolve(value)};
    const timer=setTimeout(()=>finish(null),1500);
    channel.port1.onmessage=event=>finish(event.data||null);
    try{
      controller.postMessage({type:'NOVA_MOTION_DIAGNOSTICS'},[channel.port2]);
    }catch(_){finish(null)}
  });
}

function parseForceResult(){
  try{return JSON.parse(sessionStorage.getItem(FORCE_RESULT)||'null')}catch(_){return null}
}
function saveForceResult(value){
  try{sessionStorage.setItem(FORCE_RESULT,JSON.stringify(value))}catch(_){}
}

async function inspect({showBusy=false}={}){
  ensureUi();
  if(showBusy)setOverall('Проверяю Motion Studio…','busy');

  const registration=await getRegistration();
  const controller=navigator.serviceWorker?.controller||null;
  const reported=await askController();
  const names=await cacheNames();
  const legacy=names.filter(name=>LEGACY_CACHE_RE.test(name));
  const expectedCachePresent=names.includes(EXPECTED_CACHE);
  const active=registration?.active||null;
  const waiting=registration?.waiting||null;
  const installing=registration?.installing||null;
  const reportedVersion=String(reported?.version||'');
  const reportedCache=String(reported?.cache||'');
  const activeV24=reportedVersion===EXPECTED_VERSION && reportedCache===EXPECTED_CACHE;
  const controlled=Boolean(controller);
  const force=parseForceResult();
  const pending=sessionStorage.getItem(FORCE_PENDING)==='1';

  $('novaDiagVersion').textContent=activeV24?EXPECTED_VERSION:(reportedVersion||'не подтверждена');
  $('novaDiagVersionNote').textContent=activeV24?'Активный worker подтвердил v24.':'Ожидается '+EXPECTED_VERSION+'.';

  $('novaDiagControlled').textContent=controlled?'ДА ✓':'НЕТ';
  $('novaDiagController').textContent=controller?.scriptURL||'Страница пока не контролируется Service Worker.';

  $('novaDiagWorkerState').textContent=active?.state||controller?.state||'нет активного';
  $('novaDiagWorkerUrl').textContent=active?.scriptURL||controller?.scriptURL||'—';

  $('novaDiagCache').textContent=reportedCache|| (expectedCachePresent?EXPECTED_CACHE:'не подтверждён');
  $('novaDiagCacheNote').textContent=expectedCachePresent?'v24 cache присутствует на устройстве.':'v24 cache пока не найден.';

  $('novaDiagLegacy').textContent=legacy.length?'НАЙДЕНЫ ⚠️':'НЕТ ✓';
  $('novaDiagLegacyList').textContent=legacy.length?legacy.join(' • '):'v22/v23 отсутствуют.';

  if(pending){
    const success=activeV24&&expectedCachePresent&&legacy.length===0;
    const result={
      at:new Date().toISOString(),
      ok:success,
      message:success?'УСПЕХ: iPhone работает на Motion Studio v24, старые v22/v23 удалены.':'После перезагрузки v24 ещё не подтверждён полностью.',
      activeVersion:reportedVersion||null,
      activeCache:reportedCache||null,
      legacy
    };
    saveForceResult(result);
    sessionStorage.removeItem(FORCE_PENDING);
  }

  const latest=parseForceResult();
  $('novaDiagForce').textContent=latest?(latest.ok?'УСПЕХ ✓':'НЕ ЗАВЕРШЕНО'):'ещё не запускалось';
  $('novaDiagForceNote').textContent=latest?.message||'Нажми кнопку ниже для принудительной проверки/обновления.';

  const good=activeV24&&controlled&&expectedCachePresent&&legacy.length===0;
  setOverall(
    good?'✅ Motion Studio v24 активен. Старого кода v22/v23 нет.':'⚠️ Диагностика нашла состояние, которое требует обновления.',
    good?'ok':'error'
  );

  const raw={
    expectedVersion:EXPECTED_VERSION,
    expectedCache:EXPECTED_CACHE,
    location:location.href,
    controlled,
    controller:{scriptURL:controller?.scriptURL||null,state:controller?.state||null},
    registration:{
      scope:registration?.scope||null,
      updateViaCache:registration?.updateViaCache||null,
      active:active?{scriptURL:active.scriptURL,state:active.state}:null,
      waiting:waiting?{scriptURL:waiting.scriptURL,state:waiting.state}:null,
      installing:installing?{scriptURL:installing.scriptURL,state:installing.state}:null
    },
    workerReport:reported,
    cacheNames:names,
    legacyCaches:legacy,
    forceResult:parseForceResult()
  };
  $('novaDiagRaw').textContent=JSON.stringify(raw,null,2);
  return {good,activeV24,expectedCachePresent,legacy,registration,reported};
}

async function forceUpdateToV24(){
  ensureUi();
  const button=$('novaDiagForceUpdate');
  if(button)button.disabled=true;
  setAction('Принудительно проверяю v24 и удаляю старые v22/v23…','busy');
  setOverall('Обновление v24…','busy');

  try{
    if(!('serviceWorker' in navigator))throw new Error('Service Worker не поддерживается этим браузером.');
    if(!('caches' in window))throw new Error('Cache Storage недоступен.');

    const before=await cacheNames();
    const legacy=before.filter(name=>LEGACY_CACHE_RE.test(name));
    await Promise.all(legacy.map(name=>caches.delete(name)));

    const response=await fetch('./service-worker.js?v=24&diagnostics='+Date.now(),{cache:'no-store'});
    if(!response.ok)throw new Error('Не удалось скачать service-worker.js v24: HTTP '+response.status);
    const source=await response.text();
    if(!source.includes(EXPECTED_CACHE))throw new Error('Сервер вернул Service Worker без маркера Motion Studio v24.');

    const registration=await navigator.serviceWorker.register('./service-worker.js?v=24',{
      scope:'./',
      updateViaCache:'none'
    });
    await registration.update();

    sessionStorage.setItem(FORCE_PENDING,'1');
    sessionStorage.setItem(AUTO_OPEN,'1');
    saveForceResult({
      at:new Date().toISOString(),
      ok:false,
      message:'v24 скачан и update() выполнен. Проверяю активный worker после перезагрузки…',
      deletedLegacy:legacy
    });
    setAction('v24 скачан. Перезагружаю Motion Studio и проверяю активный worker…','busy');

    setTimeout(()=>location.reload(),350);
  }catch(error){
    const result={at:new Date().toISOString(),ok:false,message:'ОШИБКА: '+error.message};
    saveForceResult(result);
    $('novaDiagForce').textContent='ОШИБКА';
    $('novaDiagForceNote').textContent=result.message;
    setAction(result.message,'error');
    setOverall('❌ Принудительное обновление v24 не завершилось.','error');
    if(button)button.disabled=false;
  }
}

async function openDiagnostics(){
  ensureUi();
  $('novaMotionDiagnostics')?.classList.remove('hidden');
  document.documentElement.classList.add('nova-diag-opened');
  await inspect({showBusy:true});
}
function closeDiagnostics(){
  $('novaMotionDiagnostics')?.classList.add('hidden');
  document.documentElement.classList.remove('nova-diag-opened');
}

ensureUi();
window.NOVA_MOTION_DIAGNOSTICS={open:openDiagnostics,inspect,forceUpdateToV24,version:EXPECTED_VERSION,cache:EXPECTED_CACHE};

if(sessionStorage.getItem(AUTO_OPEN)==='1'){
  sessionStorage.removeItem(AUTO_OPEN);
  setTimeout(()=>openDiagnostics(),250);
}
})();