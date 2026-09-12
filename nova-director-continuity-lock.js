(() => {
  'use strict';

  if (window.NovaDirectorContinuityLock) return;

  const VERSION = '32.0.0';
  const STORAGE_KEY = 'nova-director-continuity-lock-v32';
  const LOCK_START = '<<NOVA_DIRECTOR_LOCK_START>>';
  const LOCK_END = '<<NOVA_DIRECTOR_LOCK_END>>';
  const NEG_START = '<<NOVA_CONTINUITY_NEG_START>>';
  const NEG_END = '<<NOVA_CONTINUITY_NEG_END>>';

  const DEFAULT_BIBLE = Object.freeze({
    identity: 'Preserve the exact same person from the visual reference: facial geometry, age, skin tone, hairstyle, eye shape, facial hair state, body proportions and handedness. Do not reinterpret or beautify the face.',
    wardrobe: 'Keep the exact same wardrobe, accessories, materials, colors, fit and carried props unless the shot prompt explicitly requests one intentional change.',
    world: 'Keep the same location, set layout, background architecture, furniture/props, time of day, weather, practical lights and light direction unless the director explicitly changes them.',
    spatial: 'Maintain screen direction, 180-degree line, eyelines, left/right placement, entrance/exit direction, subject scale and prop ownership across cuts.',
    motion: 'Use natural human motion, stable anatomy and match-on-action continuity. Preserve pose intent and contact points; no teleporting hands, props, feet or body parts.'
  });

  const DIRECTOR_GRAMMAR = Object.freeze([
    'Establish geography first: controlled wide/medium-wide master, stable horizon, readable subject placement, no unnecessary orbit.',
    'Continue the same action in a medium shot; preserve screen direction and match the exact body/prop state from the previous shot.',
    'Performance close-up: preserve face geometry and eyeline; subtle natural expression only, no facial redesign, no lens-induced face distortion.',
    'Reaction/reverse coverage: respect the 180-degree line, matching eyeline, light direction, wardrobe folds, prop hand and background geography.',
    'Resolution/hero continuation: finish the action with match-on-action, same world state and a motivated camera move; do not reset the scene.'
  ]);

  const HARD_NEGATIVES = [
    'identity drift', 'face morphing', 'face swap', 'different person', 'age change', 'skin tone change',
    'eye color change', 'hairstyle change', 'facial hair change', 'body proportion drift', 'handedness flip',
    'wardrobe change', 'accessory swap', 'prop swap', 'prop teleportation', 'background redesign',
    'location jump', 'time-of-day jump', 'weather jump', 'lighting direction jump', 'screen-direction reversal',
    'left-right flip', 'broken eyeline', 'lens inconsistency', 'face flicker', 'texture boiling', 'frame jitter',
    'duplicate person', 'extra people', 'extra limbs', 'extra fingers', 'warped hands', 'warped face',
    'melting geometry', 'random text', 'watermark', 'logo mutation'
  ].join(', ');

  const defaultState = () => ({
    enabled: true,
    strict: true,
    autoDirector: true,
    projectAnchor: `NOVA-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    bible: { ...DEFAULT_BIBLE },
    sceneGoal: '',
    lastShot: null,
    lastPreflight: null,
    runsPrepared: 0
  });

  function loadState() {
    const base = defaultState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return base;
      const parsed = JSON.parse(raw);
      return {
        ...base,
        ...parsed,
        bible: { ...DEFAULT_BIBLE, ...(parsed?.bible || {}) },
        enabled: parsed?.enabled !== false,
        strict: parsed?.strict !== false,
        autoDirector: parsed?.autoDirector !== false
      };
    } catch (_) {
      return base;
    }
  }

  let state = loadState();

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function clean(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function stripManaged(text, start = LOCK_START, end = LOCK_END) {
    const input = String(text || '');
    const a = input.indexOf(start);
    const b = input.indexOf(end);
    if (a < 0 || b < a) return input.trim();
    return `${input.slice(0, a)} ${input.slice(b + end.length)}`.replace(/\s+/g, ' ').trim();
  }

  function status(message, ok = true) {
    const local = document.getElementById('novaLockStatus');
    if (local) {
      local.textContent = message;
      local.dataset.ok = ok ? '1' : '0';
    }
    const global = document.getElementById('novaMediaStatus') || document.getElementById('statusText');
    if (global) global.textContent = message;
  }

  function directorGuide(index, style = '') {
    const base = DIRECTOR_GRAMMAR[index % DIRECTOR_GRAMMAR.length];
    const styleText = clean(style);
    return `${base}${styleText ? ` Current visual style: ${styleText}.` : ''}`;
  }

  function previousShotGuide() {
    if (!state.lastShot) return 'This is the first locked shot: establish a stable continuity baseline and do not invent off-screen changes.';
    const p = state.lastShot;
    return `Continue from previous shot state: style=${p.style || 'unchanged'}, ratio=${p.ratio || 'unchanged'}, camera=${p.camera || 'motivated continuation'}, action=${p.action || 'continue without reset'}. Preserve all unchanged visual facts.`;
  }

  function buildLockBlock(meta = {}) {
    const shotIndex = Number.isInteger(meta.shotIndex) ? meta.shotIndex : null;
    const shotGuide = shotIndex == null
      ? 'Director rule: make only the requested action/camera change; everything else stays locked to the reference and previous shot.'
      : directorGuide(shotIndex, meta.style);
    const goal = clean(meta.sceneGoal || state.sceneGoal);
    return [
      LOCK_START,
      `DIRECTOR + IDENTITY/CONTINUITY LOCK v${VERSION}. PROJECT ANCHOR: ${state.projectAnchor}.`,
      `IDENTITY IMMUTABLE: ${clean(state.bible.identity)}`,
      `WARDROBE/PROP IMMUTABLE: ${clean(state.bible.wardrobe)}`,
      `WORLD IMMUTABLE: ${clean(state.bible.world)}`,
      `SPATIAL CONTINUITY: ${clean(state.bible.spatial)}`,
      `MOTION/ANATOMY CONTINUITY: ${clean(state.bible.motion)}`,
      previousShotGuide(),
      shotGuide,
      goal ? `CURRENT SCENE GOAL: ${goal}` : '',
      'Priority order: identity > anatomy > wardrobe/props > world geometry > screen direction/eyeline > requested action > camera style > cosmetic effects.',
      'Do not redesign, restyle, replace, reset or randomize any locked attribute. No unrequested cuts, new people, new props, new text, wardrobe changes or background changes.',
      LOCK_END
    ].filter(Boolean).join(' ');
  }

  function lockPrompt(prompt, meta = {}) {
    const base = stripManaged(prompt, LOCK_START, LOCK_END);
    return clean(`${buildLockBlock(meta)} ${base}`);
  }

  function lockNegative(negative) {
    const base = stripManaged(negative, NEG_START, NEG_END);
    return clean(`${NEG_START} ${HARD_NEGATIVES} ${NEG_END}${base ? `, ${base}` : ''}`);
  }

  function selectedReferenceInfo() {
    const imageInput = document.getElementById('novaProImageRef');
    const videoInput = document.getElementById('novaProVideoRef');
    const localVideo = document.getElementById('novaLocalVideo');
    const imageLabel = document.querySelector('.nova-ref-image-name')?.textContent || '';
    const videoLabel = document.querySelector('.nova-ref-video-name')?.textContent || '';
    const hasImage = Boolean(imageInput?.files?.[0]) || !/не выбрано|not selected/i.test(imageLabel) && /\S/.test(imageLabel);
    const hasVideo = Boolean(videoInput?.files?.[0]) || Boolean(localVideo?.files?.[0]) || !/не выбрано|not selected/i.test(videoLabel) && /\S/.test(videoLabel);
    return {
      hasReference: hasImage || hasVideo,
      kind: hasVideo ? 'video' : hasImage ? 'image' : 'none',
      name: videoInput?.files?.[0]?.name || localVideo?.files?.[0]?.name || imageInput?.files?.[0]?.name || clean(videoLabel || imageLabel) || 'reference'
    };
  }

  function preflight(options = {}, context = 'api') {
    if (!state.enabled) return { ok: true, options: { ...options }, warnings: ['Lock выключен'] };
    const prepared = { ...options };
    prepared.refMode = 'exact';
    prepared.duration = Math.min(5, Math.max(1, Number(prepared.duration || 5)));
    prepared.prompt = lockPrompt(prepared.prompt || '', {
      style: prepared.style || '',
      sceneGoal: prepared.sceneGoal || state.sceneGoal
    });
    prepared.negative = lockNegative(prepared.negative || '');
    const sourcePresent = Boolean(prepared.source?.file || (typeof File !== 'undefined' && prepared.source instanceof File) || prepared.file);
    const ref = selectedReferenceInfo();
    if (state.strict && !sourcePresent && !ref.hasReference && context !== 'pure-test') {
      return { ok: false, options: prepared, error: 'Identity Lock: сначала нужен Photo или Video Reference.' };
    }
    state.runsPrepared += 1;
    state.lastPreflight = {
      at: Date.now(),
      context,
      refMode: 'exact',
      duration: prepared.duration,
      style: prepared.style || '',
      ratio: prepared.ratio || document.getElementById('novaProRatio')?.value || '',
      reference: ref.name
    };
    saveState();
    return { ok: true, options: prepared, warnings: [], reference: ref };
  }

  function syncStateFromUi() {
    const value = (id, fallback = '') => clean(document.getElementById(id)?.value ?? fallback);
    state.enabled = document.getElementById('novaLockEnabled')?.checked !== false;
    state.strict = document.getElementById('novaLockStrict')?.checked !== false;
    state.autoDirector = document.getElementById('novaLockAutoDirector')?.checked !== false;
    state.sceneGoal = value('novaLockSceneGoal', state.sceneGoal);
    state.bible = {
      identity: value('novaLockIdentity', state.bible.identity),
      wardrobe: value('novaLockWardrobe', state.bible.wardrobe),
      world: value('novaLockWorld', state.bible.world),
      spatial: value('novaLockSpatial', state.bible.spatial),
      motion: value('novaLockMotion', state.bible.motion)
    };
    saveState();
  }

  function applyUiLock({ timeline = false } = {}) {
    syncStateFromUi();
    if (!state.enabled) return { ok: true, skipped: true };

    const refMode = document.getElementById('novaProRefMode');
    if (refMode) {
      refMode.value = 'exact';
      refMode.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const duration = document.getElementById('novaProDuration');
    if (duration && Number(duration.value) > 5) duration.value = '5';

    const ref = selectedReferenceInfo();
    if (state.strict && !ref.hasReference) {
      return { ok: false, error: '🔒 MAX Lock остановил запуск: сначала выбери Photo или Video Reference.' };
    }

    const prompt = document.getElementById('novaProPrompt');
    const negative = document.getElementById('novaProNegative');
    const style = document.getElementById('novaProStyle')?.value || '';
    if (prompt) prompt.value = lockPrompt(prompt.value, { style, sceneGoal: state.sceneGoal });
    if (negative) negative.value = lockNegative(negative.value);

    if (timeline || state.autoDirector) {
      document.querySelectorAll('.nova-pro-scene').forEach((row, index) => {
        const scenePrompt = row.querySelector('[data-role="prompt"]');
        const sceneDuration = row.querySelector('[data-role="duration"]');
        const sceneStyle = row.querySelector('[data-role="style"]')?.value || style;
        if (sceneDuration && Number(sceneDuration.value) > 5) sceneDuration.value = '5';
        if (scenePrompt) {
          scenePrompt.value = lockPrompt(scenePrompt.value, {
            shotIndex: index,
            style: sceneStyle,
            sceneGoal: state.sceneGoal
          });
        }
      });
    }

    state.lastPreflight = {
      at: Date.now(),
      context: timeline ? 'timeline-ui' : 'single-ui',
      refMode: 'exact',
      duration: Number(duration?.value || 5),
      style,
      ratio: document.getElementById('novaProRatio')?.value || '',
      reference: ref.name
    };
    state.runsPrepared += 1;
    saveState();
    status(`🔒 Director Lock MAX готов · EXACT reference · ≤5s/shot · ${ref.kind}: ${ref.name}`);
    return { ok: true, reference: ref };
  }

  function snapshotShot(action = 'render') {
    const ratio = document.getElementById('novaProRatio')?.value || '';
    const style = document.getElementById('novaProStyle')?.value || '';
    state.lastShot = {
      at: Date.now(),
      action,
      ratio,
      style,
      camera: style === 'cinema' ? 'motivated cinematic continuation' : style || 'continuity-first',
      reference: selectedReferenceInfo().name
    };
    saveState();
  }

  function generateDirectorPlan() {
    syncStateFromUi();
    const rows = [...document.querySelectorAll('.nova-pro-scene')];
    if (!rows.length) {
      status('Director: сначала открой вкладку PRO Editor.', false);
      return;
    }
    rows.forEach((row, index) => {
      const textarea = row.querySelector('[data-role="prompt"]');
      const style = row.querySelector('[data-role="style"]')?.value || '';
      if (!textarea) return;
      const base = stripManaged(textarea.value, LOCK_START, LOCK_END);
      const guide = directorGuide(index, style);
      textarea.value = lockPrompt(`${guide} ${base}`, { shotIndex: index, style, sceneGoal: state.sceneGoal });
      const duration = row.querySelector('[data-role="duration"]');
      if (duration) duration.value = String(Math.min(5, Math.max(1, Number(duration.value || 5))));
    });
    status('🎬 Director: 5 сцен выстроены с continuity grammar и MAX Identity Lock.');
  }

  function resetProjectAnchor() {
    state.projectAnchor = `NOVA-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    state.lastShot = null;
    state.lastPreflight = null;
    saveState();
    const badge = document.getElementById('novaLockProject');
    if (badge) badge.textContent = state.projectAnchor;
    status(`🆕 Новый continuity project: ${state.projectAnchor}`);
  }

  function restoreDefaults() {
    state = { ...defaultState(), projectAnchor: state.projectAnchor };
    saveState();
    mount(true);
    status('✅ Director/Continuity Lock сброшен на MAX defaults.');
  }

  function escapeText(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeAttr(value) {
    return escapeText(value).replace(/"/g, '&quot;');
  }

  function panelHtml() {
    return `
      <div class="nova-lock-head">
        <div><b>🎬 Director + 🔒 Identity/Continuity Lock</b><small>v${VERSION} · zero-credit local controller</small></div>
        <span id="novaLockProject">${state.projectAnchor}</span>
      </div>
      <div class="nova-lock-toggles">
        <label><input id="novaLockEnabled" type="checkbox" ${state.enabled ? 'checked' : ''}> Lock ON</label>
        <label><input id="novaLockStrict" type="checkbox" ${state.strict ? 'checked' : ''}> STRICT MAX</label>
        <label><input id="novaLockAutoDirector" type="checkbox" ${state.autoDirector ? 'checked' : ''}> Auto Director</label>
      </div>
      <div class="nova-media-field"><label>Scene goal / действие</label><input id="novaLockSceneGoal" type="text" value="${escapeAttr(state.sceneGoal)}" placeholder="Напр.: мужчина говорит и медленно идёт к камере; фон и одежда не меняются"></div>
      <details open><summary>Character / World Bible — жёсткие якоря</summary>
        <div class="nova-lock-grid">
          <div class="nova-media-field"><label>Identity</label><textarea id="novaLockIdentity">${escapeText(state.bible.identity)}</textarea></div>
          <div class="nova-media-field"><label>Wardrobe + props</label><textarea id="novaLockWardrobe">${escapeText(state.bible.wardrobe)}</textarea></div>
          <div class="nova-media-field"><label>World + light</label><textarea id="novaLockWorld">${escapeText(state.bible.world)}</textarea></div>
          <div class="nova-media-field"><label>Spatial / camera continuity</label><textarea id="novaLockSpatial">${escapeText(state.bible.spatial)}</textarea></div>
          <div class="nova-media-field"><label>Motion / anatomy</label><textarea id="novaLockMotion">${escapeText(state.bible.motion)}</textarea></div>
        </div>
      </details>
      <div class="nova-media-actions">
        <button id="novaLockApply" class="nova-media-btn primary" type="button">🔒 Apply MAX Lock</button>
        <button id="novaLockPlan" class="nova-media-btn" type="button">🎬 Director: 5 scenes</button>
        <button id="novaLockNew" class="nova-media-btn" type="button">🆕 New continuity project</button>
        <button id="novaLockDefaults" class="nova-media-btn" type="button">↺ Defaults</button>
      </div>
      <div id="novaLockStatus" class="nova-lock-status" data-ok="1">MAX Lock активен: EXACT reference, identity-first, 5s max per shot, no paid retry.</div>`;
  }

  function installStyles() {
    if (document.getElementById('novaDirectorLockStyles')) return;
    const style = document.createElement('style');
    style.id = 'novaDirectorLockStyles';
    style.textContent = `
      .nova-director-lock{border:1px solid rgba(75,220,255,.42);border-radius:16px;padding:12px;margin:10px 0;background:linear-gradient(180deg,rgba(15,74,120,.16),rgba(8,20,48,.28));box-shadow:0 0 0 1px rgba(0,0,0,.2) inset}
      .nova-lock-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap}.nova-lock-head>div{display:grid;gap:3px}.nova-lock-head small{color:#8fb9db;font-size:10px}.nova-lock-head>span{font-size:9px;padding:5px 7px;border-radius:999px;background:rgba(57,205,255,.12);color:#bfeeff;border:1px solid rgba(57,205,255,.22)}
      .nova-lock-toggles{display:flex;gap:8px;flex-wrap:wrap;margin:9px 0}.nova-lock-toggles label{display:flex;align-items:center;gap:5px;padding:6px 8px;border-radius:10px;background:rgba(255,255,255,.045);font-size:11px;font-weight:800}.nova-lock-toggles input{accent-color:#28d8ff}
      .nova-lock-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px}.nova-lock-grid textarea{width:100%;min-height:76px;box-sizing:border-box;border:1px solid rgba(255,255,255,.12);border-radius:9px;background:#071027;color:#fff;padding:8px;resize:vertical;font:inherit;font-size:11px;line-height:1.35}
      .nova-director-lock details{margin:8px 0}.nova-director-lock summary{cursor:pointer;color:#c9ebff;font-size:11px;font-weight:900}.nova-lock-status{margin-top:8px;padding:8px 9px;border-radius:10px;font-size:10px;background:rgba(34,197,94,.09);border:1px solid rgba(34,197,94,.18);color:#b9ffd0}.nova-lock-status[data-ok="0"]{background:rgba(255,95,95,.1);border-color:rgba(255,95,95,.25);color:#ffd0d0}
      @media(max-width:720px){.nova-lock-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function mount(force = false) {
    const pane = document.getElementById('novaProPane');
    if (!pane) return false;
    let panel = document.getElementById('novaDirectorLockPanel');
    if (panel && !force) return true;
    if (panel) panel.remove();
    installStyles();
    panel = document.createElement('section');
    panel.id = 'novaDirectorLockPanel';
    panel.className = 'nova-director-lock';
    panel.innerHTML = panelHtml();
    const note = pane.querySelector('.nova-media-note');
    if (note?.nextSibling) pane.insertBefore(panel, note.nextSibling);
    else pane.prepend(panel);

    panel.addEventListener('input', () => syncStateFromUi());
    document.getElementById('novaLockApply')?.addEventListener('click', () => {
      const result = applyUiLock({ timeline: false });
      if (!result.ok) status(result.error, false);
    });
    document.getElementById('novaLockPlan')?.addEventListener('click', generateDirectorPlan);
    document.getElementById('novaLockNew')?.addEventListener('click', resetProjectAnchor);
    document.getElementById('novaLockDefaults')?.addEventListener('click', restoreDefaults);
    return true;
  }

  function installUiGuards() {
    document.addEventListener('click', (event) => {
      const button = event.target?.closest?.('#novaProMotion,#novaProExtend,#novaProRenderTimeline');
      if (!button) return;
      syncStateFromUi();
      if (!state.enabled) return;
      const result = applyUiLock({ timeline: button.id === 'novaProRenderTimeline' });
      if (!result.ok) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        status(result.error, false);
        return;
      }
      snapshotShot(button.id === 'novaProExtend' ? 'extend' : button.id === 'novaProRenderTimeline' ? 'timeline' : 'motion');
    }, true);

    const observer = new MutationObserver(() => {
      mount();
      const outputs = document.querySelectorAll('#novaProOutputs .nova-pro-output').length;
      if (outputs && state.lastShot) {
        const node = document.getElementById('novaLockStatus');
        if (node && !/output/i.test(node.dataset.phase || '')) {
          node.dataset.phase = 'output';
          node.textContent = `✅ Output ${outputs}: lock metadata сохранены. Локальный EXACT render сохраняет исходные пиксели; для внешней generative-модели дополнительно нужна визуальная face/continuity проверка.`;
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function wrapVideoPro(api) {
    if (!api || api.__directorContinuityWrapped) return api;
    const rawRender = typeof api.renderLocalClip === 'function' ? api.renderLocalClip.bind(api) : null;
    const rawTimeline = typeof api.renderTimeline === 'function' ? api.renderTimeline.bind(api) : null;
    const wrapped = { ...api, __directorContinuityWrapped: true, directorContinuityVersion: VERSION };
    if (rawRender) {
      wrapped.renderLocalClip = async (options = {}) => {
        const result = preflight(options, 'NovaVideoPro.renderLocalClip');
        if (!result.ok) throw new Error(result.error);
        snapshotShot('api-render');
        return rawRender(result.options);
      };
    }
    if (rawTimeline) {
      wrapped.renderTimeline = async (...args) => {
        const result = applyUiLock({ timeline: true });
        if (!result.ok) throw new Error(result.error);
        snapshotShot('api-timeline');
        return rawTimeline(...args);
      };
    }
    return Object.freeze(wrapped);
  }

  function installVideoProInterceptor() {
    try {
      let current = window.NovaVideoPro ? wrapVideoPro(window.NovaVideoPro) : null;
      const desc = Object.getOwnPropertyDescriptor(window, 'NovaVideoPro');
      if (desc && desc.configurable === false) return;
      Object.defineProperty(window, 'NovaVideoPro', {
        configurable: true,
        enumerable: true,
        get() { return current; },
        set(value) { current = wrapVideoPro(value); }
      });
    } catch (error) {
      console.warn('[NOVA Director Lock] VideoPro interceptor unavailable:', error);
    }
  }

  const api = Object.freeze({
    version: VERSION,
    getState: () => JSON.parse(JSON.stringify(state)),
    preflight,
    lockPrompt,
    lockNegative,
    applyUiLock,
    generateDirectorPlan,
    resetProjectAnchor,
    mount,
    setEnabled(value) { state.enabled = Boolean(value); saveState(); mount(true); return state.enabled; }
  });

  window.NovaDirectorContinuityLock = api;
  installVideoProInterceptor();
  installUiGuards();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mount(), { once: true });
  else mount();
})();