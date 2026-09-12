(() => {
  'use strict';

  if (window.NOVA_COLAB_WOLF_AUTO) return;

  const VERSION = '1.0.0';
  const WOLF_ACTIVE_KEY = 'nova.colab.wolf.active';
  const WOLF_APPROVED_AT_KEY = 'nova.colab.wolf.voiceApprovedAt';
  const WOLF_SHUTDOWN_KEY = 'nova.colab.wolf.autoShutdown';
  const RECOVERY_KEY = 'nova.remoteGpu.recovery';
  const URL_KEY = 'nova.remoteGpu.url';
  const TOKEN_KEY = 'nova.remoteGpu.token';
  const WOLF_NOTEBOOK = 'https://colab.research.google.com/github/magomedt149/nova-robot/blob/main/blender-colab/NOVA_Wolf_Auto_Worker.ipynb';
  const WOLF_PROMPT = '[NOVA_WOLF_AUTO_V1] Ночной серый волк воет на луну на скале. Blender TRUE 3D, один непрерывный полный 360° orbit, 10 секунд, 24 fps, 16:9. FREE ONLY. Без платных API.';
  const ACTIVE_PHASES = new Set(['prepared','submitting','uploading','uploaded','queued','running','final','recovering','promoting','recovered-drive']);

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }
  function safeRemove(key) {
    try { localStorage.removeItem(key); } catch (_) {}
  }
  function recoveryMeta() {
    try { return JSON.parse(safeGet(RECOVERY_KEY) || 'null'); } catch (_) { return null; }
  }
  function scenarioRequested() {
    const params = new URLSearchParams(location.search);
    return params.get('wolf') === '1' || safeGet(WOLF_ACTIVE_KEY) === '1';
  }
  function recentlyVoiceApproved() {
    const stamp = Number(safeGet(WOLF_APPROVED_AT_KEY) || 0);
    return stamp > 0 && Date.now() - stamp < 15 * 60 * 1000;
  }
  function status(text, kind = '') {
    const a = $('remoteStatus');
    if (a) { a.textContent = text; a.dataset.kind = kind; }
    const b = $('remoteRecoveryStatus');
    if (b && /Colab|runtime|Connect Code|MP4|волк/i.test(text)) { b.textContent = text; b.dataset.kind = kind; }
  }

  function configureExactWolfJob() {
    safeSet(WOLF_ACTIVE_KEY, '1');
    safeSet(WOLF_SHUTDOWN_KEY, '1');

    const prompt = $('prompt');
    if (prompt) {
      prompt.value = WOLF_PROMPT;
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
      prompt.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if ($('duration')) $('duration').value = '10';
    if ($('ratio')) $('ratio').value = '16:9';
    if ($('camera')) $('camera').value = 'orbit';
    if ($('remoteEngine')) $('remoteEngine').value = 'blender';
    if ($('remoteQuality')) $('remoteQuality').value = 'final';
    if ($('humanMotionMode')) $('humanMotionMode').value = 'none';
    if ($('remoteAutoRecover')) $('remoteAutoRecover').checked = true;

    const colab = $('remoteColabLink');
    if (colab) colab.href = WOLF_NOTEBOOK;
    $('applyPrompt')?.click();
    status('🐺 NOVA подготовила FREE wolf job: Blender · 10 сек · 24 fps · 16:9 · TRUE 360°.', 'ok');
  }

  function acceptConnectCode(code) {
    if (!scenarioRequested()) return false;
    const text = String(code || '').trim();
    if (!text.startsWith('NOVA_CONNECT=')) return false;
    const input = $('remoteConnectCode');
    if (!input) return false;
    input.value = text;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    status('Connect Code получен. NOVA подключает Colab и продолжает задачу волка…', 'busy');
    return true;
  }

  async function startApprovedWolfJob() {
    if (!scenarioRequested()) return false;
    configureExactWolfJob();

    const meta = recoveryMeta();
    if (meta?.userApprovedRemote && ACTIVE_PHASES.has(String(meta.phase || ''))) {
      status('Восстанавливаю уже одобренную задачу волка. Жду Colab/Connect Code…', 'busy');
      return true;
    }

    const button = $('remoteEasyAction');
    if (!button) {
      status('Motion Studio ещё загружается. Повторяю запуск…', 'busy');
      return false;
    }

    // The exact spoken command is the approval for THIS free Blender job only.
    // We never disable FREE LOCK globally and never approve WanGP/paid services.
    if (!recentlyVoiceApproved()) {
      status('FREE LOCK: для запуска скажи «Нова, включи Colab» ещё раз.', 'error');
      return false;
    }

    const originalConfirm = window.confirm;
    window.confirm = (message) => {
      const text = String(message || '');
      if (scenarioRequested() && recentlyVoiceApproved() && /NOVA FREE LOCK/i.test(text) && /Blender|Remote GPU|3D render/i.test(text)) {
        return true;
      }
      return originalConfirm.call(window, message);
    };
    try {
      button.click();
    } finally {
      window.confirm = originalConfirm;
    }
    return true;
  }

  async function requestRuntimeStop() {
    const endpoint = String(safeGet(URL_KEY) || '').replace(/\/+$/, '');
    const token = String(safeGet(TOKEN_KEY) || '');
    if (!endpoint || !token) throw new Error('Worker URL/token missing');
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(endpoint + '/runtime/shutdown', {
          method: 'POST',
          headers: { 'X-NOVA-Token': token },
          cache: 'no-store'
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return await response.json().catch(() => ({ ok: true }));
      } catch (error) {
        lastError = error;
        if (attempt < 3) await sleep(700 * attempt);
      }
    }
    throw lastError || new Error('runtime shutdown failed');
  }

  async function localizeResultAndStopRuntime() {
    if (!scenarioRequested() || safeGet(WOLF_SHUTDOWN_KEY) !== '1') return false;
    const link = $('remoteResult');
    if (!link || link.dataset.wolfLocalizing === '1' || link.dataset.wolfLocalized === '1') return false;
    const href = String(link.href || '');
    if (!/^https:\/\//i.test(href) || !/\/download\//i.test(href)) return false;

    link.dataset.wolfLocalizing = '1';
    status('MP4 готов. Сначала переношу файл из Colab на телефон; runtime пока НЕ выключаю…', 'busy');
    try {
      const response = await fetch(href, { cache: 'no-store' });
      if (!response.ok) throw new Error('MP4 download HTTP ' + response.status);
      const blob = await response.blob();
      if (!blob.size) throw new Error('получен пустой MP4');

      const localUrl = URL.createObjectURL(blob);
      const filename = link.download || 'NOVA_WOLF_FINAL.mp4';
      link.href = localUrl;
      link.download = filename;
      link.textContent = '🐺 Готово — открыть / сохранить NOVA_WOLF_FINAL.mp4';
      link.dataset.wolfLocalized = '1';
      delete link.dataset.wolfLocalizing;

      const video = $('video');
      if (video) {
        video.src = localUrl;
        video.classList.remove('hidden');
      }

      status(`MP4 (${Math.max(1, Math.round(blob.size / 1024 / 1024))} МБ) перенесён из Colab. Останавливаю runtime…`, 'ok');
      try {
        await requestRuntimeStop();
        status('✅ Волк готов. MP4 сохранён локально в NOVA; Colab runtime получил команду остановки.', 'ok');
      } catch (error) {
        // Result is already safe locally. Do not lose it even if Google refuses
        // the programmatic disconnect; tell the user only about the stop failure.
        status('✅ MP4 уже безопасно в NOVA. Google не подтвердил автоостановку runtime: ' + error.message, 'error');
      }

      safeRemove(WOLF_ACTIVE_KEY);
      safeRemove(WOLF_APPROVED_AT_KEY);
      safeRemove(WOLF_SHUTDOWN_KEY);
      safeRemove('nova.remoteGpu.waitingColab');
      safeRemove('nova.remoteGpu.autoRecover');
      setTimeout(() => {
        safeRemove(URL_KEY);
        safeRemove(TOKEN_KEY);
      }, 1500);
      return true;
    } catch (error) {
      delete link.dataset.wolfLocalizing;
      status('Рендер готов, но локальный перенос MP4 не завершён. Runtime оставляю включённым, чтобы файл не потерялся: ' + error.message, 'error');
      return false;
    }
  }

  function watchForResult() {
    const link = $('remoteResult');
    if (!link) return;
    const observer = new MutationObserver(() => localizeResultAndStopRuntime().catch(() => {}));
    observer.observe(link, { attributes: true, attributeFilter: ['href', 'class'], childList: true });
    const timer = setInterval(() => {
      if (!scenarioRequested() && safeGet(WOLF_SHUTDOWN_KEY) !== '1') {
        clearInterval(timer);
        observer.disconnect();
        return;
      }
      localizeResultAndStopRuntime().catch(() => {});
    }, 1600);
  }

  function installConnectCodeBridge() {
    window.addEventListener('message', (event) => {
      // Colab may post the one-time code from its output frame/window. The code
      // is accepted only while this exact wolf scenario is active.
      if (typeof event.data === 'string') acceptConnectCode(event.data);
      else if (typeof event.data?.nova_connect === 'string') acceptConnectCode(event.data.nova_connect);
    });
  }

  async function boot() {
    if (!scenarioRequested()) return;
    configureExactWolfJob();
    installConnectCodeBridge();
    watchForResult();
    await sleep(320);
    await startApprovedWolfJob();
  }

  window.NOVA_COLAB_WOLF_AUTO = Object.freeze({
    version: VERSION,
    notebook: WOLF_NOTEBOOK,
    configureExactWolfJob,
    startApprovedWolfJob,
    acceptConnectCode,
    localizeResultAndStopRuntime
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => boot().catch(() => {}), { once: true });
  } else {
    boot().catch(() => {});
  }
})();
