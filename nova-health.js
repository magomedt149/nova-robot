(() => {
  'use strict';
  if (window.NovaHealth) return;

  const BUILD = '27.12.0';
  const state = {
    startedAt: Date.now(),
    errors: [],
    warnings: [],
    lastReport: null
  };

  const criticalDom = [
    'statusText', 'chat', 'messageInput', 'composer', 'micBtn',
    'videoStudioBtn', 'quickActions'
  ];

  const moduleChecks = [
    ['NovaWhisper', 'Whisper'],
    ['NovaVideoPro', 'Video PRO'],
    ['NovaMediaLibrary', 'Медиатека'],
    ['NovaUnifiedVideoStudio', 'Video Studio']
  ];

  function clean(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, 500);
  }

  function remember(kind, value) {
    const item = { at: new Date().toISOString(), message: clean(value) };
    const list = kind === 'error' ? state.errors : state.warnings;
    if (!item.message || list.some((entry) => entry.message === item.message)) return;
    list.push(item);
    if (list.length > 30) list.shift();
  }

  window.addEventListener('error', (event) => {
    const target = event.target;
    if (target && target !== window && target.tagName === 'SCRIPT') {
      remember('error', 'Не загрузился модуль: ' + (target.getAttribute('src') || 'script'));
      return;
    }
    remember('error', event.error?.message || event.message || 'JavaScript error');
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    remember('error', event.reason?.message || event.reason || 'Unhandled promise rejection');
  });

  function setStatus(message) {
    const node = document.getElementById('statusText');
    if (node) node.textContent = message;
  }

  function summarize(report) {
    if (report.ok) {
      const ready = report.modules.filter((x) => x.ok).length;
      return `✅ NOVA проверена: ${ready}/${report.modules.length} ключевых модулей готовы`;
    }
    return `⚠️ NOVA: найдено проблем — ${report.failures.length}`;
  }

  async function readVersion() {
    try {
      const response = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      return { ok: true, version: String(data.version || ''), data };
    } catch (error) {
      return { ok: false, version: '', error: clean(error?.message || error) };
    }
  }

  async function run(options = {}) {
    const failures = [];
    const warnings = [];

    for (const id of criticalDom) {
      if (!document.getElementById(id)) failures.push('DOM #' + id);
    }

    const modules = moduleChecks.map(([globalName, label]) => ({
      globalName,
      label,
      ok: Boolean(window[globalName])
    }));
    modules.filter((x) => !x.ok).forEach((x) => warnings.push('Модуль не готов: ' + x.label));

    const capabilities = {
      serviceWorker: 'serviceWorker' in navigator,
      speechSynthesis: 'speechSynthesis' in window,
      microphone: Boolean(navigator.mediaDevices?.getUserMedia),
      mediaRecorder: 'MediaRecorder' in window,
      canvasCapture: Boolean(window.HTMLCanvasElement?.prototype?.captureStream),
      indexedDB: 'indexedDB' in window
    };

    if (!capabilities.microphone) warnings.push('Микрофон API недоступен');
    if (!capabilities.mediaRecorder) warnings.push('MediaRecorder недоступен');
    if (!capabilities.canvasCapture) warnings.push('Canvas captureStream недоступен — локальный видео-рендер может потребовать Colab');

    const version = await readVersion();
    if (!version.ok) warnings.push('version.json недоступен: ' + version.error);
    else if (version.version && version.version !== BUILD) {
      failures.push(`Версия страницы ${BUILD} ≠ version.json ${version.version}`);
    }

    state.errors.forEach((item) => failures.push('Runtime: ' + item.message));
    state.warnings.forEach((item) => warnings.push('Runtime: ' + item.message));

    const report = {
      ok: failures.length === 0,
      build: BUILD,
      version: version.version || BUILD,
      failures: [...new Set(failures)],
      warnings: [...new Set(warnings)],
      modules,
      capabilities,
      checkedAt: new Date().toISOString()
    };
    state.lastReport = report;

    if (!report.ok) setStatus(summarize(report));
    else if (options.announce) setStatus(summarize(report));

    window.dispatchEvent(new CustomEvent('nova:health-report', { detail: report }));
    return report;
  }

  async function repair(options = {}) {
    setStatus('NOVA: очищаю старый кэш и обновляю модули…');
    try {
      const registrations = await navigator.serviceWorker?.getRegistrations?.();
      for (const registration of registrations || []) {
        try { await registration.update(); } catch (_) {}
        try { registration.active?.postMessage?.({ type: 'NOVA_CLEAR_APP_CACHES' }); } catch (_) {}
        try { registration.waiting?.postMessage?.({ type: 'NOVA_SKIP_WAITING' }); } catch (_) {}
      }
    } catch (error) {
      remember('warning', 'Service Worker repair: ' + (error?.message || error));
    }

    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys
          .filter((key) => (/^nova-|^tumsoev-motion-/i.test(key)) && key !== 'nova-api-economy-v2')
          .map((key) => caches.delete(key)));
      }
    } catch (error) {
      remember('warning', 'Cache repair: ' + (error?.message || error));
    }

    try { localStorage.setItem('nova:last-repair', new Date().toISOString()); } catch (_) {}
    const report = await run({ announce: false });
    setStatus(report.ok ? '✅ NOVA обновлена. Если экран старый — обнови страницу один раз.' : summarize(report));

    if (options.reload === true) {
      try {
        const key = 'nova:repair-reloaded:' + BUILD;
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, '1');
          location.reload();
        }
      } catch (_) {}
    }
    return report;
  }

  function injectButton() {
    const host = document.getElementById('quickActions');
    if (!host || document.getElementById('novaHealthBtn')) return;
    const button = document.createElement('button');
    button.id = 'novaHealthBtn';
    button.className = 'action-btn';
    button.type = 'button';
    button.innerHTML = '<span>🩺</span><b>ПРОВЕРКА</b>';
    button.addEventListener('click', async () => {
      const report = await run({ announce: true });
      if (!report.ok || report.warnings.length) {
        await repair({ reload: false });
      }
    });
    host.appendChild(button);
  }

  window.NovaHealth = Object.freeze({
    version: BUILD,
    run,
    repair,
    getLastReport: () => state.lastReport,
    getRuntimeErrors: () => state.errors.slice()
  });

  const boot = () => {
    injectButton();
    setTimeout(() => run({ announce: false }).catch(() => {}), 900);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();