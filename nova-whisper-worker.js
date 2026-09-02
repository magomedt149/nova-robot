import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/+esm';

const MODEL_IDS = Object.freeze({
  tiny: 'onnx-community/whisper-tiny',
  small: 'onnx-community/whisper-small'
});

const pipelines = new Map();

function progress(message) {
  self.postMessage({ type: 'progress', ...message });
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
  if (self.navigator?.gpu) {
    try {
      transcriber = await pipeline('automatic-speech-recognition', model, { ...options, device: 'webgpu' });
      progress({ stage: 'backend', backend: 'webgpu', model: key });
    } catch (error) {
      progress({ stage: 'backend-fallback', backend: 'wasm', model: key, message: String(error?.message || error) });
    }
  }
  if (!transcriber) {
    transcriber = await pipeline('automatic-speech-recognition', model, options);
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

function normalizeChunks(result, durationSeconds) {
  const raw = Array.isArray(result?.chunks) ? result.chunks : [];
  if (raw.length) {
    return raw.map((chunk, index) => {
      const startRaw = Array.isArray(chunk?.timestamp) ? Number(chunk.timestamp[0]) : 0;
      const endRaw = Array.isArray(chunk?.timestamp) ? Number(chunk.timestamp[1]) : NaN;
      const nextStart = index + 1 < raw.length && Array.isArray(raw[index + 1]?.timestamp)
        ? Number(raw[index + 1].timestamp[0]) : NaN;
      const start = Number.isFinite(startRaw) ? Math.max(0, startRaw) : 0;
      let end = Number.isFinite(endRaw) ? endRaw : Number.isFinite(nextStart) ? nextStart : Math.min(durationSeconds, start + 4);
      if (!(end > start)) end = Math.min(durationSeconds, start + 2.5);
      return {
        start,
        duration: Math.max(0.25, Math.min(durationSeconds - start, end - start)),
        text: String(chunk?.text || '').replace(/\s+/g, ' ').trim()
      };
    }).filter((item) => item.text && item.start < durationSeconds && item.duration > 0);
  }

  const text = String(result?.text || '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const sentences = text.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g)?.map((s) => s.trim()).filter(Boolean) || [text];
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
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5
    };
    if (data.language === 'ru') options.language = 'russian';
    if (data.language === 'en') options.language = 'english';
    progress({ stage: 'transcribe', model: modelKey, duration: durationSeconds });
    const result = await transcriber(audio, options);
    const chunks = normalizeChunks(result, durationSeconds);
    const language = normalizeLanguage(result?.language) || (data.language === 'ru' || data.language === 'en' ? data.language : detectLanguage(result?.text || chunks.map((c) => c.text).join(' ')));
    self.postMessage({
      type: 'result',
      id,
      model: modelKey,
      language,
      text: String(result?.text || chunks.map((c) => c.text).join(' ')).trim(),
      chunks
    });
  } catch (error) {
    self.postMessage({ type: 'error', id, message: String(error?.message || error) });
  }
};
