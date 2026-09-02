(() => {
  'use strict';

  if (window.NovaStack) return;

  const RELEASE = '33.0.0';
  const MODULES = [
    { file: 'nova-media-studio.js', ready: () => window.__novaMediaStudioInstalled },
    { file: 'nova-whisper.js', ready: () => window.__novaWhisperInstalled },
    { file: 'nova-voice-editor.js', ready: () => window.__novaTranscriptEditorInstalled },
    { file: 'nova-transcript-editor-sync.js', ready: () => window.__novaTranscriptEditorSyncInstalled },
    { file: 'nova-ios-photo-save.js', ready: () => window.NovaIOSSave },
    { file: 'nova-video-upgrade.js', ready: () => window.__novaVideoUpgradeInstalled },
    { file: 'nova-multi-shorts.js', ready: () => window.__novaMultiShortsInstalled },
    { file: 'nova-media-library.js', ready: () => window.NovaMediaLibrary },
    { file: 'nova-ios-output-actions.js', ready: () => window.__novaIOSOutputActionsInstalled },
    { file: 'nova-video-pro.js', ready: () => window.NovaVideoPro }
  ];

  const errors = [];

  function sourcePath(script) {
    try {
      return new URL(script.src, document.baseURI).pathname.replace(/^\/+/, '');
    } catch (_) {
      return '';
    }
  }

  function existingScript(file) {
    return [...document.scripts].find((script) => sourcePath(script).endsWith(file));
  }

  function loadModule(module) {
    if (module.ready()) return Promise.resolve(module.file);

    const existing = existingScript(module.file);
    if (existing) {
      if (existing.dataset.novaLoaded === 'true') return Promise.resolve(module.file);
      return new Promise((resolve, reject) => {
        existing.addEventListener('load', () => resolve(module.file), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Не загрузился ${module.file}`)), { once: true });
      });
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `./${module.file}?v=${RELEASE}`;
      script.async = false;
      script.dataset.novaModule = module.file;
      script.addEventListener('load', () => {
        script.dataset.novaLoaded = 'true';
        resolve(module.file);
      }, { once: true });
      script.addEventListener('error', () => reject(new Error(`Не загрузился ${module.file}`)), { once: true });
      document.head.appendChild(script);
    });
  }

  function openRequestedTool() {
    const routes = {
      'video-pro': '#novaProTab',
      whisper: '[data-media-tab="dub"]',
      shorts: '#novaMultiShortsTab',
      library: '#novaLibraryTab',
      motion: '#novaMotionTab'
    };
    let requested = '';
    try { requested = new URL(window.location.href).searchParams.get('open') || ''; } catch (_) {}
    const targetSelector = routes[requested];
    if (!targetSelector) return;
    document.querySelector('#novaMediaLaunch')?.click();
    document.querySelector(targetSelector)?.click();
  }

  async function loadAll() {
    for (const module of MODULES) {
      try {
        await loadModule(module);
      } catch (error) {
        errors.push({ file: module.file, message: error?.message || String(error) });
        console.warn('[NOVA Stack]', error);
      }
    }

    if (errors.length) {
      const status = document.querySelector('#statusText');
      if (status) status.textContent = `NOVA: не загрузилось модулей — ${errors.length}`;
    }

    openRequestedTool();
    window.dispatchEvent(new CustomEvent('nova-stack-ready', { detail: { release: RELEASE, errors: [...errors] } }));
    return { release: RELEASE, loaded: MODULES.length - errors.length, errors: [...errors] };
  }

  const ready = loadAll();
  window.NovaStack = Object.freeze({
    release: RELEASE,
    modules: MODULES.map(({ file }) => file),
    errors,
    ready
  });
})();
