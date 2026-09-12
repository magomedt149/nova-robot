(() => {
  'use strict';

  const VERSION = '27.31.1';
  const FREE_LOCK_KEY = 'nova.freeLock.version';
  const FREE_UPDATE_CHECK_KEY = 'nova.freeUpdate.lastCheck';
  const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
  const WOLF_ACTIVE_KEY = 'nova.colab.wolf.active';
  const WOLF_APPROVED_AT_KEY = 'nova.colab.wolf.voiceApprovedAt';
  const REMOTE_RECOVERY_KEY = 'nova.remoteGpu.recovery';
  const WOLF_PROMPT = '[NOVA_WOLF_AUTO_V1] Ночной серый волк воет на луну на скале. Blender TRUE 3D, один непрерывный полный 360° orbit, 10 секунд, 24 fps, 16:9. FREE ONLY. Без платных API.';
  const WOLF_COLAB_COMMAND = /^(?:привет[,.! ]+)?(?:нова|nova)[,.! ]*(?:включи|запусти|открой)\s+(?:google\s+)?(?:colab|колаб|коллаб)(?:\s+(?:для\s+)?волка)?[.! ]*$/i;

  const isMeteredNetlifyHost = /(^|\.)netlify\.app$/i.test(location.hostname);
  const isFreeStaticHost =
    /(^|\.)github\.io$/i.test(location.hostname) ||
    /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);

  function safeStorage(action) {
    try { return action(localStorage); } catch (_) { return undefined; }
  }

  function approvedRemoteFlow(storage) {
    if (storage.getItem(WOLF_ACTIVE_KEY) === '1') return true;
    try {
      const meta = JSON.parse(storage.getItem(REMOTE_RECOVERY_KEY) || 'null');
      if (!meta?.userApprovedRemote) return false;
      return ['prepared','submitting','uploading','uploaded','queued','running','final','recovering','promoting','recovered-drive'].includes(String(meta.phase || ''));
    } catch (_) {
      return false;
    }
  }

  function repairFreeLockState() {
    safeStorage((storage) => {
      // FREE LOCK never enables generic Full Auto Final. It may, however, keep
      // Auto Recovery alive for one exact job the user already approved.
      storage.setItem('nova.remoteGpu.fullAuto', '0');
      if (approvedRemoteFlow(storage)) {
        storage.setItem('nova.remoteGpu.autoRecover', '1');
      } else {
        storage.setItem('nova.remoteGpu.autoRecover', '0');
        storage.removeItem('nova.remoteGpu.waitingColab');
      }
      storage.setItem(FREE_LOCK_KEY, VERSION);
    });
  }

  function startWolfColabScenario() {
    safeStorage((storage) => {
      storage.setItem('nova.remoteGpu.pendingPrompt', WOLF_PROMPT);
      storage.setItem(WOLF_ACTIVE_KEY, '1');
      storage.setItem(WOLF_APPROVED_AT_KEY, String(Date.now()));
      storage.setItem('nova.colab.wolf.autoShutdown', '1');
      storage.setItem('nova.colab.wolf.returnUrl', location.href);
    });
    const target = new URL('./motion-studio/', document.baseURI);
    target.searchParams.set('wolf', '1');
    // Same-tab navigation is the most reliable path on iPhone Safari. Motion
    // Studio prepares the exact job first; only then does it open our Colab.
    setTimeout(() => location.assign(target.href), 450);
  }

  function installColabVoiceCommand() {
    const baseBrain = window.NovaBrain;
    if (!baseBrain?.handle || baseBrain.__novaColabWolfAuto) return false;
    const baseHandle = baseBrain.handle.bind(baseBrain);
    const wrapped = Object.freeze({
      ...baseBrain,
      __novaColabWolfAuto: true,
      version: `${baseBrain.version || '27'}+colab-wolf-${VERSION}`,
      async handle(text, context = {}) {
        const phrase = String(text || '').normalize('NFKC').trim();
        if (WOLF_COLAB_COMMAND.test(phrase)) {
          startWolfColabScenario();
          return {
            text: 'Открываю наш бесплатный Colab для волка. Если Google попросит Connect/Run all или выбрать T4, это единственное ручное действие; дальше NOVA продолжит сама и остановит runtime после безопасного переноса MP4.'
          };
        }
        return baseHandle(text, context);
      }
    });
    window.NovaBrain = wrapped;
    return true;
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
      speechRecognition: Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
      approvedRemoteFlow: Boolean(safeStorage((storage) => approvedRemoteFlow(storage)))
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
      report.approvedRemoteFlow ? 'Remote GPU: только уже одобренный FREE job' : 'Remote GPU auto: выключен',
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
  installColabVoiceCommand();

  window.NOVA_FREE_RUNTIME = Object.freeze({
    version: VERSION,
    freeLock: true,
    isMeteredNetlifyHost,
    isFreeStaticHost,
    health,
    storageHealth,
    repair: repairFreeLockState,
    startWolfColabScenario,
    checkForFreeUpdate: () => freeUpdateCheck(true)
  });

  const start = () => {
    installColabVoiceCommand();
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
        installColabVoiceCommand();
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
