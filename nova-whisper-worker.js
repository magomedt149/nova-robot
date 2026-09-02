import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/+esm';

const MODEL_IDS = Object.freeze({
  tiny: 'onnx-community/whisper-tiny',
  small: 'onnx-community/whisper-small'
});

const pipelines = new Map();

function progress(message) {
  self.postMessage({ type: 'progress', ...message });
}

async function hasWebGPUAdapter() {
  if (!self.navigator?.gpu?.requestAdapter) return false;
  try {
    const adapter = await Promise.race([
      self.navigator.gpu.requestAdapter(),
      new Promise((resolve) => setTimeout(() => resolve(null), 1500))
    ]);
    return Boolean(adapter);
  } catch (_) {
    return false;
  }
}

async function buildPipeline(modelKey) {
  const key = MODEL_IDS[modelKey] ? modelKey : 'tiny';
  if (pipelines.has(key)) return pipelines.get(key);
  const model = MODEL_IDS[key];
  const options = {
    progress_callback(info) {
      const loaded = Number(info?.loaded || 0);
      const total = Number(info?.total || 0);
      progress({ stage: 'model', model: key, file: info?.file || '', loaded, total, status: info?.status || '' });
    }
  };

  let transcriber;
  if (await hasWebGPUAdapter()) {
    try {
      transcriber = await pipeline('automatic-speech-recognition', model, { ...options, device: 'webgpu' });
      progress({ stage: 'backend', backend: 'webgpu', model: key });
    } catch (error) {
      progress({ stage: 'backend-fallback', backend: 'wasm', model: key, message: String(error?.message || error) });
    }
  }
  if (!transcriber) {
    // Transformers.js supports explicit `device: 'wasm'` for CPU/WebAssembly.
    // Do not rely on automatic device selection here: in Chrome navigator.gpu may
    // exist even when no GPU adapter is available, which can otherwise retry WebGPU.
    transcriber = await pipeline('automatic-speech-recognition', model, { ...options, device: 'wasm' });
    progress({ stage: 'backend', backend: 'wasm', model: key });
  }
  pipelines.set(key, transcriber);
  return transcriber;
}

function normalizeLanguage(value) {
  const text = String(value || '').toLowerCase();
  if (text.startsWith('ru') || text.includes('russian')) return 'ru';
  if (text.startsWith('en') || text.includes('english')) return 'en';
  return '';
}

function detectLanguage(text) {
  const value = String(text || '');
  const cyr = (value.match(/[А-Яа-яЁё]/g) || []).length;
  const latin = (value.match(/[A-Za-z]/g) || []).length;
  return cyr > latin * 0.25 ? 'ru' : 'en';
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function appendPiece(current, piece) {
  const text = String(piece || '').trim();
  if (!text) return current;
  if (!current) return text;
  if (/^[,.;:!?…%)\]}]/.test(text)) return `${current}${text}`;
  if (/[([{«“]$/.test(current)) return `${current}${text}`;
  return `${current} ${text}`;
}

function rawTimedChunks(result, durationSeconds) {
  const raw = Array.isArray(result?.chunks) ? result.chunks : [];
  return raw.map((chunk, index) => {
    const timestamp = Array.isArray(chunk?.timestamp) ? chunk.timestamp : [];
    const startRaw = Number(timestamp[0]);
    const endRaw = Number(timestamp[1]);
    const nextStart = index + 1 < raw.length && Array.isArray(raw[index + 1]?.timestamp)
      ? Number(raw[index + 1].timestamp[0]) : NaN;
    const start = Number.isFinite(startRaw) ? Math.max(0, startRaw) : 0;
    let end = Number.isFinite(endRaw) ? endRaw : Number.isFinite(nextStart) ? nextStart : Math.min(durationSeconds, start + 2.5);
    if (!(end > start)) end = Math.min(durationSeconds, start + 1.5);
    return {
      start,
      end: Math.max(start + 0.05, Math.min(durationSeconds, end)),
      text: String(chunk?.text || '').trim()
    };
  }).filter((item) => item.text && item.start < durationSeconds && item.end > item.start);
}

function looksWordLevel(items) {
  if (items.length < 4) return false;
  const short = items.filter((item) => cleanText(item.text).split(/\s+/).filter(Boolean).length <= 2).length;
  return short / items.length >= 0.65;
}

function dedupeTimedItems(items) {
  const out = [];
  for (const item of items) {
    const normalized = cleanText(item.text).toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    const previous = out[out.length - 1];
    const prevNormalized = previous ? cleanText(previous.text).toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') : '';
    if (previous && normalized && normalized === prevNormalized && item.start <= previous.end + 0.18) {
      previous.end = Math.max(previous.end, item.end);
      continue;
    }
    out.push({ ...item });
  }
  return out;
}

function groupWordItems(items, durationSeconds) {
  const cleanItems = dedupeTimedItems(items);
  const cues = [];
  let current = null;

  const flush = () => {
    if (!current || !cleanText(current.text)) return;
    cues.push({
      start: current.start,
      duration: Math.max(0.25, Math.min(durationSeconds - current.start, current.end - current.start)),
      text: cleanText(current.text)
    });
    current = null;
  };

  for (const item of cleanItems) {
    const piece = cleanText(item.text);
    if (!piece) continue;
    if (!current) {
      current = { start: item.start, end: item.end, text: piece, words: piece.split(/\s+/).length };
      continue;
    }

    const gap = Math.max(0, item.start - current.end);
    const nextWords = piece.split(/\s+/).filter(Boolean).length;
    const candidate = appendPiece(current.text, piece);
    const punctuationBreak = /[.!?…]$/.test(current.text) && current.words >= 3;
    const tooLong = candidate.length > 52 || current.words + nextWords > 10 || item.end - current.start > 4.6;
    const shouldBreak = gap > 0.75 || punctuationBreak || tooLong;

    if (shouldBreak) {
      flush();
      current = { start: item.start, end: item.end, text: piece, words: nextWords };
    } else {
      current.text = appendPiece(current.text, piece);
      current.end = Math.max(current.end, item.end);
      current.words += nextWords;
    }
  }
  flush();
  return cues.filter((item) => item.text && item.duration > 0);
}

function phraseItemsToCues(items, durationSeconds) {
  const deduped = dedupeTimedItems(items);
  return deduped.map((item) => ({
    start: Math.max(0, item.start),
    duration: Math.max(0.25, Math.min(durationSeconds - item.start, item.end - item.start)),
    text: cleanText(item.text)
  })).filter((item) => item.text && item.start < durationSeconds && item.duration > 0);
}

function fallbackFromText(text, durationSeconds) {
  const value = cleanText(text);
  if (!value) return [];
  const sentences = value.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g)?.map((s) => cleanText(s)).filter(Boolean) || [value];
  const weights = sentences.map((s) => Math.max(1, s.split(/\s+/).length));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let cursor = 0;
  return sentences.map((sentence, index) => {
    const duration = durationSeconds * (weights[index] / total);
    const item = { start: cursor, duration, text: sentence };
    cursor += duration;
    return item;
  });
}

function normalizeChunks(result, durationSeconds) {
  const timed = rawTimedChunks(result, durationSeconds);
  if (timed.length) {
    const cues = looksWordLevel(timed)
      ? groupWordItems(timed, durationSeconds)
      : phraseItemsToCues(timed, durationSeconds);
    if (cues.length) return cues;
  }
  return fallbackFromText(result?.text || '', durationSeconds);
}

function wordCount(text) {
  return cleanText(text).split(/\s+/).filter(Boolean).length;
}

function textCoverage(fullText, chunks) {
  const full = wordCount(fullText);
  const segmented = wordCount(chunks.map((c) => c.text).join(' '));
  if (!full) return 1;
  return Math.min(1, segmented / full);
}

self.onmessage = async (event) => {
  const data = event?.data || {};
  if (data.type !== 'transcribe') return;
  const id = data.id;
  try {
    const audio = data.audio instanceof Float32Array ? data.audio : new Float32Array(data.audio || 0);
    if (!audio.length) throw new Error('Пустая аудиодорожка.');
    const durationSeconds = audio.length / 16000;
    const modelKey = MODEL_IDS[data.model] ? data.model : 'tiny';
    const transcriber = await buildPipeline(modelKey);
    const options = {
      task: 'transcribe',
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5
    };
    if (data.language === 'ru') options.language = 'russian';
    if (data.language === 'en') options.language = 'english';
    progress({ stage: 'transcribe', model: modelKey, duration: durationSeconds });
    const result = await transcriber(audio, options);
    let chunks = normalizeChunks(result, durationSeconds);
    const coverage = textCoverage(result?.text || '', chunks);

    if (coverage < 0.82 && cleanText(result?.text || '')) {
      progress({ stage: 'subtitle-repair', coverage });
      const fallback = fallbackFromText(result.text, durationSeconds);
      if (wordCount(fallback.map((c) => c.text).join(' ')) > wordCount(chunks.map((c) => c.text).join(' '))) chunks = fallback;
    }

    const language = normalizeLanguage(result?.language)
      || (data.language === 'ru' || data.language === 'en' ? data.language : detectLanguage(result?.text || chunks.map((c) => c.text).join(' ')));

    self.postMessage({
      type: 'result',
      id,
      model: modelKey,
      language,
      text: String(result?.text || chunks.map((c) => c.text).join(' ')).trim(),
      chunks,
      subtitleCoverage: textCoverage(result?.text || '', chunks)
    });
  } catch (error) {
    self.postMessage({ type: 'error', id, message: String(error?.message || error) });
  }
};
