(() => {
  'use strict';

  if (window.__novaNeuralRussianTtsInstalled) return;
  window.__novaNeuralRussianTtsInstalled = true;

  const PIPER_IMPORT = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/+esm';
  const VOICES = Object.freeze({
    irina: { id: 'ru_RU-irina-medium', label: 'Ирина', gender: 'female' },
    denis: { id: 'ru_RU-denis-medium', label: 'Денис', gender: 'male' }
  });
  const MAX_CHUNK_CHARS = 170;
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;

  const nativeSpeak = synth.speak.bind(synth);
  const nativeCancel = synth.cancel.bind(synth);

  let piper = null;
  let piperLoading = null;
  let audio = null;
  let playbackToken = 0;
  let currentBlobUrl = '';

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
        if (cut < Math.floor(max * 0.55)) cut = max;
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
    audio.style.display = 'none';
    document.body.appendChild(audio);
    return audio;
  }

  function unlockAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, 22050);
        src.connect(ctx.destination);
        src.start(0);
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      }
    } catch (_) {}
    getAudio();
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
      const cleanup = () => { player.onended = null; player.onerror = null; };
      player.onended = () => { cleanup(); resolve(); };
      player.onerror = () => { cleanup(); reject(new Error('Не удалось воспроизвести нейроголос.')); };
      player.src = currentBlobUrl;
      const promise = player.play();
      if (promise?.catch) promise.catch((error) => { cleanup(); reject(error); });
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

  async function speak(text, voice = 'irina') {
    const clean = cleanRussianText(text);
    if (!clean) return;
    const key = normalizeVoice(voice);
    nativeCancel();
    stopPiperAudio();
    unlockAudio();
    const token = playbackToken;
    setStatus(`Первый запуск ${VOICES[key].label} может скачать модель один раз. Платных кредитов нет.`);
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
  }

  async function speakDialogue(turns) {
    nativeCancel();
    stopPiperAudio();
    unlockAudio();
    const token = playbackToken;
    const normalized = (Array.isArray(turns) ? turns : []).map((turn, index) => ({
      voice: normalizeVoice(turn?.voice || (index % 2 ? 'denis' : 'irina')),
      text: cleanRussianText(turn?.text || '')
    })).filter((turn) => turn.text);
    for (let i = 0; i < normalized.length; i++) {
      if (token !== playbackToken) return;
      const turn = normalized[i];
      const blobs = await synthesize(turn.text, turn.voice);
      setStatus(`🎭 Диалог ${i + 1}/${normalized.length}: ${VOICES[turn.voice].label}`);
      for (const blob of blobs) {
        if (token !== playbackToken) return;
        await playBlob(blob, token);
      }
    }
    if (token === playbackToken) setStatus('✅ Диалог Ирина + Денис готов.');
  }

  function selectClearRussianSystemVoice() {
    const voices = synth.getVoices?.() || [];
    const russian = voices.filter((voice) => String(voice.lang || '').toLowerCase().startsWith('ru'));
    if (!russian.length) return null;
    const priority = ['milena', 'katya', 'svetlana', 'irina', 'yuri', 'dmitry', 'pavel', 'google', 'microsoft'];
    for (const needle of priority) {
      const found = russian.find((voice) => String(voice.name || '').toLowerCase().includes(needle));
      if (found) return found;
    }
    return russian.find((voice) => voice.localService) || russian[0];
  }

  function systemFallback(text) {
    const clean = cleanRussianText(text);
    if (!clean) return;
    const fallback = new SpeechSynthesisUtterance(clean);
    fallback.lang = 'ru-RU';
    fallback.rate = 0.88;
    fallback.pitch = 1;
    const voice = selectClearRussianSystemVoice();
    if (voice) fallback.voice = voice;
    setStatus('Piper временно недоступен — включаю системный русский голос.');
    nativeSpeak(fallback);
  }

  function patchedSpeak(utterance) {
    if (!isRussianUtterance(utterance)) return nativeSpeak(utterance);
    speak(utterance?.text || '', 'irina').catch((error) => {
      console.warn('[NOVA Russian TTS] Piper fallback:', error);
      systemFallback(utterance?.text || '');
    });
  }

  function patchedCancel() {
    stopPiperAudio();
    nativeCancel();
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
    note.textContent = '🇷🇺 Основные голоса NOVA: Piper Ирина — женский/рассказчик, Piper Денис — мужской/диалоги. Работают без платного API.';
    anchor.insertAdjacentElement('afterend', note);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addUiNote, { once: true });
  } else {
    addUiNote();
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
    unlock: unlockAudio
  });
})();
