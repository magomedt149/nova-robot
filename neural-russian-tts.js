(() => {
  'use strict';

  if (window.__novaNeuralRussianTtsInstalled) return;
  window.__novaNeuralRussianTtsInstalled = true;

  const PIPER_IMPORT = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/+esm';
  const PRESET_KEY = 'novaRussianVoicePreset:v1';
  const VOICES = Object.freeze({
    liza: {
      id: '55f8c0f546884f9cbdefa113f5e7b682',
      label: 'Лиза — Elizabeth Friendly',
      provider: 'heygen',
      locale: 'ru-RU',
      exactReference: true
    },
    irina: {
      id: 'ru_RU-irina-medium',
      label: 'Ирина',
      provider: 'piper',
      locale: 'ru-RU',
      gender: 'female'
    },
    denis: {
      id: 'ru_RU-denis-medium',
      label: 'Денис',
      provider: 'piper',
      locale: 'ru-RU',
      gender: 'male'
    }
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
    const raw = String(value || '').toLowerCase().replace(/^nova:/, '');
    if (raw === 'elizabeth' || raw === 'elizabeth-friendly' || raw === 'lisa') return 'liza';
    return VOICES[raw] ? raw : 'irina';
  }

  function getDefaultVoice() {
    try {
      const stored = normalizeVoice(localStorage.getItem(PRESET_KEY) || 'liza');
      return stored === 'denis' ? 'irina' : stored;
    } catch (_) {
      return 'liza';
    }
  }

  function setDefaultVoice(value) {
    const key = normalizeVoice(value);
    const selected = key === 'denis' ? 'irina' : key;
    try { localStorage.setItem(PRESET_KEY, selected); } catch (_) {}
    injectVoicePresetOptions();
    return selected;
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

  function stopNeuralAudio() {
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
    if (key === 'liza') {
      throw new Error('Лиза использует точный HeyGen Elizabeth Friendly; Piper не должен подменять этот голос.');
    }
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

  async function speakExactLiza(text) {
    const clean = cleanRussianText(text);
    if (!clean) return;
    const provider = window.NovaExactLizaTTS;
    if (provider && typeof provider.speak === 'function') {
      return provider.speak(clean, {
        voiceId: VOICES.liza.id,
        locale: VOICES.liza.locale,
        speed: 0.9
      });
    }
    setStatus('🎙️ Лиза закреплена как HeyGen Elizabeth – Friendly. Точная озвучка не заменяется другим голосом; внешний HeyGen TTS не подключён к браузерной NOVA.');
    throw new Error('Exact Liza provider is not connected. Automatic fallback is disabled.');
  }

  async function speakNow(text, voice = getDefaultVoice()) {
    const clean = cleanRussianText(text);
    if (!clean) return;
    const key = normalizeVoice(voice);
    if (key === 'liza') return speakExactLiza(clean);

    const token = playbackToken;
    if (!userUnlockedAudio) getAudio();
    setStatus(`Первый запуск Piper ${VOICES[key].label} может скачать модель один раз. Платных кредитов нет.`);
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
      console.warn('[NOVA Russian TTS] selected voice failed:', error);
      setStatus(`Не удалось загрузить Piper ${VOICES[key].label}. Голос НЕ заменён другим — попробуй ещё раз.`);
      throw error;
    }
  }

  function enqueueSpeak(text, voice = getDefaultVoice()) {
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

  function speak(text, voice = getDefaultVoice()) {
    return enqueueSpeak(text, voice);
  }

  async function speakDialogue(turns) {
    const normalized = (Array.isArray(turns) ? turns : []).map((turn, index) => ({
      voice: normalizeVoice(turn?.voice || (index % 2 ? 'denis' : 'irina')),
      text: cleanRussianText(turn?.text || '')
    })).filter((turn) => turn.text);
    for (let i = 0; i < normalized.length; i++) {
      await enqueueSpeak(normalized[i].text, normalized[i].voice);
    }
  }

  function patchedSpeak(utterance) {
    if (!isRussianUtterance(utterance)) return nativeSpeak(utterance);

    // If the user explicitly picked an iPhone/Mac/system voice in NOVA Notebook,
    // respect that exact system choice and never reroute it to Piper.
    if (utterance?.voice) return nativeSpeak(utterance);

    enqueueSpeak(utterance?.text || '', getDefaultVoice()).catch(() => {});
  }

  function patchedCancel() {
    stopNeuralAudio();
    nativeCancel();
    setStatus('Русский TTS остановлен.');
  }

  try {
    Object.defineProperty(synth, 'speak', { configurable: true, value: patchedSpeak });
    Object.defineProperty(synth, 'cancel', { configurable: true, value: patchedCancel });
  } catch (_) {
    try { synth.speak = patchedSpeak; synth.cancel = patchedCancel; } catch (_) {}
  }

  function injectVoicePresetOptions() {
    const selectedPreset = getDefaultVoice();
    ['#novaTranslateVoice', '#novaYoutubeVoice'].forEach((selector) => {
      const select = document.querySelector(selector);
      if (!select) return;

      if (!select.querySelector('option[value="nova:liza"]')) {
        const liza = document.createElement('option');
        liza.value = 'nova:liza';
        liza.textContent = 'Лиза — Elizabeth Friendly · точный выбранный голос';
        select.insertBefore(liza, select.firstChild?.nextSibling || null);
      }
      if (!select.querySelector('option[value="nova:irina"]')) {
        const irina = document.createElement('option');
        irina.value = 'nova:irina';
        irina.textContent = 'Ирина — Piper · бесплатно на устройстве';
        const liza = select.querySelector('option[value="nova:liza"]');
        liza?.insertAdjacentElement('afterend', irina);
      }

      if (!select.dataset.novaVoicePresetBound) {
        select.dataset.novaVoicePresetBound = '1';
        select.addEventListener('change', () => {
          if (select.value === 'nova:liza') setDefaultVoice('liza');
          else if (select.value === 'nova:irina') setDefaultVoice('irina');
        });
      }

      if (!select.value || select.value.startsWith('nova:')) {
        select.value = selectedPreset === 'liza' ? 'nova:liza' : 'nova:irina';
      }
    });
  }

  function addUiNote() {
    const modal = document.querySelector('#novaNotebookModal');
    if (!modal) return;
    injectVoicePresetOptions();
    if (modal.querySelector('#novaNeuralTtsNote')) return;
    const anchor = modal.querySelector('.nova-note-meta');
    if (!anchor) return;
    const note = document.createElement('div');
    note.id = 'novaNeuralTtsNote';
    note.className = 'nova-note-meta';
    note.textContent = '🇷🇺 Голос фиксируется: Лиза = HeyGen Elizabeth – Friendly (точный выбранный профиль), Ирина = Piper ru_RU-irina-medium (бесплатно). NOVA больше не подменяет выбранный русский голос.';
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

  const observer = new MutationObserver(() => {
    addUiNote();
    injectVoicePresetOptions();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.NovaRussianTTS = Object.freeze({
    voices: VOICES,
    exactLiza: VOICES.liza,
    defaultNarrator: getDefaultVoice(),
    defaultMale: 'denis',
    getDefaultVoice,
    setDefaultVoice,
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