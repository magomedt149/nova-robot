(() => {
  'use strict';

  if (window.__novaNeuralRussianTtsInstalled) return;
  window.__novaNeuralRussianTtsInstalled = true;

  const PIPER_IMPORT = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/+esm';
  const RUSSIAN_VOICE_ID = 'ru_RU-irina-medium';
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

    const pushHardSplit = (value) => {
      let rest = value.trim();
      while (rest.length > max) {
        let cut = rest.lastIndexOf(' ', max);
        if (cut < Math.floor(max * 0.55)) cut = max;
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) current = rest;
    };

    for (const sentence of sentences) {
      const part = sentence.trim();
      if (!part) continue;
      const candidate = current ? `${current} ${part}` : part;
      if (candidate.length <= max) {
        current = candidate;
      } else {
        if (current) chunks.push(current);
        current = '';
        if (part.length <= max) current = part;
        else pushHardSplit(part);
      }
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
      const cleanup = () => {
        player.onended = null;
        player.onerror = null;
      };
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

  function selectClearRussianSystemVoice() {
    const voices = synth.getVoices?.() || [];
    const russian = voices.filter((voice) => String(voice.lang || '').toLowerCase().startsWith('ru'));
    if (!russian.length) return null;

    const priority = ['milena', 'katya', 'svetlana', 'dariya', 'alena', 'irina', 'yuri', 'dmitry', 'pavel', 'google', 'microsoft'];
    for (const needle of priority) {
      const found = russian.find((voice) => String(voice.name || '').toLowerCase().includes(needle));
      if (found) return found;
    }
    return russian.find((voice) => voice.localService) || russian[0];
  }

  function speakSystemFallback(originalUtterance, reason) {
    const text = cleanRussianText(originalUtterance?.text || '');
    if (!text) return;

    const fallback = new SpeechSynthesisUtterance(text);
    fallback.lang = 'ru-RU';
    fallback.rate = 0.86;
    fallback.pitch = 1;
    fallback.volume = 1;
    const voice = selectClearRussianSystemVoice();
    if (voice) fallback.voice = voice;

    setStatus(reason ? 'Нейроголос недоступен — включаю чёткий системный русский TTS.' : '🔊 Русский системный TTS.');
    nativeSpeak(fallback);
  }

  async function speakRussianNeural(originalUtterance, token) {
    const text = cleanRussianText(originalUtterance?.text || '');
    if (!text) return;

    const chunks = splitForSpeech(text);
    setStatus('Первый запуск русского голоса может скачать около 60 МБ один раз. Платных кредитов нет.');
    const engine = await ensurePiper();

    for (let index = 0; index < chunks.length; index++) {
      if (token !== playbackToken) return;
      const chunk = chunks[index];
      const blob = await engine.predict(
        { text: chunk, voiceId: RUSSIAN_VOICE_ID },
        (progress) => {
          if (token !== playbackToken || !progress?.total) return;
          const percent = Math.max(0, Math.min(100, Math.round((progress.loaded / progress.total) * 100)));
          setStatus(`Загружаю русский нейроголос Ирина: ${percent}%…`);
        }
      );
      if (token !== playbackToken) return;
      setStatus(chunks.length > 1 ? `🔊 Ирина читает: ${index + 1}/${chunks.length}` : '🔊 Ирина читает по-русски…');
      await playBlob(blob, token);
    }

    if (token === playbackToken) setStatus('✅ Русский нейроголос Ирина — готово.');
  }

  function patchedSpeak(utterance) {
    if (!isRussianUtterance(utterance)) return nativeSpeak(utterance);

    nativeCancel();
    stopPiperAudio();
    unlockAudio();
    const token = playbackToken;

    speakRussianNeural(utterance, token).catch((error) => {
      if (token !== playbackToken) return;
      console.warn('[NOVA Russian TTS] Piper fallback:', error);
      speakSystemFallback(utterance, error);
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
    try {
      synth.speak = patchedSpeak;
      synth.cancel = patchedCancel;
    } catch (_) {}
  }

  function addUiNote() {
    const modal = document.querySelector('#novaNotebookModal');
    if (!modal || modal.querySelector('#novaNeuralTtsNote')) return;
    const notes = modal.querySelectorAll('.nova-note-meta');
    const anchor = notes[0];
    if (!anchor) return;
    const note = document.createElement('div');
    note.id = 'novaNeuralTtsNote';
    note.className = 'nova-note-meta';
    note.textContent = '🇷🇺 Русская озвучка: нейроголос Piper Irina. Первый запуск ~60 МБ, потом модель хранится локально. Если Piper недоступен — NOVA автоматически использует лучший русский голос устройства.';
    anchor.insertAdjacentElement('afterend', note);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addUiNote, { once: true });
  } else {
    addUiNote();
  }

  const observer = new MutationObserver(() => addUiNote());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.NovaRussianTTS = {
    voiceId: RUSSIAN_VOICE_ID,
    speak(text) {
      unlockAudio();
      const utterance = new SpeechSynthesisUtterance(cleanRussianText(text));
      utterance.lang = 'ru-RU';
      patchedSpeak(utterance);
    },
    stop: patchedCancel,
    preload: ensurePiper
  };
})();