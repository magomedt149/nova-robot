(() => {
  'use strict';
  if (window.NovaSavedSettingsV32) return;

  const KEY = 'nova.video.saved.settings.v32';
  const LEGACY_QUALITY_KEY = 'nova.video.quality.v31';
  const VERSION = '32.1.0';
  const SAFETY = Object.freeze({
    safeMotionEnabled: true,
    passScore: 95,
    geometryMin: 98,
    subjectMin: 95,
    stabilityMin: 96,
    subtitleMin: 95,
    technicalMin: 95,
    maxMotionPercent: 2.5,
    minScale: 0.95,
    maxScale: 1,
    preserveWholeFrame: true,
    blockLowScoreExport: true
  });
  const DEFAULTS = Object.freeze({
    version: VERSION,
    ...SAFETY,
    refMode: 'exact',
    ratio: '9:16',
    style: 'motion',
    duration: '5',
    shortsDuration: '5',
    captions: 'on',
    prompt: 'preserve the same subject, face, clothes and scene; smooth controlled cinematic motion; keep the whole subject inside frame',
    negative: 'no crop, no face change, no identity change, no extra people, no flicker, no warped frame, no broken edges'
  });

  const ids = Object.freeze({
    novaProRefMode: 'refMode',
    novaShortRefMode: 'refMode',
    novaMotionRefMode: 'refMode',
    novaProRatio: 'ratio',
    novaProStyle: 'style',
    novaProDuration: 'duration',
    novaShortDuration: 'shortsDuration',
    novaShortCaptions: 'captions',
    novaProPrompt: 'prompt',
    novaShortMasterPrompt: 'prompt',
    novaMotionPrompt: 'prompt',
    novaProNegative: 'negative',
    novaShortNegativePrompt: 'negative',
    novaMotionNegative: 'negative'
  });

  const allowedStyles = new Set(['cinema', 'motion', 'threed', 'hologram', 'action']);
  const allowedDurations = new Set(['3', '5', '8', '10', '15']);
  const allowedShortDurations = new Set(['3', '5', '8', '10']);
  let applying = false;
  let timer = 0;

  function cleanText(value, fallback = '') {
    const v = String(value ?? '').replace(/\s+/g, ' ').trim();
    return (v || fallback).slice(0, 4000);
  }

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; }
    catch (_) { return {}; }
  }

  function sanitize(raw = {}) {
    const value = { ...DEFAULTS, ...raw, ...SAFETY, version: VERSION };
    value.refMode = value.refMode === 'style' ? 'style' : 'exact';
    value.ratio = value.ratio === '16:9' ? '16:9' : '9:16';
    value.style = allowedStyles.has(String(value.style)) ? String(value.style) : 'motion';
    value.duration = allowedDurations.has(String(value.duration)) ? String(value.duration) : '5';
    value.shortsDuration = allowedShortDurations.has(String(value.shortsDuration)) ? String(value.shortsDuration) : '5';
    value.captions = value.captions === 'off' ? 'off' : 'on';
    value.prompt = cleanText(value.prompt, DEFAULTS.prompt);
    value.negative = cleanText(value.negative, DEFAULTS.negative);
    return value;
  }

  function load() {
    const saved = readJson(KEY);
    if (Object.keys(saved).length) return sanitize(saved);
    const legacy = readJson(LEGACY_QUALITY_KEY);
    const first = sanitize({
      preserveWholeFrame: legacy.preserveWholeImage !== false,
      maxMotionPercent: legacy.maxMotionPercent
    });
    try { localStorage.setItem(KEY, JSON.stringify(first)); } catch (_) {}
    return first;
  }

  function save(patch = {}) {
    const next = sanitize({ ...load(), ...patch });
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (_) {}
    updateBadge(next);
    return next;
  }

  function setControl(id, value, eventName) {
    const node = document.getElementById(id);
    if (!node || value == null) return;
    const stringValue = String(value);
    if (node.value === stringValue) return;
    const optionExists = node.tagName !== 'SELECT' || [...node.options].some((o) => o.value === stringValue || o.textContent.trim() === stringValue);
    if (!optionExists) return;
    node.value = stringValue;
    node.dispatchEvent(new Event(eventName || (node.tagName === 'SELECT' ? 'change' : 'input'), { bubbles: true }));
  }

  function apply() {
    const settings = load();
    applying = true;
    try {
      setControl('novaProRefMode', settings.refMode, 'change');
      setControl('novaShortRefMode', settings.refMode, 'change');
      setControl('novaMotionRefMode', settings.refMode, 'change');
      setControl('novaProRatio', settings.ratio, 'change');
      setControl('novaProStyle', settings.style, 'change');
      setControl('novaProDuration', settings.duration, 'change');
      setControl('novaShortDuration', settings.shortsDuration, 'change');
      setControl('novaShortCaptions', settings.captions, 'change');
      setControl('novaProPrompt', settings.prompt, 'input');
      setControl('novaShortMasterPrompt', settings.prompt, 'input');
      setControl('novaMotionPrompt', settings.prompt, 'input');
      setControl('novaProNegative', settings.negative, 'input');
      setControl('novaShortNegativePrompt', settings.negative, 'input');
      setControl('novaMotionNegative', settings.negative, 'input');
      try {
        window.NovaQualityGate?.savePolicy?.({
          passScore: SAFETY.passScore,
          geometryMin: SAFETY.geometryMin,
          subjectSafetyMin: SAFETY.subjectMin,
          stabilityMin: SAFETY.stabilityMin,
          subtitleMin: SAFETY.subtitleMin,
          technicalMin: SAFETY.technicalMin,
          maxMotionPercent: SAFETY.maxMotionPercent,
          preserveWholeImage: true,
          blockLowScoreExport: true
        });
      } catch (_) {}
    } finally {
      applying = false;
    }
    updateBadge(settings);
    document.documentElement.dataset.novaVideoSettings = VERSION;
    return settings;
  }

  function captureNode(node) {
    if (applying || !node?.id || !ids[node.id]) return;
    const key = ids[node.id];
    const patch = {};
    patch[key] = node.value;
    save(patch);
  }

  function scheduleCapture(node) {
    clearTimeout(timer);
    timer = setTimeout(() => captureNode(node), 180);
  }

  function updateBadge(settings = load()) {
    const hosts = [document.querySelector('#novaProPane .nova-media-note'), document.querySelector('[data-media-pane="shorts"] .nova-safe-quality-v32')].filter(Boolean);
    hosts.forEach((host) => {
      let badge = host.querySelector('.nova-settings-v32-badge');
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'nova-settings-v32-badge';
        badge.style.cssText = 'margin-top:7px;font:800 11px/1.35 system-ui;color:#9ed7ff';
        host.appendChild(badge);
      }
      badge.textContent = `⚙️ Настройки сохранены · Safe v32 · ${settings.refMode.toUpperCase()} · ${settings.ratio} · Quality ≥${settings.passScore}%`;
    });
  }

  function resetToSafeDefaults() {
    const next = sanitize(DEFAULTS);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (_) {}
    apply();
    return next;
  }

  function install() {
    load();
    const applyWhenReady = () => {
      const ready = document.getElementById('novaProTab') || document.getElementById('novaShortRefMode') || document.getElementById('novaMotionRefMode');
      if (!ready) return false;
      apply();
      return true;
    };
    if (!applyWhenReady()) {
      const observer = new MutationObserver(() => {
        if (applyWhenReady()) observer.disconnect();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    document.addEventListener('change', (event) => captureNode(event.target), true);
    document.addEventListener('input', (event) => {
      const id = event.target?.id;
      if (!id || !ids[id]) return;
      if (/Prompt|Negative/.test(id)) scheduleCapture(event.target);
      else captureNode(event.target);
    }, true);
    window.addEventListener('pageshow', () => setTimeout(apply, 0));
  }

  window.NovaSavedSettingsV32 = Object.freeze({
    version: VERSION,
    key: KEY,
    defaults: DEFAULTS,
    safety: SAFETY,
    load,
    save,
    apply,
    resetToSafeDefaults
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
