(() => {
  'use strict';

  if (window.__novaNeuralRussianTtsInstalled) return;
  window.__novaNeuralRussianTtsInstalled = true;

  const PIPER_IMPORT = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/+esm';
  const VOICES = Object.freeze({
    irina: { id: 'ru_RU-irina-medium', label: 'Ирина', gender: 'female' },
    denis: { id: 'ru_RU-denis-medium', label: 'Денис', gender: 'male' }
  });
  const MAX_CHUNK_CHARS = 260;
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;

  const nativeSpeak = synth.speak.bind(synth);
  const nativeCancel = synth.cancel.bind(synth);

  let piper = null;
  let piperLoading = null;
  let audio = null;
  let playbackToken = 0;
  let currentBlobUrl = '';
  let queue = Promise.resolve();
  let queuedCount = 0;
  let userUnlockedAudio = false;

  function setStatus(message) {
    const studio = document.querySelector('#novaMediaStatus');
    if (studio) studio.textContent = message;
    const youtube = document.querySelector('#novaYoutubeStatus');
    const translate = document.querySelector('#novaTranslateStatus');
    const modal = document.querySelector('#novaNotebookModal');
    const youtubePane = document.querySelector('[data-note-pane="youtube"]');
    const translatePane = document.querySelector('[data-note-pane="translate"]');
    if (modal && !modal.hidden) {
      if (youtubePane && !youtubePane.hidden && youtube) youtube.textContent = message;
      else if (translatePane && !translatePane.hidden && translate) translate.textContent = message;
      return;
    }
    const globalStatus = document.querySelector('#statusText');
    if (globalStatus) globalStatus.textContent = message;
  }

  function decodeEntities(text) {
    const input = String(text || '');
    if (!/[&][#a-z0-9]+;/i.test(input)) return input;
    const el = document.createElement('textarea');
    el.innerHTML = input;
    return el.value;
  }

  function cleanRussianText(text) {
    return decodeEntities(text)
      .replace(/\u00a0/g, ' ')
      .replace(/[“”„]/g, '"')
      .replace(/[’‘]/g, "'")
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/([.!?…]){2,}/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeVoice(value) {
    const key = String(value || 'irina').toLowerCase();
    return VOICES[key] ? key : 'irina';
  }

  function isRussianUtterance(utterance) {
    const lang = String(utterance?.lang || '').toLowerCase();
    const text = String(utterance?.text || '');
    return lang.startsWith('ru') || /[А-Яа-яЁё]/.test(text);
  }

  function splitForSpeech(text, max = MAX_CHUNK_CHARS) {
    const clean = cleanRussianText(text);
    if (!clean) return [];
    if (clean.length <= max) return [clean];
    const sentences = clean.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [clean];
    const chunks = [];
    let current = '';
    for (const sentence of sentences) {
      let part = sentence.trim();
      if (!part) continue;
      const candidate = current ? `${current} ${part}` : part;
      if (candidate.length <= max) {
        current = candidate;
        continue;
      }
      if (current) chunks.push(current);
      current = '';
      while (part.length > max) {
        let cut = part.lastIndexOf(' ', max);
        if (cut < Math.floor(max * 0.6)) cut = max;
        chunks.push(part.slice(0, cut).trim());
        part = part.slice(cut).trim();
      }
      if (part) current = part;
    }
    if (current) chunks.push(current);
    return chunks.filter(Boolean);
  }

  function getAudio() {
    if (audio) return audio;
    audio = document.createElement('audio');
    audio.id = 'novaNeuralRussianAudio';
    audio.preload = 'auto';
    audio.playsInline = true;
    audio.volume = 1;
    audio.style.display = 'none';
    document.body.appendChild(audio);
    return audio;
  }

  function unlockAudio() {
    userUnlockedAudio = true;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, 22050);
        src.connect(ctx.destination);
        src.start(0);
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        setTimeout(() => ctx.close().catch(() => {}), 80);
      }
    } catch (_) {}
    getAudio();
  }

  function installUnlockListeners() {
    const once = () => {
      unlockAudio();
      document.removeEventListener('pointerdown', once, true);
      document.removeEventListener('touchstart', once, true);
      document.removeEventListener('keydown', once, true);
    };
    document.addEventListener('pointerdown', once, true);
    document.addEventListener('touchstart', once, true);
    document.addEventListener('keydown', once, true);
  }

  async function ensurePiper() {
    if (piper) return piper;
    if (!piperLoading) {
      piperLoading = import(PIPER_IMPORT)
        .then((module) => {
          piper = module;
          return module;
        })
        .catch((error) => {
          piperLoading = null;
          throw error;
        });
    }
    return piperLoading;
  }

  function stopPiperAudio() {
    playbackToken += 1;
    queuedCount = 0;
    queue = Promise.resolve();
    if (audio) {
      try { audio.pause(); } catch (_) {}
      audio.removeAttribute('src');
      try { audio.load(); } catch (_) {}
    }
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = '';
    }
  }

  async function playBlob(blob, token) {
    if (token !== playbackToken) return;
    const player = getAudio();
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = URL.createObjectURL(blob);
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        player.onended = null;
        player.onerror = null;
        if (error) reject(error); else resolve();
      };
      player.onended = () => finish();
      player.onerror = () => finish(new Error('Не удалось воспроизвести нейроголос.'));
      player.src = currentBlobUrl;
      player.currentTime = 0;
      const promise = player.play();
      if (promise?.catch) promise.catch((error) => finish(error));
    });
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = '';
    }
  }

  async function synthesize(text, voice = 'irina', onProgress) {
    const clean = cleanRussianText(text);
    if (!clean) return [];
    const key = normalizeVoice(voice);
    const chunks = splitForSpeech(clean);
    const engine = await ensurePiper();
    const blobs = [];
    for (let index = 0; index < chunks.length; index++) {
      const blob = await engine.predict(
        { text: chunks[index], voiceId: VOICES[key].id },
        (progress) => {
          if (typeof onProgress === 'function') {
            onProgress({ ...progress, index, totalChunks: chunks.length, voice: key });
          }
        }
      );
      blobs.push(blob);
    }
    return blobs;
  }

  async function systemFallback(text) {
    const clean = cleanRussianText(text);
    if (!clean) return;
    await new Promise((resolve) => {
      const fallback = new SpeechSynthesisUtterance(clean);
      fallback.lang = 'ru-RU';
      fallback.rate = 0.88;
      fallback.pitch = 1;
      const voices = synth.getVoices?.() || [];
      const russian = voices.filter((voice) => String(voice.lang || '').toLowerCase().startsWith('ru'));
      const priority = ['milena', 'katya', 'svetlana', 'irina', 'yuri', 'dmitry', 'pavel', 'google', 'microsoft'];
      let selected = null;
      for (const needle of priority) {
        selected = russian.find((voice) => String(voice.name || '').toLowerCase().includes(needle));
        if (selected) break;
      }
      if (!selected) selected = russian.find((voice) => voice.localService) || russian[0] || null;
      if (selected) fallback.voice = selected;
      fallback.onend = resolve;
      fallback.onerror = resolve;
      setStatus('Piper временно недоступен — включаю системный русский голос.');
      nativeSpeak(fallback);
    });
  }

  async function speakNow(text, voice = 'irina') {
    const clean = cleanRussianText(text);
    if (!clean) return;
    const key = normalizeVoice(voice);
    const token = playbackToken;
    if (!userUnlockedAudio) getAudio();
    setStatus(`Первый запуск ${VOICES[key].label} может скачать модель один раз. Платных кредитов нет.`);
    try {
      const blobs = await synthesize(clean, key, (progress) => {
        if (token !== playbackToken || !progress?.total) return;
        const percent = Math.max(0, Math.min(100, Math.round((progress.loaded / progress.total) * 100)));
        setStatus(`Загружаю Piper ${VOICES[key].label}: ${percent}%…`);
      });
      for (let index = 0; index < blobs.length; index++) {
        if (token !== playbackToken) return;
        setStatus(blobs.length > 1 ? `🔊 ${VOICES[key].label}: ${index + 1}/${blobs.length}` : `🔊 ${VOICES[key].label} говорит…`);
        await playBlob(blobs[index], token);
      }
      if (token === playbackToken) setStatus(`✅ Piper ${VOICES[key].label} — готово.`);
    } catch (error) {
      if (token !== playbackToken) return;
      console.warn('[NOVA Russian TTS] Piper fallback:', error);
      await systemFallback(clean);
    }
  }

  function enqueueSpeak(text, voice = 'irina') {
    const clean = cleanRussianText(text);
    if (!clean) return Promise.resolve();
    queuedCount += 1;
    const jobToken = playbackToken;
    const job = async () => {
      if (jobToken !== playbackToken) return;
      try {
        await speakNow(clean, voice);
      } finally {
        queuedCount = Math.max(0, queuedCount - 1);
      }
    };
    queue = queue.then(job, job);
    return queue;
  }

  function speak(text, voice = 'irina') {
    return enqueueSpeak(text, voice);
  }

  async function speakDialogue(turns) {
    const normalized = (Array.isArray(turns) ? turns : []).map((turn, index) => ({
      voice: normalizeVoice(turn?.voice || (index % 2 ? 'denis' : 'irina')),
      text: cleanRussianText(turn?.text || '')
    })).filter((turn) => turn.text);
    for (let i = 0; i < normalized.length; i++) {
      const turn = normalized[i];
      await enqueueSpeak(turn.text, turn.voice);
    }
  }

  function patchedSpeak(utterance) {
    if (!isRussianUtterance(utterance)) return nativeSpeak(utterance);
    enqueueSpeak(utterance?.text || '', 'irina');
  }

  function patchedCancel() {
    stopPiperAudio();
    nativeCancel();
    setStatus('Русский TTS остановлен.');
  }

  try {
    Object.defineProperty(synth, 'speak', { configurable: true, value: patchedSpeak });
    Object.defineProperty(synth, 'cancel', { configurable: true, value: patchedCancel });
  } catch (_) {
    try { synth.speak = patchedSpeak; synth.cancel = patchedCancel; } catch (_) {}
  }

  function addUiNote() {
    const modal = document.querySelector('#novaNotebookModal');
    if (!modal || modal.querySelector('#novaNeuralTtsNote')) return;
    const anchor = modal.querySelector('.nova-note-meta');
    if (!anchor) return;
    const note = document.createElement('div');
    note.id = 'novaNeuralTtsNote';
    note.className = 'nova-note-meta';
    note.textContent = '🇷🇺 NOVA TTS: Piper Ирина — женский голос по умолчанию. Реплики идут по очереди без взаимного обрыва. Piper Денис доступен для мужских реплик.';
    anchor.insertAdjacentElement('afterend', note);
  }

  function loadMediaStudio() {
    if (document.querySelector('script[data-nova-media-studio]')) return;
    const script = document.createElement('script');
    script.src = './nova-media-studio.js?v=28.0.0';
    script.defer = true;
    script.dataset.novaMediaStudio = '1';
    document.head.appendChild(script);
  }

  function init() {
    installUnlockListeners();
    addUiNote();
    loadMediaStudio();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
  const observer = new MutationObserver(addUiNote);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.NovaRussianTTS = Object.freeze({
    voices: VOICES,
    defaultNarrator: 'irina',
    defaultMale: 'denis',
    cleanText: cleanRussianText,
    splitForSpeech,
    synthesize,
    speak,
    speakDialogue,
    stop: patchedCancel,
    preload: ensurePiper,
    unlock: unlockAudio,
    queueSize: () => queuedCount
  });
})();