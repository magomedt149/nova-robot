(() => {
  'use strict';

  if (window.__novaMultiShortsInstalled) return;
  window.__novaMultiShortsInstalled = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const generatedUrls = [];
  let sourceObjectUrl = '';
  let sourceDuration = 0;
  let renderAbort = false;

  const SCENES = [
    { name: 'CINEMA', style: 'cinema', label: 'Cinema push-in' },
    { name: 'MOTION', style: 'motion', label: 'Motion Control pan' },
    { name: '3D', style: 'threed', label: '3D depth look' },
    { name: 'HOLO', style: 'hologram', label: 'Hologram' },
    { name: 'ACTION', style: 'action', label: 'Action / dynamic' }
  ];

  function status(message) {
    const local = $('#novaMediaStatus');
    if (local) local.textContent = message;
    const global = $('#statusText');
    if (global) global.textContent = message;
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function revokeGenerated() {
    generatedUrls.splice(0).forEach((url) => URL.revokeObjectURL(url));
  }

  function waitFor(target, event) {
    return new Promise((resolve, reject) => {
      const onOk = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error(`Видео: событие ${event} не удалось.`)); };
      const cleanup = () => {
        target.removeEventListener(event, onOk);
        target.removeEventListener('error', onError);
      };
      target.addEventListener(event, onOk, { once: true });
      target.addEventListener('error', onError, { once: true });
    });
  }

  function ensureStyles() {
    if ($('#novaMultiShortsStyles')) return;
    const style = document.createElement('style');
    style.id = 'novaMultiShortsStyles';
    style.textContent = `
      .nova-shorts-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px;margin:9px 0}
      .nova-short-card{display:grid;gap:6px;padding:9px;border:1px solid rgba(255,255,255,.1);border-radius:13px;background:rgba(255,255,255,.045)}
      .nova-short-card b{font-size:11px;color:#c9dbf5}.nova-short-card small{font-size:10px;color:#7f9fc9}
      .nova-short-card input,.nova-short-card select{width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.13);border-radius:9px;background:#071027;color:white;padding:7px;font:inherit;font-size:12px}
      .nova-shorts-preview{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin:9px 0}.nova-shorts-preview .shot{aspect-ratio:9/16;border-radius:10px;overflow:hidden;background:linear-gradient(180deg,#111a38,#02050c);border:1px solid rgba(117,171,255,.18);display:grid;place-items:center;text-align:center;padding:7px;color:#adc4e8;font-size:10px}
      .nova-shorts-progress{font-size:12px;color:#a9c3e8;min-height:18px;margin:7px 0}.nova-shorts-downloads{display:flex;flex-wrap:wrap;gap:7px;margin:8px 0}.nova-shorts-downloads a{display:inline-flex;padding:9px 11px;border-radius:11px;background:rgba(34,129,255,.18);border:1px solid rgba(78,157,255,.3);color:#e4efff;text-decoration:none;font-weight:800;font-size:12px}
      @media(max-width:760px){.nova-shorts-grid{grid-template-columns:1fr 1fr}.nova-shorts-preview{grid-template-columns:repeat(5,minmax(64px,1fr));overflow-x:auto}.nova-shorts-preview .shot{min-width:64px}}
    `;
    document.head.appendChild(style);
  }

  function injectPane(modal) {
    if ($('#novaMultiShortsTab')) return true;
    const tabs = $('.nova-media-tabs', modal);
    const card = $('.nova-media-card', modal);
    const statusNode = $('#novaMediaStatus', modal);
    if (!tabs || !card) return false;

    const tab = document.createElement('button');
    tab.id = 'novaMultiShortsTab';
    tab.className = 'nova-media-tab';
    tab.type = 'button';
    tab.dataset.mediaTab = 'shorts';
    tab.textContent = '📱 Multi Shorts ×5';
    tabs.appendChild(tab);
    tabs.style.gridTemplateColumns = 'repeat(5,1fr)';

    const pane = document.createElement('div');
    pane.className = 'nova-media-pane';
    pane.dataset.mediaPane = 'shorts';
    pane.hidden = true;
    pane.innerHTML = `
      <div class="nova-media-note"><b>📱 Multi Shorts — 5 разных сцен</b><br>
      NOVA берёт выбранное MP4/MOV, автоматически раскладывает его на пять вертикальных сцен 9:16 и локально рендерит пять разных вариантов: Cinema, Motion Control, 3D-look, Hologram и Action. Если после Whisper есть исправленный English SRT, он может быть вписан в каждый Short. Это локальный монтаж/эффекты, а не генерация новых людей или новых кадров нейросетью.</div>
      <div class="nova-media-grid">
        <div class="nova-media-field"><label for="novaShortDuration">Длительность каждой сцены</label><select id="novaShortDuration"><option value="3">3 сек</option><option value="5" selected>5 сек</option><option value="8">8 сек</option><option value="10">10 сек</option></select></div>
        <div class="nova-media-field"><label for="novaShortCaptions">English subtitles</label><select id="novaShortCaptions"><option value="on" selected>Вписать снизу</option><option value="off">Без субтитров</option></select></div>
      </div>
      <div class="nova-media-field"><label for="novaShortTitle">Текст сверху (необязательно)</label><input id="novaShortTitle" maxlength="80" placeholder="Например: NOVA CINEMA"></div>
      <div class="nova-shorts-grid" id="novaShortSceneGrid"></div>
      <div class="nova-media-actions"><button class="nova-media-btn" id="novaShortAutoPlan" type="button">🧩 Авто 5 сцен</button><button class="nova-media-btn primary" id="novaShortRenderAll" type="button">🎬 Сгенерировать 5 Shorts</button><button class="nova-media-btn warn" id="novaShortStop" type="button">⏹ Стоп</button></div>
      <div class="nova-shorts-preview" id="novaShortPreviewStrip"></div>
      <div class="nova-shorts-progress" id="novaShortProgress">Выбери MP4/MOV во вкладке «Видео», затем нажми «Авто 5 сцен».</div>
      <div class="nova-shorts-downloads" id="novaShortDownloads"></div>`;
    card.insertBefore(pane, statusNode || null);

    const grid = $('#novaShortSceneGrid', pane);
    const strip = $('#novaShortPreviewStrip', pane);
    SCENES.forEach((scene, index) => {
      const item = document.createElement('div');
      item.className = 'nova-short-card';
      item.innerHTML = `<b>${index + 1}. ${scene.name}</b><small>${scene.label}</small><label><small>Старт, сек</small><input class="nova-short-start" data-index="${index}" type="number" min="0" step="0.1" value="0"></label><label><small>Стиль</small><select class="nova-short-style" data-index="${index}"><option value="cinema"${scene.style === 'cinema' ? ' selected' : ''}>Cinema</option><option value="motion"${scene.style === 'motion' ? ' selected' : ''}>Motion Control</option><option value="threed"${scene.style === 'threed' ? ' selected' : ''}>3D look</option><option value="hologram"${scene.style === 'hologram' ? ' selected' : ''}>Hologram</option><option value="action"${scene.style === 'action' ? ' selected' : ''}>Action</option></select></label>`;
      grid.appendChild(item);
      const preview = document.createElement('div');
      preview.className = 'shot';
      preview.dataset.index = String(index);
      preview.innerHTML = `<b>${scene.name}</b><span>scene ${index + 1}</span>`;
      strip.appendChild(preview);
    });

    tab.addEventListener('click', () => selectTab('shorts'));
    $('#novaShortAutoPlan', pane)?.addEventListener('click', () => autoPlan().catch((error) => status(`Multi Shorts: ${error.message || error}`)));
    $('#novaShortRenderAll', pane)?.addEventListener('click', () => renderAll().catch((error) => status(`Multi Shorts: ${error.message || error}`)));
    $('#novaShortStop', pane)?.addEventListener('click', () => { renderAbort = true; status('Multi Shorts: остановлено пользователем.'); });
    return true;
  }

  function selectTab(name) {
    document.querySelectorAll('[data-media-tab]').forEach((button) => button.classList.toggle('active', button.dataset.mediaTab === name));
    document.querySelectorAll('[data-media-pane]').forEach((pane) => { pane.hidden = pane.dataset.mediaPane !== name; });
  }

  function currentFile() {
    return $('#novaLocalVideo')?.files?.[0] || null;
  }

  async function getDuration(file) {
    if (!file) throw new Error('Сначала выбери MP4/MOV во вкладке «Видео».');
    if (sourceObjectUrl) URL.revokeObjectURL(sourceObjectUrl);
    sourceObjectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.playsInline = true;
    video.src = sourceObjectUrl;
    await waitFor(video, 'loadedmetadata');
    sourceDuration = Number(video.duration || 0);
    if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) throw new Error('Не удалось определить длительность видео.');
    return sourceDuration;
  }

  function sceneDuration() {
    return clamp($('#novaShortDuration')?.value || 5, 1, 15);
  }

  async function autoPlan() {
    const file = currentFile();
    const duration = await getDuration(file);
    const clip = Math.min(sceneDuration(), duration);
    const maxStart = Math.max(0, duration - clip);
    const positions = maxStart > 0
      ? [0, 0.23, 0.46, 0.69, 1].map((ratio) => maxStart * ratio)
      : [0, 0, 0, 0, 0];
    document.querySelectorAll('.nova-short-start').forEach((input, index) => {
      input.max = String(Math.max(0, duration - 0.25));
      input.value = positions[index].toFixed(1);
    });
    const progress = $('#novaShortProgress');
    if (progress) progress.textContent = `План готов: ${duration.toFixed(1)} сек → 5 сцен по ${clip.toFixed(1)} сек. Можно поправить старт каждой сцены.`;
    status('✅ Multi Shorts: пять разных сцен автоматически расставлены по видео.');
  }

  async function englishCues() {
    if ($('#novaShortCaptions')?.value === 'off') return [];
    try {
      const session = window.NovaTranscriptEditor?.getSession?.();
      if (session?.rows?.length) {
        return session.rows.map((row) => ({
          start: Number(row.start || 0),
          end: Number(row.end || (Number(row.start || 0) + Number(row.duration || 0))),
          text: cleanText(row.enText || '')
        })).filter((row) => row.text && row.end > row.start);
      }
    } catch (_) {}

    const links = [...document.querySelectorAll('#novaDubDownloads a')];
    const link = links.find((a) => a.textContent.includes('English SRT · исправленный'))
      || links.find((a) => a.textContent.includes('English SRT'));
    if (!link?.href) return [];
    try {
      const response = await fetch(link.href);
      if (!response.ok) return [];
      const raw = (await response.text()).replace(/\r/g, '').trim();
      return raw.split(/\n\s*\n/).map((block) => {
        const lines = block.split('\n').filter(Boolean);
        const timing = lines.findIndex((line) => line.includes('-->'));
        if (timing < 0) return null;
        const parse = (value) => {
          const parts = String(value).trim().replace(',', '.').split(':').map(Number);
          return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : 0;
        };
        const [a, b] = lines[timing].split('-->').map((v) => v.trim().split(/\s+/)[0]);
        const start = parse(a);
        const end = parse(b);
        const text = cleanText(lines.slice(timing + 1).join(' ').replace(/<[^>]+>/g, ''));
        return text && end > start ? { start, end, text } : null;
      }).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  function wrapLines(ctx, text, maxWidth, maxLines = 3) {
    const words = cleanText(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) line = candidate;
      else {
        lines.push(line);
        line = word;
        if (lines.length >= maxLines - 1) break;
      }
    }
    if (line && lines.length < maxLines) {
      const used = lines.join(' ').split(/\s+/).filter(Boolean).length;
      const remaining = words.slice(used).join(' ');
      lines.push(remaining || line);
    }
    if (lines.length === maxLines && lines.join(' ').split(/\s+/).length < words.length) lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.…]+$/, '')}…`;
    return lines;
  }

  function drawCover(ctx, video, width, height, scale = 1, offsetX = 0, offsetY = 0, alpha = 1) {
    const vw = video.videoWidth || width;
    const vh = video.videoHeight || height;
    const base = Math.max(width / vw, height / vh) * scale;
    const dw = vw * base;
    const dh = vh * base;
    const x = (width - dw) / 2 + offsetX;
    const y = (height - dh) / 2 + offsetY;
    ctx.globalAlpha = alpha;
    ctx.drawImage(video, x, y, dw, dh);
    ctx.globalAlpha = 1;
  }

  function drawStyle(ctx, video, width, height, style, progress) {
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    const ease = 0.5 - Math.cos(Math.PI * clamp(progress, 0, 1)) / 2;

    if (style === 'cinema') {
      ctx.filter = 'contrast(1.13) saturate(.9) brightness(.94)';
      drawCover(ctx, video, width, height, 1.03 + ease * 0.09, 0, -8 * ease);
      ctx.filter = 'none';
      const grad = ctx.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, 'rgba(0,0,0,.18)'); grad.addColorStop(.45, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,.24)');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, width, height);
    } else if (style === 'motion') {
      ctx.filter = 'contrast(1.05) saturate(1.05)';
      drawCover(ctx, video, width, height, 1.04 + ease * 0.14, (-22 + 44 * ease), -10 * Math.sin(progress * Math.PI));
    } else if (style === 'threed') {
      ctx.filter = 'contrast(1.1) saturate(1.08)';
      drawCover(ctx, video, width, height, 1.07 + ease * 0.06, -7, 0, .38);
      ctx.globalCompositeOperation = 'screen';
      ctx.filter = 'hue-rotate(155deg) saturate(1.8)';
      drawCover(ctx, video, width, height, 1.07 + ease * 0.06, 7, 0, .32);
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'none';
      drawCover(ctx, video, width, height, 1.05 + ease * 0.05, 0, 0, .86);
    } else if (style === 'hologram') {
      ctx.filter = 'hue-rotate(145deg) saturate(1.85) contrast(1.18) brightness(.96)';
      drawCover(ctx, video, width, height, 1.04 + Math.sin(progress * Math.PI * 2) * 0.015, 0, 0, .82);
      ctx.filter = 'none';
      ctx.fillStyle = 'rgba(80,220,255,.08)'; ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(120,235,255,.12)';
      for (let y = 0; y < height; y += 9) ctx.fillRect(0, y, width, 1);
    } else {
      ctx.filter = 'contrast(1.18) saturate(1.12) brightness(.96)';
      const pulse = Math.sin(progress * Math.PI * 4) * 0.012;
      drawCover(ctx, video, width, height, 1.08 + ease * 0.13 + pulse, 25 * Math.sin(progress * Math.PI * 2), -12 * ease);
      ctx.filter = 'none';
    }
    ctx.restore();
  }

  function drawText(ctx, width, height, title, cueText) {
    if (title) {
      ctx.save();
      ctx.font = '900 32px system-ui,-apple-system,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.shadowColor = 'rgba(0,0,0,.75)'; ctx.shadowBlur = 8;
      ctx.fillStyle = '#fff';
      ctx.fillText(title, width / 2, 50, width * .84);
      ctx.restore();
    }
    if (!cueText) return;
    ctx.save();
    ctx.font = '900 34px system-ui,-apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = wrapLines(ctx, cueText, width * .84, 3);
    const lineHeight = 42;
    const boxHeight = lines.length * lineHeight + 24;
    const boxY = height - 170 - boxHeight;
    ctx.fillStyle = 'rgba(0,0,0,.52)';
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(width * .06, boxY, width * .88, boxHeight, 14);
      ctx.fill();
    } else {
      ctx.fillRect(width * .06, boxY, width * .88, boxHeight);
    }
    ctx.fillStyle = '#fff';
    ctx.shadowColor = '#000'; ctx.shadowBlur = 5;
    lines.forEach((line, index) => ctx.fillText(line, width / 2, boxY + 18 + lineHeight * (index + .5), width * .82));
    ctx.restore();
  }

  function preferredMime() {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    return candidates.find((type) => MediaRecorder.isTypeSupported?.(type)) || '';
  }

  async function renderScene(file, index, cues) {
    const startInput = document.querySelector(`.nova-short-start[data-index="${index}"]`);
    const styleInput = document.querySelector(`.nova-short-style[data-index="${index}"]`);
    const start = clamp(startInput?.value || 0, 0, Math.max(0, sourceDuration - 0.1));
    const duration = Math.max(0.3, Math.min(sceneDuration(), sourceDuration - start));
    const style = styleInput?.value || SCENES[index].style;
    const title = cleanText($('#novaShortTitle')?.value || '');

    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.src = url;
    video.playsInline = true;
    video.preload = 'auto';
    await waitFor(video, 'loadedmetadata');
    video.currentTime = Math.min(start, Math.max(0, Number(video.duration || sourceDuration) - 0.05));
    await waitFor(video, 'seeked');

    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 1280;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const canvasStream = canvas.captureStream?.(30);
    if (!canvasStream) throw new Error('Этот браузер не поддерживает запись Canvas.');

    let audioContext = null;
    let mediaSource = null;
    let audioDestination = null;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        audioContext = new Ctx();
        mediaSource = audioContext.createMediaElementSource(video);
        audioDestination = audioContext.createMediaStreamDestination();
        mediaSource.connect(audioDestination);
      }
    } catch (_) {}

    const combined = new MediaStream();
    canvasStream.getVideoTracks().forEach((track) => combined.addTrack(track));
    audioDestination?.stream?.getAudioTracks?.().forEach((track) => combined.addTrack(track));
    const hasAudio = combined.getAudioTracks().length > 0;
    const mimeType = preferredMime();
    const recorder = new MediaRecorder(combined, mimeType ? { mimeType, videoBitsPerSecond: 5_000_000 } : { videoBitsPerSecond: 5_000_000 });
    const chunks = [];
    recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    const stopped = new Promise((resolve) => { recorder.onstop = resolve; });

    const begin = performance.now();
    recorder.start(250);
    try { await audioContext?.resume?.(); } catch (_) {}
    await video.play();

    await new Promise((resolve) => {
      const tick = (now) => {
        const elapsed = (now - begin) / 1000;
        const progress = clamp(elapsed / duration, 0, 1);
        drawStyle(ctx, video, canvas.width, canvas.height, style, progress);
        const sourceTime = start + elapsed;
        const cue = cues.find((item) => sourceTime >= item.start && sourceTime < item.end);
        drawText(ctx, canvas.width, canvas.height, title, cue?.text || '');
        if (renderAbort || elapsed >= duration || video.ended) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    try { video.pause(); } catch (_) {}
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
    try { mediaSource?.disconnect(); } catch (_) {}
    try { audioDestination?.disconnect?.(); } catch (_) {}
    try { await audioContext?.close?.(); } catch (_) {}
    canvasStream.getTracks().forEach((track) => track.stop());
    URL.revokeObjectURL(url);

    if (!chunks.length) throw new Error(`Сцена ${index + 1}: MediaRecorder не записал данные.`);
    const type = recorder.mimeType || mimeType || 'video/webm';
    const extension = type.includes('mp4') ? 'mp4' : 'webm';
    return { blob: new Blob(chunks, { type }), extension, style, start, duration, hasAudio };
  }

  function addDownload(result, index, file) {
    const downloads = $('#novaShortDownloads');
    if (!downloads) return;
    const url = URL.createObjectURL(result.blob);
    generatedUrls.push(url);
    const link = document.createElement('a');
    const base = file.name.replace(/\.[^.]+$/, '') || 'NOVA';
    link.href = url;
    link.download = `${base}_SHORT_${index + 1}_${result.style.toUpperCase()}.${result.extension}`;
    link.textContent = `⬇ Short ${index + 1} · ${result.style} · ${result.extension.toUpperCase()}`;
    downloads.appendChild(link);
    const preview = $(`.nova-shorts-preview .shot[data-index="${index}"]`);
    if (preview) preview.innerHTML = `<b>✅ ${SCENES[index].name}</b><span>${result.start.toFixed(1)}–${(result.start + result.duration).toFixed(1)}s${result.hasAudio ? ' · audio' : ' · no audio'}</span>`;
  }

  async function renderAll() {
    const file = currentFile();
    if (!file) throw new Error('Сначала выбери MP4/MOV во вкладке «Видео».');
    if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder недоступен в этом браузере.');
    renderAbort = false;
    revokeGenerated();
    const downloads = $('#novaShortDownloads');
    if (downloads) downloads.innerHTML = '';
    if (!sourceDuration) await autoPlan();
    const cues = await englishCues();
    const progress = $('#novaShortProgress');

    for (let index = 0; index < SCENES.length; index++) {
      if (renderAbort) break;
      const label = document.querySelector(`.nova-short-style[data-index="${index}"]`)?.value || SCENES[index].style;
      if (progress) progress.textContent = `Рендер ${index + 1}/5: ${label}… Не закрывай NOVA.`;
      status(`Multi Shorts ${index + 1}/5: ${label}…`);
      const result = await renderScene(file, index, cues);
      addDownload(result, index, file);
    }

    if (renderAbort) {
      if (progress) progress.textContent = 'Рендер остановлен. Уже готовые Shorts сохранены ниже.';
      return;
    }
    if (progress) progress.textContent = `✅ Готово: 5 разных вертикальных Shorts. English subtitles: ${cues.length ? 'использованы из текущего исправленного текста' : 'не найдены/отключены'}.`;
    status('✅ Multi Shorts: пять разных сцен сгенерированы локально без платных кредитов.');
  }

  function installWhenReady() {
    const install = () => {
      const modal = $('#novaMediaModal');
      if (!modal) return false;
      ensureStyles();
      return injectPane(modal);
    };
    if (install()) return;
    const observer = new MutationObserver(() => { if (install()) observer.disconnect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installWhenReady, { once: true });
  else installWhenReady();

  window.NovaMultiShorts = Object.freeze({
    autoPlan,
    renderAll,
    stop() { renderAbort = true; },
    sceneCount: 5
  });
})();