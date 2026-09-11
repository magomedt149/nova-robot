(() => {
  'use strict';

  const VERSION = '1.2.0';
  const ROOM_PREFIX = 'NOVA-TUMSOEV';
  const SELF_HOSTED_BASE = 'https://call.tumsoev.com/';
  const TEMP_PUBLIC_FALLBACK_BASE = 'https://meet.jit.si/';
  const STORAGE_KEY = 'nova.freeCalls.lastRoom.v1';
  const SELF_HOSTED_SEEN_KEY = 'nova.freeCalls.selfHostedSeen.v1';
  const PUBLIC_FALLBACK_ALLOWED_KEY = 'nova.freeCalls.publicFallbackAllowed.v1';
  const UI_ID = 'nova-free-call-ui';
  const STYLE_ID = 'nova-free-call-style';

  let activeCallRoom = null;

  function randomToken(bytes = 12) {
    const data = new Uint8Array(bytes);
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(data);
      return Array.from(data, (value) => value.toString(16).padStart(2, '0')).join('');
    }
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function makeRoomName() {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    return `${ROOM_PREFIX}-${stamp}-${randomToken(10)}`;
  }

  function buildRoomUrl(roomName, base = SELF_HOSTED_BASE) {
    const room = encodeURIComponent(String(roomName || makeRoomName()).replace(/[^a-zA-Z0-9_-]/g, ''));
    const normalizedBase = String(base || SELF_HOSTED_BASE).replace(/\/?$/, '/');
    return `${normalizedBase}${room}#config.startAudioOnly=false&config.startWithAudioMuted=false&config.startWithVideoMuted=false&config.prejoinPageEnabled=false`;
  }

  function saveRoom(room) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(room)); } catch (_) {}
  }

  function getLastRoom() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value ? JSON.parse(value) : null;
    } catch (_) {
      return null;
    }
  }

  function hasSelfHostedEverWorked() {
    try { return localStorage.getItem(SELF_HOSTED_SEEN_KEY) === '1'; }
    catch (_) { return false; }
  }

  function markSelfHostedWorking() {
    try {
      localStorage.setItem(SELF_HOSTED_SEEN_KEY, '1');
      localStorage.setItem(PUBLIC_FALLBACK_ALLOWED_KEY, '0');
    } catch (_) {}
  }

  function publicFallbackAllowed() {
    try {
      const saved = localStorage.getItem(PUBLIC_FALLBACK_ALLOWED_KEY);
      if (saved === '0') return false;
      if (saved === '1') return true;
    } catch (_) {}
    return !hasSelfHostedEverWorked();
  }

  function setPublicFallbackAllowed(enabled) {
    try { localStorage.setItem(PUBLIC_FALLBACK_ALLOWED_KEY, enabled ? '1' : '0'); } catch (_) {}
  }

  async function probe(url, timeoutMs = 3500) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await fetch(url, {
        method: 'GET',
        mode: 'no-cors',
        cache: 'no-store',
        signal: controller.signal
      });
      return true;
    } catch (_) {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function resolveProvider() {
    const selfHostedOk = await probe(SELF_HOSTED_BASE);
    if (selfHostedOk) {
      markSelfHostedWorking();
      return {
        base: SELF_HOSTED_BASE,
        provider: 'NOVA Call self-hosted',
        selfHosted: true,
        temporaryFallback: false
      };
    }

    if (!publicFallbackAllowed()) {
      throw new Error('Self-hosted NOVA Call is offline and public fallback is disabled.');
    }

    const fallbackOk = await probe(TEMP_PUBLIC_FALLBACK_BASE);
    if (!fallbackOk) {
      throw new Error('No NOVA Call provider is reachable.');
    }

    return {
      base: TEMP_PUBLIC_FALLBACK_BASE,
      provider: 'Jitsi public temporary fallback',
      selfHosted: false,
      temporaryFallback: true
    };
  }

  function createRoomWithProvider(provider) {
    const roomName = makeRoomName();
    const url = buildRoomUrl(roomName, provider.base);
    const room = {
      roomName,
      url,
      createdAt: Date.now(),
      provider: provider.provider,
      selfHosted: provider.selfHosted === true,
      temporaryFallback: provider.temporaryFallback === true,
      mode: 'FREE_VIDEO_CALL',
      video: true,
      pstn: false
    };
    saveRoom(room);
    return room;
  }

  let activeProvider = hasSelfHostedEverWorked()
    ? {
        base: SELF_HOSTED_BASE,
        provider: 'NOVA Call self-hosted',
        selfHosted: true,
        temporaryFallback: false
      }
    : {
        base: TEMP_PUBLIC_FALLBACK_BASE,
        provider: 'Jitsi public temporary fallback',
        selfHosted: false,
        temporaryFallback: true
      };

  async function refreshActiveProvider() {
    try {
      activeProvider = await resolveProvider();
    } catch (_) {
      if (hasSelfHostedEverWorked()) {
        activeProvider = {
          base: SELF_HOSTED_BASE,
          provider: 'NOVA Call self-hosted',
          selfHosted: true,
          temporaryFallback: false
        };
      }
    }
    return activeProvider;
  }

  function createRoom() {
    return createRoomWithProvider(activeProvider);
  }

  async function createBestRoom() {
    const provider = await refreshActiveProvider();
    return createRoomWithProvider(provider);
  }

  refreshActiveProvider();

  async function diagnose() {
    const [selfHosted, publicFallback] = await Promise.all([
      probe(SELF_HOSTED_BASE, 5000),
      publicFallbackAllowed() ? probe(TEMP_PUBLIC_FALLBACK_BASE, 5000) : Promise.resolve(false)
    ]);

    if (selfHosted) markSelfHostedWorking();

    return {
      version: VERSION,
      selfHostedUrl: SELF_HOSTED_BASE,
      selfHostedOnline: selfHosted,
      publicFallbackAllowed: publicFallbackAllowed(),
      publicFallbackOnline: publicFallback,
      permanentlyPreferSelfHosted: hasSelfHostedEverWorked(),
      inlineVideoCall: true
    };
  }

  async function shareRoom(room = getLastRoom()) {
    if (!room?.url) return false;
    const data = {
      title: 'NOVA VIDEO CALL',
      text: 'Видеозвонок NOVA — открой ссылку и нажми разрешить камеру и микрофон',
      url: room.url
    };

    try {
      if (navigator.share) {
        await navigator.share(data);
        return true;
      }
    } catch (error) {
      if (error?.name === 'AbortError') return false;
    }

    try {
      await navigator.clipboard.writeText(room.url);
      return true;
    } catch (_) {
      return false;
    }
  }

  async function copyRoomLink(room = getLastRoom()) {
    if (!room?.url) return false;
    try {
      await navigator.clipboard.writeText(room.url);
      return true;
    } catch (_) {
      const input = document.createElement('textarea');
      input.value = room.url;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) {}
      input.remove();
      return ok;
    }
  }

  function ensureCallStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${UI_ID} { position: fixed; inset: 0; z-index: 2147483000; background: #02040b; display: flex; flex-direction: column; padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); }
      #${UI_ID}[hidden] { display: none !important; }
      #${UI_ID} .nova-call-bar { min-height: 58px; display: flex; align-items: center; gap: 10px; padding: 9px 12px; background: rgba(4,9,24,.98); border-bottom: 1px solid rgba(255,255,255,.12); color: #fff; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      #${UI_ID} .nova-call-title { min-width: 0; flex: 1; }
      #${UI_ID} .nova-call-title b { display: block; font-size: 15px; }
      #${UI_ID} .nova-call-title small { display: block; opacity: .7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11px; margin-top: 2px; }
      #${UI_ID} button { appearance: none; border: 1px solid rgba(255,255,255,.17); background: rgba(255,255,255,.08); color: #fff; border-radius: 12px; min-height: 39px; padding: 0 12px; font: 700 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      #${UI_ID} button:active { transform: scale(.97); }
      #${UI_ID} .nova-call-close { width: 40px; padding: 0; font-size: 24px; }
      #${UI_ID} .nova-call-frame { flex: 1; width: 100%; min-height: 0; border: 0; background: #000; }
      #${UI_ID} .nova-call-actions { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; padding: 9px 10px; background: rgba(4,9,24,.98); border-top: 1px solid rgba(255,255,255,.12); }
      #${UI_ID} .nova-call-actions button:first-child { background: rgba(40,180,110,.18); border-color: rgba(80,230,145,.45); }
      #${UI_ID} .nova-call-note { grid-column: 1 / -1; color: rgba(255,255,255,.68); font: 500 10px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; text-align: center; line-height: 1.3; }
      @media (max-width: 430px) { #${UI_ID} .nova-call-actions { grid-template-columns: 1fr 1fr; } #${UI_ID} .nova-call-actions .nova-call-external { grid-column: 1 / -1; } }
    `;
    document.head.appendChild(style);
  }

  function ensureCallUi() {
    let root = document.getElementById(UI_ID);
    if (root) return root;

    ensureCallStyle();
    root = document.createElement('section');
    root.id = UI_ID;
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'NOVA видеозвонок');
    root.innerHTML = `
      <div class="nova-call-bar">
        <div class="nova-call-title"><b>📹 NOVA VIDEO CALL</b><small data-nova-call-provider>Подключение…</small></div>
        <button class="nova-call-close" type="button" data-nova-call-close aria-label="Закрыть">×</button>
      </div>
      <iframe class="nova-call-frame" data-nova-call-frame title="NOVA видеозвонок" allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write" allowfullscreen referrerpolicy="no-referrer"></iframe>
      <div class="nova-call-actions">
        <button type="button" data-nova-call-share>📤 Маме</button>
        <button type="button" data-nova-call-copy>🔗 Копировать</button>
        <button class="nova-call-external" type="button" data-nova-call-external>↗ Открыть отдельно</button>
        <div class="nova-call-note">Разреши камеру и микрофон. Если встроенное видео не откроется на iPhone, нажми «Открыть отдельно».</div>
      </div>
    `;

    document.body.appendChild(root);

    root.querySelector('[data-nova-call-close]')?.addEventListener('click', closeRoom);
    root.querySelector('[data-nova-call-share]')?.addEventListener('click', async () => {
      const button = root.querySelector('[data-nova-call-share]');
      const old = button.textContent;
      const ok = await shareRoom(activeCallRoom);
      button.textContent = ok ? '✅ Отправлено' : '📤 Маме';
      setTimeout(() => { button.textContent = old; }, 1300);
    });
    root.querySelector('[data-nova-call-copy]')?.addEventListener('click', async () => {
      const button = root.querySelector('[data-nova-call-copy]');
      const old = button.textContent;
      const ok = await copyRoomLink(activeCallRoom);
      button.textContent = ok ? '✅ Скопировано' : '⚠️ Не вышло';
      setTimeout(() => { button.textContent = old; }, 1300);
    });
    root.querySelector('[data-nova-call-external]')?.addEventListener('click', () => openRoomExternal(activeCallRoom));

    return root;
  }

  function closeRoom() {
    const root = document.getElementById(UI_ID);
    if (!root) return false;
    const frame = root.querySelector('[data-nova-call-frame]');
    if (frame) frame.src = 'about:blank';
    root.hidden = true;
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    activeCallRoom = null;
    return true;
  }

  function openRoom(room = getLastRoom()) {
    if (!room?.url) return false;
    const root = ensureCallUi();
    const frame = root.querySelector('[data-nova-call-frame]');
    const provider = root.querySelector('[data-nova-call-provider]');
    activeCallRoom = room;
    if (provider) {
      provider.textContent = room.selfHosted
        ? 'Свой NOVA Call сервер · видеозвонок'
        : 'Резервный Jitsi · видеозвонок';
    }
    if (frame) frame.src = room.url;
    root.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return true;
  }

  function openRoomExternal(room = activeCallRoom || getLastRoom()) {
    if (!room?.url) return false;
    const opened = window.open(room.url, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.assign(room.url);
    return true;
  }

  async function createAndOpen() {
    const room = await createBestRoom();
    openRoom(room);
    return room;
  }

  window.NOVA_FREE_CALLS = {
    version: VERSION,
    selfHostedBase: SELF_HOSTED_BASE,
    createRoom,
    createBestRoom,
    buildRoomUrl,
    getLastRoom,
    shareRoom,
    copyRoomLink,
    openRoom,
    openRoomExternal,
    closeRoom,
    createAndOpen,
    diagnose,
    resolveProvider,
    setPublicFallbackAllowed,
    publicFallbackAllowed
  };
})();
