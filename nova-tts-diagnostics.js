(() => {
  'use strict';

  if (window.NovaTtsDiagnostics) return;

  const EXPECTED = Object.freeze({
    provider: 'piper',
    voiceId: 'ru_RU-irina-medium',
    locale: 'ru-RU',
    pitchFactor: 1,
    formantFactor: 1,
    perVideoVariation: false,
    allowSystemFallback: false,
    allowAutomaticVoiceSubstitution: false
  });

  const AUDIO_HISTORY_KEY = 'novaIrinaAudioFingerprintHistory:v2';
  const MAX_AUDIO_HISTORY = 24;
  const BLOCK_SECONDS = 0.50;
  const STEP_SECONDS = 0.25;
  const MIN_REPEAT_SECONDS = 1.0;
  const MIN_MATCH_BLOCKS = Math.max(3, Math.ceil(MIN_REPEAT_SECONDS / STEP_SECONDS));
  const BLOCK_SIMILARITY = 0.985;
  const MAX_HISTORY_AGE_MS = 90 * 24 * 60 * 60 * 1000;

  function row(name, ok, actual, expected) {
    return { name, ok: Boolean(ok), actual, expected };
  }

  function run({ updateUi = true } = {}) {
    const tts = window.NovaRussianTTS;
    const pronunciation = window.NovaRussianPronunciation;
    const irina = tts?.voices?.irina;
    const lock = tts?.irinaLock;
    const checks = [
      row('tts-loaded', Boolean(tts), Boolean(tts), true),
      row('pronunciation-loaded', Boolean(pronunciation?.normalize), Boolean(pronunciation?.normalize), true),
      row('provider', irina?.provider === EXPECTED.provider, irina?.provider, EXPECTED.provider),
      row('voice-id', irina?.id === EXPECTED.voiceId, irina?.id, EXPECTED.voiceId),
      row('locale', irina?.locale === EXPECTED.locale, irina?.locale, EXPECTED.locale),
      row('voice-lock', lock?.voiceId === EXPECTED.voiceId, lock?.voiceId, EXPECTED.voiceId),
      row('pitch-locked', Number(lock?.pitchFactor) === 1, lock?.pitchFactor, 1),
      row('formants-locked', Number(lock?.formantFactor) === 1, lock?.formantFactor, 1),
      row('per-video-variation-disabled', lock?.perVideoVariation === false, lock?.perVideoVariation, false),
      row('system-fallback-disabled', lock?.allowSystemFallback === false, lock?.allowSystemFallback, false),
      row('voice-substitution-disabled', lock?.allowAutomaticVoiceSubstitution === false, lock?.allowAutomaticVoiceSubstitution, false)
    ];

    let normalizationSample = '';
    try {
      normalizationSample = pronunciation?.normalize?.('NOVA, урок 4. TTS Ирины: GPU Render, WanGP, Blender, FFmpeg, MP4, 30 FPS, 9:16, 100%.') || '';
      checks.push(row('russian-normalization', /НОВА/.test(normalizationSample) && /джи-пи-ю/i.test(normalizationSample) && /эм-пэ-четыре/i.test(normalizationSample) && /кадров в секунду/i.test(normalizationSample) && /девять на шестнадцать/i.test(normalizationSample) && /сто/.test(normalizationSample), normalizationSample, 'normalized Russian speech text'));
    } catch (error) {
      checks.push(row('russian-normalization', false, error?.message || String(error), 'normalized Russian speech text'));
    }

    const ok = checks.every((item) => item.ok);
    const report = Object.freeze({
      ok,
      checkedAt: new Date().toISOString(),
      expected: EXPECTED,
      voiceSignature: tts?.getVoiceSignature?.('irina') || null,
      pronunciationVersion: pronunciation?.version || null,
      normalizationSample,
      audioFreshnessEnabled: true,
      audioFreshnessPolicy: {
        blockSeconds: BLOCK_SECONDS,
        stepSeconds: STEP_SECONDS,
        minRepeatedFragmentSeconds: MIN_REPEAT_SECONDS,
        maxHistory: MAX_AUDIO_HISTORY
      },
      checks
    });

    if (updateUi) {
      const node = document.querySelector('#statusText');
      if (node) {
        node.textContent = ok
          ? '✅ Диагностика TTS: Ирина зафиксирована, русский слой активен, проверка повторов аудио включена.'
          : '⚠️ Диагностика TTS обнаружила несоответствие. Ирина не должна использоваться до исправления.';
      }
    }

    try { window.dispatchEvent(new CustomEvent('nova:tts-diagnostics', { detail: report })); } catch (_) {}
    return report;
  }

  function assertReady() {
    const report = run({ updateUi: false });
    if (!report.ok) {
      const failed = report.checks.filter((item) => !item.ok).map((item) => item.name).join(', ');
      throw new Error(`NOVA TTS diagnostics failed: ${failed}`);
    }
    return report;
  }

  function getAudioContext() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('AudioContext недоступен для проверки аудио.');
    return new Ctx();
  }

  async function decodeAudio(source) {
    if (typeof AudioBuffer !== 'undefined' && source instanceof AudioBuffer) return source;
    let bytes;
    if (source instanceof Blob) bytes = await source.arrayBuffer();
    else if (source instanceof ArrayBuffer) bytes = source.slice(0);
    else if (ArrayBuffer.isView(source)) bytes = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    else throw new Error('Для диагностики нужен Blob, ArrayBuffer или AudioBuffer.');

    const ctx = getAudioContext();
    try {
      return await ctx.decodeAudioData(bytes.slice(0));
    } finally {
      try { await ctx.close(); } catch (_) {}
    }
  }

  function monoSamples(buffer) {
    const channels = Math.max(1, buffer.numberOfChannels || 1);
    const length = buffer.length;
    const mono = new Float32Array(length);
    for (let c = 0; c < channels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
    }
    return mono;
  }

  function blockVector(samples, start, size) {
    const SUB = 12;
    const out = new Array(SUB + 4).fill(0);
    const end = Math.min(samples.length, start + size);
    const span = Math.max(1, end - start);
    let peak = 0;
    let rms = 0;
    let diff = 0;
    let zc = 0;
    let prev = samples[start] || 0;

    for (let i = start; i < end; i++) {
      const x = samples[i] || 0;
      const ax = Math.abs(x);
      peak = Math.max(peak, ax);
      rms += x * x;
      if ((x >= 0) !== (prev >= 0)) zc += 1;
      diff += Math.abs(x - prev);
      prev = x;
      const sub = Math.min(SUB - 1, Math.floor(((i - start) / span) * SUB));
      out[sub] += ax;
    }

    const floor = 1e-7;
    const global = Math.max(floor, out.slice(0, SUB).reduce((a, b) => a + b, 0) / SUB);
    for (let i = 0; i < SUB; i++) {
      const subLen = Math.max(1, Math.floor(span / SUB));
      out[i] = Math.log1p((out[i] / subLen) / global * 12);
    }
    out[SUB] = Math.sqrt(rms / span) / Math.max(peak, floor);
    out[SUB + 1] = zc / span;
    out[SUB + 2] = diff / span / Math.max(peak, floor);

    let corr1 = 0;
    const lag = Math.max(1, Math.floor(span / 32));
    for (let i = start + lag; i < end; i++) corr1 += (samples[i] || 0) * (samples[i - lag] || 0);
    out[SUB + 3] = corr1 / Math.max(1, span - lag) / Math.max(floor, rms / span);

    const norm = Math.sqrt(out.reduce((sum, v) => sum + v * v, 0)) || 1;
    return out.map((v) => Math.round((v / norm) * 1000));
  }

  function vectorSimilarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
    let dot = 0, aa = 0, bb = 0;
    for (let i = 0; i < a.length; i++) {
      const x = Number(a[i] || 0);
      const y = Number(b[i] || 0);
      dot += x * y;
      aa += x * x;
      bb += y * y;
    }
    if (!aa || !bb) return 0;
    return dot / Math.sqrt(aa * bb);
  }

  function fingerprintBuffer(buffer) {
    const samples = monoSamples(buffer);
    const sampleRate = Number(buffer.sampleRate || 48000);
    const blockSize = Math.max(256, Math.round(sampleRate * BLOCK_SECONDS));
    const stepSize = Math.max(128, Math.round(sampleRate * STEP_SECONDS));
    const blocks = [];
    for (let start = 0; start + Math.floor(blockSize * 0.7) < samples.length; start += stepSize) {
      blocks.push(blockVector(samples, start, blockSize));
    }
    return {
      duration: Number(buffer.duration || samples.length / sampleRate),
      sampleRate,
      blocks
    };
  }

  function longestSequenceMatch(a, b, { self = false } = {}) {
    const A = a?.blocks || [];
    const B = b?.blocks || [];
    let best = { blocks: 0, similarity: 0, aStart: -1, bStart: -1 };

    for (let i = 0; i < A.length; i++) {
      for (let j = 0; j < B.length; j++) {
        if (self && Math.abs(i - j) < MIN_MATCH_BLOCKS + 1) continue;
        let n = 0;
        let score = 0;
        while (i + n < A.length && j + n < B.length) {
          if (self && Math.abs((i + n) - (j + n)) < MIN_MATCH_BLOCKS + 1) break;
          const sim = vectorSimilarity(A[i + n], B[j + n]);
          if (sim < BLOCK_SIMILARITY) break;
          score += sim;
          n += 1;
        }
        if (n > best.blocks || (n === best.blocks && n > 0 && score / n > best.similarity)) {
          best = { blocks: n, similarity: n ? score / n : 0, aStart: i, bStart: j };
        }
      }
    }

    return {
      ...best,
      seconds: best.blocks ? (best.blocks - 1) * STEP_SECONDS + BLOCK_SECONDS : 0
    };
  }

  function readHistory() {
    try {
      const raw = JSON.parse(localStorage.getItem(AUDIO_HISTORY_KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      const cutoff = Date.now() - MAX_HISTORY_AGE_MS;
      return raw.filter((item) => Number(item?.savedAt || 0) >= cutoff && Array.isArray(item?.fingerprint?.blocks));
    } catch (_) {
      return [];
    }
  }

  function writeHistory(history) {
    try {
      localStorage.setItem(AUDIO_HISTORY_KEY, JSON.stringify(history.slice(-MAX_AUDIO_HISTORY)));
    } catch (_) {}
  }

  function normalizeMeta(meta = {}) {
    return {
      id: String(meta.id || meta.renderId || `render-${Date.now()}`),
      name: String(meta.name || meta.fileName || ''),
      lesson: String(meta.lesson || ''),
      text: String(meta.text || '').replace(/\s+/g, ' ').trim().slice(0, 1000)
    };
  }

  async function checkRenderedAudio(source, options = {}) {
    assertReady();
    const buffer = await decodeAudio(source);
    const fingerprint = fingerprintBuffer(buffer);
    const selfMatch = longestSequenceMatch(fingerprint, fingerprint, { self: true });
    const history = readHistory();

    let previousBest = null;
    for (const item of history) {
      const match = longestSequenceMatch(fingerprint, item.fingerprint);
      if (!previousBest || match.seconds > previousBest.match.seconds || (match.seconds === previousBest.match.seconds && match.similarity > previousBest.match.similarity)) {
        previousBest = { item, match };
      }
    }

    const selfRepeated = selfMatch.blocks >= MIN_MATCH_BLOCKS && selfMatch.seconds >= MIN_REPEAT_SECONDS;
    const reusedPrevious = Boolean(previousBest && previousBest.match.blocks >= MIN_MATCH_BLOCKS && previousBest.match.seconds >= MIN_REPEAT_SECONDS);
    const checks = [
      row('no-self-repeated-audio-fragment', !selfRepeated, selfMatch, `no repeated fragment >= ${MIN_REPEAT_SECONDS.toFixed(1)}s`),
      row('no-previous-render-audio-reuse', !reusedPrevious, previousBest ? {
        previousRender: previousBest.item.meta,
        match: previousBest.match
      } : null, `no reused fragment >= ${MIN_REPEAT_SECONDS.toFixed(1)}s from previous renders`)
    ];

    const report = {
      ok: checks.every((item) => item.ok),
      checkedAt: new Date().toISOString(),
      duration: fingerprint.duration,
      fingerprintBlocks: fingerprint.blocks.length,
      selfMatch,
      previousBest: previousBest ? { meta: previousBest.item.meta, match: previousBest.match } : null,
      checks
    };

    if (options.updateUi !== false) {
      const node = document.querySelector('#statusText');
      if (node) {
        node.textContent = report.ok
          ? '✅ Аудио новое: старых фраз и повторяющихся фрагментов не найдено.'
          : reusedPrevious
            ? `⛔ Найден старый аудиофрагмент ~${previousBest.match.seconds.toFixed(2)} сек. Экспорт нужно остановить.`
            : `⛔ Найден повтор внутри ролика ~${selfMatch.seconds.toFixed(2)} сек. Экспорт нужно остановить.`;
      }
    }

    try { window.dispatchEvent(new CustomEvent('nova:audio-freshness-diagnostics', { detail: report })); } catch (_) {}
    return { ...report, fingerprint };
  }

  async function rememberRenderedAudio(source, meta = {}, options = {}) {
    const checked = await checkRenderedAudio(source, { ...options, updateUi: options.updateUi !== false });
    if (!checked.ok && options.allowUnsafe !== true) {
      const failed = checked.checks.filter((item) => !item.ok).map((item) => item.name).join(', ');
      throw new Error(`NOVA audio freshness diagnostics failed: ${failed}`);
    }

    const history = readHistory();
    history.push({
      savedAt: Date.now(),
      meta: normalizeMeta(meta),
      fingerprint: checked.fingerprint
    });
    writeHistory(history);
    return checked;
  }

  async function assertFreshAudio(source, options = {}) {
    const report = await checkRenderedAudio(source, options);
    if (!report.ok) {
      const failed = report.checks.filter((item) => !item.ok).map((item) => item.name).join(', ');
      throw new Error(`NOVA audio freshness diagnostics failed: ${failed}`);
    }
    return report;
  }

  function clearAudioHistory() {
    try { localStorage.removeItem(AUDIO_HISTORY_KEY); } catch (_) {}
  }

  function audioHistory() {
    return readHistory().map((item) => ({ savedAt: item.savedAt, meta: item.meta, duration: item.fingerprint?.duration || 0 }));
  }

  window.NovaTtsDiagnostics = Object.freeze({
    expected: EXPECTED,
    run,
    assertReady,
    checkRenderedAudio,
    assertFreshAudio,
    rememberRenderedAudio,
    audioHistory,
    clearAudioHistory,
    audioFreshnessPolicy: Object.freeze({
      historyKey: AUDIO_HISTORY_KEY,
      maxHistory: MAX_AUDIO_HISTORY,
      blockSeconds: BLOCK_SECONDS,
      stepSeconds: STEP_SECONDS,
      minRepeatedFragmentSeconds: MIN_REPEAT_SECONDS,
      minMatchBlocks: MIN_MATCH_BLOCKS,
      blockSimilarity: BLOCK_SIMILARITY
    })
  });
})();