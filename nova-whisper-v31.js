(() => {
  'use strict';

  if (window.__novaWhisperV31Installed) return;
  window.__novaWhisperV31Installed = true;

  const MAX_SECONDS = 120;
  const TARGET_RATE = 16000;
  const LAME_URL = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';
  const FFMPEG_MODULE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/+esm';
  const FFMPEG_UTIL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/+esm';
  const FFMPEG_CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';

  const $ = (selector, root = document) => root.querySelector(selector);
  let whisperWorker = null;
  let whisperJob = 0;
  let ffmpegState = null;
  let session = null;
  const urls = [];

  function status(message) {
    const media = $('#novaMediaStatus');
    if (media) media.textContent = message;
    const global = $('#statusText');
    if (global) global.textContent = message;
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function loadScript(src, id) {
    if (id && document.getElementById(id)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      if (id) script.id = id;
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Не загрузился ${src}`));
      document.head.appendChild(script);
    });
  }

  function injectUi() {
    const pane = $('[data-media-pane="dub"]');
    const videoInput = $('#novaLocalVideo');
    if (!pane || !videoInput) return false;

    const old = $('#novaWhisperBox');
    if (old) old.remove();
    if ($('#novaWhisperV31Box')) return true;

    const exactButton = $('#novaLocalExact')?.closest('.nova-media-actions');
    if (!exactButton) return false;

    const box = document.createElement('div');
    box.id = 'novaWhisperV31Box';
    box.innerHTML = `
      <div class="nova-media-note" style="margin-top:12px"><b>🗣️ MP4 без SRT — Whisper + авто-спикеры</b><br>Whisper работает локально до 2 минут. После автоопределения можно вручную заменить голос каждой реплики и пересобрать MP3 без повторного распознавания.</div>
      <div class="nova-media-grid">
        <div class="nova-media-field"><label for="novaWhisperModel">Whisper</label><select id="novaWhisperModel"><option value="small">Small — точнее, тяжелее</option><option value="tiny">Tiny — быстрее, легче</option></select></div>
        <div class="nova-media-field"><label for="novaWhisperLanguage">Язык исходной речи</label><select id="novaWhisperLanguage"><option value="auto">Авто</option><option value="ru">Русский</option><option value="en">English</option></select></div>
      </div>
      <div class="nova-media-actions"><button class="nova-media-btn primary" id="novaLocalWhisper" type="button">Whisper: MP4 → RU MP3 + EN SRT</button></div>
      <div id="novaVoiceOverridePanel" hidden>
        <div class="nova-media-note"><b>🎭 Голоса реплик</b><br>Автоназначение уже сделано. Измени только нужные строки: Auto вернёт исходный выбор, Ирина/Денис зададут голос вручную. Таймкоды и SRT не меняются.</div>
        <div id="novaVoiceOverrideRows" style="display:grid;gap:7px;max-height:330px;overflow:auto"></div>
        <div class="nova-media-actions"><button class="nova-media-btn good" id="novaRebuildVoiceMp3" type="button">🔁 Пересобрать MP3 с выбранными голосами</button><button class="nova-media-btn" id="novaResetVoiceOverrides" type="button">Сбросить к авто</button></div>
      </div>`;
    exactButton.insertAdjacentElement('afterend', box);

    if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) $('#novaWhisperModel').value = 'tiny';
    $('#novaLocalWhisper').addEventListener('click', () => localWhisperDub().catch(showError));
    $('#novaRebuildVoiceMp3').addEventListener('click', () => rebuildFromOverrides().catch(showError));
    $('#novaResetVoiceOverrides').addEventListener('click', () => {
      if (!session) return;
      session.russian.forEach((segment) => { segment.voice = segment.autoVoice; segment.manualVoice = false; });
      renderVoiceEditor();
      status('Голоса возвращены к автоматическому определению. Нажми «Пересобрать MP3».');
    });
    return true;
  }

  function showError(error) {
    const message = error?.message || String(error);
    const result = $('#novaDubResult');
    if (result) result.textContent = message;
    status(`Whisper: ${message}`);
  }

  function ensureUi() {
    if (injectUi()) return;
    const observer = new MutationObserver(() => {
      if (injectUi()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  async function decodeWithWebAudio(file) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Ctx || !Offline) throw new Error('Web Audio недоступен.');
    const ctx = new Ctx();
    try {
      const decoded = await ctx.decodeAudioData((await file.arrayBuffer()).slice(0));
      const duration = Math.min(MAX_SECONDS, decoded.duration || MAX_SECONDS);
      const frames = Math.max(1, Math.ceil(duration * TARGET_RATE));
      const offline = new Offline(1, frames, TARGET_RATE);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start(0, 0, duration);
      const rendered = await offline.startRendering();
      return new Float32Array(rendered.getChannelData(0));
    } finally {
      try { await ctx.close(); } catch (_) {}
    }
  }

  async function ensureFfmpeg() {
    if (ffmpegState) return ffmpegState;
    status('MP4 не декодировался через Web Audio — загружаю бесплатный FFmpeg (~31 МБ)…');
    const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([import(FFMPEG_MODULE), import(FFMPEG_UTIL)]);
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({
      coreURL: await toBlobURL(`${FFMPEG_CORE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${FFMPEG_CORE}/ffmpeg-core.wasm`, 'application/wasm')
    });
    ffmpegState = { ffmpeg, fetchFile };
    return ffmpegState;
  }

  async function decodeWithFfmpeg(file) {
    const { ffmpeg, fetchFile } = await ensureFfmpeg();
    const input = `input-${Date.now()}.mp4`;
    const output = `audio-${Date.now()}.f32`;
    try {
      await ffmpeg.writeFile(input, await fetchFile(file));
      const code = await ffmpeg.exec(['-i', input, '-t', String(MAX_SECONDS), '-vn', '-ac', '1', '-ar', String(TARGET_RATE), '-f', 'f32le', output]);
      if (code !== 0) throw new Error(`FFmpeg завершился с кодом ${code}.`);
      const raw = await ffmpeg.readFile(output);
      const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw.buffer || raw);
      const copy = new Uint8Array(bytes.length);
      copy.set(bytes);
      return new Float32Array(copy.buffer);
    } finally {
      try { await ffmpeg.deleteFile(input); } catch (_) {}
      try { await ffmpeg.deleteFile(output); } catch (_) {}
    }
  }

  async function videoToPcm(file) {
    status('Извлекаю аудио из MP4 локально…');
    try {
      const pcm = await decodeWithWebAudio(file);
      if (pcm.length) return pcm;
    } catch (error) {
      console.warn('[NOVA Whisper] WebAudio decode failed:', error);
    }
    return decodeWithFfmpeg(file);
  }

  function getWorker() {
    if (whisperWorker) return whisperWorker;
    whisperWorker = new Worker('./nova-whisper-worker.js?v=29.0.0', { type: 'module', name: 'nova-whisper' });
    return whisperWorker;
  }

  function transcribePcm(pcm, model, language) {
    const worker = getWorker();
    const id = ++whisperJob;
    return new Promise((resolve, reject) => {
      const onMessage = (event) => {
        const data = event?.data || {};
        if (data.type === 'progress') {
          if (data.stage === 'model' && data.total > 0) {
            const pct = Math.max(0, Math.min(100, Math.round((data.loaded / data.total) * 100)));
            status(`Whisper ${model}: загрузка модели ${pct}%… Первый раз модель кэшируется.`);
          } else if (data.stage === 'backend') {
            status(`Whisper ${model}: ${data.backend === 'webgpu' ? 'WebGPU' : 'WASM'} готов, распознаю речь…`);
          } else if (data.stage === 'transcribe') {
            status(`Whisper распознаёт до ${Math.round(data.duration)} сек локального аудио…`);
          }
          return;
        }
        if (data.id !== id) return;
        if (data.type === 'result') { cleanup(); resolve(data); }
        else if (data.type === 'error') { cleanup(); reject(new Error(data.message || 'Ошибка Whisper.')); }
      };
      const onError = (error) => { cleanup(); reject(new Error(error?.message || 'Whisper worker остановился.')); };
      const cleanup = () => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage({ type: 'transcribe', id, model, language, audio: pcm }, [pcm.buffer]);
    });
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
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: value, from, to })
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

  async function translateSegments(segments, from, to) {
    if (from === to) return segments.map((s) => ({ ...s }));
    const out = [];
    for (let i = 0; i < segments.length; i++) {
      status(`Перевод ${i + 1}/${segments.length}: ${from} → ${to}…`);
      out.push({ ...segments[i], text: await translateText(segments[i].text, from, to) });
    }
    return out;
  }

  function formatSrtTime(seconds) {
    const ms = Math.max(0, Math.round(Number(seconds || 0) * 1000));
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const x = ms % 1000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(x).padStart(3, '0')}`;
  }

  function segmentsToSrt(segments) {
    return segments.map((item, index) => `${index + 1}\n${formatSrtTime(item.start)} --> ${formatSrtTime(item.start + item.duration)}\n${item.text}\n`).join('\n');
  }

  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function estimatePitch(frame, sampleRate) {
    const n = frame.length;
    if (n < 320) return { hz: 0, confidence: 0 };
    let mean = 0;
    for (let i = 0; i < n; i++) mean += frame[i];
    mean /= n;
    let energy = 0;
    const centered = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = frame[i] - mean;
      centered[i] = v;
      energy += v * v;
    }
    if (Math.sqrt(energy / n) < 0.006) return { hz: 0, confidence: 0 };
    const minLag = Math.floor(sampleRate / 340);
    const maxLag = Math.min(n - 2, Math.ceil(sampleRate / 75));
    let bestLag = 0;
    let bestCorr = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0, a2 = 0, b2 = 0;
      const limit = n - lag;
      for (let i = 0; i < limit; i++) {
        const a = centered[i], b = centered[i + lag];
        sum += a * b; a2 += a * a; b2 += b * b;
      }
      const corr = sum / Math.sqrt(Math.max(1e-12, a2 * b2));
      if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
    }
    if (!bestLag || bestCorr < 0.42) return { hz: 0, confidence: bestCorr };
    return { hz: sampleRate / bestLag, confidence: bestCorr };
  }

  function analyzeSegmentPitch(segment, pcm) {
    const start = Math.max(0, Math.floor(Number(segment.start || 0) * TARGET_RATE));
    const end = Math.min(pcm.length, Math.ceil((Number(segment.start || 0) + Number(segment.duration || 0)) * TARGET_RATE));
    const frameSize = Math.round(TARGET_RATE * 0.04);
    const hop = Math.round(TARGET_RATE * 0.02);
    const pitches = [];
    const confidences = [];
    let tested = 0;
    for (let offset = start; offset + frameSize <= end; offset += hop) {
      tested += 1;
      const result = estimatePitch(pcm.subarray(offset, offset + frameSize), TARGET_RATE);
      if (result.hz >= 75 && result.hz <= 340 && result.confidence >= 0.42) {
        pitches.push(result.hz); confidences.push(result.confidence);
      }
    }
    return {
      hz: median(pitches),
      confidence: tested ? Math.max(0, Math.min(1, (median(confidences) || 0) * Math.min(1, (pitches.length / tested) * 2.3))) : 0
    };
  }

  function adaptiveThreshold(measures) {
    const pitches = measures.map((m) => m.pitchHz).filter((v) => v >= 75 && v <= 340);
    if (pitches.length < 4) return 170;
    const logs = pitches.map(Math.log);
    let c1 = Math.min(...logs), c2 = Math.max(...logs);
    for (let iteration = 0; iteration < 10; iteration++) {
      const a = [], b = [];
      logs.forEach((value) => (Math.abs(value - c1) <= Math.abs(value - c2) ? a : b).push(value));
      if (!a.length || !b.length) return 170;
      c1 = a.reduce((sum, v) => sum + v, 0) / a.length;
      c2 = b.reduce((sum, v) => sum + v, 0) / b.length;
    }
    const low = Math.exp(Math.min(c1, c2));
    const high = Math.exp(Math.max(c1, c2));
    if (high - low < 28 || high / Math.max(1, low) < 1.18) return 170;
    return Math.max(145, Math.min(195, Math.sqrt(low * high)));
  }

  function diarizeByVoiceProfile(segments, pcm) {
    const measured = segments.map((segment) => {
      const pitch = analyzeSegmentPitch(segment, pcm);
      return { ...segment, pitchHz: pitch.hz, speakerConfidence: pitch.confidence };
    });
    const threshold = adaptiveThreshold(measured);
    const tagged = measured.map((segment) => {
      const voice = segment.pitchHz ? (segment.pitchHz < threshold ? 'denis' : 'irina') : '';
      return { ...segment, voice, autoVoice: voice || '', manualVoice: false };
    });
    for (let i = 0; i < tagged.length; i++) {
      if (tagged[i].voice && tagged[i].speakerConfidence >= 0.48) continue;
      const previous = i > 0 ? tagged[i - 1] : null;
      const next = i + 1 < tagged.length ? tagged[i + 1] : null;
      if (previous?.voice && next?.voice && previous.voice === next.voice) tagged[i].voice = previous.voice;
      else if (previous?.voice) tagged[i].voice = previous.voice;
      else if (next?.voice) tagged[i].voice = next.voice;
      else tagged[i].voice = 'irina';
      tagged[i].autoVoice = tagged[i].voice;
    }
    return tagged.map((segment, index) => ({ ...segment, start: Number(segments[index].start), duration: Number(segments[index].duration) }));
  }

  function assertTimingsPreserved(reference, enriched) {
    if (reference.length !== enriched.length) throw new Error('Внутренняя ошибка: число сегментов изменилось.');
    for (let i = 0; i < reference.length; i++) {
      if (Number(reference[i].start) !== Number(enriched[i].start) || Number(reference[i].duration) !== Number(enriched[i].duration)) {
        throw new Error('Внутренняя ошибка: тайминг сегмента был изменён.');
      }
    }
  }

  async function decodeTtsBlob(blob, ctx) {
    const buffer = await ctx.decodeAudioData((await blob.arrayBuffer()).slice(0));
    return new Float32Array(buffer.getChannelData(0));
  }

  function joinParts(parts, sampleRate) {
    const silence = Math.round(sampleRate * 0.04);
    const total = parts.reduce((sum, part) => sum + part.length, 0) + Math.max(0, parts.length - 1) * silence;
    const out = new Float32Array(total);
    let offset = 0;
    parts.forEach((part, index) => { out.set(part, offset); offset += part.length + (index < parts.length - 1 ? silence : 0); });
    return out;
  }

  function fitSamples(samples, frames) {
    const target = Math.max(1, frames);
    if (!samples.length) return new Float32Array(target);
    if (samples.length === target) return samples;
    const out = new Float32Array(target);
    const ratio = (samples.length - 1) / Math.max(1, target - 1);
    for (let i = 0; i < target; i++) {
      const p = i * ratio, a = Math.floor(p), b = Math.min(samples.length - 1, a + 1), t = p - a;
      out[i] = samples[a] * (1 - t) + samples[b] * t;
    }
    return out;
  }

  async function synthesizeSegment(segment, ctx) {
    const tts = window.NovaRussianTTS;
    if (!tts?.synthesize) throw new Error('Piper Ирина/Денис не загружен.');
    const blobs = await tts.synthesize(segment.text, segment.voice);
    const parts = [];
    for (const blob of blobs) parts.push(await decodeTtsBlob(blob, ctx));
    return joinParts(parts, ctx.sampleRate);
  }

  async function ensureLame() {
    if (!window.lamejs) await loadScript(LAME_URL, 'nova-whisper-lame');
    if (!window.lamejs) throw new Error('MP3-кодек не загрузился.');
  }

  async function encodeMp3(samples, sampleRate) {
    await ensureLame();
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

  async function timedRussianMp3(segments) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('AudioContext недоступен.');
    const ctx = new Ctx();
    try {
      const sampleRate = ctx.sampleRate;
      const totalSeconds = Math.min(MAX_SECONDS, Math.max(1, ...segments.map((s) => s.start + s.duration)));
      const timeline = new Float32Array(Math.ceil(totalSeconds * sampleRate));
      for (let i = 0; i < segments.length; i++) {
        const item = segments[i];
        status(`Piper ${item.voice === 'denis' ? 'Денис' : 'Ирина'}: ${i + 1}/${segments.length}…`);
        const raw = await synthesizeSegment(item, ctx);
        const fitted = fitSamples(raw, Math.round(item.duration * sampleRate));
        const offset = Math.max(0, Math.round(item.start * sampleRate));
        for (let j = 0; j < fitted.length && offset + j < timeline.length; j++) timeline[offset + j] = Math.max(-1, Math.min(1, timeline[offset + j] + fitted[j]));
      }
      return encodeMp3(timeline, sampleRate);
    } finally {
      try { await ctx.close(); } catch (_) {}
    }
  }

  function clearDownloads() {
    urls.splice(0).forEach((url) => URL.revokeObjectURL(url));
    const container = $('#novaDubDownloads');
    if (container) container.innerHTML = '';
  }

  function addDownload(blob, filename, label) {
    const container = $('#novaDubDownloads');
    if (!container) return;
    const url = URL.createObjectURL(blob);
    urls.push(url);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.textContent = label;
    container.appendChild(link);
  }

  function normalizeSourceLanguage(value, text) {
    if (value === 'ru' || value === 'en') return value;
    const cyr = (String(text).match(/[А-Яа-яЁё]/g) || []).length;
    const latin = (String(text).match(/[A-Za-z]/g) || []).length;
    return cyr > latin * 0.25 ? 'ru' : 'en';
  }

  function renderVoiceEditor() {
    const panel = $('#novaVoiceOverridePanel');
    const rows = $('#novaVoiceOverrideRows');
    if (!panel || !rows || !session) return;
    rows.innerHTML = '';
    session.russian.forEach((segment, index) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:74px 118px 1fr;gap:7px;align-items:start;padding:8px;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(255,255,255,.035)';
      const time = document.createElement('span');
      time.style.cssText = 'font-size:11px;color:#94acd1;padding-top:8px';
      time.textContent = `${segment.start.toFixed(1)}–${(segment.start + segment.duration).toFixed(1)}s`;
      const select = document.createElement('select');
      select.style.cssText = 'width:100%;border-radius:9px;background:#090f22;color:white;border:1px solid rgba(255,255,255,.15);padding:7px';
      const autoLabel = segment.autoVoice === 'denis' ? 'Auto · Денис' : 'Auto · Ирина';
      select.innerHTML = `<option value="auto">${autoLabel}</option><option value="irina">Ирина</option><option value="denis">Денис</option>`;
      select.value = segment.manualVoice ? segment.voice : 'auto';
      select.addEventListener('change', () => {
        const target = session.russian[index];
        if (select.value === 'auto') { target.voice = target.autoVoice; target.manualVoice = false; }
        else { target.voice = select.value; target.manualVoice = true; }
        updateResultPreview();
        status(`Реплика ${index + 1}: ${target.voice === 'denis' ? 'Денис' : 'Ирина'}. Тайминг не изменён.`);
      });
      const text = document.createElement('span');
      text.style.cssText = 'font-size:13px;line-height:1.35;padding-top:6px';
      text.textContent = segment.text;
      row.append(time, select, text);
      rows.appendChild(row);
    });
    panel.hidden = false;
  }

  function updateResultPreview() {
    const result = $('#novaDubResult');
    if (!result || !session) return;
    result.textContent = session.russian.map((segment, index) => {
      const mark = segment.manualVoice ? '✎' : 'A';
      const name = segment.voice === 'denis' ? 'Денис' : 'Ирина';
      return `${index + 1}. [${segment.start.toFixed(1)}s] ${mark} ${name}: ${segment.text}`;
    }).join('\n');
  }

  async function buildDownloads() {
    if (!session) throw new Error('Сначала обработай MP4 через Whisper.');
    assertTimingsPreserved(session.original, session.russian);
    assertTimingsPreserved(session.original, session.english);
    clearDownloads();
    status('Создаю русский MP3 с текущими назначениями голосов…');
    const mp3 = await timedRussianMp3(session.russian);
    const enSrt = new Blob([segmentsToSrt(session.english)], { type: 'application/x-subrip;charset=utf-8' });
    const rawSrt = new Blob([segmentsToSrt(session.original)], { type: 'application/x-subrip;charset=utf-8' });
    addDownload(mp3, `${session.base}_WHISPER_RU_Irina_Denis.mp3`, '⬇ Русский MP3 · Ирина/Денис');
    addDownload(enSrt, `${session.base}_WHISPER_EN.srt`, '⬇ English SRT · исходные тайминги');
    addDownload(rawSrt, `${session.base}_WHISPER_original.srt`, '⬇ Original transcript SRT');
    status('✅ MP3 и SRT готовы. Ручные замены голосов применены, тайминги и субтитры не изменены.');
  }

  async function rebuildFromOverrides() {
    if (!session) throw new Error('Сначала обработай MP4 через Whisper.');
    await buildDownloads();
  }

  async function localWhisperDub() {
    const file = $('#novaLocalVideo')?.files?.[0];
    if (!file) throw new Error('Сначала выбери MP4/видео. SRT не обязателен.');
    clearDownloads();
    const resultNode = $('#novaDubResult');
    if (resultNode) resultNode.textContent = 'Локальный Whisper запускается…';

    const model = $('#novaWhisperModel')?.value || 'tiny';
    const selectedLanguage = $('#novaWhisperLanguage')?.value || 'auto';
    const pcm = await videoToPcm(file);
    if (!pcm.length) throw new Error('В видео не найдена аудиодорожка.');
    const pcmForDiarization = new Float32Array(pcm);

    status(`Аудио готово: ${(pcm.length / TARGET_RATE).toFixed(1)} сек. Запускаю Whisper ${model}…`);
    const recognized = await transcribePcm(pcm, model, selectedLanguage);
    if (!recognized?.chunks?.length) throw new Error('Whisper не распознал речь.');

    const original = recognized.chunks.slice(0, 80).map((item) => ({
      start: Math.max(0, Number(item.start || 0)),
      duration: Math.max(0.25, Number(item.duration || 1)),
      text: cleanText(item.text)
    })).filter((item) => item.text && item.start < MAX_SECONDS);
    const source = normalizeSourceLanguage(recognized.language, recognized.text || original.map((s) => s.text).join(' '));

    status(`Whisper готов: ${original.length} сегментов. Определяю голосовые профили локально…`);
    const diarized = diarizeByVoiceProfile(original, pcmForDiarization);
    assertTimingsPreserved(original, diarized);

    const russian = source === 'ru' ? diarized.map((s) => ({ ...s })) : await translateSegments(diarized, source, 'ru');
    const english = source === 'en' ? diarized.map((s) => ({ ...s })) : await translateSegments(diarized, source, 'en');
    assertTimingsPreserved(original, russian);
    assertTimingsPreserved(original, english);

    session = {
      model,
      source,
      original,
      russian: russian.map((s) => ({ ...s, autoVoice: s.autoVoice || s.voice, manualVoice: false })),
      english,
      base: file.name.replace(/\.[^.]+$/, '') || 'NOVA_video'
    };
    updateResultPreview();
    renderVoiceEditor();
    await buildDownloads();
  }

  ensureUi();
  window.NovaWhisper = Object.freeze({
    version: '31.0.0',
    maxSeconds: MAX_SECONDS,
    transcribeVideo: localWhisperDub,
    rebuildMp3: rebuildFromOverrides,
    getSession() {
      if (!session) return null;
      return {
        model: session.model,
        source: session.source,
        original: session.original.map((s) => ({ ...s })),
        russian: session.russian.map((s) => ({ ...s })),
        english: session.english.map((s) => ({ ...s }))
      };
    },
    setVoice(index, voice) {
      if (!session || !session.russian[index]) return false;
      const segment = session.russian[index];
      if (voice === 'auto') { segment.voice = segment.autoVoice; segment.manualVoice = false; }
      else if (voice === 'irina' || voice === 'denis') { segment.voice = voice; segment.manualVoice = true; }
      else return false;
      renderVoiceEditor();
      updateResultPreview();
      return true;
    }
  });
})();