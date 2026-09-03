(() => {
  'use strict';
  if (window.NovaBlenderSkeletonMotion) return;

  const VERSION = '32.2.0';
  const $ = (s, root = document) => root.querySelector(s);
  const COLAB_URL = 'https://colab.research.google.com/github/magomedt149/nova-robot/blob/blender-colab-studio/blender-colab/TUMSOEV_Blender_WanGP_Studio.ipynb';
  const FPS = 30;
  const DURATION = 5;

  function status(message) {
    const local = $('#novaMediaStatus');
    if (local) local.textContent = message;
    const global = $('#statusText');
    if (global) global.textContent = message;
  }

  function v3(x=0, y=0, z=0) { return [x, y, z]; }
  function add(a,b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
  function limb(origin, length, angle, side=0) {
    return [origin[0] + side, origin[1] + Math.sin(angle) * length, origin[2] - Math.cos(angle) * length];
  }

  function actorFrame(t, actor, phaseOffset) {
    const w = Math.PI * 2 * 1.72;
    const p = w * t + phaseOffset;
    const laughIn = Math.max(0, Math.min(1, (t - 0.55) / 1.15));
    const laughOut = 1 - Math.max(0, Math.min(1, (t - 4.25) / 0.65));
    const laugh = laughIn * laughOut;
    const laughPulse = Math.sin(Math.PI * 2 * 2.35 * t + phaseOffset * 0.35) * laugh;

    const x0 = actor.x + 0.035 * Math.sin(p * 0.5);
    const y0 = -0.18 * t;
    const z0 = actor.hipZ + 0.045 * Math.sin(p * 2) + 0.018 * laughPulse;
    const pelvis = v3(x0, y0, z0);
    const shoulderCenter = add(pelvis, v3(0, 0, actor.torso));
    const neck = add(shoulderCenter, v3(0, 0.0, 0.17));
    const head = add(neck, v3(0.018 * Math.sin(p*0.45), 0.015 * laughPulse, 0.20 + 0.012 * laughPulse));

    const hipL = add(pelvis, v3(-actor.hipW/2, 0, 0));
    const hipR = add(pelvis, v3(actor.hipW/2, 0, 0));
    const shL = add(shoulderCenter, v3(-actor.shoulderW/2, 0, 0));
    const shR = add(shoulderCenter, v3(actor.shoulderW/2, 0, 0));

    const legSwing = 0.54 * Math.sin(p);
    const kneeLiftL = Math.max(0, Math.sin(p)) * 0.58;
    const kneeLiftR = Math.max(0, Math.sin(p + Math.PI)) * 0.58;
    const kneeL = limb(hipL, actor.thigh, legSwing - 0.08, -0.01);
    const kneeR = limb(hipR, actor.thigh, -legSwing - 0.08, 0.01);
    kneeL[1] += 0.08 * kneeLiftL; kneeL[2] += 0.11 * kneeLiftL;
    kneeR[1] += 0.08 * kneeLiftR; kneeR[2] += 0.11 * kneeLiftR;
    const ankleL = limb(kneeL, actor.shin, -0.30 * Math.sin(p) + 0.20 * kneeLiftL, 0);
    const ankleR = limb(kneeR, actor.shin, 0.30 * Math.sin(p) + 0.20 * kneeLiftR, 0);

    const armSwing = 0.50 * Math.sin(p + Math.PI);
    const elbowL = limb(shL, actor.upperArm, armSwing, -0.01);
    const elbowR = limb(shR, actor.upperArm, -armSwing, 0.01);
    const wristL = limb(elbowL, actor.forearm, armSwing * 0.45 + 0.08, 0);
    const wristR = limb(elbowR, actor.forearm, -armSwing * 0.45 + 0.08, 0);

    const chestLean = 0.025 * Math.sin(p*0.5) + 0.018 * laughPulse;
    shoulderCenter[1] += chestLean;
    shL[1] += chestLean; shR[1] += chestLean;

    return {
      id: actor.id,
      root: pelvis,
      laugh,
      joints: {
        pelvis, shoulder_center: shoulderCenter, neck, head,
        hip_l: hipL, hip_r: hipR, knee_l: kneeL, knee_r: kneeR,
        ankle_l: ankleL, ankle_r: ankleR,
        shoulder_l: shL, shoulder_r: shR, elbow_l: elbowL, elbow_r: elbowR,
        wrist_l: wristL, wrist_r: wristR
      }
    };
  }

  const ACTORS = [
    { id:'man', x:-0.46, hipZ:1.08, torso:0.63, hipW:0.28, shoulderW:0.43, thigh:0.52, shin:0.50, upperArm:0.38, forearm:0.34 },
    { id:'woman', x:0.46, hipZ:1.03, torso:0.58, hipW:0.25, shoulderW:0.36, thigh:0.50, shin:0.48, upperArm:0.34, forearm:0.31 }
  ];

  function sample(t) {
    const tt = Math.max(0, Math.min(DURATION, Number(t)||0));
    return {
      t: tt,
      camera: {
        x: 0.025 * Math.sin(tt * 1.6),
        y: -4.6 + 0.12 * tt,
        z: 1.45 + 0.012 * Math.sin(tt * 2.1),
        focal: 50
      },
      actors: [actorFrame(tt, ACTORS[0], 0), actorFrame(tt, ACTORS[1], Math.PI * 0.72)]
    };
  }

  function previewOffsets(t) {
    const frame = sample(t);
    const a = frame.actors;
    return {
      left: {
        x: (a[0].joints.pelvis[0] - ACTORS[0].x) * 42,
        y: (a[0].joints.pelvis[2] - ACTORS[0].hipZ) * -72,
        headY: a[0].laugh * Math.sin(Math.PI*2*2.35*t) * 2.0
      },
      right: {
        x: (a[1].joints.pelvis[0] - ACTORS[1].x) * 42,
        y: (a[1].joints.pelvis[2] - ACTORS[1].hipZ) * -72,
        headY: a[1].laugh * Math.sin(Math.PI*2*2.25*t+0.55) * 1.8
      }
    };
  }

  function buildMotion() {
    const frames = [];
    const count = Math.round(FPS * DURATION);
    for (let i=0; i<count; i++) frames.push(sample(i/FPS));
    return {
      version: 2,
      engine: `NOVA Blender Skeleton Motion v${VERSION}`,
      preset: 'duo_walk_laugh',
      fps: FPS,
      duration: DURATION,
      frame_count: count,
      coordinate_system: 'x=screen horizontal, y=depth, z=up',
      actors: ACTORS,
      frames
    };
  }

  function downloadMotion() {
    const payload = buildMotion();
    const blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'NOVA_DUO_WALK_LAUGH_SKELETON_5s.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    status('🦴 Skeleton Motion JSON готов: 2 персонажа · 150 кадров · 5 сек · 30fps.');
    return payload;
  }

  function openColab() {
    downloadMotion();
    window.open(COLAB_URL, '_blank', 'noopener,noreferrer');
    status('🦴 Blender Skeleton: motion JSON сохранён, открыт бесплатный Blender/WanGP Colab.');
  }

  function mount() {
    const pane = $('#novaProPane');
    if (!pane || $('#novaBlenderSkeletonPanel')) return false;
    const walk = $('#novaWalkLaughPanel');
    const outputs = $('#novaProOutputs')?.closest('.nova-pro-section');
    const panel = document.createElement('div');
    panel.id = 'novaBlenderSkeletonPanel';
    panel.className = 'nova-pro-section';
    panel.innerHTML = `<div class="nova-pro-title"><b>🦴 Blender Skeleton Motion</b><span>DUO · 5s · 30fps · real joint plan</span></div>
      <div class="nova-media-note">Один motion-plan управляет двумя скелетами: таз, плечи, руки, ноги, голова, шаг и смех. JSON идёт в Blender → pose-control video → WanGP/Wan Animate. Это заменяет простое «качание картинки» настоящим skeletal motion-control.</div>
      <div class="nova-media-actions"><button id="novaSkeletonJson" class="nova-media-btn" type="button">⬇ Skeleton JSON</button><button id="novaSkeletonColab" class="nova-media-btn primary" type="button">🦴 Blender + WanGP</button></div>`;
    pane.insertBefore(panel, walk || outputs || null);
    $('#novaSkeletonJson', panel)?.addEventListener('click', downloadMotion);
    $('#novaSkeletonColab', panel)?.addEventListener('click', openColab);
    return true;
  }

  if (!mount()) {
    const observer = new MutationObserver(() => { if (mount()) observer.disconnect(); });
    observer.observe(document.documentElement, {childList:true, subtree:true});
  }

  window.NovaBlenderSkeletonMotion = Object.freeze({ VERSION, FPS, DURATION, sample, previewOffsets, buildMotion, downloadMotion, openColab, mount });
})();