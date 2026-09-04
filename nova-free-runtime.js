(() => {
  'use strict';

  const VERSION = '27.2.1';
  const FREE_LOCK_KEY = 'nova.freeLock.version';
  const FREE_UPDATE_CHECK_KEY = 'nova.freeUpdate.lastCheck';
  const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

  const isMeteredNetlifyHost = /(^|\.)netlify\.app$/i.test(location.hostname);
  const isFreeStaticHost =
    /(^|\.)github\.io$/i.test(location.hostname) ||
    /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);

  function safeStorage(action) {
    try { return action(localStorage); } catch (_) { return undefined; }
  }

  function repairFreeLockState() {
    safeStorage((storage) => {
      storage.setItem('nova.remoteGpu.fullAuto', '0');
      storage.setItem('nova.remoteGpu.autoRecover', '0');
      storage.removeItem('nova.remoteGpu.waitingColab');
      storage.setItem(FREE_LOCK_KEY, VERSION);
    });
  }

  function health() {
    const report = {
      version: VERSION,
      freeLock: true,
      host: location.hostname,
      meteredNetlifyHost: isMeteredNetlifyHost,
      freeStaticHost: isFreeStaticHost,
      online: navigator.onLine,
      secureContext: window.isSecureContext,
      serviceWorker: 'serviceWorker' in navigator,
      cacheStorage: 'caches' in window,
      indexedDB: 'indexedDB' in window,
      localStorage: false,
      webGPU: Boolean(navigator.gpu),
      speechSynthesis: 'speechSynthesis' in window,
      speechRecognition: Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
    };

    try {
      const key = '__nova_free_health__';
      localStorage.setItem(key, '1');
      localStorage.removeItem(key);
      report.localStorage = true;
    } catch (_) {}

    report.ok = Boolean(
      report.secureContext &&
      report.serviceWorker &&
      report.cacheStorage &&
      report.indexedDB &&
      report.localStorage
    );
    return report;
  }

  function updateBadge() {
    const badge = document.getElementById('freeModeBadge');
    if (!badge) return;
    const report = health();
    badge.textContent = report.ok ? 'FREE LOCK ✓' : 'FREE LOCK';
    badge.title = [
      'NOVA ' + VERSION,
      'Автоплатежи/API: выключены',
      'Remote GPU auto: выключен',
      'Сеть: ' + (report.online ? 'online' : 'offline'),
      'PWA: ' + (report.serviceWorker ? 'готово' : 'недоступно'),
      isMeteredNetlifyHost ? 'Netlify auto-check: выключен' : 'Free update check: разрешён'
    ].join(' • ');
  }

  async function freeUpdateCheck(force = false) {
    if (!isFreeStaticHost || isMeteredNetlifyHost || !navigator.onLine || !('serviceWorker' in navigator)) {
      return { checked: false, reason: 'host-or-network-policy' };
    }

    const now = Date.now();
    const last = Number(safeStorage((storage) => storage.getItem(FREE_UPDATE_CHECK_KEY)) || 0);
    if (!force && last && now - last < UPDATE_INTERVAL_MS) {
      return { checked: false, reason: 'interval' };
    }

    safeStorage((storage) => storage.setItem(FREE_UPDATE_CHECK_KEY, String(now)));

    try {
      const registration = await navigator.serviceWorker.getRegistration('./');
      if (!registration) return { checked: false, reason: 'no-registration' };
      await registration.update();
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'NOVA_SKIP_WAITING' });
      }
      return { checked: true };
    } catch (error) {
      return { checked: false, reason: String(error?.message || error || 'update-failed') };
    }
  }

  async function storageHealth() {
    const result = { persisted: null, quota: null, usage: null };
    try {
      if (navigator.storage?.persisted) result.persisted = await navigator.storage.persisted();
      if (navigator.storage?.estimate) {
        const estimate = await navigator.storage.estimate();
        result.quota = Number(estimate.quota || 0);
        result.usage = Number(estimate.usage || 0);
      }
    } catch (_) {}
    return result;
  }

  repairFreeLockState();

  window.NOVA_FREE_RUNTIME = Object.freeze({
    version: VERSION,
    freeLock: true,
    isMeteredNetlifyHost,
    isFreeStaticHost,
    health,
    storageHealth,
    repair: repairFreeLockState,
    checkForFreeUpdate: () => freeUpdateCheck(true)
  });

  const start = () => {
    updateBadge();
    freeUpdateCheck(false).catch(() => {});

    window.addEventListener('online', () => {
      updateBadge();
      freeUpdateCheck(false).catch(() => {});
    });
    window.addEventListener('offline', updateBadge);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        repairFreeLockState();
        updateBadge();
        freeUpdateCheck(false).catch(() => {});
      }
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
