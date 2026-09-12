(() => {
  'use strict';

  if (window.NovaChechenTTS) return;

  const VERSION = '1.1.0';
  const MODEL_ID = 'facebook/mms-tts-che';
  const MAX_TEXT_CHARS = 1200;
  const WORKER_URL_KEY = 'nova.remoteGpu.url';
  const WORKER_TOKEN_KEY = 'nova.remoteGpu.token';
  const RAMZAN = Object.freeze({
    id: MODEL_ID, key: 'ramzan', label: 'Рамзан — чеченский', locale: 'ce-RU',
    provider: 'meta-mms-worker', paidApi: false, workerRequired: true
  });
  let audio = null;
  let objectUrl = '';
  let requestController = null;

  function setStatus(message) {
    const own = document.querySelector('#novaRamzanStatus');
    if (own) own.textContent = message;
    const global = document.querySelector('#statusText');
    if (global) global.textContent = message;
  }

  function workerConfig() {
    let url = '';
    let token = '';
    try {
      url = String(localStorage.getItem(WORKER_URL_KEY) || '').trim().replace(/\/+$/, '');
      token = String(localStorage.getItem(WORKER_TOKEN_KEY) || '').trim();
    } catch (_) {}
    return { url, token };
  }

  function getAudio() {
    if (audio) return audio;
    audio = document.createElement('audio');
    audio.id = 'novaChechenTtsAudio';
    audio.preload = 'auto';
    audio.playsInline = true;
    audio.style.display = 'none';
    document.body.appendChild(audio);
    return audio;
  }

  function stop() {
    requestController?.abort();
    requestController = null;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = '';
    setStatus('Рамзан остановлен.');
  }

  async function speak(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    if (clean.length > MAX_TEXT_CHARS) throw new Error(`Текст длиннее ${MAX_TEXT_CHARS} символов.`);
    const config = workerConfig();
    if (!config.url || !config.token) {
      const error = new Error('Подключи бесплатный NOVA GPU Worker или Colab в Motion Studio, затем повтори.');
      setStatus(error.message);
      throw error;
    }

    stop();
    requestController = new AbortController();
    setStatus('Рамзан создаёт чеченскую озвучку… Первый запуск может скачать модель один раз.');
    try {
      const response = await fetch(`${config.url}/tts/chechen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-NOVA-Token': config.token },
        body: JSON.stringify({ text: clean, voice: 'ramzan' }),
        signal: requestController.signal
      });
      if (!response.ok) {
        let detail = '';
        try { detail = String((await response.json())?.detail || ''); } catch (_) {}
        throw new Error(detail || `Worker вернул HTTP ${response.status}.`);
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error('Worker вернул пустой аудиофайл.');
      const player = getAudio();
      objectUrl = URL.createObjectURL(blob);
      player.src = objectUrl;
      await new Promise((resolve, reject) => {
        player.onended = resolve;
        player.onerror = () => reject(new Error('Не удалось воспроизвести WAV голоса Рамзан.'));
        const playPromise = player.play();
        if (playPromise?.catch) playPromise.catch(reject);
      });
      setStatus('Рамзан — готово.');
    } catch (error) {
      if (error?.name !== 'AbortError') setStatus(`Рамзан: ${error?.message || error}`);
      throw error;
    } finally {
      requestController = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = '';
    }
  }

  async function sing(text, options = {}) {
    const lyrics = String(text || '').trim();
    if (!lyrics) return;
    if (lyrics.length > MAX_TEXT_CHARS) throw new Error(`Текст длиннее ${MAX_TEXT_CHARS} символов.`);
    const config = workerConfig();
    if (!config.url || !config.token) {
      const error = new Error('Подключи бесплатный NOVA GPU Worker или Colab в Motion Studio, затем повтори.');
      setStatus(error.message);
      throw error;
    }
    stop();
    requestController = new AbortController();
    setStatus('Рамзан создаёт ритмический певческий тест…');
    try {
      const response = await fetch(`${config.url}/tts/chechen-song`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-NOVA-Token': config.token },
        body: JSON.stringify({ lyrics, bpm: Number(options.bpm || 82), voice: 'ramzan' }),
        signal: requestController.signal
      });
      if (!response.ok) {
        let detail = '';
        try { detail = String((await response.json())?.detail || ''); } catch (_) {}
        throw new Error(detail || `Worker вернул HTTP ${response.status}.`);
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error('Worker вернул пустой певческий тест.');
      const player = getAudio();
      objectUrl = URL.createObjectURL(blob);
      player.src = objectUrl;
      await player.play();
      setStatus('Рамзан поёт тест. Это ритмический TTS-превью, не клон певца.');
    } catch (error) {
      if (error?.name !== 'AbortError') setStatus(`Рамзан: ${error?.message || error}`);
      throw error;
    } finally {
      requestController = null;
    }
  }

  function createUi() {
    const quickActions = document.querySelector('#quickActions');
    if (quickActions && !document.querySelector('#novaRamzanLaunch')) {
      const button = document.createElement('button');
      button.id = 'novaRamzanLaunch';
      button.className = 'action-btn';
      button.type = 'button';
      button.innerHTML = '<span>🗣️</span><b>Рамзан</b>';
      quickActions.appendChild(button);
    }
    if (!document.querySelector('#novaRamzanTtsModal')) {
      const modal = document.createElement('section');
      modal.id = 'novaRamzanTtsModal';
      modal.className = 'photo-studio-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'novaRamzanTitle');
      modal.hidden = true;
      modal.innerHTML = `
        <div class="photo-studio-card" style="max-width:680px">
          <div class="photo-studio-head"><h2 id="novaRamzanTitle">🗣️ Рамзан — чеченский TTS</h2><button id="novaRamzanClose" class="photo-studio-close" type="button" aria-label="Закрыть">×</button></div>
          <p class="photo-studio-note">Бесплатная модель Meta MMS на подключённом NOVA Worker/Colab. «Спеть тест» ритмически растягивает TTS по нотам и добавляет оригинальную гитарную подложку; это не клон певца.</p>
          <textarea id="novaRamzanText" maxlength="${MAX_TEXT_CHARS}" rows="9" style="width:100%;box-sizing:border-box;border-radius:14px;padding:12px" placeholder="Вставь чеченский текст…">Хьо сан безам бу. Хьо сан дог ду. Суна хьо веза.</textarea>
          <label class="nova-note-field compact" style="display:block;margin-top:10px">Темп, BPM <input id="novaRamzanBpm" type="number" min="60" max="140" value="82" style="width:90px"></label>
          <div class="studio-actions"><button id="novaRamzanSpeak" class="studio-generate" type="button">▶ Произнести</button><button id="novaRamzanSing" class="studio-generate" type="button">🎵 Спеть тест</button><button id="novaRamzanStop" class="studio-reset" type="button">■ Стоп</button></div>
          <div id="novaRamzanStatus" class="studio-result">Подключи бесплатный Worker в Motion Studio и нажми «Произнести».</div>
        </div>`;
      document.body.appendChild(modal);
    }
    const modal = document.querySelector('#novaRamzanTtsModal');
    document.querySelector('#novaRamzanLaunch')?.addEventListener('click', () => { modal.hidden = false; });
    document.querySelector('#novaRamzanClose')?.addEventListener('click', () => { modal.hidden = true; });
    document.querySelector('#novaRamzanStop')?.addEventListener('click', stop);
    document.querySelector('#novaRamzanSpeak')?.addEventListener('click', () => speak(document.querySelector('#novaRamzanText')?.value || '').catch(() => {}));
    document.querySelector('#novaRamzanSing')?.addEventListener('click', () => sing(document.querySelector('#novaRamzanText')?.value || '', { bpm: document.querySelector('#novaRamzanBpm')?.value || 82 }).catch(() => {}));
    modal?.addEventListener('click', (event) => { if (event.target === modal) modal.hidden = true; });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createUi, { once: true });
  else createUi();

  window.NovaChechenTTS = Object.freeze({
    version: VERSION, modelId: MODEL_ID, voices: Object.freeze({ ramzan: RAMZAN }),
    ramzanProfile: RAMZAN, workerConfig, speak, speakRamzan: speak, sing, singRamzan: sing, stop
  });
})();
