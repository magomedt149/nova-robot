(() => {
  'use strict';

  if (window.NovaWalkLaughLocal) return;

  const VERSION = '32.1.0';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  let rendering = false;

  function status(message) {
    const local = $('#novaMediaStatus');
    if (local) local.textContent = message;
    const global = $('#statusText');
    if (global) global.textContent = message;
  }

  function preferredMime() {
    if (!window.MediaRecorder) return '';
    return [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ].find((type) => MediaRecorder.isTypeSupported?.(type)) || '';
  }

  function safeName(value) {
    return String(value || 'NOVA').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'NOVA';
  }

  function sourceImage() {
    const upload = $('#novaProImageRef')?.files?.[0];
    if (upload) return { file: upload, name: upload.name };
    const preview = $('#novaProImagePreview');
    if (preview?.src) return { url: preview.src, name: 'NOVA_REFERENCE' };
    return null;
  }

  async function loadImage(source) {
    const img = new Image();
    img.decoding = 'async';
    img.crossOrigin = 'anonymous';
    const url = source.file ? URL.createObjectURL(source.file) : source.url;
    try {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('Не удалось прочитать Photo Reference.'));
        img.src = url;
      });
      return img;
    } finally {
      if (source.file) setTimeout(() => URL.revokeObjectURL(url), 1500);
    }
  }

  function drawCover(ctx, image, width, height, scale = 1, dx = 0, dy = 0) {
    const ar = image.naturalWidth / image.naturalHeight;
    const targetAr = width / height;
    let dw, dh;
    if (ar > targetAr) {
      dh = height * scale;
      dw = dh * ar;
    } else {
      dw = width * scale;
      dh = dw / ar;
    }
    ctx.drawImage(image, (width - dw) / 2 + dx, (height - dh) / 2 + dy, dw, dh);
  }

  function clipEllipse(ctx, cx, cy, rx, ry, rotation = 0) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, rotation, 0, Math.PI * 2);
    ctx.clip();
  }

  function clipPerson(ctx, width, height, side) {
    ctx.beginPath();
    if (side === 'left') {
      ctx.moveTo(width * 0.02, height * 0.35);
      ctx.bezierCurveTo(width * 0.08, height * 0.24, width * 0.44, height * 0.24, width * 0.53, height * 0.46);
      ctx.lineTo(width * 0.52, height * 0.99);
      ctx.lineTo(width * 0.08, height * 0.99);
      ctx.closePath();
    } else {
      ctx.moveTo(width * 0.43, height * 0.36);
      ctx.bezierCurveTo(width * 0.52, height * 0.26, width * 0.89, height * 0.28, width * 0.88, height * 0.56);
      ctx.lineTo(width * 0.79, height * 0.99);
      ctx.lineTo(width * 0.43, height * 0.99);
      ctx.closePath();
    }
    ctx.clip();
  }

  function drawRain(ctx, width, height, t, drops) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = 'rgba(220,235,255,.72)';
    ctx.lineWidth = 1;
    for (const d of drops) {
      const y = ((d.y + d.speed * t) % (height + 90)) - 45;
      const x = (d.x + 10 * t) % width;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 1.4, y + d.len);
      ctx.stroke();
    }
    ctx.restore();
  }

  async function render() {
    if (rendering) throw new Error('Walk + Laugh уже рендерится.');
    const source = sourceImage();
    if (!source) throw new Error('Сначала выбери Photo Reference в PRO Editor.');
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) throw new Error('Этот браузер не поддерживает локальный видео-рендер.');

    const lock = window.NovaDirectorContinuityLock;
    if (lock?.applyUiLock) {
      const check = lock.applyUiLock({ timeline: false });
      if (check && check.ok === false) throw new Error(check.error || 'Identity Lock остановил запуск.');
    }

    rendering = true;
    const button = $('#novaWalkLaugh5s');
    if (button) button.disabled = true;
    status('🚶😄 NOVA Walk + Laugh: локальный 5s render · 0 paid credits…');

    try {
      const image = await loadImage(source);
      const canvas = document.createElement('canvas');
      canvas.width = 720;
      canvas.height = 1280;
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const fps = 30;
      const duration = 5;
      const stream = canvas.captureStream(fps);
      const mime = preferredMime();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : { videoBitsPerSecond: 8_000_000 });
      const chunks = [];
      recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
      const stopped = new Promise((resolve, reject) => {
        recorder.onstop = resolve;
        recorder.onerror = () => reject(recorder.error || new Error('MediaRecorder error'));
      });

      const rand = (seed) => {
        let x = seed >>> 0;
        return () => ((x = Math.imul(1664525, x) + 1013904223 >>> 0) / 4294967296);
      };
      const r = rand(149);
      const drops = Array.from({ length: 160 }, () => ({
        x: r() * canvas.width,
        y: r() * canvas.height * 2 - canvas.height,
        len: 8 + r() * 20,
        speed: 320 + r() * 340
      }));

      const frameMs = 1000 / fps;
      const start = performance.now();
      recorder.start(250);

      await new Promise((resolve) => {
        const tick = () => {
          const elapsed = performance.now() - start;
          const t = Math.min(duration, elapsed / 1000);
          const phase = Math.PI * 2 * 1.75 * t;
          const scale = 1.012 + 0.018 * (t / duration);
          const camX = Math.sin(t * 2.0) * 1.5;
          const camY = -t * 0.85 + Math.sin(t * 2.6) * 0.6;

          ctx.fillStyle = '#05070b';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          drawCover(ctx, image, canvas.width, canvas.height, scale, camX, camY);

          // Left person: independent walk bob/shoulder motion.
          ctx.save();
          clipPerson(ctx, canvas.width, canvas.height, 'left');
          const lx = Math.sin(phase * 0.52) * 1.7;
          const ly = Math.sin(phase) * 3.0;
          drawCover(ctx, image, canvas.width, canvas.height, scale, camX + lx, camY + ly);
          ctx.restore();

          // Right person: opposed step phase for believable paired walking.
          ctx.save();
          clipPerson(ctx, canvas.width, canvas.height, 'right');
          const rx = Math.sin(phase * 0.52 + 0.7) * 1.6;
          const ry = Math.sin(phase + Math.PI * 0.78) * 2.8;
          drawCover(ctx, image, canvas.width, canvas.height, scale, camX + rx, camY + ry);
          ctx.restore();

          // Laugh micro-bounce: tiny head motion preserves facial pixels/identity.
          const laugh = 0.42 + 0.58 * Math.sin(Math.min(1, Math.max(0, (t - .55) / 3.5)) * Math.PI);
          ctx.save();
          clipEllipse(ctx, canvas.width * .37, canvas.height * .33, canvas.width * .15, canvas.height * .11);
          drawCover(ctx, image, canvas.width, canvas.height, scale, camX, camY + Math.sin(t * Math.PI * 4.7) * 1.7 * laugh);
          ctx.restore();
          ctx.save();
          clipEllipse(ctx, canvas.width * .64, canvas.height * .42, canvas.width * .15, canvas.height * .12);
          drawCover(ctx, image, canvas.width, canvas.height, scale, camX, camY + Math.sin(t * Math.PI * 4.5 + .55) * 1.6 * laugh);
          ctx.restore();

          drawRain(ctx, canvas.width, canvas.height, t, drops);

          if (elapsed >= duration * 1000) return resolve();
          setTimeout(() => requestAnimationFrame(tick), Math.max(0, frameMs - 5));
        };
        tick();
      });

      recorder.stop();
      await stopped;
      stream.getTracks().forEach((track) => track.stop());
      const type = recorder.mimeType || mime || 'video/webm';
      const blob = new Blob(chunks, { type });
      if (!blob.size) throw new Error('Пустой видео-результат.');

      const ext = type.includes('mp4') ? 'mp4' : 'webm';
      const base = safeName(source.name).replace(/\.[^.]+$/, '');
      const name = `${base}_NOVA_WALK_LAUGH_5s.${ext}`;
      await window.NovaMediaLibrary?.registerBlob?.(blob, name, 'NOVA Walk + Laugh LOCAL');

      const host = $('#novaProOutputs');
      if (host) {
        const url = URL.createObjectURL(blob);
        const box = document.createElement('div');
        box.className = 'nova-pro-output';
        box.innerHTML = `<video controls playsinline src="${url}"></video><div class="nova-pro-output-meta"><b>${name}</b><span>${(blob.size / 1024 / 1024).toFixed(1)} MB · LOCAL</span></div><div class="nova-media-actions"><a class="nova-media-btn primary" href="${url}" download="${name}">⬇ Save video</a></div>`;
        host.prepend(box);
      }

      status(`✅ NOVA Walk + Laugh готов: 5.0s · 30fps · Identity Lock · 0 paid credits.`);
      return { blob, name, mimeType: type };
    } finally {
      rendering = false;
      if (button) button.disabled = false;
    }
  }

  function mount() {
    const pane = $('#novaProPane');
    if (!pane || $('#novaWalkLaughPanel')) return false;
    const outputs = $('#novaProOutputs')?.closest('.nova-pro-section');
    const panel = document.createElement('div');
    panel.id = 'novaWalkLaughPanel';
    panel.className = 'nova-pro-section';
    panel.innerHTML = `<div class="nova-pro-title"><b>🚶😄 Walk + Laugh · LOCAL</b><span>5s · Director/Identity Lock · zero paid credits</span></div><div class="nova-media-note">Фото → один непрерывный walking/laugh motion: paired step bob, head/shoulder laugh bounce, tracking-camera и rain parallax. Лицо не перерисовывается — используются исходные пиксели reference.</div><div class="nova-media-actions"><button id="novaWalkLaugh5s" class="nova-media-btn primary" type="button">🎬 Сделать Walk + Laugh · 5 сек</button></div>`;
    pane.insertBefore(panel, outputs || null);
    $('#novaWalkLaugh5s', panel)?.addEventListener('click', () => render().catch((error) => status(`Walk + Laugh: ${error.message || error}`)));
    return true;
  }

  const tryMount = () => mount();
  if (!tryMount()) {
    const observer = new MutationObserver(() => { if (tryMount()) observer.disconnect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.NovaWalkLaughLocal = Object.freeze({ version: VERSION, render, mount });
})();