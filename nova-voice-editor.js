(() => {
  'use strict';

  if (window.__novaVoiceEditorInstalled) return;
  window.__novaVoiceEditorInstalled = true;

  const LAME_URL = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';
  const $ = (selector, root = document) => root.querySelector(selector);
  const objectUrls = [];
  let session = null;

  function status(message) {
    const media = $('#novaMediaStatus');
    if (media) media.textContent = message;
    const global = $('#statusText');
    if (global) global.textContent = message;
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function parseTimecode(value) {
    const parts = String(value || '').trim().replace(',', '.').split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return Number(parts[0]) || 0;
  }

  function parseSrt(text) {
    return String(text || '').replace(/\r/g, '').trim().split(/\n\s*\n/).map((block) => {
      const lines = block.split('\n').filter(Boolean);
      const timing = lines.findIndex((line) => line.includes('-->'));
      if (timing < 0) return null;
      const [a, b] = lines[timing].split('-->').map((v) => v.trim().split(/\s+/)[0]);
      const start = parseTimecode(a);
      const end = parseTimecode(b);
      const textValue = cleanText(lines.slice(timing + 1).join(' ').replace(/<[^>]+>/g, ''));
      return textValue && end > start ? { start, duration: end - start, text: textValue } : null;
    }).filter(Boolean);
  }

  function parseRussianResult(text) {
    return String(text || '').split(/\n/).map((line) => {
      const match = line.match(/^\s*(\d+)\.\s+\[[^\]]+\]\s+(?:♂|♀)\s+(Денис|Ирина)(?:\s+·\s+\d+\s+Hz)?\s*:\s*(.*)$/i);
      if (!match) return null;
      return {
        index: Number(match[1]) - 1,
        voice: /денис/i.test(match[2]) ? 'denis' : 'irina',
        text: cleanText(match[3])
      };
    }).filter(Boolean);
  }

  function formatShortTime(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    const m = Math.floor(value / 60);
    const s = value - m * 60;
    return `${m}:${s.toFixed(2).padStart(5, '0')}`;
  }

  function ensureStyles() {
    if ($('#novaVoiceEditorStyles')) return;
    const style = document.createElement('style');
    style.id = 'novaVoiceEditorStyles';
    style.textContent = `
      .nova-voice-editor{margin:12px 0;padding:12px;border:1px solid rgba(125,174,255,.22);border-radius:16px;background:rgba(7,14,34,.72)}
      .nova-voice-editor h3{margin:0 0 6px;font-size:15px}.nova-voice-editor-note{font-size:12px;color:#a9bee0;margin-bottom:8px}
      .nova-voice-editor-list{display:grid;gap:7px;max-height:310px;overflow:auto}.nova-voice-row{display:grid;grid-template-columns:92px 112px 1fr;gap:7px;align-items:start;padding:8px;border-radius:12px;background:rgba(255,255,255,.045)}
      .nova-voice-time{font-size:11px;color:#88a4cf;padding-top:8px}.nova-voice-select{width:100%;border:1px solid rgba(255,255,255,.15);border-radius:10px;background:#081127;color:#fff;padding:7px}.nova-voice-text{font-size:13px;line-height:1.38;color:#edf4ff;padding-top:5px}
      .nova-voice-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}.nova-voice-actions button{border:0;border-radius:11px;padding:9px 11px;background:rgba(255,255,255,.1);color:white;font-weight:800}.nova-voice-actions .primary{background:linear-gradient(135deg,#177cff,#7448ff)}
      @media(max-width:620px){.nova-voice-row{grid-template-columns:78px 104px 1fr}.nova-voice-text{font-size:12px}}
    `;
    document.head.appendChild(style);
  }

  function assertTimings(reference, edited) {
    if (reference.length !== edited.length) throw new Error('Число реплик изменилось.');
    for (let i = 0; i < reference.length; i++) {
      if (Number(reference[i].start) !== Number(edited[i].start) || Number(reference[i].duration) !== Number(edited[i].duration)) {
        throw new Error('Тайминг был изменён.');
      }
    }
  }

  async function loadTextFromDownload(labelPart) {
    const links = [...document.querySelectorAll('#novaDubDownloads a')];
    const link = links.find((item) => item.textContent.includes(labelPart));
    if (!link?.href) return '';
    const response = await fetch(link.href);
    return response.ok ? response.text() : '';
  }

  function voiceName(value) {
    return value === 'denis' ? 'Денис' : 'Ирина';
  }

  function renderEditor() {
    ensureStyles();
    const downloads = $('#novaDubDownloads');
    if (!downloads || !session) return;
    let root = $('#novaVoiceEditor');
    if (!root) {
      root = document.createElement('section');
      root.id = 'novaVoiceEditor';
      root.className = 'nova-voice-editor';
      downloads.insertAdjacentElement('afterend', root);
    }

    root.innerHTML = `
      <h3>🎭 Исправить голоса вручную</h3>
      <div class="nova-voice-editor-note">Автоопределение уже выполнено. Можно поменять отдельную реплику на Дениса или Ирину. Текст, английские субтитры, начало и длительность реплики не меняются.</div>
      <div class="nova-voice-editor-list"></div>
      <div class="nova-voice-actions"><button id="novaVoiceRebuild" class="primary" type="button">Пересобрать MP3</button><button id="novaVoiceReset" type="button">Сбросить к авто</button></div>`;

    const list = $('.nova-voice-editor-list', root);
    session.edited.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'nova-voice-row';
      row.innerHTML = `
        <div class="nova-voice-time">${formatShortTime(item.start)}–${formatShortTime(item.start + item.duration)}</div>
        <select class="nova-voice-select" data-index="${index}" aria-label="Голос реплики ${index + 1}">
          <option value="irina"${item.voice === 'irina' ? ' selected' : ''}>♀ Ирина</option>
          <option value="denis"${item.voice === 'denis' ? ' selected' : ''}>♂ Денис</option>
        </select>
        <div class="nova-voice-text">${escapeHtml(item.text)}</div>`;
      list.appendChild(row);
    });

    list.addEventListener('change', (event) => {
      const select = event.target.closest('.nova-voice-select');
      if (!select) return;
      const index = Number(select.dataset.index);
      if (!session?.edited[index]) return;
      session.edited[index].voice = select.value === 'denis' ? 'denis' : 'irina';
      session.edited[index].speaker = voiceName(session.edited[index].voice);
      session.manualChanges = true;
      assertTimings(session.reference, session.edited);
      status(`Реплика ${index + 1}: выбран голос ${voiceName(session.edited[index].voice)}. Тайминг не изменён.`);
    });

    $('#novaVoiceReset', root).addEventListener('click', () => {
      session.edited = session.auto.map((item) => ({ ...item }));
      session.manualChanges = false;
      renderEditor();
      status('Автоматическое назначение голосов восстановлено.');
    });

    $('#novaVoiceRebuild', root).addEventListener('click', () => rebuildMp3().catch((error) => status(`Ошибка пересборки: ${error.message || error}`)));
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  }

  async function captureSession() {
    const result = $('#novaDubResult');
    if (!result) return;
    const detected = parseRussianResult(result.textContent);
    if (!detected.length) return;
    const rawSrtText = await loadTextFromDownload('Original transcript SRT');
    const reference = parseSrt(rawSrtText);
    if (!reference.length || reference.length !== detected.length) return;

    const auto = reference.map((segment, index) => ({
      start: segment.start,
      duration: segment.duration,
      text: detected[index]?.text || segment.text,
      voice: detected[index]?.voice || 'irina',
      speaker: voiceName(detected[index]?.voice || 'irina')
    }));
    assertTimings(reference, auto);
    session = {
      reference: reference.map((item) => ({ ...item })),
      auto: auto.map((item) => ({ ...item })),
      edited: auto.map((item) => ({ ...item })),
      manualChanges: false,
      base: ($('#novaLocalVideo')?.files?.[0]?.name || 'NOVA_video').replace(/\.[^.]+$/, '') || 'NOVA_video'
    };
    renderEditor();
    status('✅ Голоса распознаны. Теперь любую реплику можно вручную переключить между Ириной и Денисом.');
  }

  async function decodeTts(blob, ctx) {
    const buffer = await ctx.decodeAudioData((await blob.arrayBuffer()).slice(0));
    return new Float32Array(buffer.getChannelData(0));
  }

  function joinParts(parts, sampleRate) {
    const silence = Math.round(sampleRate * 0.04);
    const total = parts.reduce((sum, part) => sum + part.length, 0) + Math.max(0, parts.length - 1) * silence;
    const out = new Float32Array(total);
    let offset = 0;
    parts.forEach((part, index) => {
      out.set(part, offset);
      offset += part.length;
      if (index < parts.length - 1) offset += silence;
    });
    return out;
  }

  function fitSamples(samples, frames) {
    const target = Math.max(1, Number(frames) || 1);
    if (!samples.length) return new Float32Array(target);
    if (samples.length === target) return samples;
    const out = new Float32Array(target);
    const ratio = (samples.length - 1) / Math.max(1, target - 1);
    for (let i = 0; i < target; i++) {
      const p = i * ratio;
      const a = Math.floor(p);
      const b = Math.min(samples.length - 1, a + 1);
      const t = p - a;
      out[i] = samples[a] * (1 - t) + samples[b] * t;
    }
    return out;
  }

  function loadScript(src, id) {
    if (document.getElementById(id)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.id = id;
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error('MP3-кодек не загрузился.'));
      document.head.appendChild(script);
    });
  }

  async function encodeMp3(samples, sampleRate) {
    if (!window.lamejs) await loadScript(LAME_URL, 'nova-voice-editor-lame');
    if (!window.lamejs) throw new Error('MP3-кодек недоступен.');
    const encoder = new window.lamejs.Mp3Encoder(1, sampleRate, 128);
    const chunks = [];
    for (let i = 0; i < samples.length; i += 1152) {
      const slice = samples.subarray(i, Math.min(samples.length, i + 1152));
      const pcm = new Int16Array(slice.length);
      for (let j = 0; j < slice.length; j++) pcm[j] = Math.max(-32768, Math.min(32767, Math.round(slice[j] * 32767)));
      const data = encoder.encodeBuffer(pcm);
      if (data.length) chunks.push(new Uint8Array(data));
    }
    const end = encoder.flush();
    if (end.length) chunks.push(new Uint8Array(end));
    return new Blob(chunks, { type: 'audio/mpeg' });
  }

  async function rebuildMp3() {
    if (!session?.edited?.length) throw new Error('Сначала обработай видео через Whisper.');
    const tts = window.NovaRussianTTS;
    if (!tts?.synthesize) throw new Error('Piper Ирина/Денис не загружен.');
    assertTimings(session.reference, session.edited);
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('AudioContext недоступен.');
    const ctx = new Ctx();
    try {
      const sampleRate = ctx.sampleRate;
      const totalSeconds = Math.max(1, ...session.edited.map((item) => item.start + item.duration));
      const timeline = new Float32Array(Math.ceil(totalSeconds * sampleRate));
      for (let i = 0; i < session.edited.length; i++) {
        const item = session.edited[i];
        status(`Пересобираю ${i + 1}/${session.edited.length}: ${voiceName(item.voice)}…`);
        const blobs = await tts.synthesize(item.text, item.voice);
        const pieces = [];
        for (const blob of blobs) pieces.push(await decodeTts(blob, ctx));
        const raw = joinParts(pieces, sampleRate);
        const fitted = fitSamples(raw, Math.round(item.duration * sampleRate));
        const offset = Math.max(0, Math.round(item.start * sampleRate));
        for (let j = 0; j < fitted.length && offset + j < timeline.length; j++) {
          timeline[offset + j] = Math.max(-1, Math.min(1, timeline[offset + j] + fitted[j]));
        }
      }
      assertTimings(session.reference, session.edited);
      const mp3 = await encodeMp3(timeline, sampleRate);
      const downloads = $('#novaDubDownloads');
      downloads?.querySelectorAll('[data-nova-manual-mp3="1"]').forEach((node) => node.remove());
      objectUrls.splice(0).forEach((url) => URL.revokeObjectURL(url));
      const url = URL.createObjectURL(mp3);
      objectUrls.push(url);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${session.base}_WHISPER_RU_MANUAL_VOICES.mp3`;
      link.textContent = '⬇ Русский MP3 · ручные голоса';
      link.dataset.novaManualMp3 = '1';
      downloads?.appendChild(link);
      status('✅ Новый MP3 готов. Изменены только выбранные голоса; субтитры и тайминги остались прежними.');
    } finally {
      try { await ctx.close(); } catch (_) {}
    }
  }

  function watchResults() {
    const observer = new MutationObserver(() => {
      const downloads = $('#novaDubDownloads');
      if (!downloads) return;
      const hasRaw = [...downloads.querySelectorAll('a')].some((a) => a.textContent.includes('Original transcript SRT'));
      if (hasRaw) window.setTimeout(() => captureSession().catch(() => {}), 50);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  watchResults();
})();