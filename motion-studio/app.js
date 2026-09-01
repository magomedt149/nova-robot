const $=id=>document.getElementById(id);
const canvas=$('canvas');
const ctx=canvas.getContext('2d');
let raf=0, previewStart=performance.now();
const controls=['title','subtitle','duration','ratio','style','motion'];

function config(){return{title:$('title').value.trim()||'TUMSOEV',subtitle:$('subtitle').value.trim()||'FREE MOTION STUDIO',duration:+$('duration').value,ratio:$('ratio').value,style:$('style').value,motion:$('motion').value}}
function setCanvasSize(){const c=config(); const portrait=c.ratio==='9:16'; canvas.width=portrait?720:1280; canvas.height=portrait?1280:720;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function easeOutCubic(x){return 1-Math.pow(1-x,3)}
function hexAlpha(hex,a){return hex+Math.round(clamp(a,0,1)*255).toString(16).padStart(2,'0')}
function palette(style){
  if(style==='gold') return {bg1:'#080706',bg2:'#201707',accent:'#ffba24',text:'#fff3d0',sub:'#ceb97e'};
  if(style==='clean') return {bg1:'#f5f7fb',bg2:'#dfe6f1',accent:'#315efb',text:'#111722',sub:'#536174'};
  if(style==='redcyan') return {bg1:'#05080b',bg2:'#12070b',accent:'#00eaff',accent2:'#ff244f',text:'#f7fbff',sub:'#a8b8c7'};
  if(style==='hologram') return {bg1:'#01050a',bg2:'#031827',accent:'#36e7ff',text:'#dffbff',sub:'#6ed9ef'};
  return {bg1:'#05070e',bg2:'#101c3b',accent:'#00e5ff',text:'#f4f8ff',sub:'#93a1b4'};
}
function draw(t,c){
  const w=canvas.width,h=canvas.height,p=palette(c.style);ctx.clearRect(0,0,w,h);
  const g=ctx.createRadialGradient(w*.72,h*.14,10,w*.52,h*.45,Math.max(w,h));g.addColorStop(0,p.bg2);g.addColorStop(1,p.bg1);ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
  const prog=(t%c.duration)/c.duration; const intro=clamp(prog/.18,0,1), outro=clamp((1-prog)/.15,0,1); const alpha=Math.min(easeOutCubic(intro),easeOutCubic(outro));
  const portrait=c.ratio==='9:16'; const margin=w*.08; const top=h*.105; const bottom=h*.88;
  ctx.globalAlpha=.28;ctx.fillStyle=p.accent;ctx.fillRect(margin,top,w-margin*2,Math.max(2,h*.002));ctx.fillRect(margin,bottom,w-margin*2,Math.max(2,h*.002));ctx.globalAlpha=1;
  ctx.font=`800 ${Math.round(h*.021)}px system-ui`;ctx.fillStyle=p.accent;ctx.textBaseline='middle';ctx.fillText('MOTION / 01',margin,h*.15);ctx.textAlign='right';ctx.fillText(`${Math.round(prog*100)}%`,w-margin,h*.15);ctx.textAlign='left';
  if(c.style==='hologram'){
    ctx.globalAlpha=.12;ctx.fillStyle=p.accent;for(let y=0;y<h;y+=Math.max(5,Math.round(h/150)))ctx.fillRect(0,y,w,1);ctx.globalAlpha=1;
    for(let i=0;i<70;i++){const seed=(i*47)%97;const x=((seed/97+prog*(.03+(i%5)*.004))%1)*w;const y=((i*71)%101)/101*h;ctx.globalAlpha=.12+(i%7)*.03;ctx.fillStyle=p.accent;ctx.fillRect(x,y,2+(i%3),2+(i%3))}ctx.globalAlpha=1;
  }
  const maxHero=portrait?h*.085:h*.11; let heroSize=maxHero;
  ctx.font=`900 ${Math.round(heroSize)}px system-ui`; while(ctx.measureText(c.title).width>w*.82&&heroSize>28){heroSize-=2;ctx.font=`900 ${Math.round(heroSize)}px system-ui`}
  let x=w*.5,y=h*.455,scale=1;
  if(c.motion==='slide')x=w*.5+(1-easeOutCubic(intro))*w*.22-(1-outro)*w*.08;
  if(c.motion==='rise')y=h*.455+(1-easeOutCubic(intro))*h*.18;
  if(c.motion==='float')y+=Math.sin(prog*Math.PI*2)*h*.018;
  if(c.motion==='zoom')scale=.72+.28*easeOutCubic(intro)+Math.sin(prog*Math.PI)*.035;
  if(c.motion==='pulse')scale=1+Math.sin(prog*Math.PI*4)*.045*alpha;
  ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);ctx.textAlign='center';ctx.textBaseline='middle';ctx.globalAlpha=alpha;
  if(c.style==='redcyan'){ctx.font=`900 ${Math.round(heroSize)}px system-ui`;ctx.fillStyle=p.accent2;ctx.fillText(c.title,-Math.max(3,w*.004),0);ctx.fillStyle=p.accent;ctx.fillText(c.title,Math.max(3,w*.004),0);ctx.globalAlpha=alpha*.8;ctx.fillStyle=p.text;ctx.fillText(c.title,0,0)}
  else {ctx.shadowColor=p.accent;ctx.shadowBlur=c.style==='clean'?0:Math.round(h*.035);ctx.fillStyle=p.text;ctx.fillText(c.title,0,0)}
  ctx.restore();ctx.shadowBlur=0;ctx.globalAlpha=alpha;
  let subSize=portrait?h*.03:h*.04;ctx.font=`650 ${Math.round(subSize)}px system-ui`;while(ctx.measureText(c.subtitle).width>w*.78&&subSize>18){subSize-=1;ctx.font=`650 ${Math.round(subSize)}px system-ui`}ctx.fillStyle=p.sub;ctx.textAlign='center';ctx.fillText(c.subtitle,w*.5,h*.59);ctx.globalAlpha=1;
  const barY=h*.80,barH=Math.max(4,h*.006);ctx.fillStyle=hexAlpha(p.sub,.18);ctx.fillRect(margin,barY,w-margin*2,barH);ctx.fillStyle=p.accent;ctx.fillRect(margin,barY,(w-margin*2)*prog,barH);
  ctx.fillStyle=p.sub;ctx.globalAlpha=.65;ctx.font=`700 ${Math.round(h*.017)}px system-ui`;ctx.textAlign='center';ctx.fillText('FREE • BROWSER MOTION • NO CREDITS',w*.5,h*.92);ctx.globalAlpha=1;
}
function frame(now){const c=config();draw(((now-previewStart)/1000)%c.duration,c);raf=requestAnimationFrame(frame)}
function restart(){cancelAnimationFrame(raf);setCanvasSize();previewStart=performance.now();raf=requestAnimationFrame(frame)}
controls.forEach(id=>$(id).addEventListener('input',restart));$('preview').addEventListener('click',restart);restart();

$('applyPrompt').addEventListener('click',()=>{const q=$('prompt').value.toLowerCase();if(!q.trim())return;
  const sec=q.match(/(3|5|8|10|15)\s*(сек|sec|s)/);if(sec)$('duration').value=sec[1];
  if(/вертик|9[:x]16|portrait|reels|shorts|tiktok/.test(q))$('ratio').value='9:16';if(/гориз|16[:x]9|landscape|youtube/.test(q))$('ratio').value='16:9';
  if(/золот|кино|cinema|gold/.test(q))$('style').value='gold';else if(/красн.*голуб|red.*cyan|3d/.test(q))$('style').value='redcyan';else if(/голог|hologram/.test(q))$('style').value='hologram';else if(/чист|clean|minimal/.test(q))$('style').value='clean';else if(/неон|neon/.test(q))$('style').value='neon';
  if(/приближ|zoom|камера.*вперед/.test(q))$('motion').value='zoom';else if(/подъ.м|снизу|rise/.test(q))$('motion').value='rise';else if(/плав|float/.test(q))$('motion').value='float';else if(/пульс|pulse/.test(q))$('motion').value='pulse';else if(/слайд|slide|слева|справа/.test(q))$('motion').value='slide';
  const quoted=$('prompt').value.match(/[«\"]([^»\"]{1,80})[»\"]/);if(quoted)$('title').value=quoted[1];restart();$('status').textContent='Описание применено. Проверь предпросмотр.';
});

function chooseMime(){const types=['video/mp4;codecs=avc1.42E01E','video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];return types.find(t=>window.MediaRecorder&&MediaRecorder.isTypeSupported(t))||''}
$('render').addEventListener('click',async()=>{
  if(!canvas.captureStream||!window.MediaRecorder){$('status').innerHTML='<span class="note">Этот браузер не поддерживает запись Canvas. Открой страницу в Safari/Chrome на более новом устройстве.</span>';return}
  const btn=$('render');btn.disabled=true;$('download').classList.add('hidden');$('video').classList.add('hidden');const c=config();setCanvasSize();const fps=30;const stream=canvas.captureStream(fps);const mime=chooseMime();let rec;try{rec=new MediaRecorder(stream,mime?{mimeType:mime,videoBitsPerSecond:8_000_000}:{videoBitsPerSecond:8_000_000})}catch(e){rec=new MediaRecorder(stream)}
  const chunks=[];rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};const started=performance.now();$('status').textContent=`Рендерю ${c.duration} сек на устройстве… не закрывай страницу.`;
  let renderRaf=0;function renderFrame(now){const elapsed=(now-started)/1000;draw(Math.min(elapsed,c.duration-.001),c);if(elapsed<c.duration)renderRaf=requestAnimationFrame(renderFrame)}
  rec.start(250);renderRaf=requestAnimationFrame(renderFrame);
  await new Promise(r=>setTimeout(r,c.duration*1000+160));cancelAnimationFrame(renderRaf);rec.stop();await new Promise(r=>rec.addEventListener('stop',r,{once:true}));stream.getTracks().forEach(t=>t.stop());
  const outType=rec.mimeType||mime||'video/webm';const blob=new Blob(chunks,{type:outType});const url=URL.createObjectURL(blob);const ext=outType.includes('mp4')?'mp4':'webm';$('download').href=url;$('download').download=`TUMSOEV_Motion_${c.duration}s.${ext}`;$('download').textContent=`Скачать ${ext.toUpperCase()}`;$('download').classList.remove('hidden');$('video').src=url;$('video').classList.remove('hidden');$('status').innerHTML=ext==='mp4'?'Готово. MP4 создан бесплатно на твоём устройстве.':'Готово. Браузер создал WEBM бесплатно. Для MP4 открой студию в Safari на iPhone/Mac или используй локальную FFmpeg-версию.';btn.disabled=false;restart();
});
