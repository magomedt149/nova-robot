(() => {
  'use strict';

  if (window.NovaVideoPro) return;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const DB_NAME = 'nova-media-library-v1';
  const STORE = 'files';
  const state = {
    imageRef: null,
    videoRef: null,
    prompt: '',
    negative: '',
    refMode: 'exact',
    objectUrls: [],
    lastOutput: null,
    rendering: false,
    abort: false
  };

  const SCENE_DEFAULTS = [
    { style: 'cinema', prompt: 'cinematic slow push-in, stable face and clothing, natural camera' },
    { style: 'motion', prompt: 'smooth motion control pan left to right, gentle push-in' },
    { style: 'threed', prompt: 'subtle 2.5D depth parallax, preserve subject exactly; not a true camera orbit' },
    { style: 'hologram', prompt: 'clean hologram light effect, preserve identity and composition' },
    { style: 'action', prompt: 'dynamic action camera, controlled energy, no identity change' }
  ];

  function status(message) {
    const local = $('#novaMediaStatus');
    if (local) local.textContent = message;
    const global = $('#statusText');
    if (global) global.textContent = message;
  }

  function clean(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function safeName(value) {
    return String(value || 'NOVA').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'NOVA';
  }

  function extensionFor(type) {
    return String(type || '').includes('mp4') ? 'mp4' : 'webm';
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

  function rememberUrl(url) {
    if (url) state.objectUrls.push(url);
    return url;
  }

  function revokeTempUrls() {
    state.objectUrls.splice(0).forEach((url) => {
      try { URL.revokeObjectURL(url); } catch (_) {}
    });
  }

  function inferKind(record) {
    const type = String(record?.type || '').toLowerCase();
    const name = String(record?.name || '');
    if (type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(name)) return 'video';
    if (type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(name)) return 'image';
    if (type.startsWith('audio/') || /\.(mp3|wav|m4a|aac)$/i.test(name)) return 'audio';
    return 'file';
  }

  function restoreBlob(record) {
    if (record?.blob instanceof Blob) return record.blob;
    if (record?.bytes instanceof ArrayBuffer) return new Blob([record.bytes], { type: record.type || 'application/octet-stream' });
    if (ArrayBuffer.isView(record?.bytes)) return new Blob([record.bytes.buffer], { type: record.type || 'application/octet-stream' });
    return null;
  }

  function openLibraryDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB недоступен.'));
    });
  }

  async function libraryRecords() {
    if (!('indexedDB' in window)) return [];
    const db = await openLibraryDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result || []).map((record) => ({ ...record, blob: restoreBlob(record) })).filter((r) => r.blob));
        req.onerror = () => reject(req.error || new Error('Не удалось прочитать медиатеку.'));
      });
    } finally {
      db.close();
    }
  }

  async function libraryRecordById(id) {
    const rows = await libraryRecords();
    return rows.find((row) => row.id === id) || null;
  }

  async function saveToLibrary(blob, name, source = 'NOVA Video PRO') {
    if (!(blob instanceof Blob) || !blob.size) throw new Error('Пустой результат.');
    if (window.NovaMediaLibrary?.registerBlob) {
      await window.NovaMediaLibrary.registerBlob(blob, name, source);
    }
    state.lastOutput = { blob, name, source };
    return state.lastOutput;
  }

  async function storageInfo() {
    const node = $('#novaProStorage');
    if (!node) return;
    try {
      const estimate = await navigator.storage?.estimate?.();
      if (!estimate?.quota) return void (node.textContent = 'Хранилище: данные недоступны');
      const mb = (v) => `${(Number(v || 0) / 1024 / 1024).toFixed(1)} MB`;
      node.textContent = `Хранилище NOVA/iPhone: занято ~${mb(estimate.usage)} из ~${mb(estimate.quota)}`;
    } catch (_) {
      node.textContent = 'Хранилище: данные недоступны';
    }
  }

  async function clearTemporary() {
    revokeTempUrls();
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => /nova-video-temp|nova-render-temp/i.test(key)).map((key) => caches.delete(key)));
    } catch (_) {}
    await storageInfo();
    status('✅ Временные URL и видео-кэш NOVA очищены. Медиатека не удалялась.');
  }

  async function deleteOldLibrary(days = 14) {
    if (!confirm(`Удалить из локальной медиатеки файлы старше ${days} дней?`)) return;
    const db = await openLibraryDb();
    let removed = 0;
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const req = store.openCursor();
        const cutoff = Date.now() - days * 86400000;
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          if (Number(cursor.value?.createdAt || 0) < cutoff) {
            cursor.delete();
            removed += 1;
          }
          cursor.continue();
        };
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Очистка не удалась.'));
      });
    } finally {
      db.close();
    }
    await window.NovaMediaLibrary?.refresh?.();
    await refreshLibrarySelect();
    await storageInfo();
    status(`✅ Освобождение места: удалено старых файлов ${removed}.`);
  }

  function syncSharedInputs(source = document) {
    const prompt = $('#novaProPrompt', source)?.value ?? $('#novaShortMasterPrompt')?.value ?? $('#novaMotionPrompt')?.value;
    const negative = $('#novaProNegative', source)?.value ?? $('#novaShortNegativePrompt')?.value ?? $('#novaMotionNegative')?.value;
    const mode = $('#novaProRefMode', source)?.value ?? $('#novaShortRefMode')?.value ?? $('#novaMotionRefMode')?.value;
    if (prompt != null) state.prompt = clean(prompt);
    if (negative != null) state.negative = clean(negative);
    if (mode) state.refMode = mode;
  }

  function setReference(file, kind) {
    if (!file) return;
    if (kind === 'image') state.imageRef = file;
    if (kind === 'video') state.videoRef = file;
    updateReferenceLabels();
    updateProPlayerSource();
  }

  function updateReferenceLabels() {
    $$('.nova-ref-image-name').forEach((n) => n.textContent = state.imageRef ? `Фото: ${state.imageRef.name}` : 'Фото не выбрано');
    $$('.nova-ref-video-name').forEach((n) => n.textContent = state.videoRef ? `Видео: ${state.videoRef.name}` : 'Видео не выбрано');
    const badge = $('#novaProExactBadge');
    if (badge) badge.textContent = state.refMode === 'exact' ? 'EXACT · исходные пиксели' : 'STYLE · визуальный look';
  }

  function currentSource() {
    const local = $('#novaLocalVideo')?.files?.[0] || null;
    if (state.videoRef) return { kind: 'video', file: state.videoRef };
    if (local) return { kind: 'video', file: local };
    if (state.imageRef) return { kind: 'image', file: state.imageRef };
    return null;
  }

  function wrapCanvasText(ctx, text, maxWidth, maxLines = 7) {
    const words = clean(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (!line || ctx.measureText(next).width <= maxWidth) line = next;
      else {
        lines.push(line);
        line = word;
        if (lines.length >= maxLines - 1) break;
      }
    }
    if (line && lines.length < maxLines) lines.push(line);
    if (lines.length === maxLines && words.length > lines.join(' ').split(/\s+/).length) {
      lines[maxLines - 1] = lines[maxLines - 1].replace(/[.…]+$/, '') + '…';
    }
    return lines;
  }

  async function makeTextPromptSource(prompt, ratio = '9:16') {
    const text = clean(prompt);
    if (!text) throw new Error('Напиши, какое видео хочешь создать.');
    const width = ratio === '16:9' ? 1280 : 720;
    const height = ratio === '16:9' ? 720 : 1280;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });

    const seed = [...text].reduce((sum, ch) => (sum + ch.charCodeAt(0) * 17) % 360, 220);
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, `hsl(${seed},58%,12%)`);
    grad.addColorStop(.55, `hsl(${(seed + 38) % 360},55%,9%)`);
    grad.addColorStop(1, '#02040b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    const glow = ctx.createRadialGradient(width * .25, height * .25, 0, width * .25, height * .25, Math.max(width, height) * .72);
    glow.addColorStop(0, `hsla(${(seed + 65) % 360},90%,68%,.30)`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    for (let i = 0; i < 70; i++) {
      const x = ((i * 83 + seed * 11) % 997) / 997 * width;
      const y = ((i * 149 + seed * 7) % 991) / 991 * height;
      const r = 0.7 + ((i * 13) % 8) / 8 * 1.8;
      ctx.globalAlpha = .18 + ((i * 19) % 70) / 100;
      ctx.fillStyle = i % 5 === 0 ? '#9edcff' : '#ffffff';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    const panelW = width * .84;
    const panelX = (width - panelW) / 2;
    const panelY = height * .27;
    const panelH = height * .46;
    ctx.fillStyle = 'rgba(3,8,22,.58)';
    ctx.strokeStyle = 'rgba(140,198,255,.28)';
    ctx.lineWidth = Math.max(2, width / 500);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(panelX, panelY, panelW, panelH, Math.min(34, width * .04));
    else ctx.rect(panelX, panelY, panelW, panelH);
    ctx.fill(); ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#8bdcff';
    ctx.font = `800 ${Math.round(width * .035)}px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif`;
    ctx.fillText('NOVA · TEXT → VIDEO · FREE', width / 2, panelY + height * .065);

    const fontSize = Math.round(width * (ratio === '16:9' ? .042 : .052));
    ctx.font = `800 ${fontSize}px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif`;
    ctx.fillStyle = '#ffffff';
    const lines = wrapCanvasText(ctx, text, panelW * .78, ratio === '16:9' ? 5 : 8);
    const lineHeight = fontSize * 1.28;
    const blockH = lines.length * lineHeight;
    let y = panelY + panelH / 2 - blockH / 2 + lineHeight * .75;
    lines.forEach((line) => { ctx.fillText(line, width / 2, y); y += lineHeight; });

    ctx.font = `650 ${Math.round(width * .027)}px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif`;
    ctx.fillStyle = 'rgba(220,235,255,.78)';
    ctx.fillText('локальный motion-клип · без платных API', width / 2, panelY + panelH - height * .045);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Не удалось создать локальный кадр из текста.')), 'image/png', 1);
    });
    const file = new File([blob], 'NOVA_TEXT_PROMPT.png', { type: 'image/png', lastModified: Date.now() });
    return { kind: 'image', file, generatedFromText: true };
  }

  async function useCurrentVideo() {
    const file = $('#novaLocalVideo')?.files?.[0];
    if (!file) throw new Error('Во вкладке «Видео» нет MP4/MOV.');
    setReference(file, 'video');
    status(`✅ ${file.name} используется как точный video reference.`);
  }

  async function refreshLibrarySelect() {
    const select = $('#novaProLibrarySelect');
    if (!select) return;
    const rows = (await libraryRecords()).filter((r) => ['video', 'image'].includes(inferKind(r))).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    select.innerHTML = '<option value="">Выбрать из медиатеки…</option>' + rows.map((row) => `<option value="${row.id}">${inferKind(row) === 'video' ? '🎬' : '🖼'} ${safeName(row.name)}</option>`).join('');
  }

  async function loadLibraryReference(id) {
    if (!id) return;
    const row = await libraryRecordById(id);
    if (!row?.blob) throw new Error('Файл не найден в медиатеке.');
    const file = new File([row.blob], row.name, { type: row.type || row.blob.type || 'application/octet-stream' });
    const kind = inferKind(row);
    if (kind === 'video') setReference(file, 'video');
    else if (kind === 'image') setReference(file, 'image');
    else throw new Error('Этот файл нельзя использовать как визуальный reference.');
    status(`✅ Reference загружен из медиатеки: ${row.name}`);
  }

  function updateProPlayerSource() {
    const video = $('#novaProPlayer');
    const image = $('#novaProImagePreview');
    if (!video || !image) return;
    const source = currentSource();
    video.pause();
    video.removeAttribute('src');
    image.removeAttribute('src');
    video.hidden = true;
    image.hidden = true;
    if (!source) return updateTimeUi();
    const url = rememberUrl(URL.createObjectURL(source.file));
    if (source.kind === 'video') {
      video.src = url;
      video.hidden = false;
      video.load();
    } else {
      image.src = url;
      image.hidden = false;
    }
    updateTimeUi();
  }

  function formatTime(sec) {
    const value = Math.max(0, Number(sec || 0));
    const m = Math.floor(value / 60);
    const s = Math.floor(value % 60);
    const d = Math.floor((value % 1) * 10);
    return `${m}:${String(s).padStart(2, '0')}.${d}`;
  }

  function updateTimeUi() {
    const video = $('#novaProPlayer');
    const range = $('#novaProSeek');
    const text = $('#novaProTime');
    if (!video || !range || !text) return;
    const duration = Number(video.duration || 0);
    range.max = String(duration || 1);
    range.value = String(Math.min(Number(video.currentTime || 0), duration || 1));
    text.textContent = `${formatTime(video.currentTime)} / ${formatTime(duration)}`;
  }

  function playerAction(action, delta = 0) {
    const video = $('#novaProPlayer');
    if (!video || video.hidden) return;
    if (action === 'play') video.play().catch(() => {});
    if (action === 'pause') video.pause();
    if (action === 'stop') { video.pause(); video.currentTime = 0; }
    if (action === 'seek') video.currentTime = clamp(Number(video.currentTime || 0) + delta, 0, Number(video.duration || 0));
    updateTimeUi();
  }

  function installPlayerBar(video, key) {
    if (!video || video.dataset.novaPlayerV31 === '1') return;
    video.dataset.novaPlayerV31 = '1';
    const bar = document.createElement('div');
    bar.className = 'nova-pro-playerbar compact';
    bar.innerHTML = `<button type="button" data-a="play">▶ Play</button><button type="button" data-a="pause">⏸ Pause</button><button type="button" data-a="stop">⏹ Stop</button><button type="button" data-a="back">−5s</button><button type="button" data-a="forward">+5s</button><span data-t>0:00 / 0:00</span>`;
    video.insertAdjacentElement('afterend', bar);
    const update = () => { const t = $('[data-t]', bar); if (t) t.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`; };
    video.addEventListener('timeupdate', update);
    video.addEventListener('loadedmetadata', update);
    bar.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      const a = button.dataset.a;
      if (a === 'play') video.play().catch(() => {});
      if (a === 'pause') video.pause();
      if (a === 'stop') { video.pause(); video.currentTime = 0; }
      if (a === 'back') video.currentTime = clamp(video.currentTime - 5, 0, video.duration || 0);
      if (a === 'forward') video.currentTime = clamp(video.currentTime + 5, 0, video.duration || 0);
      update();
    });
    bar.dataset.for = key || video.id || 'video';
  }

  function parseMotion(prompt, negative = '') {
    const q = clean(prompt).toLowerCase();
    const n = clean(negative).toLowerCase();
    const blocked = (re) => re.test(n);
    return {
      zoom: !blocked(/zoom|приближ|push/) && /zoom|push.?in|dolly.?in|приближ|камера.*вперед/.test(q),
      zoomOut: !blocked(/zoom|отдал/) && /zoom.?out|dolly.?out|отдал/.test(q),
      panLeft: !blocked(/pan|движ/) && /pan left|налево|влево/.test(q),
      panRight: !blocked(/pan|движ/) && /pan right|направо|вправо/.test(q),
      panUp: !blocked(/pan|движ/) && /pan up|вверх/.test(q),
      panDown: !blocked(/pan|движ/) && /pan down|вниз/.test(q),
      handheld: !blocked(/shake|дрож|handheld/) && /handheld|shake|дрож|action camera/.test(q),
      staticCamera: /static camera|статич/.test(q) || blocked(/camera|motion|движ|zoom|pan/),
      noCrop: /no crop|без обрез/.test(q) || blocked(/crop|обрез/)
    };
  }


  function requestsTrue3D(prompt, style = '') {
    const q = clean(prompt).toLowerCase();
    const orbit = /360|full orbit|full circle|orbit|fly.?around|camera.*around|обл[её]т|вокруг|полный круг/.test(q);
    const spatialMove = /crane|top.?down|arc left|arc right|кран|сверху|дуг/.test(q);
    return orbit || spatialMove || (style === 'threed' && /camera path|3d camera|true 3d/.test(q));
  }

  function hasTrue3DControlVideo(source) {
    if (source?.kind !== 'video') return false;
    const name = String(source.file?.name || '').toLowerCase();
    return /blender|true[_ -]?orbit|previs|camera[_ -]?path|blocking[_ -]?preview|reference[_ -]?control/.test(name);
  }

  function drawCover(ctx, source, width, height, progress, motion, style, exactMode) {
    const sw = source.videoWidth || source.naturalWidth || width;
    const sh = source.videoHeight || source.naturalHeight || height;
    const cover = motion.noCrop ? Math.min(width / sw, height / sh) : Math.max(width / sw, height / sh);
    let scale = 1.02;
    if (!motion.staticCamera) {
      if (motion.zoom) scale += progress * .13;
      else if (motion.zoomOut) scale += (1 - progress) * .13;
      else scale += Math.sin(progress * Math.PI) * .035;
    }
    if (style === 'cinema') scale += .025;
    if (style === 'action') scale += .045;
    let dx = 0, dy = 0;
    if (!motion.staticCamera) {
      if (motion.panLeft) dx = 42 * (1 - 2 * progress);
      if (motion.panRight) dx = -42 * (1 - 2 * progress);
      if (motion.panUp) dy = 36 * (1 - 2 * progress);
      if (motion.panDown) dy = -36 * (1 - 2 * progress);
      if (!motion.panLeft && !motion.panRight && style === 'motion') dx = -28 + 56 * progress;
      if (motion.handheld) { dx += Math.sin(progress * 41) * 5; dy += Math.cos(progress * 33) * 4; }
    }
    const dw = sw * cover * scale;
    const dh = sh * cover * scale;
    const x = (width - dw) / 2 + dx;
    const y = (height - dh) / 2 + dy;

    if (exactMode) ctx.filter = 'none';
    else if (style === 'cinema') ctx.filter = 'contrast(1.12) saturate(.92) brightness(.95)';
    else if (style === 'hologram') ctx.filter = 'hue-rotate(145deg) saturate(1.75) contrast(1.16)';
    else if (style === 'threed') ctx.filter = 'contrast(1.08) saturate(1.05)';
    else if (style === 'action') ctx.filter = 'contrast(1.17) saturate(1.12)';
    else ctx.filter = 'none';
    ctx.drawImage(source, x, y, dw, dh);
    ctx.filter = 'none';

    if (!exactMode && style === 'hologram') {
      ctx.fillStyle = 'rgba(70,220,255,.08)'; ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(120,235,255,.12)';
      for (let yy = 0; yy < height; yy += 10) ctx.fillRect(0, yy, width, 1);
    }
    if (!exactMode && style === 'threed') {
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = .13;
      ctx.drawImage(source, x + 7, y, dw, dh);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (style === 'cinema') {
      const grad = ctx.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, 'rgba(0,0,0,.16)'); grad.addColorStop(.5, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,.2)');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, width, height);
    }
  }

  function drawPromptBadge(ctx, width, height, text) {
    const value = clean(text);
    if (!value) return;
    ctx.save();
    ctx.font = '700 20px system-ui,-apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(width * .08, height - 92, width * .84, 52);
    ctx.fillStyle = '#fff';
    const short = value.length > 72 ? `${value.slice(0, 69)}…` : value;
    ctx.fillText(short, width / 2, height - 59, width * .78);
    ctx.restore();
  }

  async function loadMedia(source, start = 0, extend = false) {
    const url = rememberUrl(URL.createObjectURL(source.file));
    if (source.kind === 'image') {
      const image = new Image();
      image.src = url;
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
      return { element: image, kind: 'image', duration: Infinity, start: 0, url };
    }
    const video = document.createElement('video');
    video.src = url;
    video.playsInline = true;
    video.preload = 'auto';
    video.muted = false;
    await new Promise((resolve, reject) => {
      video.addEventListener('loadedmetadata', resolve, { once: true });
      video.addEventListener('error', () => reject(new Error('Не удалось открыть video reference.')), { once: true });
    });
    const duration = Number(video.duration || 0);
    const actualStart = extend ? Math.max(0, duration - .12) : clamp(start, 0, Math.max(0, duration - .08));
    video.currentTime = actualStart;
    await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
    return { element: video, kind: 'video', duration, start: actualStart, url };
  }

  async function renderLocalClip(options = {}) {
    if (state.rendering) throw new Error('Уже идёт рендер.');
    const source = options.source || currentSource();
    if (!source) throw new Error('Загрузи фото или MP4/MOV reference.');
    if (!window.MediaRecorder) throw new Error('MediaRecorder недоступен в этом браузере.');
    if (!HTMLCanvasElement.prototype.captureStream) throw new Error('Canvas recording недоступен.');

    state.rendering = true;
    state.abort = false;
    try {
      const duration = clamp(options.duration || 5, .8, 15);
      const width = options.ratio === '16:9' ? 1280 : 720;
      const height = options.ratio === '16:9' ? 720 : 1280;
      const style = options.style || 'motion';
      const prompt = clean(options.prompt || state.prompt || 'smooth cinematic motion');
      const negative = clean(options.negative || state.negative || '');
      if (requestsTrue3D(prompt, style) && !hasTrue3DControlVideo(source)) {
        throw new Error('TRUE 3D Orbit/360 нельзя создавать локальным pan/zoom или из отдельных картинок. Открой вкладку 3D → Blender Camera Bridge, создай Blender control MP4 и затем используй его как Video reference.');
      }
      const exactMode = (options.refMode || state.refMode) === 'exact';
      const extend = Boolean(options.extend);
      const media = await loadMedia(source, options.start || 0, extend);
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const canvasStream = canvas.captureStream(30);

      let audioContext = null;
      let sourceNode = null;
      let audioDest = null;
      if (media.kind === 'video' && !extend) {
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (AC) {
            audioContext = new AC();
            sourceNode = audioContext.createMediaElementSource(media.element);
            audioDest = audioContext.createMediaStreamDestination();
            sourceNode.connect(audioDest);
          }
        } catch (_) {}
      }
      const stream = new MediaStream();
      canvasStream.getVideoTracks().forEach((track) => stream.addTrack(track));
      audioDest?.stream?.getAudioTracks?.().forEach((track) => stream.addTrack(track));
      const mime = preferredMime();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : { videoBitsPerSecond: 6_000_000 });
      const chunks = [];
      recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
      const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
      const motion = parseMotion(prompt, negative);
      const began = performance.now();
      recorder.start(250);
      try { await audioContext?.resume?.(); } catch (_) {}
      if (media.kind === 'video' && !extend) await media.element.play().catch(() => {});

      await new Promise((resolve) => {
        const tick = (now) => {
          const elapsed = (now - began) / 1000;
          const progress = clamp(elapsed / duration, 0, 1);
          ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
          drawCover(ctx, media.element, width, height, progress, motion, style, exactMode);
          if (options.showPrompt) drawPromptBadge(ctx, width, height, prompt);
          if (state.abort || elapsed >= duration || (media.kind === 'video' && !extend && media.element.ended)) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });

      try { media.element.pause?.(); } catch (_) {}
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;
      try { sourceNode?.disconnect?.(); } catch (_) {}
      try { audioDest?.disconnect?.(); } catch (_) {}
      try { await audioContext?.close?.(); } catch (_) {}
      canvasStream.getTracks().forEach((t) => t.stop());
      stream.getTracks().forEach((t) => t.stop());
      if (!chunks.length) throw new Error('Рендер не создал видео.');
      const type = recorder.mimeType || mime || 'video/webm';
      return { blob: new Blob(chunks, { type }), type, extension: extensionFor(type), prompt, negative, style, exactMode, duration };
    } finally {
      state.rendering = false;
    }
  }

  function addOutput(blob, name, host = $('#novaProOutputs'), source = 'NOVA Video PRO') {
    if (!host) return;
    const url = rememberUrl(URL.createObjectURL(blob));
    const box = document.createElement('div');
    box.className = 'nova-pro-output';
    box.innerHTML = `<video controls playsinline src="${url}"></video><div class="nova-pro-output-meta"><b>${safeName(name)}</b><span>${(blob.size / 1024 / 1024).toFixed(1)} MB</span></div><div class="nova-media-actions"></div>`;
    const actions = $('.nova-media-actions', box);
    const download = document.createElement('a');
    download.className = 'nova-media-btn';
    download.href = url; download.download = name; download.textContent = '⬇ Скачать';
    download.dataset.novaLibraryOwn = '1';
    actions.appendChild(download);
    if (window.NovaIOSSave?.makePhotoButton && blob.type.startsWith('video/')) {
      actions.appendChild(window.NovaIOSSave.makePhotoButton({ blob, name, label: '📲 В «Фото»', className: 'nova-media-btn primary' }));
    }
    host.prepend(box);
    installPlayerBar($('video', box), name);
    saveToLibrary(blob, name, source).then(() => storageInfo()).catch(() => {});
  }

  async function renderOneFromPro(extend = false) {
    syncSharedInputs();
    const duration = clamp($('#novaProDuration')?.value || 5, 1, 15);
    const style = $('#novaProStyle')?.value || 'motion';
    const ratio = $('#novaProRatio')?.value || '9:16';
    let source = currentSource();
    if (!source) {
      if (extend) throw new Error('Для Extend сначала нужен исходный ролик.');
      source = await makeTextPromptSource(state.prompt, ratio);
      status('TEXT → VIDEO: создал локальный кадр из текста, начинаю motion-рендер…');
    } else {
      status(`${extend ? 'Extend' : 'Motion'}: локальный рендер…`);
    }
    const result = await renderLocalClip({ source, duration, style, ratio, prompt: state.prompt, negative: state.negative, refMode: state.refMode, extend });
    const src = source.generatedFromText ? 'NOVA_TEXT' : (source.file?.name?.replace(/\.[^.]+$/, '') || 'NOVA');
    const name = `${safeName(src)}_${extend ? 'EXTEND' : 'MOTION'}_${style.toUpperCase()}_${duration}s.${result.extension}`;
    addOutput(result.blob, name, $('#novaProOutputs'), source.generatedFromText ? 'NOVA Text to Video FREE' : (extend ? 'NOVA Extend' : 'NOVA Motion Control'));
    status(`✅ ${source.generatedFromText ? 'TEXT → VIDEO' : (extend ? 'Extend' : 'Motion')} готов и сохранён в Медиатеке.`);
  }

  function sceneRows(root = document) {
    return $$('.nova-pro-scene', root).map((row, index) => ({
      index,
      enabled: $('input[type="checkbox"]', row)?.checked !== false,
      style: $('[data-role="style"]', row)?.value || SCENE_DEFAULTS[index]?.style || 'motion',
      prompt: clean($('[data-role="prompt"]', row)?.value || SCENE_DEFAULTS[index]?.prompt || ''),
      duration: clamp($('[data-role="duration"]', row)?.value || $('#novaProDuration')?.value || 5, 1, 15),
      start: clamp($('[data-role="start"]', row)?.value || 0, 0, 9999)
    })).filter((row) => row.enabled);
  }

  async function renderTimeline() {
    syncSharedInputs();
    const rows = sceneRows($('#novaProPane') || document);
    if (!rows.length) throw new Error('Нет включённых сцен.');
    const source = currentSource();
    if (!source) throw new Error('Загрузи reference.');
    const host = $('#novaProOutputs');
    state.abort = false;
    for (let i = 0; i < rows.length; i++) {
      if (state.abort) break;
      const row = rows[i];
      status(`Editor: сцена ${i + 1}/${rows.length} · ${row.style}…`);
      const result = await renderLocalClip({ source, duration: row.duration, start: row.start, style: row.style, ratio: $('#novaProRatio')?.value || '9:16', prompt: row.prompt || state.prompt, negative: state.negative, refMode: state.refMode });
      const src = source.file.name.replace(/\.[^.]+$/, '') || 'NOVA';
      addOutput(result.blob, `${safeName(src)}_SCENE_${row.index + 1}_${row.style.toUpperCase()}.${result.extension}`, host, 'NOVA Editor');
    }
    status(state.abort ? 'Editor: остановлено, готовые сцены сохранены.' : `✅ Editor: ${rows.length} сцен сохранены в Медиатеке.`);
  }

  async function renderFiveLegacy(event) {
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
    syncSharedInputs();
    const file = currentSource();
    if (!file) return status('Multi Shorts: загрузи фото/видео reference или MP4/MOV.');
    const duration = clamp($('#novaShortDuration')?.value || 5, 1, 15);
    const downloads = $('#novaShortDownloads');
    if (downloads) downloads.innerHTML = '';
    state.abort = false;
    for (let index = 0; index < 5; index++) {
      if (state.abort) break;
      const style = $(`.nova-short-style[data-index="${index}"]`)?.value || SCENE_DEFAULTS[index].style;
      const start = clamp($(`.nova-short-start[data-index="${index}"]`)?.value || 0, 0, 9999);
      const ownPrompt = clean($(`.nova-short-prompt[data-index="${index}"]`)?.value || SCENE_DEFAULTS[index].prompt);
      const combinedPrompt = clean(`${state.prompt}. ${ownPrompt}`);
      status(`Multi Shorts PRO ${index + 1}/5: ${style}…`);
      try {
        const result = await renderLocalClip({ source: file, duration, start, style, ratio: '9:16', prompt: combinedPrompt, negative: state.negative, refMode: state.refMode });
        const base = file.file.name.replace(/\.[^.]+$/, '') || 'NOVA';
        const name = `${safeName(base)}_SHORT_${index + 1}_${style.toUpperCase()}.${result.extension}`;
        const url = rememberUrl(URL.createObjectURL(result.blob));
        const link = document.createElement('a');
        link.href = url; link.download = name; link.textContent = `⬇ Short ${index + 1} · ${style}`;
        downloads?.appendChild(link);
        await saveToLibrary(result.blob, name, 'Multi Shorts PRO');
      } catch (error) {
        status(`Multi Shorts сцена ${index + 1}: ${error?.message || error}`);
        return;
      }
    }
    status(state.abort ? 'Multi Shorts остановлено.' : '✅ Multi Shorts PRO: 5 сцен созданы по prompts/references и сохранены в Медиатеке.');
    window.dispatchEvent(new Event('nova-pro-shorts-ready'));
  }

  function syncLegacyReference(file, kind) {
    if (file) setReference(file, kind);
    const target = kind === 'image' ? $('#novaProImageRef') : $('#novaProVideoRef');
    if (target && file) {
      try {
        const dt = new DataTransfer(); dt.items.add(file); target.files = dt.files;
      } catch (_) {}
    }
  }

  function augmentMultiShorts() {
    const pane = $('[data-media-pane="shorts"]');
    if (!pane || $('#novaShortProInputs')) return false;
    const note = $('.nova-media-note', pane);
    const box = document.createElement('div');
    box.id = 'novaShortProInputs';
    box.className = 'nova-pro-augment';
    box.innerHTML = `
      <div class="nova-pro-title"><b>Prompt + References</b><span>EXACT использует исходные пиксели reference как основу.</span></div>
      <div class="nova-media-field"><label>Master prompt</label><textarea id="novaShortMasterPrompt" placeholder="Например: keep the same person, same clothes and scene; cinematic slow push-in…"></textarea></div>
      <div class="nova-media-field"><label>Negative prompt</label><input id="novaShortNegativePrompt" placeholder="no face change, no extra people, no flicker, no text"></div>
      <div class="nova-media-grid"><div class="nova-media-field"><label>Photo reference</label><input id="novaShortImageRef" type="file" accept="image/*"><small class="nova-ref-image-name">Фото не выбрано</small></div><div class="nova-media-field"><label>Video reference</label><input id="novaShortVideoRef" type="file" accept="video/mp4,video/quicktime,video/*,.mp4,.mov"><small class="nova-ref-video-name">Видео не выбрано</small></div></div>
      <div class="nova-media-field"><label>Reference mode</label><select id="novaShortRefMode"><option value="exact">Exact reference — сохранить исходник максимально точно</option><option value="style">Style reference — разрешить цвет/эффект/стилизацию</option></select></div>`;
    note?.insertAdjacentElement('afterend', box);
    $('#novaShortMasterPrompt', box)?.addEventListener('input', (e) => { state.prompt = clean(e.target.value); if ($('#novaProPrompt')) $('#novaProPrompt').value = e.target.value; });
    $('#novaShortNegativePrompt', box)?.addEventListener('input', (e) => { state.negative = clean(e.target.value); if ($('#novaProNegative')) $('#novaProNegative').value = e.target.value; });
    $('#novaShortRefMode', box)?.addEventListener('change', (e) => { state.refMode = e.target.value; if ($('#novaProRefMode')) $('#novaProRefMode').value = e.target.value; updateReferenceLabels(); });
    $('#novaShortImageRef', box)?.addEventListener('change', (e) => syncLegacyReference(e.target.files?.[0], 'image'));
    $('#novaShortVideoRef', box)?.addEventListener('change', (e) => syncLegacyReference(e.target.files?.[0], 'video'));
    $$('.nova-short-card', pane).forEach((card, index) => {
      if ($('.nova-short-prompt', card)) return;
      const label = document.createElement('label');
      label.innerHTML = `<small>Scene prompt</small><textarea class="nova-short-prompt" data-index="${index}" rows="3">${SCENE_DEFAULTS[index].prompt}</textarea>`;
      card.appendChild(label);
    });
    const render = $('#novaShortRenderAll', pane);
    render?.addEventListener('click', renderFiveLegacy, { capture: true });
    const stop = $('#novaShortStop', pane);
    stop?.addEventListener('click', () => { state.abort = true; });
    return true;
  }

  function augmentMotion() {
    const pane = $('[data-media-pane="motion"]');
    if (!pane || $('#novaMotionProInputs')) return false;
    const note = $('.nova-media-note', pane);
    const box = document.createElement('div');
    box.id = 'novaMotionProInputs';
    box.className = 'nova-pro-augment';
    box.innerHTML = `
      <div class="nova-media-field"><label>Motion prompt</label><textarea id="novaMotionPrompt" placeholder="smooth dolly in, pan right, keep face/clothes/background exactly"></textarea></div>
      <div class="nova-media-field"><label>Negative prompt</label><input id="novaMotionNegative" placeholder="no face change, no flicker, no shake"></div>
      <div class="nova-media-grid"><div class="nova-media-field"><label>Photo reference</label><input id="novaMotionImageRef" type="file" accept="image/*"><small class="nova-ref-image-name">Фото не выбрано</small></div><div class="nova-media-field"><label>Video reference</label><input id="novaMotionVideoRef" type="file" accept="video/mp4,video/quicktime,video/*,.mp4,.mov"><small class="nova-ref-video-name">Видео не выбрано</small></div></div>
      <div class="nova-media-field"><label>Reference mode</label><select id="novaMotionRefMode"><option value="exact">Exact reference</option><option value="style">Style reference</option></select></div>
      <div class="nova-media-actions"><button class="nova-media-btn primary" id="novaMotionRenderPro" type="button">🎬 Generate Motion</button><button class="nova-media-btn" id="novaMotionExtendPro" type="button">➕ Extend 5s</button></div>`;
    note?.insertAdjacentElement('afterend', box);
    $('#novaMotionPrompt', box)?.addEventListener('input', (e) => { state.prompt = clean(e.target.value); if ($('#novaProPrompt')) $('#novaProPrompt').value = e.target.value; });
    $('#novaMotionNegative', box)?.addEventListener('input', (e) => { state.negative = clean(e.target.value); if ($('#novaProNegative')) $('#novaProNegative').value = e.target.value; });
    $('#novaMotionRefMode', box)?.addEventListener('change', (e) => { state.refMode = e.target.value; if ($('#novaProRefMode')) $('#novaProRefMode').value = e.target.value; updateReferenceLabels(); });
    $('#novaMotionImageRef', box)?.addEventListener('change', (e) => syncLegacyReference(e.target.files?.[0], 'image'));
    $('#novaMotionVideoRef', box)?.addEventListener('change', (e) => syncLegacyReference(e.target.files?.[0], 'video'));
    $('#novaMotionRenderPro', box)?.addEventListener('click', () => renderOneFromPro(false).catch((e) => status(`Motion: ${e.message || e}`)));
    $('#novaMotionExtendPro', box)?.addEventListener('click', () => renderOneFromPro(true).catch((e) => status(`Extend: ${e.message || e}`)));
    const video = $('#novaMotionPreviewVideo', pane);
    if (video) installPlayerBar(video, 'motion');
    return true;
  }

  function injectStyles() {
    if ($('#novaVideoProStyles')) return;
    const style = document.createElement('style');
    style.id = 'novaVideoProStyles';
    style.textContent = `
      .nova-pro-augment,.nova-pro-section{border:1px solid rgba(82,156,255,.2);border-radius:16px;padding:11px;margin:10px 0;background:rgba(24,80,160,.06)}
      .nova-pro-title{display:flex;gap:8px;align-items:baseline;justify-content:space-between;flex-wrap:wrap}.nova-pro-title span{font-size:11px;color:#83a8d8}.nova-pro-augment textarea,.nova-short-card textarea{width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.13);border-radius:9px;background:#071027;color:#fff;padding:8px;font:inherit;font-size:12px;resize:vertical}
      .nova-pro-layout{display:grid;grid-template-columns:minmax(180px,.8fr) minmax(300px,1.5fr) minmax(220px,1fr);gap:10px}.nova-pro-panel{border:1px solid rgba(255,255,255,.09);border-radius:16px;padding:10px;background:rgba(255,255,255,.035)}
      .nova-pro-preview{position:relative;min-height:300px;background:#01040b;border-radius:16px;overflow:hidden;display:grid;place-items:center}.nova-pro-preview video,.nova-pro-preview img{width:100%;max-height:460px;object-fit:contain;background:#000}.nova-pro-badge{position:absolute;top:9px;left:9px;z-index:3;padding:6px 8px;border-radius:999px;background:rgba(0,0,0,.62);font-size:10px;font-weight:900;color:#bfe7ff}
      .nova-pro-playerbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px;border-radius:12px;background:rgba(2,8,20,.72)}.nova-pro-playerbar button{border:1px solid rgba(90,157,255,.25);border-radius:9px;padding:7px 9px;background:rgba(28,101,205,.15);color:#eef5ff;font-weight:800}.nova-pro-playerbar span{margin-left:auto;font-size:11px;color:#a8c0e7}.nova-pro-playerbar input[type=range]{flex:1 1 140px}.nova-pro-playerbar.compact{margin:7px 0}
      .nova-pro-scenes{display:grid;gap:7px}.nova-pro-scene{display:grid;grid-template-columns:auto 70px 70px 110px minmax(160px,1fr);gap:6px;align-items:center;padding:7px;border-radius:11px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)}.nova-pro-scene input,.nova-pro-scene select{width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:#071027;color:#fff;padding:7px}.nova-pro-scene textarea{min-height:44px;width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:#071027;color:#fff;padding:7px;resize:vertical}
      .nova-pro-outputs{display:grid;gap:10px}.nova-pro-output{border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:9px;background:rgba(255,255,255,.035)}.nova-pro-output video{width:100%;max-height:320px;background:#000;border-radius:10px}.nova-pro-output-meta{display:flex;justify-content:space-between;gap:8px;margin-top:6px;font-size:11px;color:#9bb7df}.nova-pro-output-meta b{color:#e7f1ff;overflow-wrap:anywhere}
      .nova-pro-storage{font-size:11px;color:#9db7dd;margin:6px 0}.nova-pro-ref-list{display:grid;gap:6px}.nova-pro-ref-list small{color:#8ea9cf}.nova-media-tabs{grid-template-columns:repeat(auto-fit,minmax(105px,1fr))!important}
      @media(max-width:900px){.nova-pro-layout{grid-template-columns:1fr}.nova-pro-scene{grid-template-columns:auto 62px 62px 100px}.nova-pro-scene textarea{grid-column:1/-1}.nova-media-card{width:min(960px,100%)}}
      @media(max-width:620px){.nova-pro-playerbar span{width:100%;margin-left:0}.nova-pro-scene{grid-template-columns:auto 1fr 1fr}.nova-pro-scene select{grid-column:1/-1}.nova-pro-scene textarea{grid-column:1/-1}.nova-pro-preview{min-height:220px}}
    `;
    document.head.appendChild(style);
  }

  function sceneHtml(index) {
    const scene = SCENE_DEFAULTS[index];
    return `<div class="nova-pro-scene" data-scene="${index}"><input type="checkbox" checked aria-label="Scene ${index + 1}"><input data-role="start" type="number" min="0" step="0.1" value="${index * 2}"><input data-role="duration" type="number" min="1" max="15" step="1" value="5"><select data-role="style"><option value="cinema"${scene.style === 'cinema' ? ' selected' : ''}>Cinema</option><option value="motion"${scene.style === 'motion' ? ' selected' : ''}>Motion</option><option value="threed"${scene.style === 'threed' ? ' selected' : ''}>3D</option><option value="hologram"${scene.style === 'hologram' ? ' selected' : ''}>Hologram</option><option value="action"${scene.style === 'action' ? ' selected' : ''}>Action</option></select><textarea data-role="prompt">${scene.prompt}</textarea></div>`;
  }

  function addProPane() {
    const modal = $('#novaMediaModal');
    if (!modal || $('#novaProTab')) return false;
    const tabs = $('.nova-media-tabs', modal);
    const card = $('.nova-media-card', modal);
    const statusNode = $('#novaMediaStatus', modal);
    if (!tabs || !card) return false;
    const tab = document.createElement('button');
    tab.id = 'novaProTab'; tab.type = 'button'; tab.className = 'nova-media-tab'; tab.dataset.mediaTab = 'pro'; tab.textContent = '🎥 PRO Editor';
    tabs.appendChild(tab);
    const pane = document.createElement('div');
    pane.id = 'novaProPane'; pane.className = 'nova-media-pane'; pane.dataset.mediaPane = 'pro'; pane.hidden = true;
    pane.innerHTML = `
      <div class="nova-media-note"><b>🎥 NOVA Video PRO</b><br>Единый workflow: Prompt + Photo/Video Reference → Motion Control / Multi Shorts ×5 / Extend / Editor → автоматическое сохранение в Медиатеку. <b>Exact</b> использует исходные пиксели reference и не пытается перерисовать лицо. Локальный режим работает без платных кредитов.</div>
      <div class="nova-pro-layout">
        <div class="nova-pro-panel"><div class="nova-pro-title"><b>1. References</b><span id="novaProExactBadge">EXACT · исходные пиксели</span></div>
          <div class="nova-media-field"><label>Photo</label><input id="novaProImageRef" type="file" accept="image/*"><small class="nova-ref-image-name">Фото не выбрано</small></div>
          <div class="nova-media-field"><label>Video</label><input id="novaProVideoRef" type="file" accept="video/mp4,video/quicktime,video/*,.mp4,.mov"><small class="nova-ref-video-name">Видео не выбрано</small></div>
          <div class="nova-media-field"><label>Reference mode</label><select id="novaProRefMode"><option value="exact">Exact reference</option><option value="style">Style reference</option></select></div>
          <div class="nova-media-actions"><button class="nova-media-btn" id="novaProUseCurrent" type="button">↪ MP4/MOV из Видео</button></div>
          <div class="nova-media-field"><label>Из Медиатеки</label><select id="novaProLibrarySelect"><option value="">Выбрать…</option></select></div>
          <div class="nova-media-actions"><button class="nova-media-btn" id="novaProLoadLibrary" type="button">Загрузить reference</button><button class="nova-media-btn" id="novaProRefreshLibrary" type="button">↻</button></div>
          <div class="nova-pro-storage" id="novaProStorage">Хранилище…</div>
          <div class="nova-media-actions"><button class="nova-media-btn" id="novaProClearTemp" type="button">🧹 Очистить временное</button><button class="nova-media-btn warn" id="novaProDeleteOld" type="button">🗑 Старше 14 дней</button></div>
        </div>
        <div class="nova-pro-panel"><b>2. Player / Preview</b><div class="nova-pro-preview"><span class="nova-pro-badge">PLAY / PAUSE / STOP</span><video id="novaProPlayer" playsinline controls hidden></video><img id="novaProImagePreview" alt="Reference preview" hidden></div>
          <div class="nova-pro-playerbar" id="novaProPlayerBar"><button type="button" data-pro-player="play">▶ Play</button><button type="button" data-pro-player="pause">⏸ Pause</button><button type="button" data-pro-player="stop">⏹ Stop</button><button type="button" data-pro-player="back">−5s</button><button type="button" data-pro-player="forward">+5s</button><input id="novaProSeek" type="range" min="0" max="1" step="0.05" value="0"><span id="novaProTime">0:00 / 0:00</span></div>
        </div>
        <div class="nova-pro-panel"><b>3. Prompt / Render</b>
          <div class="nova-media-field"><label>Prompt</label><textarea id="novaProPrompt" placeholder="Keep the same person, same face, same clothes and background. Smooth cinematic dolly in…"></textarea></div>
          <div class="nova-media-field"><label>Negative prompt</label><textarea id="novaProNegative" placeholder="no face change, no extra people, no flicker, no warped hands, no text"></textarea></div>
          <div class="nova-media-grid"><div class="nova-media-field"><label>Style</label><select id="novaProStyle"><option value="motion">Motion Control</option><option value="cinema">Cinema</option><option value="threed">2.5D look · не Orbit</option><option value="hologram">Hologram</option><option value="action">Action</option></select></div><div class="nova-media-field"><label>Ratio</label><select id="novaProRatio"><option value="9:16">9:16 Shorts</option><option value="16:9">16:9 Cinema</option></select></div></div>
          <div class="nova-media-field"><label>Duration</label><select id="novaProDuration"><option>3</option><option selected>5</option><option>8</option><option>10</option><option>15</option></select></div>
          <div class="nova-media-actions"><button class="nova-media-btn primary" id="novaProMotion" type="button">🎬 Motion</button><button class="nova-media-btn" id="novaProExtend" type="button">➕ Extend</button><button class="nova-media-btn warn" id="novaProStopRender" type="button">⏹ Stop render</button></div>
        </div>
      </div>
      <div class="nova-pro-section"><div class="nova-pro-title"><b>Timeline Editor · 5 scenes</b><span>assets → preview → prompts → timeline</span></div><div class="nova-pro-scenes" id="novaProScenes">${[0,1,2,3,4].map(sceneHtml).join('')}</div><div class="nova-media-actions"><button class="nova-media-btn primary" id="novaProRenderTimeline" type="button">🎞 Render selected scenes</button><button class="nova-media-btn" id="novaProOpenShorts" type="button">📱 Открыть Multi Shorts</button></div></div>
      <div class="nova-pro-section"><b>Outputs → Медиатека</b><div class="nova-pro-outputs" id="novaProOutputs"></div></div>`;
    card.insertBefore(pane, statusNode || null);
    tab.addEventListener('click', () => {
      $$('.nova-media-tab').forEach((b) => b.classList.toggle('active', b === tab));
      $$('[data-media-pane]').forEach((p) => { p.hidden = p !== pane; });
      refreshLibrarySelect().catch(() => {}); storageInfo(); updateProPlayerSource();
    });

    $('#novaProImageRef', pane)?.addEventListener('change', (e) => setReference(e.target.files?.[0], 'image'));
    $('#novaProVideoRef', pane)?.addEventListener('change', (e) => setReference(e.target.files?.[0], 'video'));
    $('#novaProRefMode', pane)?.addEventListener('change', (e) => { state.refMode = e.target.value; updateReferenceLabels(); });
    $('#novaProPrompt', pane)?.addEventListener('input', (e) => { state.prompt = clean(e.target.value); const legacy = $('#novaShortMasterPrompt'); if (legacy) legacy.value = e.target.value; const motion = $('#novaMotionPrompt'); if (motion) motion.value = e.target.value; });
    $('#novaProNegative', pane)?.addEventListener('input', (e) => { state.negative = clean(e.target.value); const legacy = $('#novaShortNegativePrompt'); if (legacy) legacy.value = e.target.value; const motion = $('#novaMotionNegative'); if (motion) motion.value = e.target.value; });
    $('#novaProUseCurrent', pane)?.addEventListener('click', () => useCurrentVideo().catch((e) => status(e.message || e)));
    $('#novaProRefreshLibrary', pane)?.addEventListener('click', () => refreshLibrarySelect().catch(() => {}));
    $('#novaProLoadLibrary', pane)?.addEventListener('click', () => loadLibraryReference($('#novaProLibrarySelect')?.value).catch((e) => status(e.message || e)));
    $('#novaProClearTemp', pane)?.addEventListener('click', () => clearTemporary());
    $('#novaProDeleteOld', pane)?.addEventListener('click', () => deleteOldLibrary(14).catch((e) => status(e.message || e)));
    $('#novaProMotion', pane)?.addEventListener('click', () => renderOneFromPro(false).catch((e) => status(`Motion: ${e.message || e}`)));
    $('#novaProExtend', pane)?.addEventListener('click', () => renderOneFromPro(true).catch((e) => status(`Extend: ${e.message || e}`)));
    $('#novaProStopRender', pane)?.addEventListener('click', () => { state.abort = true; });
    $('#novaProRenderTimeline', pane)?.addEventListener('click', () => renderTimeline().catch((e) => status(`Editor: ${e.message || e}`)));
    $('#novaProOpenShorts', pane)?.addEventListener('click', () => $('#novaMultiShortsTab')?.click());

    const player = $('#novaProPlayer', pane);
    player?.addEventListener('timeupdate', updateTimeUi); player?.addEventListener('loadedmetadata', updateTimeUi); player?.addEventListener('durationchange', updateTimeUi);
    $('#novaProSeek', pane)?.addEventListener('input', (e) => { if (player && !player.hidden) player.currentTime = clamp(e.target.value, 0, player.duration || 0); });
    $('#novaProPlayerBar', pane)?.addEventListener('click', (event) => {
      const action = event.target.closest('button')?.dataset.proPlayer;
      if (!action) return;
      if (action === 'play') playerAction('play');
      if (action === 'pause') playerAction('pause');
      if (action === 'stop') playerAction('stop');
      if (action === 'back') playerAction('seek', -5);
      if (action === 'forward') playerAction('seek', 5);
    });
    refreshLibrarySelect().catch(() => {}); storageInfo(); updateReferenceLabels();
    return true;
  }

  function installLibraryReuseButtons() {
    const enhance = async () => {
      const list = $('#novaLibraryList');
      if (!list) return;
      const rows = await libraryRecords().catch(() => []);
      $$('.nova-library-item', list).forEach((item) => {
        if ($('[data-nova-use-reference]', item)) return;
        const name = $('.nova-library-name', item)?.textContent || '';
        const record = rows.find((row) => row.name === name);
        if (!record || !['video', 'image'].includes(inferKind(record))) return;
        const actions = $('.nova-library-actions', item);
        if (!actions) return;
        const button = document.createElement('button');
        button.type = 'button'; button.dataset.novaUseReference = '1'; button.textContent = '↪ Reference';
        button.addEventListener('click', () => loadLibraryReference(record.id).then(() => $('#novaProTab')?.click()).catch((e) => status(e.message || e)));
        actions.insertBefore(button, actions.firstChild);
      });
    };
    enhance();
    const observer = new MutationObserver(() => enhance());
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function installExistingPlayerBars() {
    ['#novaLocalPreview', '#novaMotionPreviewVideo'].forEach((selector) => {
      const video = $(selector);
      if (video) installPlayerBar(video, selector.slice(1));
    });
  }

  function install() {
    injectStyles();
    const attempt = () => {
      const modal = $('#novaMediaModal');
      if (!modal) return false;
      addProPane();
      augmentMultiShorts();
      augmentMotion();
      installExistingPlayerBars();
      installLibraryReuseButtons();
      return Boolean($('#novaProTab'));
    };
    if (attempt()) return;
    const observer = new MutationObserver(() => { if (attempt()) observer.disconnect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.NovaVideoPro = Object.freeze({
    version: '31.2.0',
    renderLocalClip,
    renderTimeline,
    renderFive: () => renderFiveLegacy(),
    useCurrentVideo,
    loadLibraryReference,
    clearTemporary,
    stop() { state.abort = true; },
    requestsTrue3D,
    getState() { return { prompt: state.prompt, negative: state.negative, refMode: state.refMode, hasImage: Boolean(state.imageRef), hasVideo: Boolean(state.videoRef), rendering: state.rendering }; }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();