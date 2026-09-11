(() => {
  'use strict';

  const VERSION = '1.3.0';
  const ROOM_PREFIX = 'NOVA-TUMSOEV';
  const SELF_HOSTED_BASE = 'https://call.tumsoev.com/';
  const TEMP_PUBLIC_FALLBACK_BASE = 'https://meet.jit.si/';
  const STORAGE_KEY = 'nova.freeCalls.lastRoom.v1';
  const SELF_HOSTED_SEEN_KEY = 'nova.freeCalls.selfHostedSeen.v1';
  const PUBLIC_FALLBACK_ALLOWED_KEY = 'nova.freeCalls.publicFallbackAllowed.v1';
  const UI_ID = 'nova-free-call-ui';
  const STYLE_ID = 'nova-free-call-style';

  let activeCallRoom = null;
  let jitsiApi = null;
  let wakeLock = null;
  let mountToken = 0;

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

  function normalizeBase(base) {
    return String(base || SELF_HOSTED_BASE).replace(/\/?$/, '/');
  }

  function buildRoomUrl(roomName, base = SELF_HOSTED_BASE) {
    const room = encodeURIComponent(String(roomName || makeRoomName()).replace(/[^a-zA-Z0-9_-]/g, ''));
    return `${normalizeBase(base)}${room}#config.startAudioOnly=false&config.startWithAudioMuted=false&config.startWithVideoMuted=false&config.prejoinPageEnabled=false&config.disableDeepLinking=true`;
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
    try { localStorage.setItem(SELF_HOSTED_SEEN_KEY, '1'); } catch (_) {}
  }

  function publicFallbackAllowed() {
    try {
      const saved = localStorage.getItem(PUBLIC_FALLBACK_ALLOWED_KEY);
      if (saved === '0') return false;
      if (saved === '1') return true;
    } catch (_) {}
    return true;
  }

  function setPublicFallbackAllowed(enabled) {
    try { localStorage.setItem(PUBLIC_FALLBACK_ALLOWED_KEY, enabled ? '1' : '0'); } catch (_) {}
  }

  async function probe(url, timeoutMs = 3000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-store', signal: controller.signal });
      return true;
    } catch (_) {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function resolveProvider() {
    const fallbackAllowed = publicFallbackAllowed();
    const [selfHostedOk, fallbackOk] = await Promise.all([
      probe(SELF_HOSTED_BASE, 3000),
      fallbackAllowed ? probe(TEMP_PUBLIC_FALLBACK_BASE, 3000) : Promise.resolve(false)
    ]);

    if (selfHostedOk) {
      markSelfHostedWorking();
      return { base: SELF_HOSTED_BASE, provider: 'NOVA Call self-hosted', selfHosted: true, temporaryFallback: false };
    }

    if (fallbackOk) {
      return { base: TEMP_PUBLIC_FALLBACK_BASE, provider: 'Jitsi public fallback', selfHosted: false, temporaryFallback: true };
    }

    throw new Error('Сейчас нет доступного маршрута NOVA Call.');
  }

  function createRoomWithProvider(provider, roomName = makeRoomName()) {
    const room = {
      roomName,
      url: buildRoomUrl(roomName, provider.base),
      base: provider.base,
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
    ? { base: SELF_HOSTED_BASE, provider: 'NOVA Call self-hosted', selfHosted: true, temporaryFallback: false }
    : { base: TEMP_PUBLIC_FALLBACK_BASE, provider: 'Jitsi public fallback', selfHosted: false, temporaryFallback: true };

  async function refreshActiveProvider() {
    try { activeProvider = await resolveProvider(); } catch (_) {}
    return activeProvider;
  }

  function createRoom() {
    return createRoomWithProvider(activeProvider);
  }

  async function createBestRoom() {
    const provider = await resolveProvider();
    activeProvider = provider;
    return createRoomWithProvider(provider);
  }

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
      inlineVideoCall: true,
      iframeApi: true,
      online: navigator.onLine !== false,
      mediaDevices: Boolean(navigator.mediaDevices?.getUserMedia)
    };
  }

  async function testDevices() {
    if (!navigator.mediaDevices?.getUserMedia) {
      return { ok: false, camera: false, microphone: false, error: 'Камера и микрофон недоступны в этом браузере.' };
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      return {
        ok: true,
        camera: stream.getVideoTracks().length > 0,
        microphone: stream.getAudioTracks().length > 0
      };
    } catch (error) {
      return { ok: false, camera: false, microphone: false, error: error?.message || 'Нет разрешения на камеру или микрофон.' };
    } finally {
      stream?.getTracks?.().forEach((track) => track.stop());
    }
  }

  async function shareRoom(room = getLastRoom()) {
    if (!room?.url) return false;
    const data = {
      title: 'NOVA VIDEO CALL',
      text: 'Видеозвонок NOVA — открой ссылку и разреши камеру и микрофон',
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
    return copyRoomLink(room);
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

  function setCallStatus(text, kind = '') {
    const root = document.getElementById(UI_ID);
    const status = root?.querySelector('[data-nova-call-status]');
    if (!status) return;
    status.textContent = text;
    status.dataset.state = kind;
  }

  function ensureCallStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${UI_ID}{position:fixed;inset:0;z-index:2147483000;background:#02040b;display:flex;flex-direction:column;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}
      #${UI_ID}[hidden]{display:none!important}
      #${UI_ID} .nova-call-bar{min-height:58px;display:flex;align-items:center;gap:9px;padding:8px 10px;background:rgba(4,9,24,.98);border-bottom:1px solid rgba(255,255,255,.12);color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      #${UI_ID} .nova-call-title{min-width:0;flex:1} #${UI_ID} .nova-call-title b{display:block;font-size:15px} #${UI_ID} .nova-call-title small{display:block;opacity:.72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;margin-top:2px}
      #${UI_ID} .nova-call-status{font-size:11px;padding:5px 8px;border-radius:999px;background:rgba(255,255,255,.08);white-space:nowrap} #${UI_ID} .nova-call-status[data-state="ready"]{background:rgba(35,180,105,.2)} #${UI_ID} .nova-call-status[data-state="error"]{background:rgba(220,70,70,.22)}
      #${UI_ID} button{appearance:none;border:1px solid rgba(255,255,255,.17);background:rgba(255,255,255,.08);color:#fff;border-radius:12px;min-height:39px;padding:0 11px;font:700 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif} #${UI_ID} button:active{transform:scale(.97)}
      #${UI_ID} .nova-call-close{width:40px;padding:0;font-size:24px} #${UI_ID} .nova-call-stage{position:relative;flex:1;min-height:0;background:#000;overflow:hidden} #${UI_ID} .nova-call-mount,#${UI_ID} .nova-call-mount>iframe{width:100%!important;height:100%!important;min-height:100%!important;border:0!important}
      #${UI_ID} .nova-call-actions{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;padding:8px 9px;background:rgba(4,9,24,.98);border-top:1px solid rgba(255,255,255,.12)} #${UI_ID} .nova-call-actions button:first-child{background:rgba(40,180,110,.18);border-color:rgba(80,230,145,.45)}
      #${UI_ID} .nova-call-note{grid-column:1/-1;color:rgba(255,255,255,.68);font:500 10px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;line-height:1.3}
      @media(max-width:560px){#${UI_ID} .nova-call-actions{grid-template-columns:1fr 1fr} #${UI_ID} .nova-call-status{display:none}}
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
        <span class="nova-call-status" data-nova-call-status>ГОТОВЛЮ…</span>
        <button class="nova-call-close" type="button" data-nova-call-close aria-label="Закрыть">×</button>
      </div>
      <div class="nova-call-stage"><div class="nova-call-mount" data-nova-call-mount></div></div>
      <div class="nova-call-actions">
        <button type="button" data-nova-call-share>📤 Маме</button>
        <button type="button" data-nova-call-copy>🔗 Ссылка</button>
        <button type="button" data-nova-call-reconnect>↻ Повтор</button>
        <button type="button" data-nova-call-switch>⇄ Резерв</button>
        <button type="button" data-nova-call-devices>🎥 Тест</button>
        <button type="button" data-nova-call-external>↗ Отдельно</button>
        <div class="nova-call-note" data-nova-call-note>Разреши камеру и микрофон. NOVA сначала использует свой сервер, при проблеме — бесплатный резерв.</div>
      </div>`;
    document.body.appendChild(root);

    root.querySelector('[data-nova-call-close]')?.addEventListener('click', closeRoom);
    root.querySelector('[data-nova-call-share]')?.addEventListener('click', async () => {
      const button = root.querySelector('[data-nova-call-share]');
      const old = button.textContent;
      const ok = await shareRoom(activeCallRoom);
      button.textContent = ok ? '✅ Готово' : '📤 Маме';
      setTimeout(() => { button.textContent = old; }, 1300);
    });
    root.querySelector('[data-nova-call-copy]')?.addEventListener('click', async () => {
      const button = root.querySelector('[data-nova-call-copy]');
      const old = button.textContent;
      const ok = await copyRoomLink(activeCallRoom);
      button.textContent = ok ? '✅ Скопировано' : '⚠️ Ошибка';
      setTimeout(() => { button.textContent = old; }, 1300);
    });
    root.querySelector('[data-nova-call-reconnect]')?.addEventListener('click', () => {
      if (activeCallRoom) mountRoom(activeCallRoom, true);
    });
    root.querySelector('[data-nova-call-switch]')?.addEventListener('click', switchProvider);
    root.querySelector('[data-nova-call-devices]')?.addEventListener('click', async () => {
      setCallStatus('ТЕСТ…');
      const result = await testDevices();
      setCallStatus(result.ok ? 'КАМЕРА + МИК ✅' : 'НЕТ ДОСТУПА', result.ok ? 'ready' : 'error');
    });
    root.querySelector('[data-nova-call-external]')?.addEventListener('click', () => openRoomExternal(activeCallRoom));
    return root;
  }

  function providerText(room) {
    return room?.selfHosted ? 'Свой NOVA Call сервер · видео' : 'Бесплатный резерв Jitsi · видео';
  }

  function disposeMeeting() {
    mountToken += 1;
    try { jitsiApi?.dispose?.(); } catch (_) {}
    jitsiApi = null;
    const root = document.getElementById(UI_ID);
    const mount = root?.querySelector('[data-nova-call-mount]');
    if (mount) mount.innerHTML = '';
  }

  function loadScript(src, timeoutMs = 7000) {
    return new Promise((resolve, reject) => {
      if (window.JitsiMeetExternalAPI) return resolve(true);
      const existing = [...document.scripts].find((s) => s.src === src);
      if (existing) {
        const timer = setTimeout(() => reject(new Error('Jitsi API timeout')), timeoutMs);
        existing.addEventListener('load', () => { clearTimeout(timer); resolve(true); }, { once: true });
        existing.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Jitsi API load error')); }, { once: true });
        return;
      }
      const script = document.createElement('script');
      const timer = setTimeout(() => { script.remove(); reject(new Error('Jitsi API timeout')); }, timeoutMs);
      script.src = src;
      script.async = true;
      script.onload = () => { clearTimeout(timer); resolve(true); };
      script.onerror = () => { clearTimeout(timer); reject(new Error('Jitsi API load error')); };
      document.head.appendChild(script);
    });
  }

  async function requestWakeLock() {
    if (!navigator.wakeLock?.request || document.visibilityState !== 'visible') return false;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener?.('release', () => { wakeLock = null; }, { once: true });
      return true;
    } catch (_) { return false; }
  }

  async function releaseWakeLock() {
    try { await wakeLock?.release?.(); } catch (_) {}
    wakeLock = null;
  }

  function bindJitsiEvents(api, room, token) {
    const current = () => token === mountToken && activeCallRoom?.roomName === room.roomName;
    api.addListener?.('videoConferenceJoined', () => {
      if (!current()) return;
      setCallStatus('В ЭФИРЕ', 'ready');
      requestWakeLock();
    });
    api.addListener?.('participantJoined', () => {
      if (!current()) return;
      setCallStatus('МАМА ПОДКЛЮЧИЛАСЬ', 'ready');
    });
    api.addListener?.('participantLeft', () => {
      if (!current()) return;
      setCallStatus('СОБЕСЕДНИК ВЫШЕЛ');
    });
    api.addListener?.('cameraError', () => {
      if (!current()) return;
      setCallStatus('КАМЕРА ⚠️', 'error');
    });
    api.addListener?.('micError', () => {
      if (!current()) return;
      setCallStatus('МИКРОФОН ⚠️', 'error');
    });
    api.addListener?.('videoConferenceLeft', () => {
      if (!current()) return;
      setCallStatus('ЗВОНОК ЗАВЕРШЁН');
      releaseWakeLock();
    });
    api.addListener?.('readyToClose', () => {
      if (!current()) return;
      closeRoom();
    });
  }

  function fallbackDirectIframe(room, token) {
    if (token !== mountToken) return;
    const root = ensureCallUi();
    const mount = root.querySelector('[data-nova-call-mount]');
    if (!mount) return;
    mount.innerHTML = '';
    const frame = document.createElement('iframe');
    frame.title = 'NOVA видеозвонок';
    frame.allow = 'camera; microphone; fullscreen; display-capture; autoplay; clipboard-write';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'no-referrer';
    frame.src = room.url;
    frame.addEventListener('load', () => setCallStatus('ОТКРЫТО', 'ready'), { once: true });
    mount.appendChild(frame);
  }

  async function mountRoom(room, force = false) {
    if (!room?.url) return false;
    const root = ensureCallUi();
    const mount = root.querySelector('[data-nova-call-mount]');
    const provider = root.querySelector('[data-nova-call-provider]');
    if (!mount) return false;

    if (force) disposeMeeting();
    const token = ++mountToken;
    if (provider) provider.textContent = providerText(room);
    setCallStatus(navigator.onLine === false ? 'НЕТ ИНТЕРНЕТА' : 'ПОДКЛЮЧЕНИЕ…', navigator.onLine === false ? 'error' : '');
    mount.innerHTML = '';

    let origin;
    try { origin = new URL(room.base || room.url).origin; }
    catch (_) { origin = new URL(room.url).origin; }

    try {
      await loadScript(`${origin}/external_api.js`);
      if (token !== mountToken) return false;
      if (typeof window.JitsiMeetExternalAPI !== 'function') throw new Error('Jitsi API unavailable');
      const domain = new URL(origin).host;
      jitsiApi = new window.JitsiMeetExternalAPI(domain, {
        roomName: room.roomName,
        parentNode: mount,
        width: '100%',
        height: '100%',
        lang: 'ru',
        configOverwrite: {
          prejoinPageEnabled: false,
          startWithAudioMuted: false,
          startWithVideoMuted: false,
          disableDeepLinking: true,
          enableWelcomePage: false
        },
        interfaceConfigOverwrite: { MOBILE_APP_PROMO: false }
      });
      bindJitsiEvents(jitsiApi, room, token);
      setCallStatus('ЗАПУСК…');
      return true;
    } catch (_) {
      fallbackDirectIframe(room, token);
      return true;
    }
  }

  function closeRoom() {
    const root = document.getElementById(UI_ID);
    if (!root) return false;
    disposeMeeting();
    root.hidden = true;
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    activeCallRoom = null;
    releaseWakeLock();
    return true;
  }

  function openRoom(room = getLastRoom()) {
    if (!room?.url) return false;
    const root = ensureCallUi();
    activeCallRoom = room;
    root.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    mountRoom(room, true);
    return true;
  }

  function openRoomExternal(room = activeCallRoom || getLastRoom()) {
    if (!room?.url) return false;
    const opened = window.open(room.url, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.assign(room.url);
    return true;
  }

  async function switchProvider() {
    if (!activeCallRoom) return false;
    const useFallback = activeCallRoom.selfHosted;
    if (useFallback && !publicFallbackAllowed()) setPublicFallbackAllowed(true);
    const provider = useFallback
      ? { base: TEMP_PUBLIC_FALLBACK_BASE, provider: 'Jitsi public fallback', selfHosted: false, temporaryFallback: true }
      : { base: SELF_HOSTED_BASE, provider: 'NOVA Call self-hosted', selfHosted: true, temporaryFallback: false };
    const switched = createRoomWithProvider(provider, activeCallRoom.roomName);
    activeCallRoom = switched;
    await mountRoom(switched, true);
    setCallStatus('МАРШРУТ СМЕНЁН', 'ready');
    return switched;
  }

  async function createAndOpen() {
    const room = await createBestRoom();
    openRoom(room);
    return room;
  }

  async function reopenLastRoom(maxAgeMs = 6 * 60 * 60 * 1000) {
    const room = getLastRoom();
    if (!room?.url || Date.now() - Number(room.createdAt || 0) > maxAgeMs) return false;
    return openRoom(room);
  }

  window.addEventListener('offline', () => {
    if (activeCallRoom) setCallStatus('НЕТ ИНТЕРНЕТА', 'error');
  });
  window.addEventListener('online', () => {
    if (activeCallRoom) {
      setCallStatus('ИНТЕРНЕТ ВЕРНУЛСЯ');
      mountRoom(activeCallRoom, true);
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (activeCallRoom && document.visibilityState === 'visible') requestWakeLock();
  });

  refreshActiveProvider();

  window.NOVA_FREE_CALLS = {
    version: VERSION,
    selfHostedBase: SELF_HOSTED_BASE,
    fallbackBase: TEMP_PUBLIC_FALLBACK_BASE,
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
    reopenLastRoom,
    switchProvider,
    testDevices,
    diagnose,
    resolveProvider,
    setPublicFallbackAllowed,
    publicFallbackAllowed
  };
})();