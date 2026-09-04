(() => {
  'use strict';

  if (window.__novaNeuralRussianTtsInstalled) return;
  window.__novaNeuralRussianTtsInstalled = true;

  const PIPER_IMPORT = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/+esm';
  const PRESET_KEY = 'novaRussianVoicePreset:v1';
  const MAX_CHUNK_CHARS = 190;

  const IRINA_LOCK = Object.freeze({
    provider: 'piper',
    voiceId: 'ru_RU-irina-medium',
    locale: 'ru-RU',
    pitchFactor: 1,
    formantFactor: 1,
    perVideoVariation: false,
    allowSystemFallback: false,
    allowAutomaticVoiceSubstitution: false,
    allowPitchShift: false,
    allowFormantShift: false,
    allowDemoSampleReuse: false
  });

  const DENIS_PROFILE = Object.freeze({
    provider: 'piper-primary+ios-system-fallback',
    voiceId: 'ru_RU-denis-medium',
    fallbackVoiceIds: Object.freeze(['ru_RU-dmitri-medium', 'ru_RU-ruslan-medium']),
    locale: 'ru-RU',
    gender: 'male',
    preferSystemVoiceOnIOS: false,
    automaticMaleFallback: true,
    pitchFactor: 1,
    rate: 0.92
  });

  const IRINA_RUNTIME_PROFILE = Object.freeze({
    provider: 'piper+ios-female-fallback',
    voiceId: IRINA_LOCK.voiceId,
    locale: IRINA_LOCK.locale,
    gender: 'female',
    preferExactPiper: true,
    automaticFemaleFallback: true,
    pitchFactor: 1,
    rate: 0.94
  });

  const VOICES = Object.freeze({
    liza: Object.freeze({ id: '55f8c0f546884f9cbdefa113f5e7b682', label: 'Лиза — Elizabeth Friendly', provider: 'heygen', locale: 'ru-RU', exactReference: true }),
    irina: Object.freeze({ id: IRINA_LOCK.voiceId, label: 'Ирина', provider: IRINA_LOCK.provider, locale: IRINA_LOCK.locale, gender: 'female', locked: true }),
    denis: Object.freeze({ id: DENIS_PROFILE.voiceId, label: 'Денис — мужской RU', provider: DENIS_PROFILE.provider, locale: DENIS_PROFILE.locale, gender: DENIS_PROFILE.gender })
  });

  const synth = window.speechSynthesis;
  const hasNativeSpeech = Boolean(synth && typeof SpeechSynthesisUtterance !== 'undefined');
  const nativeSpeak = hasNativeSpeech ? synth.speak.bind(synth) : null;
  const nativeCancel = hasNativeSpeech ? synth.cancel.bind(synth) : null;

  let piper = null;
  let piperLoading = null;
  let pronunciationLoading = null;
  let diagnosticsLoading = null;
  let audio = null;
  let playbackToken = 0;
  let currentBlobUrl = '';
  let queue = Promise.resolve();
  let queuedCount = 0;
  let userUnlockedAudio = false;
  let activeSystemSpeechCancel = null;

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

  function loadLocalScript(src, marker) {
    const existing = document.querySelector(`script[data-${marker}]`);
    if (existing) {
      return new Promise((resolve) => {
        if (existing.dataset.loaded === '1') return resolve();
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => resolve(), { once: true });
      });
    }
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = src;
      script.defer = true;
      script.dataset[marker] = '1';
      script.addEventListener('load', () => { script.dataset.loaded = '1'; resolve(); }, { once: true });
      script.addEventListener('error', () => resolve(), { once: true });
      document.head.appendChild(script);
    });
  }

  async function ensurePronunciation() {
    if (window.NovaRussianPronunciation?.normalize) return window.NovaRussianPronunciation;
    if (!pronunciationLoading) {
      pronunciationLoading = loadLocalScript('./nova-russian-pronunciation.js?v=28.3.0', 'novaPronunciation')
        .then(() => window.NovaRussianPronunciation || null)
        .finally(() => { pronunciationLoading = null; });
    }
    return pronunciationLoading;
  }

  async function ensureDiagnostics() {
    if (window.NovaTtsDiagnostics?.run) return window.NovaTtsDiagnostics;
    if (!diagnosticsLoading) {
      diagnosticsLoading = loadLocalScript('./nova-tts-diagnostics.js?v=28.3.0', 'novaTtsDiagnostics')
        .then(() => window.NovaTtsDiagnostics || null)
        .finally(() => { diagnosticsLoading = null; });
    }
    return diagnosticsLoading;
  }

  function decodeEntities(text) {
    const input = String(text || '');
    if (!/[&][#a-z0-9]+;/i.test(input)) return input;
    const el = document.createElement('textarea');
    el.innerHTML = input;
    return el.value;
  }

  function basicClean(text) {
    return decodeEntities(text)
      .replace(/\u00a0/g, ' ')
      .replace(/[“”„«»]/g, '"')
      .replace(/[’‘]/g, "'")
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/([!?]){2,}/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cleanRussianText(text) {
    const clean = basicClean(text);
    const pronunciation = window.NovaRussianPronunciation;
    if (pronunciation && typeof pronunciation.normalize === 'function') {
      try { return pronunciation.normalize(clean); } catch (_) {}
    }
    return clean;
  }

  function normalizeVoice(value) {
    const raw = String(value || '').toLowerCase().replace(/^nova:/, '');
    if (raw === 'elizabeth' || raw === 'elizabeth-friendly' || raw === 'lisa') return 'liza';
    return VOICES[raw] ? raw : 'irina';
  }

  function getDefaultVoice() {
    try {
      return normalizeVoice(localStorage.getItem(PRESET_KEY) || 'irina');
    } catch (_) {
      return 'irina';
    }
  }

  function setDefaultVoice(value) {
    const selected = normalizeVoice(value);
    try { localStorage.setItem(PRESET_KEY, selected); } catch (_) {}
    injectVoicePresetOptions();
    return selected;
  }

  function isIOSDevice() {
    const ua = String(navigator.userAgent || '');
    return /iPhone|iPad|iPod/i.test(ua)
      || (navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1);
  }

  const MALE_VOICE_RE = /(yuri|yury|jurij|юрий|maxim|maksim|максим|alexander|aleksandr|александр|alexey|aleksey|алексей|nikolai|nikolay|николай|pavel|павел|ivan|иван|mikhail|михаил|dmitri|dmitry|дмитрий|sergey|sergei|сергей|male|man|мужск)/i;
  const FEMALE_VOICE_RE = /(milena|милена|irina|ирина|alena|алена|tatyana|tatiana|татьяна|katya|katerina|катерина|female|woman|женск)/i;

  function scoreMaleRussianVoice(voice) {
    const name = String(voice?.name || '');
    const lang = String(voice?.lang || '').toLowerCase();
    if (!lang.startsWith('ru')) return -1000;
    let score = lang === 'ru-ru' ? 80 : 60;
    if (MALE_VOICE_RE.test(name)) score += 120;
    if (FEMALE_VOICE_RE.test(name)) score -= 180;
    if (/premium|enhanced|siri|apple/i.test(name)) score += 24;
    if (voice?.localService) score += 12;
    if (voice?.default) score += 4;
    return score;
  }

  function scoreFemaleRussianVoice(voice) {
    const name = String(voice?.name || '');
    const lang = String(voice?.lang || '').toLowerCase();
    if (!lang.startsWith('ru')) return -1000;
    let score = lang === 'ru-ru' ? 80 : 60;
    if (/irina|ирина/i.test(name)) score += 180;
    else if (FEMALE_VOICE_RE.test(name)) score += 120;
    if (MALE_VOICE_RE.test(name)) score -= 180;
    if (/premium|enhanced|siri|apple/i.test(name)) score += 24;
    if (voice?.localService) score += 12;
    if (voice?.default) score += 4;
    return score;
  }

  function findClosestMaleRussianVoice() {
    if (!hasNativeSpeech) return null;
    const voices = synth.getVoices?.() || [];
    const russian = voices.filter((voice) => String(voice?.lang || '').toLowerCase().startsWith('ru'));
    if (!russian.length) return null;
    const ranked = russian
      .map((voice) => ({ voice, score: scoreMaleRussianVoice(voice) }))
      .sort((a, b) => b.score - a.score);
    const explicitMale = ranked.find((item) => MALE_VOICE_RE.test(String(item.voice?.name || '')) && !FEMALE_VOICE_RE.test(String(item.voice?.name || '')));
    if (explicitMale) return explicitMale.voice;
    const nonFemale = ranked.find((item) => !FEMALE_VOICE_RE.test(String(item.voice?.name || '')));
    return nonFemale?.voice || null;
  }

  function waitForMaleRussianVoice(timeoutMs = 900) {
    const immediate = findClosestMaleRussianVoice();
    if (immediate) return Promise.resolve(immediate);
    if (!hasNativeSpeech || typeof synth.addEventListener !== 'function') return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        synth.removeEventListener('voiceschanged', onVoices);
        resolve(findClosestMaleRussianVoice());
      };
      const onVoices = () => finish();
      const timer = setTimeout(finish, timeoutMs);
      synth.addEventListener('voiceschanged', onVoices, { once: true });
    });
  }

  function findClosestFemaleRussianVoice() {
    if (!hasNativeSpeech) return null;
    const voices = synth.getVoices?.() || [];
    const russian = voices.filter((voice) => String(voice?.lang || '').toLowerCase().startsWith('ru'));
    if (!russian.length) return null;
    const ranked = russian
      .map((voice) => ({ voice, score: scoreFemaleRussianVoice(voice) }))
      .sort((a, b) => b.score - a.score);
    const explicitIrina = ranked.find((item) => /irina|ирина/i.test(String(item.voice?.name || '')));
    if (explicitIrina) return explicitIrina.voice;
    const explicitFemale = ranked.find((item) => FEMALE_VOICE_RE.test(String(item.voice?.name || '')) && !MALE_VOICE_RE.test(String(item.voice?.name || '')));
    if (explicitFemale) return explicitFemale.voice;
    const nonMale = ranked.find((item) => !MALE_VOICE_RE.test(String(item.voice?.name || '')));
    return nonMale?.voice || null;
  }

  function waitForFemaleRussianVoice(timeoutMs = 900) {
    const immediate = findClosestFemaleRussianVoice();
    if (immediate) return Promise.resolve(immediate);
    if (!hasNativeSpeech || typeof synth.addEventListener !== 'function') return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        synth.removeEventListener('voiceschanged', onVoices);
        resolve(findClosestFemaleRussianVoice());
      };
      const onVoices = () => finish();
      const timer = setTimeout(finish, timeoutMs);
      synth.addEventListener('voiceschanged', onVoices, { once: true });
    });
  }

  function cancelActiveSystemSpeech() {
    const cancel = activeSystemSpeechCancel;
    activeSystemSpeechCancel = null;
    if (typeof cancel === 'function') {
      try { cancel(); } catch (_) {}
    }
  }

  function speakWithSystemVoice(text, voice, profile, label) {
    if (!hasNativeSpeech || !nativeSpeak) return Promise.reject(new Error('Системный TTS недоступен.'));
    const clean = cleanRussianText(text);
    if (!clean) return Promise.resolve();

    cancelActiveSystemSpeech();
    nativeCancel?.();

    return new Promise((resolve, reject) => {
      let settled = false;
      const utterance = new SpeechSynthesisUtterance(clean);
      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (activeSystemSpeechCancel === cancelCurrent) activeSystemSpeechCancel = null;
        utterance.onend = null;
        utterance.onerror = null;
        if (error) reject(error);
        else resolve();
      };
      const cancelCurrent = () => finish();

      utterance.lang = String(voice.lang || profile.locale);
      utterance.voice = voice;
      utterance.rate = profile.rate;
      utterance.pitch = profile.pitchFactor;
      utterance.volume = 1;
      utterance.onend = () => finish();
      utterance.onerror = (event) => {
        const code = String(event?.error || '').toLowerCase();
        if (code === 'canceled' || code === 'interrupted') return finish();
        finish(event?.error instanceof Error ? event.error : new Error(`Ошибка системного голоса ${label}.`));
      };

      activeSystemSpeechCancel = cancelCurrent;
      try { synth.resume?.(); } catch (_) {}
      setStatus(`🔊 ${label} · ${voice.name || profile.locale} · ${utterance.lang}`);
      nativeSpeak(utterance);
    });
  }

  async function speakDenisSystem(text) {
    const voice = await waitForMaleRussianVoice();
    if (!voice) throw new Error('Мужской русский системный голос на устройстве не найден.');
    return speakWithSystemVoice(text, voice, DENIS_PROFILE, 'Денис');
  }

  async function speakIrinaSystem(text) {
    const voice = await waitForFemaleRussianVoice();
    if (!voice) throw new Error('Женский русский системный голос на устройстве не найден.');
    return speakWithSystemVoice(text, voice, IRINA_RUNTIME_PROFILE, 'Ирина');
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

  function getVoiceSignature(voice = 'irina') {
    const key = normalizeVoice(voice);
    const item = VOICES[key];
    if (!item) return '';
    if (key === 'irina') return `${IRINA_LOCK.provider}:${IRINA_LOCK.voiceId}:${IRINA_LOCK.locale}:pitch=${IRINA_LOCK.pitchFactor}:formant=${IRINA_LOCK.formantFactor}`;
    return `${item.provider}:${item.id}:${item.locale}`;
  }

  function assertIrinaLocked() {
    if (VOICES.irina.id !== IRINA_LOCK.voiceId || VOICES.irina.provider !== IRINA_LOCK.provider) throw new Error('Irina voice lock mismatch.');
    if (IRINA_LOCK.pitchFactor !== 1 || IRINA_LOCK.formantFactor !== 1 || IRINA_LOCK.perVideoVariation !== false) throw new Error('Irina timbre/pitch lock is not intact.');
    return true;
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
        .then((module) => { piper = module; return module; })
        .catch((error) => { piperLoading = null; throw error; });
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
    await ensurePronunciation();
    const clean = cleanRussianText(text);
    if (!clean) return [];
    const key = normalizeVoice(voice);
    if (key === 'liza') throw new Error('Лиза использует точный HeyGen Elizabeth Friendly; Piper не должен подменять этот голос.');
    if (key === 'irina') assertIrinaLocked();

    const chunks = splitForSpeech(clean);
    const engine = await ensurePiper();
    const blobs = [];
    let denisVoiceId = DENIS_PROFILE.voiceId;

    for (let index = 0; index < chunks.length; index++) {
      if (key !== 'denis') {
        const blob = await engine.predict(
          { text: chunks[index], voiceId: IRINA_LOCK.voiceId },
          (progress) => {
            if (typeof onProgress === 'function') onProgress({ ...progress, index, totalChunks: chunks.length, voice: key, voiceSignature: getVoiceSignature(key) });
          }
        );
        blobs.push(blob);
        continue;
      }

      const candidates = [denisVoiceId, ...DENIS_PROFILE.fallbackVoiceIds.filter((id) => id !== denisVoiceId)];
      let lastError = null;
      let blob = null;
      for (const voiceId of candidates) {
        try {
          blob = await engine.predict(
            { text: chunks[index], voiceId },
            (progress) => {
              if (typeof onProgress === 'function') onProgress({
                ...progress,
                index,
                totalChunks: chunks.length,
                voice: key,
                voiceId,
                voiceSignature: `piper:${voiceId}:${DENIS_PROFILE.locale}`
              });
            }
          );
          denisVoiceId = voiceId;
          if (voiceId !== DENIS_PROFILE.voiceId) {
            setStatus(`🔊 Денис: основной голос недоступен, использую резервный мужской Piper ${voiceId}.`);
          }
          break;
        } catch (error) {
          lastError = error;
          console.warn('[NOVA Russian TTS] Piper male voice failed:', voiceId, error);
        }
      }
      if (!blob) throw lastError || new Error('Не удалось загрузить мужской голос Денис.');
      blobs.push(blob);
    }
    return blobs;
  }

  function synthesizeIrina(text, onProgress) {
    assertIrinaLocked();
    return synthesize(text, 'irina', onProgress);
  }

  async function speakExactLiza(text) {
    await ensurePronunciation();
    const clean = cleanRussianText(text);
    if (!clean) return;
    const provider = window.NovaExactLizaTTS;
    if (provider && typeof provider.speak === 'function') {
      return provider.speak(clean, { voiceId: VOICES.liza.id, locale: VOICES.liza.locale, speed: 0.9 });
    }
    setStatus('🎙️ Лиза закреплена как HeyGen Elizabeth – Friendly. Точная озвучка не заменяется другим голосом; внешний HeyGen TTS не подключён к браузерной NOVA.');
    throw new Error('Exact Liza provider is not connected. Automatic fallback is disabled.');
  }

  async function speakNow(text, voice = getDefaultVoice()) {
    await ensurePronunciation();
    const clean = cleanRussianText(text);
    if (!clean) return;
    const key = normalizeVoice(voice);
    if (key === 'liza') return speakExactLiza(clean);
    if (key === 'irina') assertIrinaLocked();

    // Denis is Piper-first on iPhone too. This avoids Safari returning an empty
    // or female-only system voice list after a quick Irina -> Denis switch.
    if (key === 'denis' && DENIS_PROFILE.preferSystemVoiceOnIOS && isIOSDevice()) {
      try {
        return await speakDenisSystem(clean);
      } catch (systemError) {
        console.info('[NOVA Russian TTS] iOS male ru-RU voice unavailable; continuing with Piper Denis:', systemError);
      }
    }

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
      if (key === 'irina' && IRINA_RUNTIME_PROFILE.automaticFemaleFallback) {
        try {
          setStatus('Ирина: Piper недоступен, включаю женский русский голос ru-RU на iPhone…');
          return await speakIrinaSystem(clean);
        } catch (fallbackError) {
          console.warn('[NOVA Russian TTS] Irina system fallback failed:', fallbackError);
          setStatus('Ирина: женский ru-RU голос не найден. Проверь установленные голоса iPhone или интернет для Piper.');
          throw fallbackError;
        }
      }
      if (key === 'denis' && DENIS_PROFILE.automaticMaleFallback) {
        try {
          setStatus('Ищу ближайший мужской русский голос ru-RU на устройстве…');
          return await speakDenisSystem(clean);
        } catch (fallbackError) {
          console.warn('[NOVA Russian TTS] Denis system fallback failed:', fallbackError);
          setStatus('Денис: мужской ru-RU голос не найден. Проверь установленные голоса iPhone или интернет для Piper.');
          throw fallbackError;
        }
      }
      setStatus(`Не удалось загрузить Piper ${VOICES[key].label}. Попробуй ещё раз.`);
      throw error;
    }
  }

  function enqueueSpeak(text, voice = getDefaultVoice()) {
    const clean = basicClean(text);
    if (!clean) return Promise.resolve();
    queuedCount += 1;
    const jobToken = playbackToken;
    const job = async () => {
      if (jobToken !== playbackToken) return;
      try { await speakNow(clean, voice); }
      finally { queuedCount = Math.max(0, queuedCount - 1); }
    };
    queue = queue.then(job, job);
    return queue;
  }

  function speak(text, voice = getDefaultVoice()) { return enqueueSpeak(text, voice); }
  function speakIrina(text) { assertIrinaLocked(); return enqueueSpeak(text, 'irina'); }
  function speakDenis(text) { return enqueueSpeak(text, 'denis'); }

  async function speakDialogue(turns) {
    const normalized = (Array.isArray(turns) ? turns : []).map((turn, index) => ({
      voice: normalizeVoice(turn?.voice || (index % 2 ? 'denis' : 'irina')),
      text: basicClean(turn?.text || '')
    })).filter((turn) => turn.text);
    for (let i = 0; i < normalized.length; i++) await enqueueSpeak(normalized[i].text, normalized[i].voice);
  }

  function patchedSpeak(utterance) {
    if (!nativeSpeak || !isRussianUtterance(utterance)) return nativeSpeak?.(utterance);
    if (utterance?.voice) return nativeSpeak(utterance);
    enqueueSpeak(utterance?.text || '', getDefaultVoice()).catch(() => {});
  }

  function patchedCancel() {
    stopNeuralAudio();
    cancelActiveSystemSpeech();
    nativeCancel?.();
    setStatus('Русский TTS остановлен.');
  }

  if (hasNativeSpeech) {
    try {
      Object.defineProperty(synth, 'speak', { configurable: true, value: patchedSpeak });
      Object.defineProperty(synth, 'cancel', { configurable: true, value: patchedCancel });
    } catch (_) {
      try { synth.speak = patchedSpeak; synth.cancel = patchedCancel; } catch (_) {}
    }
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
        irina.textContent = 'Ирина — женский ru-RU · Piper + iPhone fallback';
        const liza = select.querySelector('option[value="nova:liza"]');
        liza?.insertAdjacentElement('afterend', irina);
      }
      if (!select.querySelector('option[value="nova:denis"]')) {
        const denis = document.createElement('option');
        denis.value = 'nova:denis';
        denis.textContent = 'Денис — мужской ru-RU · авто iPhone';
        const irina = select.querySelector('option[value="nova:irina"]');
        irina?.insertAdjacentElement('afterend', denis);
      }
      if (!select.dataset.novaVoicePresetBound) {
        select.dataset.novaVoicePresetBound = '1';
        select.addEventListener('change', () => {
          if (select.value === 'nova:liza') setDefaultVoice('liza');
          else if (select.value === 'nova:irina') setDefaultVoice('irina');
          else if (select.value === 'nova:denis') setDefaultVoice('denis');
        });
      }
      if (!select.value || select.value.startsWith('nova:')) {
        select.value = selectedPreset === 'liza' ? 'nova:liza' : selectedPreset === 'denis' ? 'nova:denis' : 'nova:irina';
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
    note.textContent = '🇷🇺 Голоса NOVA: Ирина — женский ru-RU (Piper Irina, при сбое только женский системный fallback). Денис — мужской ru-RU (на iPhone мужской системный голос, при необходимости Piper Denis). При переключении женский и мужской профили не смешиваются.';
    anchor.insertAdjacentElement('afterend', note);
  }

  function loadMediaStudio() {
    if (document.querySelector('script[data-nova-media-studio]')) return;
    const script = document.createElement('script');
    script.src = './nova-media-studio.js?v=28.0.1';
    script.defer = true;
    script.dataset.novaMediaStudio = '1';
    document.head.appendChild(script);
  }

  function init() {
    installUnlockListeners();
    addUiNote();
    loadMediaStudio();
    ensurePronunciation()
      .then(() => ensureDiagnostics())
      .then((diagnostics) => diagnostics?.run?.({ updateUi: false }))
      .catch(() => {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  const observer = new MutationObserver(() => { addUiNote(); injectVoicePresetOptions(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.NovaRussianTTS = Object.freeze({
    voices: VOICES,
    irinaLock: IRINA_LOCK,
    irinaRuntimeProfile: IRINA_RUNTIME_PROFILE,
    denisProfile: DENIS_PROFILE,
    exactLiza: VOICES.liza,
    defaultNarrator: getDefaultVoice(),
    defaultMale: 'denis',
    getDefaultVoice,
    setDefaultVoice,
    getVoiceSignature,
    assertIrinaLocked,
    cleanText: cleanRussianText,
    splitForSpeech,
    synthesize,
    synthesizeIrina,
    speak,
    speakIrina,
    speakDenis,
    speakDialogue,
    findClosestMaleRussianVoice,
    findClosestFemaleRussianVoice,
    stop: patchedCancel,
    preload: ensurePiper,
    preloadPronunciation: ensurePronunciation,
    diagnostics: () => window.NovaTtsDiagnostics?.run?.() || null,
    unlock: unlockAudio,
    queueSize: () => queuedCount
  });
})();