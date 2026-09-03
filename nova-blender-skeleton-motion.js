(() => {
  'use strict';
  if (window.NovaBlenderSkeletonMotion) return;

  const VERSION = '32.3.0';
  const $ = (s, root = document) => root.querySelector(s);
  const COLAB_URL = 'https://colab.research.google.com/github/magomedt149/nova-robot/blob/blender-colab-studio/blender-colab/TUMSOEV_Blender_WanGP_Studio.ipynb';
  const FPS = 30;
  const DURATION = 5;
  const GROUND_Z = -3.02;
  const STEP_HZ = 1.28;
  const ROOT_SPEED = 0.62;
  const STANCE = 0.62;

  function status(message) {
    const local = $('#novaMediaStatus');
    if (local) local.textContent = message;
    const global = $('#statusText');
    if (global) global.textContent = message;
  }

  const v3 = (x=0,y=0,z=0) => [x,y,z];
  const add = (a,b) => [a[0]+b[0],a[1]+b[1],a[2]+b[2]];
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  const fract = (v) => v - Math.floor(v);
  const smooth01 = (v) => { const x=clamp(v,0,1); return x*x*(3-2*x); };

  function footPath(t, phase, actor, side) {
    const period = 1 / STEP_HZ;
    const q = t / period + phase;
    const cycle = fract(q);
    const rootY = -ROOT_SPEED * t;
    const stanceTravel = ROOT_SPEED * period * STANCE;
    let relY, z, contact, swing;
    if (cycle < STANCE) {
      const u = cycle / STANCE;
      relY = -stanceTravel/2 + stanceTravel*u;
      z = GROUND_Z;
      contact = true;
      swing = 0;
    } else {
      const u = (cycle-STANCE)/(1-STANCE);
      const eased = smooth01(u);
      relY = stanceTravel/2 - stanceTravel*eased;
      z = GROUND_Z + actor.stepClearance * Math.sin(Math.PI*u);
      contact = false;
      swing = Math.sin(Math.PI*u);
    }
    const lateral = side * actor.hipW * 0.52 + side * 0.018 * Math.sin(Math.PI*2*q);
    return { point:v3(actor.x+lateral, rootY+relY, z), contact, swing, cycle };
  }

  function solveKnee(hip, ankle, thigh, shin, bendSign) {
    const dy = ankle[1]-hip[1], dz = ankle[2]-hip[2];
    let d = Math.hypot(dy,dz);
    d = clamp(d, Math.abs(thigh-shin)+1e-4, thigh+shin-1e-4);
    const uy = dy/d, uz = dz/d;
    const a = (thigh*thigh - shin*shin + d*d)/(2*d);
    const h = Math.sqrt(Math.max(0, thigh*thigh-a*a));
    const by = hip[1] + uy*a;
    const bz = hip[2] + uz*a;
    const py = -uz, pz = uy;
    return v3(hip[0] + bendSign*0.012, by + py*h*bendSign, bz + pz*h*bendSign);
  }

  function armChain(shoulder, upper, fore, angle, side, laughPulse) {
    const elbow = v3(
      shoulder[0] + side*0.03,
      shoulder[1] + Math.sin(angle)*upper,
      shoulder[2] - Math.cos(angle)*upper + 0.018*see(laughPulse)
    );
    const elbowAngle = angle*0.42 + side*0.12 + 0.05*see(laughPulse);
    const wrist = v3(
      elbow[0] + side*0.015,
      elbow[1] + Math.sin(elbowAngle)*fore,
      elbow[2] - Math.cos(elbowAngle)*fore
    );
    return {elbow,wrist};
  }
  function see(v){ return Number.isFinite(v)?v:0; }

  function actorFrame(t, actor, phaseOffset) {
    const rootY = -ROOT_SPEED*t;
    const p = Math.PI*2*STEP_HZ*t + phaseOffset*Math.PI*2;
    const left = footPath(t, phaseOffset, actor, -1);
    const right = footPath(t, phaseOffset+0.5, actor, 1);

    const support = left.contact && !right.contact ? -1 : right.contact && !left.contact ? 1 : 0;
    const laughIn = smooth01((t-0.55)/0.9);
    const laughOut = 1-smooth01((t-4.2)/0.7);
    const laugh = laughIn*laughOut;
    const laughPulse = Math.sin(Math.PI*2*2.25*t + phaseOffset*1.7)*laugh;

    const weightShift = support * actor.hipW*0.08 + 0.018*Math.sin(p*0.5);
    const pelvisZ = actor.hipZ + 0.025*Math.cos(p*2) + 0.012*laughPulse;
    const pelvis = v3(actor.x+weightShift, rootY, pelvisZ);
    const hipL = add(pelvis,v3(-actor.hipW/2,0,0));
    const hipR = add(pelvis,v3(actor.hipW/2,0,0));
    const kneeL = solveKnee(hipL,left.point,actor.thigh,actor.shin,-1);
    const kneeR = solveKnee(hipR,right.point,actor.thigh,actor.shin,1);

    const torsoLeanY = 0.035*Math.sin(p*0.5)+0.025*laughPulse;
    const shoulderCenter = add(pelvis,v3(0,torsoLeanY,actor.torso));
    const shL = add(shoulderCenter,v3(-actor.shoulderW/2,0,0));
    const shR = add(shoulderCenter,v3(actor.shoulderW/2,0,0));
    const neck = add(shoulderCenter,v3(0,0.012*laughPulse,0.19));
    const head = add(neck,v3(0.015*Math.sin(p*0.42),0.018*laughPulse,0.25+0.012*laughPulse));

    const armSwing = 0.58*Math.sin(p+Math.PI);
    const armL = armChain(shL,actor.upperArm,actor.forearm,armSwing,-1,laughPulse);
    const armR = armChain(shR,actor.upperArm,actor.forearm,-armSwing,1,laughPulse);

    const toeL = add(left.point,v3(-0.018,-actor.footLen, left.contact?0:0.018*left.swing));
    const toeR = add(right.point,v3(0.018,-actor.footLen, right.contact?0:0.018*right.swing));

    return {
      id:actor.id,
      root:pelvis,
      laugh,
      contacts:{foot_l:left.contact,foot_r:right.contact,support:left.contact?'left':right.contact?'right':'flight',ground_z:GROUND_Z},
      joints:{
        pelvis, shoulder_center:shoulderCenter, neck, head,
        hip_l:hipL, hip_r:hipR, knee_l:kneeL, knee_r:kneeR,
        ankle_l:left.point, ankle_r:right.point, toe_l:toeL, toe_r:toeR,
        shoulder_l:shL, shoulder_r:shR,
        elbow_l:armL.elbow, elbow_r:armR.elbow,
        wrist_l:armL.wrist, wrist_r:armR.wrist
      }
    };
  }

  const ACTORS = [
    {id:'man',x:-0.53,hipZ:-1.31,torso:1.42,hipW:0.31,shoulderW:0.48,thigh:0.88,shin:0.86,upperArm:0.46,forearm:0.40,footLen:0.22,stepClearance:0.19},
    {id:'woman',x:0.60,hipZ:-1.42,torso:1.38,hipW:0.27,shoulderW:0.40,thigh:0.83,shin:0.80,upperArm:0.41,forearm:0.36,footLen:0.20,stepClearance:0.17}
  ];

  function sample(t) {
    const tt=clamp(Number(t)||0,0,DURATION);
    return {
      t:tt,
      ground_z:GROUND_Z,
      camera:{x:0.02*Math.sin(tt*1.4),y:-7.5-0.08*tt,z:0.0,ortho_scale:6.4},
      actors:[actorFrame(tt,ACTORS[0],0.0),actorFrame(tt,ACTORS[1],0.37)]
    };
  }

  function previewOffsets(t) {
    const f=sample(t); const a=f.actors;
    return {
      left:{x:(a[0].joints.pelvis[0]-ACTORS[0].x)*40,y:(a[0].joints.pelvis[2]-ACTORS[0].hipZ)*-70,headY:a[0].laugh*Math.sin(Math.PI*2*2.25*t)*1.8},
      right:{x:(a[1].joints.pelvis[0]-ACTORS[1].x)*40,y:(a[1].joints.pelvis[2]-ACTORS[1].hipZ)*-70,headY:a[1].laugh*Math.sin(Math.PI*2*2.2*t+.5)*1.7}
    };
  }

  function buildMotion() {
    const count=Math.round(FPS*DURATION),frames=[];
    for(let i=0;i<count;i++) frames.push(sample(i/FPS));
    return {version:3,engine:`NOVA Blender Skeleton Motion v${VERSION}`,preset:'duo_walk_laugh_footlock',fps:FPS,duration:DURATION,frame_count:count,coordinate_system:'x=screen horizontal, y=depth, z=up',ground_z:GROUND_Z,actors:ACTORS,frames};
  }

  function downloadMotion() {
    const payload=buildMotion();
    const blob=new Blob([JSON.stringify(payload)],{type:'application/json'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a');
    a.href=url; a.download='NOVA_DUO_WALK_LAUGH_FOOTLOCK_5s.json'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    status('🦴 Skeleton v32.3: 2 персонажа · foot-lock · перенос веса · 150 кадров · 5 сек.');
    return payload;
  }

  function openColab(){ downloadMotion(); window.open(COLAB_URL,'_blank','noopener,noreferrer'); status('🦴 Открыт Blender/WanGP Colab v32.3. Загрузи reference video + FOOTLOCK JSON.'); }

  function mount(){
    const pane=$('#novaProPane'); if(!pane||$('#novaBlenderSkeletonPanel')) return false;
    const walk=$('#novaWalkLaughPanel'); const outputs=$('#novaProOutputs')?.closest('.nova-pro-section');
    const panel=document.createElement('div'); panel.id='novaBlenderSkeletonPanel'; panel.className='nova-pro-section';
    panel.innerHTML=`<div class="nova-pro-title"><b>🦴 Blender Skeleton Motion</b><span>v${VERSION} · DUO · FOOT LOCK</span></div><div class="nova-media-note">Исправлено: два независимых skeleton-rig, IK колени, противофазные руки, перенос веса, фаза опоры и настоящий foot-lock. Colab рендерит Blender control-video и отдельный contact-check поверх reference video.</div><div class="nova-media-actions"><button id="novaSkeletonJson" class="nova-media-btn" type="button">⬇ Skeleton + Foot Lock</button><button id="novaSkeletonColab" class="nova-media-btn primary" type="button">🦴 Blender + Contact Check</button></div>`;
    pane.insertBefore(panel,walk||outputs||null);
    $('#novaSkeletonJson',panel)?.addEventListener('click',downloadMotion);
    $('#novaSkeletonColab',panel)?.addEventListener('click',openColab);
    return true;
  }

  if(!mount()){ const observer=new MutationObserver(()=>{if(mount())observer.disconnect();}); observer.observe(document.documentElement,{childList:true,subtree:true}); }
  window.NovaBlenderSkeletonMotion=Object.freeze({VERSION,FPS,DURATION,GROUND_Z,sample,previewOffsets,buildMotion,downloadMotion,openColab,mount});
})();