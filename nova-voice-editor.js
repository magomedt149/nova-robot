(() => {
  'use strict';

  if (window.__novaTranscriptEditorInstalled) return;
  window.__novaTranscriptEditorInstalled = true;

  const LAME_URL = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';
  const MAX_SECONDS = 120;
  const $ = (selector, root = document) => root.querySelector(selector);
  const objectUrls = [];
  let session = null;
  let captureTimer = 0;

  function status(message) {
    const media = $('#novaMediaStatus');
    if (media) media.textContent = message;
    const global = $('#statusText');
    if (global) global.textContent = message;
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function parseTimecode(value) {
    const parts = String(value || '').trim().replace(',', '.').split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return Number(parts[0]) || 0;
  }

  function formatSrtTime(seconds) {
    const ms = Math.max(0, Math.round((Number(seconds) || 0) * 1000));
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const x = ms % 1000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(x).padStart(3, '0')}`;
  }

  function formatShortTime(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    const m = Math.floor(value / 60);
    const s = value - m * 60;
    return `${m}:${s.toFixed(2).padStart(5, '0')}`;
  }

  function parseSrt(text) {
    return String(text || '').replace(/\r/g, '').trim().split(/\n\s*\n/).map((block) => {
      const lines = block.split('\n').filter(Boolean);
      const timing = lines.findIndex((line) => line.includes('-->'));
      if (timing < 0) return null;
      const [a, b] = lines[timing].split('-->').map((v) => v.trim().split(/\s+/)[0]);
      const start = parseTimecode(a);
      const end = parseTimecode(b);
      const value = cleanText(lines.slice(timing + 1).join(' ').replace(/<[^>]+>/g, ''));
      return value && end > start ? { start, end, duration: end - start, text: value } : null;
    }).filter(Boolean);
  }

  function segmentsToSrt(rows, key) {
    return rows.map((row, index) =>
      `${index + 1}\n${formatSrtTime(row.start)} --> ${formatSrtTime(row.end)}\n${cleanText(row[key])}\n`
    ).join('\n');
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

  function detectLanguage(text) {
    const value = String(text || '');
    const cyr = (value.match(/[А-Яа-яЁё]/g) || []).length;
    const latin = (value.match(/[A-Za-z]/g) || []).length;
    return cyr > latin * 0.25 ? 'ru' : 'en';
  }

  function voiceName(value) {
    return value === 'denis' ? 'Денис' : 'Ирина';
  }

  async function loadTextFromDownload(labelPart) {
    const links = [...document.querySelectorAll('#novaDubDownloads a')];
    const link = links.find((item) => item.textContent.includes(labelPart));
    if (!link?.href) return '';
    const response = await fetch(link.href);
    return response.ok ? response.text() : '';
  }

  async function translateText(text, from, to) {
    const value = cleanText(text);
    if (!value || from === to) return value;
    try {
      if (window.Translator?.create) {
        const translator = await window.Translator.create({ sourceLanguage: from, targetLanguage: to });
        return cleanText(await translator.translate(value));
      }
    } catch (_) {}
    try {
      const response = await fetch('/.netlify/functions/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: value, from, to })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.ok && data?.translatedText) return cleanText(data.translatedText);
    } catch (_) {}
    const url = new URL('https://api.mymemory.translated.net/get');
    url.searchParams.set('q', value.slice(0, 450));
    url.searchParams.set('langpair', `${from}|${to}`);
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok || !data?.responseData?.translatedText) throw new Error('Перевод временно недоступен.');
    return cleanText(data.responseData.translatedText);
  }

  function ensureStyles() {
    $('#novaVoiceEditorStyles')?.remove();
    if ($('#novaTranscriptEditorStyles')) return;
    const style = document.createElement('style');
    style.id = 'novaTranscriptEditorStyles';
    style.textContent = `
      .nova-transcript-editor{margin:12px 0;padding:12px;border:1px solid rgba(125,174,255,.24);border-radius:16px;background:rgba(7,14,34,.76)}
      .nova-transcript-editor h3{margin:0 0 6px;font-size:15px}.nova-editor-note{font-size:12px;color:#a9bee0;margin-bottom:9px;line-height:1.45}
      .nova-editor-list{display:grid;gap:9px;max-height:430px;overflow:auto;padding-right:2px}
      .nova-editor-row{display:grid;grid-template-columns:92px 110px 1fr;gap:7px;padding:9px;border-radius:13px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.06)}
      .nova-editor-num{font-size:11px;color:#84a4d4;font-weight:800}.nova-editor-time{display:grid;grid-template-columns:1fr 1fr;gap:5px}
      .nova-editor-time label,.nova-editor-main label{font-size:10px;color:#87a2cb;font-weight:800;display:grid;gap:3px}
      .nova-editor-row input,.nova-editor-row textarea,.nova-editor-row select{box-sizing:border-box;width:100%;border:1px solid rgba(255,255,255,.14);border-radius:9px;background:#081127;color:#fff;padding:7px;font:inherit}
      .nova-editor-row textarea{min-height:62px;resize:vertical;font-size:12px;line-height:1.35}.nova-editor-col{display:grid;gap:6px}
      .nova-editor-main{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px}.nova-editor-main .wide{grid-column:span 3}
      .nova-editor-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.nova-editor-actions button{border:0;border-radius:11px;padding:9px 11px;background:rgba(255,255,255,.1);color:white;font-weight:800}
      .nova-editor-actions .primary{background:linear-gradient(135deg,#177cff,#7448ff)}.nova-editor-actions .good{background:linear-gradient(135deg,#079b67,#21c58e)}
      .nova-editor-warning{font-size:11px;color:#ffd68a;margin-top:7px;min-height:15px}
      @media(max-width:720px){.nova-editor-row{grid-template-columns:1fr}.nova-editor-main{grid-template-columns:1fr}.nova-editor-main .wide{grid-column:span 1}.nova-editor-time{grid-template-columns:1fr 1fr}}
    `;
    document.head.appendChild(style);
  }

  function validateRows(rows) {
    if (!rows.length) throw new Error('Нет реплик для пересборки.');
    const warnings = [];
    rows.forEach((row, index) => {
      row.start = Number(row.start);
      row.end = Number(row.end);
      row.duration = row.end - row.start;
      if (!Number.isFinite(row.start) || !Number.isFinite(row.end)) throw new Error(`Реплика ${index + 1}: неверный таймкод.`);
      if (row.start < 0 || row.end <= row.start) throw new Error(`Реплика ${index + 1}: конец должен быть позже начала.`);
      if (row.end > MAX_SECONDS) throw new Error(`Реплика ${index + 1}: тайминг выходит за предел ${MAX_SECONDS} секунд.`);
      if (!cleanText(row.originalText)) throw new Error(`Реплика ${index + 1}: пустой Whisper-текст.`);
      if (index > 0 && row.start < rows[index - 1].end) warnings.push(`Реплики ${index} и ${index + 1} перекрываются.`);
    });
    return warnings;
  }

  function markTranslationNeeds(row) {
    if (session.sourceLanguage === 'ru') {
      row.ruText = row.originalText;
      row.ruDirty = false;
      if (!row.enManual) row.enDirty = true;
    } else {
      row.enText = row.originalText;
      row.enDirty = false;
      if (!row.ruManual) row.ruDirty = true;
    }
  }

  function readRowFromUi(rowNode) {
    const index = Number(rowNode.dataset.index);
    const row = session?.edited?.[index];
    if (!row) return;
    const previousOriginal = row.originalText;
    const previousRu = row.ruText;
    const previousEn = row.enText;
    const original = cleanText($('.nova-original', rowNode)?.value);
    const ru = cleanText($('.nova-ru', rowNode)?.value);
    const en = cleanText($('.nova-en', rowNode)?.value);
    row.start = Number($('.nova-start', rowNode)?.value);
    row.end = Number($('.nova-end', rowNode)?.value);
    row.duration = row.end - row.start;
    row.voice = $('.nova-voice', rowNode)?.value === 'denis' ? 'denis' : 'irina';

    if (original !== previousOriginal) {
      row.originalText = original;
      markTranslationNeeds(row);
    }
    if (ru !== previousRu) {
      row.ruText = ru;
      row.ruManual = true;
      row.ruDirty = false;
    }
    if (en !== previousEn) {
      row.enText = en;
      row.enManual = true;
      row.enDirty = false;
    }
  }

  function syncAllFromUi() {
    document.querySelectorAll('#novaTranscriptEditor .nova-editor-row').forEach(readRowFromUi);
    const warnings = validateRows(session.edited);
    const warning = $('#novaEditorWarning');
    if (warning) warning.textContent = warnings.join(' ');
    return warnings;
  }

  function renderEditor() {
    if (!session) return;
    ensureStyles();
    const downloads = $('#novaDubDownloads');
    if (!downloads) return;

    $('#novaVoiceEditor')?.remove();
    let root = $('#novaTranscriptEditor');
    if (!root) {
      root = document.createElement('section');
      root.id = 'novaTranscriptEditor';
      root.className = 'nova-transcript-editor';
      downloads.insertAdjacentElement('afterend', root);
    }

    root.innerHTML = `
      <h3>✍️ Whisper: текст, тайминги и голоса</h3>
      <div class="nova-editor-note">
        Исправляй распознанный Whisper-текст, начало/конец реплики и голос. Можно также вручную поправить русский дубляж и English subtitle.
        После изменения Whisper-текста NOVA автоматически обновит нужный перевод при пересборке. MP3 и SRT создаются заново из этих строк.
      </div>
      <div class="nova-editor-list"></div>
      <div id="novaEditorWarning" class="nova-editor-warning"></div>
      <div class="nova-editor-actions">
        <button id="novaEditorRebuild" class="primary" type="button">🔁 Пересобрать RU MP3 + EN SRT</button>
        <button id="novaEditorRetranslate" class="good" type="button">🌐 Перевести заново из Whisper</button>
        <button id="novaEditorReset" type="button">Сбросить всё</button>
      </div>`;

    const list = $('.nova-editor-list', root);
    session.edited.forEach((row, index) => {
      const node = document.createElement('div');
      node.className = 'nova-editor-row';
      node.dataset.index = String(index);
      node.innerHTML = `
        <div class="nova-editor-col">
          <div class="nova-editor-num">#${index + 1}</div>
          <select class="nova-voice" aria-label="Голос реплики ${index + 1}">
            <option value="irina"${row.voice === 'irina' ? ' selected' : ''}>♀ Ирина</option>
            <option value="denis"${row.voice === 'denis' ? ' selected' : ''}>♂ Денис</option>
          </select>
          <small style="color:#7f9bc5">${formatShortTime(row.start)}–${formatShortTime(row.end)}</small>
        </div>
        <div class="nova-editor-time">
          <label>Начало, сек<input class="nova-start" type="number" min="0" max="${MAX_SECONDS}" step="0.01" value="${row.start.toFixed(2)}"></label>
          <label>Конец, сек<input class="nova-end" type="number" min="0.01" max="${MAX_SECONDS}" step="0.01" value="${row.end.toFixed(2)}"></label>
        </div>
        <div class="nova-editor-main">
          <label class="wide">Whisper / оригинал<textarea class="nova-original">${escapeHtml(row.originalText)}</textarea></label>
          <label>Русский дубляж<textarea class="nova-ru">${escapeHtml(row.ruText)}</textarea></label>
          <label>English SRT<textarea class="nova-en">${escapeHtml(row.enText)}</textarea></label>
          <label>Источник<input value="${session.sourceLanguage.toUpperCase()}" disabled></label>
        </div>`;
      list.appendChild(node);
    });

    list.addEventListener('input', (event) => {
      const rowNode = event.target.closest('.nova-editor-row');
      if (!rowNode) return;
      try {
        readRowFromUi(rowNode);
        validateRows(session.edited);
        $('#novaEditorWarning').textContent = '';
      } catch (error) {
        $('#novaEditorWarning').textContent = error.message || String(error);
      }
    });

    $('#novaEditorReset', root).addEventListener('click', () => {
      session.edited = session.initial.map((row) => ({ ...row }));
      renderEditor();
      status('Редактор сброшен к результату Whisper.');
    });
    $('#novaEditorRetranslate', root).addEventListener('click', () => retranslateAll().catch(showError));
    $('#novaEditorRebuild', root).addEventListener('click', () => rebuildOutputs().catch(showError));
  }

  function showError(error) {
    const message = error?.message || String(error);
    const warning = $('#novaEditorWarning');
    if (warning) warning.textContent = message;
    status(`Редактор: ${message}`);
  }

  async function captureSession() {
    const result = $('#novaDubResult');
    if (!result) return;
    const detected = parseRussianResult(result.textContent);
    if (!detected.length) return;

    const [rawSrtText, englishSrtText] = await Promise.all([
      loadTextFromDownload('Original transcript SRT'),
      loadTextFromDownload('English SRT')
    ]);
    const original = parseSrt(rawSrtText);
    const english = parseSrt(englishSrtText);
    if (!original.length || original.length !== detected.length) return;

    const sourceLanguage = detectLanguage(original.map((s) => s.text).join(' '));
    const rows = original.map((segment, index) => ({
      start: segment.start,
      end: segment.end,
      duration: segment.duration,
      originalText: segment.text,
      ruText: detected[index]?.text || (sourceLanguage === 'ru' ? segment.text : ''),
      enText: english[index]?.text || (sourceLanguage === 'en' ? segment.text : ''),
      voice: detected[index]?.voice || 'irina',
      ruDirty: false,
      enDirty: false,
      ruManual: false,
      enManual: false
    }));

    session = {
      sourceLanguage,
      initial: rows.map((row) => ({ ...row })),
      edited: rows.map((row) => ({ ...row })),
      base: ($('#novaLocalVideo')?.files?.[0]?.name || 'NOVA_video').replace(/\.[^.]+$/, '') || 'NOVA_video'
    };
    renderEditor();
    status('✅ Whisper готов. Теперь можно исправить текст, тайминги, русский дубляж, English SRT и голоса.');
  }

  async function resolveTranslations(rows, force = false) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (force) {
        row.ruManual = false;
        row.enManual = false;
        if (session.sourceLanguage === 'ru') {
          row.ruText = row.originalText;
          row.ruDirty = false;
          row.enDirty = true;
        } else {
          row.enText = row.originalText;
          row.enDirty = false;
          row.ruDirty = true;
        }
      }
      if (row.ruDirty && !row.ruManual) {
        status(`Перевожу RU ${i + 1}/${rows.length}…`);
        row.ruText = await translateText(row.originalText, session.sourceLanguage, 'ru');
        row.ruDirty = false;
      }
      if (row.enDirty && !row.enManual) {
        status(`Перевожу EN ${i + 1}/${rows.length}…`);
        row.enText = await translateText(row.originalText, session.sourceLanguage, 'en');
        row.enDirty = false;
      }
    }
  }

  async function retranslateAll() {
    syncAllFromUi();
    await resolveTranslations(session.edited, true);
    renderEditor();
    status('✅ Русский и английский тексты обновлены из исправленного Whisper-текста.');
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
    if (!window.lamejs) await loadScript(LAME_URL, 'nova-transcript-editor-lame');
    if (!window.lamejs) throw new Error('MP3-кодек недоступен.');
    const encoder = new window.lamejs.Mp3Encoder(1, sampleRate, 128);
    const chunks = [];
    for (let i = 0; i < samples.length; i += 1152) {
      const slice = samples.subarray(i, Math.min(samples.length, i + 1152));
      const pcm = new Int16Array(slice.length);
      for (let j = 0; j < slice.length; j++) {
        pcm[j] = Math.max(-32768, Math.min(32767, Math.round(slice[j] * 32767)));
      }
      const data = encoder.encodeBuffer(pcm);
      if (data.length) chunks.push(new Uint8Array(data));
    }
    const end = encoder.flush();
    if (end.length) chunks.push(new Uint8Array(end));
    return new Blob(chunks, { type: 'audio/mpeg' });
  }

  async function buildMp3(rows) {
    const tts = window.NovaRussianTTS;
    if (!tts?.synthesize) throw new Error('Piper Ирина/Денис не загружен.');
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('AudioContext недоступен.');
    const ctx = new Ctx();
    try {
      const sampleRate = ctx.sampleRate;
      const totalSeconds = Math.min(MAX_SECONDS, Math.max(1, ...rows.map((row) => row.end)));
      const timeline = new Float32Array(Math.ceil(totalSeconds * sampleRate));
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        status(`Piper ${voiceName(row.voice)}: ${i + 1}/${rows.length}…`);
        const blobs = await tts.synthesize(row.ruText, row.voice);
        const pieces = [];
        for (const blob of blobs) pieces.push(await decodeTts(blob, ctx));
        const raw = joinParts(pieces, sampleRate);
        const fitted = fitSamples(raw, Math.round((row.end - row.start) * sampleRate));
        const offset = Math.max(0, Math.round(row.start * sampleRate));
        for (let j = 0; j < fitted.length && offset + j < timeline.length; j++) {
          timeline[offset + j] = Math.max(-1, Math.min(1, timeline[offset + j] + fitted[j]));
        }
      }
      return encodeMp3(timeline, sampleRate);
    } finally {
      try { await ctx.close(); } catch (_) {}
    }
  }

  function addDownload(blob, filename, label, kind) {
    const downloads = $('#novaDubDownloads');
    if (!downloads) return;
    downloads.querySelectorAll(`[data-nova-editor-output="${kind}"]`).forEach((node) => node.remove());
    const url = URL.createObjectURL(blob);
    objectUrls.push(url);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.textContent = label;
    link.dataset.novaEditorOutput = kind;
    downloads.appendChild(link);
  }

  async function rebuildOutputs() {
    const warnings = syncAllFromUi();
    await resolveTranslations(session.edited, false);
    validateRows(session.edited);
    session.edited.forEach((row, index) => {
      if (!cleanText(row.ruText)) throw new Error(`Реплика ${index + 1}: русский текст пуст.`);
      if (!cleanText(row.enText)) throw new Error(`Реплика ${index + 1}: English subtitle пуст.`);
    });
    status('Пересобираю русский MP3 по исправленным текстам и таймингам…');
    const mp3 = await buildMp3(session.edited);
    const enSrt = new Blob([segmentsToSrt(session.edited, 'enText')], { type: 'application/x-subrip;charset=utf-8' });
    const correctedSrt = new Blob([segmentsToSrt(session.edited, 'originalText')], { type: 'application/x-subrip;charset=utf-8' });
    addDownload(mp3, `${session.base}_WHISPER_RU_EDITED.mp3`, '⬇ Русский MP3 · исправленный', 'mp3');
    addDownload(enSrt, `${session.base}_WHISPER_EN_EDITED.srt`, '⬇ English SRT · исправленный', 'en-srt');
    addDownload(correctedSrt, `${session.base}_WHISPER_CORRECTED.srt`, '⬇ Whisper SRT · исправленный', 'raw-srt');
    const result = $('#novaDubResult');
    if (result) {
      result.textContent = session.edited.map((row, index) =>
        `${index + 1}. [${row.start.toFixed(2)}–${row.end.toFixed(2)}s] ${row.voice === 'denis' ? '♂ Денис' : '♀ Ирина'}: ${row.ruText}`
      ).join('\n');
    }
    renderEditor();
    status(`✅ Пересборка готова: исправленный RU MP3 + EN SRT${warnings.length ? '. Есть перекрывающиеся реплики.' : '.'}`);
  }

  function scheduleCapture() {
    clearTimeout(captureTimer);
    captureTimer = window.setTimeout(() => captureSession().catch(() => {}), 80);
  }

  function watchResults() {
    const observer = new MutationObserver(() => {
      const downloads = $('#novaDubDownloads');
      if (!downloads) return;
      const hasRaw = [...downloads.querySelectorAll('a')].some((a) => a.textContent.includes('Original transcript SRT'));
      if (hasRaw) scheduleCapture();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scheduleCapture();
  }

  watchResults();

  window.NovaTranscriptEditor = Object.freeze({
    getSession() {
      if (!session) return null;
      return { sourceLanguage: session.sourceLanguage, rows: session.edited.map((row) => ({ ...row })) };
    },
    rebuild: rebuildOutputs
  });
})();