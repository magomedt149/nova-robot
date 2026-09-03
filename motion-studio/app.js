const $=id=>document.getElementById(id);
const canvas=$('canvas');
const ctx=canvas.getContext('2d');
let raf=0, previewStart=performance.now();
const controls=['title','subtitle','duration','ratio','style','motion','camera','vfx','intensity'];

const VFX_PRESETS={
  fire:{label:'Огонь',vfx:'fire',intensity:'0.65',duration:'5',camera:'push',style:'gold',motion:'pulse',info:'Огонь • 5 сек • средняя сила • Push-in'},
  smoke:{label:'Дым',vfx:'smoke',intensity:'0.65',duration:'8',camera:'handheld',style:'clean',motion:'float',info:'Дым • 8 сек • средняя сила • Handheld'},
  sparks:{label:'Искры',vfx:'sparks',intensity:'1',duration:'5',camera:'push',style:'gold',motion:'zoom',info:'Искры • 5 сек • сильный эффект • Push-in'},
  lightning:{label:'Молния',vfx:'lightning',intensity:'1',duration:'5',camera:'orbit',style:'neon',motion:'pulse',info:'Молния • 5 сек • сильный эффект • Orbit'},
  debris:{label:'Обломки',vfx:'debris',intensity:'0.65',duration:'8',camera:'handheld',style:'redcyan',motion:'rise',info:'Обломки • 8 сек • средняя сила • Handheld'},
  explosion:{label:'Взрыв',vfx:'explosion',intensity:'1',duration:'5',camera:'push',style:'gold',motion:'zoom',info:'Взрыв • 5 сек • сильный эффект • Push-in'},
  fog:{label:'Туман',vfx:'fog',intensity:'0.35',duration:'10',camera:'static',style:'clean',motion:'float',info:'Туман • 10 сек • лёгкий эффект • Static'},
  rain:{label:'Дождь',vfx:'rain',intensity:'0.65',duration:'10',camera:'handheld',style:'neon',motion:'slide',info:'Дождь • 10 сек • средняя сила • Handheld'}
};

function config(){return{title:$('title').value.trim()||'TUMSOEV',subtitle:$('subtitle').value.trim()||'FREE MOTION + VFX STUDIO',duration:+$('duration').value,ratio:$('ratio').value,style:$('style').value,motion:$('motion').value,camera:$('camera').value,vfx:$('vfx').value,intensity:+$('intensity').value}}
function setCanvasSize(){const c=config(); const portrait=c.ratio==='9:16'; canvas.width=portrait?720:1280; canvas.height=portrait?1280:720;}

function setPresetActive(name){
  document.querySelectorAll('.preset-chip').forEach(btn=>btn.classList.toggle('active',btn.dataset.preset===name));
}
function applyPreset(name){
  const p=VFX_PRESETS[name];
  if(!p)return;
  $('vfx').value=p.vfx;
  $('intensity').value=p.intensity;
  $('duration').value=p.duration;
  $('camera').value=p.camera;
  $('style').value=p.style;
  $('motion').value=p.motion;
  const info=$('presetInfo');
  if(info)info.textContent=p.info+' — всё можно изменить вручную до рендера.';
  setPresetActive(name);
  restart();
  $('status').textContent=`Пресет «${p.label}» применён. Предпросмотр обновлён — рендер ещё не запущен.`;
}
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

function hash(n){const x=Math.sin(n*12.9898+78.233)*43758.5453;return x-Math.floor(x)}
function cameraPose(prog,c,w,h){
  if(c.camera==='push')return{x:0,y:-prog*h*.012,scale:1+prog*.07,rot:0};
  if(c.camera==='orbit')return{x:Math.sin(prog*Math.PI*2)*w*.025,y:Math.cos(prog*Math.PI*2)*h*.009,scale:1.025+Math.sin(prog*Math.PI)*.012,rot:Math.sin(prog*Math.PI*2)*.004};
  if(c.camera==='handheld')return{x:(Math.sin(prog*91)+Math.sin(prog*43))*w*.0028,y:(Math.cos(prog*73)+Math.sin(prog*57))*h*.0028,scale:1.018,rot:Math.sin(prog*67)*.006};
  return{x:0,y:0,scale:1,rot:0};
}
function drawVfx(prog,c,w,h,layer){
  const kind=c.vfx||'none',s=clamp(Number(c.intensity)||.65,.1,1);
  if(kind==='none')return;
  ctx.save();
  if((kind==='smoke'||kind==='fog')&&layer==='back'){
    const count=Math.round((kind==='fog'?14:18)*s);
    for(let i=0;i<count;i++){
      const phase=(prog*(kind==='fog'?.08:.22)+hash(i+11))%1,baseX=hash(i+21)*w;
      const x=kind==='fog'?((baseX+phase*w*.22)%w):(baseX+(hash(i+31)-.5)*w*.08);
      const y=kind==='fog'?h*(.18+hash(i+41)*.72):h*(.82-phase*.72+hash(i+51)*.09);
      const r=(kind==='fog'?w*.16:w*.075)*(.55+hash(i+61)),a=(kind==='fog'?.028:.045)*s*(.4+.6*Math.sin(Math.PI*phase));
      const g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,`rgba(220,235,245,${a})`);g.addColorStop(1,'rgba(220,235,245,0)');
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
    }
  }
  if(kind==='fire'&&layer==='back'){
    ctx.globalCompositeOperation='screen';
    const count=Math.round(46*s);
    for(let i=0;i<count;i++){
      const phase=(prog*(.8+hash(i+2)*.8)+hash(i+4))%1,x=w*.5+(hash(i+8)-.5)*w*.32*(1-phase*.45),y=h*.82-phase*h*.38;
      const r=(6+hash(i+12)*26)*s*(1-phase*.5),a=(.16+.32*(1-phase))*s;
      ctx.fillStyle=i%3===0?`rgba(255,70,20,${a})`:`rgba(255,190,50,${a})`;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
    }
  }
  if(layer==='front'&&kind==='rain'){
    ctx.strokeStyle=`rgba(205,232,255,${.18+.34*s})`;ctx.lineWidth=Math.max(1,w/900);
    const count=Math.round(105*s);
    for(let i=0;i<count;i++){const x=hash(i+1)*w,y=((hash(i+5)+prog*(1.8+hash(i+7)*1.4))%1)*h,len=h*(.018+.035*hash(i+9))*s;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-w*.008,y+len);ctx.stroke()}
  }
  if(layer==='front'&&kind==='sparks'){
    ctx.globalCompositeOperation='screen';const count=Math.round(72*s);
    for(let i=0;i<count;i++){const phase=(prog*(1.15+hash(i+2))+hash(i+3))%1,angle=(-Math.PI*.92)+hash(i+4)*Math.PI*.84,speed=w*(.10+.26*hash(i+5));const x=w*.5+Math.cos(angle)*speed*phase,y=h*.62+Math.sin(angle)*speed*phase+h*.24*phase*phase,r=1+3*hash(i+6)*s,a=(1-phase)*(.35+.6*s);ctx.fillStyle=`rgba(255,210,90,${a})`;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill()}
  }
  if(layer==='front'&&kind==='debris'){
    const count=Math.round(38*s);
    for(let i=0;i<count;i++){const phase=(prog*(.65+hash(i+2)*.7)+hash(i+3))%1,dir=(hash(i+4)-.5)*2,x=w*.5+dir*w*.46*phase,y=h*.58-(.18+.2*hash(i+5))*h*phase+h*.32*phase*phase,size=3+13*hash(i+6)*s;ctx.save();ctx.translate(x,y);ctx.rotate(phase*8*(hash(i+7)-.5));ctx.globalAlpha=(1-phase)*.65*s;ctx.fillStyle=i%2?'#8f99a8':'#c8b9a0';ctx.fillRect(-size/2,-size/3,size,size*.65);ctx.restore()}
  }
  if(layer==='front'&&kind==='lightning'){
    const phase=(prog*3.2)%1;if(phase<.16){const power=(1-phase/.16)*s;ctx.globalCompositeOperation='screen';ctx.lineCap='round';for(let glow=3;glow>=1;glow--){ctx.strokeStyle=`rgba(210,235,255,${power*(glow===1?.9:.15)})`;ctx.lineWidth=(glow===1?2:glow*5)*s;ctx.beginPath();let x=w*(.58+hash(Math.floor(prog*100)+9)*.16),y=0;ctx.moveTo(x,y);for(let k=1;k<=9;k++){y=h*k/9;x+=(hash(k*31+Math.floor(prog*50))-.5)*w*.065;ctx.lineTo(x,y)}ctx.stroke()}ctx.fillStyle=`rgba(225,240,255,${power*.12})`;ctx.fillRect(0,0,w,h)}
  }
  if(layer==='front'&&kind==='explosion'&&prog>.32&&prog<.72){
    const phase=clamp((prog-.32)/.28,0,1),cx=w*.5,cy=h*.56,r=w*(.03+.27*phase)*s;ctx.globalCompositeOperation='screen';const g=ctx.createRadialGradient(cx,cy,0,cx,cy,r);g.addColorStop(0,`rgba(255,250,215,${(1-phase)*.9*s})`);g.addColorStop(.28,`rgba(255,170,40,${(1-phase)*.72*s})`);g.addColorStop(1,'rgba(255,55,15,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();ctx.strokeStyle=`rgba(255,205,100,${(1-phase)*.65*s})`;ctx.lineWidth=Math.max(2,w*.006*(1-phase));ctx.beginPath();ctx.arc(cx,cy,r*1.18,0,Math.PI*2);ctx.stroke();
  }
  ctx.restore();
}

function draw(t,c){
  const w=canvas.width,h=canvas.height,p=palette(c.style);ctx.clearRect(0,0,w,h);
  const g=ctx.createRadialGradient(w*.72,h*.14,10,w*.52,h*.45,Math.max(w,h));g.addColorStop(0,p.bg2);g.addColorStop(1,p.bg1);ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
  const prog=(t%c.duration)/c.duration; const cam=cameraPose(prog,c,w,h);ctx.save();ctx.translate(w*.5+cam.x,h*.5+cam.y);ctx.rotate(cam.rot);ctx.scale(cam.scale,cam.scale);ctx.translate(-w*.5,-h*.5);drawVfx(prog,c,w,h,'back'); const intro=clamp(prog/.18,0,1), outro=clamp((1-prog)/.15,0,1); const alpha=Math.min(easeOutCubic(intro),easeOutCubic(outro));
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
  ctx.fillStyle=p.sub;ctx.globalAlpha=.65;ctx.font=`700 ${Math.round(h*.017)}px system-ui`;ctx.textAlign='center';ctx.fillText('FREE • MOTION + VFX • NO CREDITS',w*.5,h*.92);ctx.globalAlpha=1;drawVfx(prog,c,w,h,'front');ctx.restore();
}
function frame(now){const c=config();draw(((now-previewStart)/1000)%c.duration,c);raf=requestAnimationFrame(frame)}
function restart(){cancelAnimationFrame(raf);setCanvasSize();previewStart=performance.now();raf=requestAnimationFrame(frame)}
controls.forEach(id=>$(id).addEventListener('input',()=>{setPresetActive('');restart()}));
$('preview').addEventListener('click',restart);
document.querySelectorAll('.preset-chip').forEach(btn=>btn.addEventListener('click',()=>applyPreset(btn.dataset.preset)));
restart();

$('applyPrompt').addEventListener('click',()=>{const q=$('prompt').value.toLowerCase();if(!q.trim())return;
  const sec=q.match(/(3|5|8|10|15)\s*(сек|sec|s)/);if(sec)$('duration').value=sec[1];
  if(/вертик|9[:x]16|portrait|reels|shorts|tiktok/.test(q))$('ratio').value='9:16';if(/гориз|16[:x]9|landscape|youtube/.test(q))$('ratio').value='16:9';
  if(/золот|кино|cinema|gold/.test(q))$('style').value='gold';else if(/красн.*голуб|red.*cyan|3d/.test(q))$('style').value='redcyan';else if(/голог|hologram/.test(q))$('style').value='hologram';else if(/чист|clean|minimal/.test(q))$('style').value='clean';else if(/неон|neon/.test(q))$('style').value='neon';
  if(/приближ|zoom|камера.*вперед/.test(q))$('motion').value='zoom';else if(/подъ.м|снизу|rise/.test(q))$('motion').value='rise';else if(/плав|float/.test(q))$('motion').value='float';else if(/пульс|pulse/.test(q))$('motion').value='pulse';else if(/слайд|slide|слева|справа/.test(q))$('motion').value='slide';
  if(/обл[её]т|orbit|вокруг/.test(q))$('camera').value='orbit';else if(/handheld|ручн.*камер|дрож/.test(q))$('camera').value='handheld';else if(/push[- ]?in|наезд|камера.*впер/.test(q))$('camera').value='push';
  if(/взрыв|explosion/.test(q))$('vfx').value='explosion';else if(/молн|lightning/.test(q))$('vfx').value='lightning';else if(/искр|sparks?/.test(q))$('vfx').value='sparks';else if(/дым|smoke/.test(q))$('vfx').value='smoke';else if(/туман|fog/.test(q))$('vfx').value='fog';else if(/дожд|rain/.test(q))$('vfx').value='rain';else if(/облом|debris/.test(q))$('vfx').value='debris';else if(/огонь|плам|fire/.test(q))$('vfx').value='fire';
  if(/сильн|много|макс|heavy|intense/.test(q))$('intensity').value='1';else if(/л[её]гк|слаб|subtle|light/.test(q))$('intensity').value='0.35';
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
