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
      <div class="nova-media-note" style="margin-top:12px"><b>🗣️ MP4 без SRT — локальный Whisper + авто-спикеры</b><br>Видео не отправляется на сервер. NOVA извлекает аудио, распознаёт до 2 минут, локально оценивает мужской/женский голос, назначает Дениса/Ирину и сохраняет исходные тайминги субтитров без сдвига.</div>
      <div class="nova-media-grid">
        <div class="nova-media-field"><label for="novaWhisperModel">Whisper</label><select id="novaWhisperModel"><option value="small">Small — точнее, тяжелее</option><option value="tiny">Tiny — быстрее, легче</option></select></div>
        <div class="nova-media-field"><label for="novaWhisperLanguage">Язык исходной речи</label><select id="novaWhisperLanguage"><option value="auto">Авто</option><option value="ru">Русский</option><option value="en">English</option></select></div>
      </div>
      <div class="nova-media-actions"><button class="nova-media-btn primary" id="novaLocalWhisper" type="button">Whisper + спикеры: MP4 → RU MP3 + EN SRT</button></div>`;
    exactButton.insertAdjacentElement('afterend', box);

    if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) $('#novaWhisperModel').value = 'tiny';
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
    whisperWorker = new Worker('./nova-whisper-worker.js?v=33.0.0', { type: 'module', name: 'nova-whisper' });
    return whisperWorker;
  }

  function transcribePcm(pcm, model, language) {
    const worker = getWorker();
    const id = ++whisperJob;
    const workerAudio = pcm.slice();
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
      worker.postMessage({ type: 'transcribe', id, model, language, audio: workerAudio }, [workerAudio.buffer]);
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
    const rms = Math.sqrt(energy / n);
    if (rms < 0.006) return { hz: 0, confidence: 0 };

    const minLag = Math.floor(sampleRate / 340);
    const maxLag = Math.min(n - 2, Math.ceil(sampleRate / 75));
    let bestLag = 0;
    let bestCorr = 0;
    const correlations = new Float32Array(maxLag + 1);
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      let a2 = 0;
      let b2 = 0;
      const limit = n - lag;
      for (let i = 0; i < limit; i++) {
        const a = centered[i];
        const b = centered[i + lag];
        sum += a * b;
        a2 += a * a;
        b2 += b * b;
      }
      const corr = sum / Math.sqrt(Math.max(1e-12, a2 * b2));
      correlations[lag] = corr;
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }
    if (!bestLag || bestCorr < 0.42) return { hz: 0, confidence: bestCorr };

    let lag = bestLag;
    if (bestLag > minLag && bestLag < maxLag) {
      const y1 = correlations[bestLag - 1];
      const y2 = correlations[bestLag];
      const y3 = correlations[bestLag + 1];
      const denom = y1 - 2 * y2 + y3;
      if (Math.abs(denom) > 1e-6) lag = bestLag + 0.5 * (y1 - y3) / denom;
    }
    return { hz: sampleRate / lag, confidence: bestCorr };
  }

  function analyzeSegmentPitch(segment, pcm, sampleRate = TARGET_RATE) {
    const start = Math.max(0, Math.floor(Number(segment.start || 0) * sampleRate));
    const end = Math.min(pcm.length, Math.ceil((Number(segment.start || 0) + Number(segment.duration || 0)) * sampleRate));
    const frameSize = Math.round(sampleRate * 0.04);
    const hop = Math.round(sampleRate * 0.02);
    const pitches = [];
    const confidences = [];
    let tested = 0;
    for (let offset = start; offset + frameSize <= end; offset += hop) {
      tested += 1;
      const result = estimatePitch(pcm.subarray(offset, offset + frameSize), sampleRate);
      if (result.hz >= 75 && result.hz <= 340 && result.confidence >= 0.42) {
        pitches.push(result.hz);
        confidences.push(result.confidence);
      }
    }
    const hz = median(pitches);
    const voicedRatio = tested ? pitches.length / tested : 0;
    const confidence = Math.max(0, Math.min(1, (median(confidences) || 0) * Math.min(1, voicedRatio * 2.3)));
    return { hz, confidence, voicedFrames: pitches.length, testedFrames: tested };
  }

  function adaptiveGenderThreshold(measures) {
    const pitches = measures.map((m) => m.pitchHz).filter((v) => v >= 75 && v <= 340);
    if (pitches.length < 4) return 170;
    const logs = pitches.map((v) => Math.log(v));
    let c1 = Math.min(...logs);
    let c2 = Math.max(...logs);
    for (let iteration = 0; iteration < 10; iteration++) {
      const a = [];
      const b = [];
      for (const value of logs) (Math.abs(value - c1) <= Math.abs(value - c2) ? a : b).push(value);
      if (!a.length || !b.length) return 170;
      c1 = a.reduce((sum, v) => sum + v, 0) / a.length;
      c2 = b.reduce((sum, v) => sum + v, 0) / b.length;
    }
    const low = Math.min(c1, c2);
    const high = Math.max(c1, c2);
    const lowHz = Math.exp(low);
    const highHz = Math.exp(high);
    if (highHz - lowHz < 28 || highHz / Math.max(1, lowHz) < 1.18) return 170;
    return Math.max(145, Math.min(195, Math.sqrt(lowHz * highHz)));
  }

  function explicitVoiceFromText(text) {
    const value = cleanText(text);
    if (/^(?:денис|мужчина|male|man)\s*[:—-]/i.test(value)) return 'denis';
    if (/^(?:ирина|женщина|female|woman)\s*[:—-]/i.test(value)) return 'irina';
    return '';
  }

  function diarizeByGender(segments, pcm) {
    const measures = segments.map((segment) => {
      const pitch = analyzeSegmentPitch(segment, pcm, TARGET_RATE);
      return { ...segment, pitchHz: pitch.hz, speakerConfidence: pitch.confidence };
    });
    const threshold = adaptiveGenderThreshold(measures);

    const tagged = measures.map((segment) => {
      const explicit = explicitVoiceFromText(segment.text);
      let voice = explicit;
      if (!voice && segment.pitchHz) voice = segment.pitchHz < threshold ? 'denis' : 'irina';
      return {
        ...segment,
        voice,
        speakerGender: voice === 'denis' ? 'male' : voice === 'irina' ? 'female' : 'unknown'
      };
    });

    for (let i = 0; i < tagged.length; i++) {
      if (tagged[i].voice && tagged[i].speakerConfidence >= 0.48) continue;
      const previous = i > 0 ? tagged[i - 1] : null;
      const next = i + 1 < tagged.length ? tagged[i + 1] : null;
      if (previous?.voice && next?.voice && previous.voice === next.voice) tagged[i].voice = previous.voice;
      else if (!tagged[i].voice && previous?.voice) tagged[i].voice = previous.voice;
      else if (!tagged[i].voice && next?.voice) tagged[i].voice = next.voice;
      else if (!tagged[i].voice) tagged[i].voice = 'irina';
      tagged[i].speakerGender = tagged[i].voice === 'denis' ? 'male' : 'female';
    }

    return tagged.map((segment, index) => ({
      ...segment,
      start: Number(segments[index].start),
      duration: Number(segments[index].duration),
      speaker: segment.voice === 'denis' ? 'Денис' : 'Ирина'
    }));
  }

  function assignVoices(segments) {
    let current = 'irina';
    let previousEnd = 0;
    return segments.map((segment, index) => {
      const text = cleanText(segment.text);
      const gap = Math.max(0, Number(segment.start || 0) - previousEnd);
      if (segment.voice === 'denis' || segment.voice === 'irina') current = segment.voice;
      else {
        const explicit = explicitVoiceFromText(text);
        if (explicit) current = explicit;
        else if (index > 0 && gap >= 0.65) current = current === 'irina' ? 'denis' : 'irina';
      }
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

  function assertTimingsPreserved(reference, enriched) {
    if (reference.length !== enriched.length) throw new Error('Внутренняя ошибка: число сегментов изменилось.');
    for (let i = 0; i < reference.length; i++) {
      if (Number(reference[i].start) !== Number(enriched[i].start) || Number(reference[i].duration) !== Number(enriched[i].duration)) {
        throw new Error('Внутренняя ошибка: тайминг сегмента был изменён.');
      }
    }
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
    status(`Whisper готов: ${original.length} сегментов. Определяю говорящих локально по голосу…`);

    const diarized = diarizeByGender(original, pcm);
    assertTimingsPreserved(original, diarized);
    const maleCount = diarized.filter((s) => s.voice === 'denis').length;
    const femaleCount = diarized.filter((s) => s.voice === 'irina').length;
    status(`Спикеры готовы: мужских сегментов ${maleCount}, женских ${femaleCount}. Тайминги сохранены без изменений.`);

    const russian = source === 'ru' ? diarized.map((s) => ({ ...s })) : await translateSegments(diarized, source, 'ru');
    const english = source === 'en' ? diarized.map((s) => ({ ...s })) : await translateSegments(diarized, source, 'en');
    assertTimingsPreserved(original, russian);
    assertTimingsPreserved(original, english);

    if (resultNode) {
      resultNode.textContent = russian.map((segment, index) => {
        const icon = segment.voice === 'denis' ? '♂' : '♀';
        const name = segment.voice === 'denis' ? 'Денис' : 'Ирина';
        const pitch = segment.pitchHz ? ` · ${Math.round(segment.pitchHz)} Hz` : '';
        return `${index + 1}. [${segment.start.toFixed(1)}s] ${icon} ${name}${pitch}: ${segment.text}`;
      }).join('\n');
    }

    status('Создаю русский MP3: мужские реплики — Денис, женские — Ирина…');
    const mp3 = await timedRussianMp3(russian);
    const srt = new Blob([segmentsToSrt(english)], { type: 'application/x-subrip;charset=utf-8' });
    const rawSrt = new Blob([segmentsToSrt(original)], { type: 'application/x-subrip;charset=utf-8' });
    const base = file.name.replace(/\.[^.]+$/, '') || 'NOVA_video';
    addDownload(mp3, `${base}_WHISPER_RU_AUTO_SPEAKERS.mp3`, '⬇ Русский MP3 · авто-спикеры');
    addDownload(srt, `${base}_WHISPER_EN.srt`, '⬇ English SRT · исходные тайминги');
    addDownload(rawSrt, `${base}_WHISPER_original.srt`, '⬇ Original transcript SRT');
    status(`✅ Готово локально: Whisper ${model}, Денис/Ирина по голосу, русский MP3 + English SRT. Тайминги не изменены. Платных AI-кредитов нет.`);
  }

  ensureUi();
  window.NovaWhisper = Object.freeze({
    maxSeconds: MAX_SECONDS,
    transcribeVideo: localWhisperDub,
    diarizeSegments(segments, pcm) {
      const result = diarizeByGender(segments, pcm);
      assertTimingsPreserved(segments, result);
      return result;
    }
  });
})();
