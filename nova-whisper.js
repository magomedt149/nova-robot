(() => {
  'use strict';

  if (window.__novaWhisperInstalled) return;
  window.__novaWhisperInstalled = true;

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
    if (!pane || !videoInput || $('#novaLocalWhisper')) return false;

    const exactButton = $('#novaLocalExact')?.closest('.nova-media-actions');
    if (!exactButton) return false;

    const box = document.createElement('div');
    box.id = 'novaWhisperBox';
    box.innerHTML = `
      <div class="nova-media-note" style="margin-top:12px"><b>🗣️ MP4 без SRT — локальный Whisper</b><br>Видео не отправляется на сервер. NOVA извлекает аудио на устройстве, распознаёт до 2 минут, делает русский MP3 голосами Ирина/Денис и английский SRT.</div>
      <div class="nova-media-grid">
        <div class="nova-media-field"><label for="novaWhisperModel">Whisper</label><select id="novaWhisperModel"><option value="small">Small — точнее, тяжелее</option><option value="tiny">Tiny — быстрее, легче</option></select></div>
        <div class="nova-media-field"><label for="novaWhisperLanguage">Язык исходной речи</label><select id="novaWhisperLanguage"><option value="auto">Авто</option><option value="ru">Русский</option><option value="en">English</option></select></div>
      </div>
      <div class="nova-media-actions"><button class="nova-media-btn primary" id="novaLocalWhisper" type="button">Whisper: MP4 → RU MP3 + EN SRT</button></div>`;
    exactButton.insertAdjacentElement('afterend', box);

    if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
      $('#novaWhisperModel').value = 'tiny';
    }
    $('#novaLocalWhisper').addEventListener('click', () => localWhisperDub().catch((error) => {
      const result = $('#novaDubResult');
      if (result) result.textContent = error?.message || String(error);
      status(`Whisper: ${error?.message || error}`);
    }));
    return true;
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
      const buffer = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(buffer.slice(0));
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
    const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([
      import(FFMPEG_MODULE),
      import(FFMPEG_UTIL)
    ]);
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
        if (data.type === 'result') {
          cleanup();
          resolve(data);
        } else if (data.type === 'error') {
          cleanup();
          reject(new Error(data.message || 'Ошибка Whisper.'));
        }
      };
      const onError = (error) => {
        cleanup();
        reject(new Error(error?.message || 'Whisper worker остановился.'));
      };
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

  function assignVoices(segments) {
    let current = 'irina';
    let previousEnd = 0;
    return segments.map((segment, index) => {
      const text = cleanText(segment.text);
      const gap = Math.max(0, Number(segment.start || 0) - previousEnd);
      if (/^(?:денис|мужчина|male|man)\s*[:—-]/i.test(text)) current = 'denis';
      else if (/^(?:ирина|женщина|female|woman)\s*[:—-]/i.test(text)) current = 'irina';
      else if (index > 0 && gap >= 0.65) current = current === 'irina' ? 'denis' : 'irina';
      previousEnd = Number(segment.start || 0) + Number(segment.duration || 0);
      return { ...segment, text, voice: current };
    });
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
    parts.forEach((part, index) => {
      out.set(part, offset);
      offset += part.length;
      if (index < parts.length - 1) offset += silence;
    });
    return out;
  }

  function fitSamples(samples, frames) {
    const target = Math.max(1, frames);
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
      const voiced = assignVoices(segments);
      const sampleRate = ctx.sampleRate;
      const totalSeconds = Math.min(MAX_SECONDS, Math.max(1, ...voiced.map((s) => s.start + s.duration)));
      const timeline = new Float32Array(Math.ceil(totalSeconds * sampleRate));
      for (let i = 0; i < voiced.length; i++) {
        const item = voiced[i];
        status(`Piper ${item.voice === 'denis' ? 'Денис' : 'Ирина'}: ${i + 1}/${voiced.length}…`);
        const raw = await synthesizeSegment(item, ctx);
        const fitted = fitSamples(raw, Math.round(item.duration * sampleRate));
        const offset = Math.max(0, Math.round(item.start * sampleRate));
        for (let j = 0; j < fitted.length && offset + j < timeline.length; j++) {
          timeline[offset + j] = Math.max(-1, Math.min(1, timeline[offset + j] + fitted[j]));
        }
      }
      return encodeMp3(timeline, sampleRate);
    } finally {
      try { await ctx.close(); } catch (_) {}
    }
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

  function clearDownloads() {
    urls.splice(0).forEach((url) => URL.revokeObjectURL(url));
    const container = $('#novaDubDownloads');
    if (container) container.innerHTML = '';
  }

  function normalizeSourceLanguage(value, text) {
    if (value === 'ru' || value === 'en') return value;
    const cyr = (String(text).match(/[А-Яа-яЁё]/g) || []).length;
    const latin = (String(text).match(/[A-Za-z]/g) || []).length;
    return cyr > latin * 0.25 ? 'ru' : 'en';
  }

  async function localWhisperDub() {
    const file = $('#novaLocalVideo')?.files?.[0];
    if (!file) throw new Error('Сначала выбери MP4/видео. SRT больше не обязателен.');
    clearDownloads();
    const resultNode = $('#novaDubResult');
    if (resultNode) resultNode.textContent = 'Локальный Whisper запускается…';

    const model = $('#novaWhisperModel')?.value || 'tiny';
    const selectedLanguage = $('#novaWhisperLanguage')?.value || 'auto';
    const pcm = await videoToPcm(file);
    if (!pcm.length) throw new Error('В видео не найдена аудиодорожка.');
    status(`Аудио готово: ${(pcm.length / TARGET_RATE).toFixed(1)} сек. Запускаю Whisper ${model}…`);
    const recognized = await transcribePcm(pcm, model, selectedLanguage);
    if (!recognized?.chunks?.length) throw new Error('Whisper не распознал речь.');

    const original = recognized.chunks.slice(0, 80).map((item) => ({
      start: Math.max(0, Number(item.start || 0)),
      duration: Math.max(0.25, Number(item.duration || 1)),
      text: cleanText(item.text)
    })).filter((item) => item.text && item.start < MAX_SECONDS);
    const source = normalizeSourceLanguage(recognized.language, recognized.text || original.map((s) => s.text).join(' '));
    status(`Whisper готов: ${original.length} сегментов, исходный язык ${source.toUpperCase()}.`);

    const russian = source === 'ru' ? original.map((s) => ({ ...s })) : await translateSegments(original, source, 'ru');
    const english = source === 'en' ? original.map((s) => ({ ...s })) : await translateSegments(original, source, 'en');

    if (resultNode) {
      resultNode.textContent = russian.map((segment, index) => `${index + 1}. [${segment.start.toFixed(1)}s] ${segment.text}`).join('\n');
    }

    status('Создаю русский MP3 с таймингом Whisper…');
    const mp3 = await timedRussianMp3(russian);
    const srt = new Blob([segmentsToSrt(english)], { type: 'application/x-subrip;charset=utf-8' });
    const rawSrt = new Blob([segmentsToSrt(original)], { type: 'application/x-subrip;charset=utf-8' });
    const base = file.name.replace(/\.[^.]+$/, '') || 'NOVA_video';
    addDownload(mp3, `${base}_WHISPER_RU_Irina_Denis.mp3`, '⬇ Русский MP3');
    addDownload(srt, `${base}_WHISPER_EN.srt`, '⬇ English SRT');
    addDownload(rawSrt, `${base}_WHISPER_original.srt`, '⬇ Original transcript SRT');
    status(`✅ Готово локально: Whisper ${model}, русский MP3 + English SRT. Платных AI-кредитов нет.`);
  }

  ensureUi();
  window.NovaWhisper = Object.freeze({
    maxSeconds: MAX_SECONDS,
    transcribeVideo: localWhisperDub
  });
})();
