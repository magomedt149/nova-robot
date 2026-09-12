(() => {
  'use strict';

  const VERSION = '1.4.0';
  const ROOM_PREFIX = 'NOVA-TUMSOEV';
  const SELF_HOSTED_BASE = 'https://call.tumsoev.com/';
  const TEMP_PUBLIC_FALLBACK_BASE = 'https://jitsi.member.fsf.org/';
  const MODERATOR_FALLBACK_BASE = 'https://meet.jit.si/';
  const STORAGE_KEY = 'nova.freeCalls.lastRoom.v1';
  const SELF_HOSTED_SEEN_KEY = 'nova.freeCalls.selfHostedSeen.v1';
  const PUBLIC_FALLBACK_ALLOWED_KEY = 'nova.freeCalls.publicFallbackAllowed.v1';
  const UI_ID = 'nova-free-call-ui';
  const STYLE_ID = 'nova-free-call-style';
  const SELF_HOSTED_PROBE_MS = 1400;
  const PUBLIC_API_TIMEOUT_MS = 6500;
  const CONNECTION_TIMEOUT_MS = 18000;

  const PROVIDERS = Object.freeze({
    selfHosted: Object.freeze({
      id: 'self-hosted',
      base: SELF_HOSTED_BASE,
      provider: 'NOVA Call self-hosted',
      selfHosted: true,
      temporaryFallback: false,
      communityFallback: false,
      requiresModeratorLogin: false,
      inline: true
    }),
    community: Object.freeze({
      id: 'community',
      base: TEMP_PUBLIC_FALLBACK_BASE,
      provider: 'Jitsi community fallback',
      selfHosted: false,
      temporaryFallback: true,
      communityFallback: true,
      requiresModeratorLogin: false,
      inline: true
    }),
    moderator: Object.freeze({
      id: 'moderator-login',
      base: MODERATOR_FALLBACK_BASE,
      provider: 'Jitsi moderator-login fallback',
      selfHosted: false,
      temporaryFallback: true,
      communityFallback: false,
      requiresModeratorLogin: true,
      inline: false
    })
  });

  let activeCallRoom = null;
  let jitsiApi = null;
  let wakeLock = null;
  let mountToken = 0;
  let connectionTimer = 0;

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
    const config = [
      'config.startAudioOnly=false',
      'config.startWithAudioMuted=false',
      'config.startWithVideoMuted=false',
      'config.prejoinPageEnabled=false',
      'config.prejoinConfig.enabled=false',
      'config.disableDeepLinking=true'
    ];
    return `${normalizeBase(base)}${room}#${config.join('&')}`;
  }

  function saveRoom(room) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(room)); } catch (_) {}
  }

  function getLastRoom() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      const room = value ? JSON.parse(value) : null;
      if (!room?.url) return room;

      // Rooms created by older NOVA builds used meet.jit.si as the normal
      // fallback. That service now requires a moderator login and the OAuth
      // popup is commonly blocked inside an iPhone PWA iframe. Migrate only
      // those legacy rooms to the anonymous community route.
      const isLegacyModeratorRoom = normalizeBase(room.base) === normalizeBase(MODERATOR_FALLBACK_BASE)
        && room.requiresModeratorLogin !== true;
      if (isLegacyModeratorRoom) {
        const migrated = {
          ...room,
          url: buildRoomUrl(room.roomName, TEMP_PUBLIC_FALLBACK_BASE),
          base: TEMP_PUBLIC_FALLBACK_BASE,
          provider: PROVIDERS.community.provider,
          providerId: PROVIDERS.community.id,
          selfHosted: false,
          temporaryFallback: true,
          communityFallback: true,
          requiresModeratorLogin: false,
          inline: true
        };
        saveRoom(migrated);
        return migrated;
      }
      return room;
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

  function providerConfig(provider) {
    return { ...(provider || PROVIDERS.community) };
  }

  function probeImage(base, timeoutMs = 3500) {
    return new Promise((resolve) => {
      if (navigator.onLine === false) { resolve(false); return; }
      const image = new Image();
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        image.onload = null;
        image.onerror = null;
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      image.onload = () => finish(true);
      image.onerror = () => finish(false);
      image.src = `${normalizeBase(base)}images/favicon.ico?nova_probe=${Date.now()}`;
    });
  }

  async function resolveProvider() {
    if (navigator.onLine === false) throw new Error('Нет интернета. Подключись к сети и нажми «Повтор».');

    // Do not delay every call by probing an undeployed server. Once the
    // self-hosted route has completed a real conference, NOVA checks it for a
    // short bounded time and otherwise falls back immediately.
    if (hasSelfHostedEverWorked() && await probeImage(SELF_HOSTED_BASE, SELF_HOSTED_PROBE_MS)) {
      return providerConfig(PROVIDERS.selfHosted);
    }

    if (publicFallbackAllowed()) return providerConfig(PROVIDERS.community);

    if (await probeImage(SELF_HOSTED_BASE, 3000)) return providerConfig(PROVIDERS.selfHosted);
    throw new Error('Свой сервер NOVA Call недоступен, а бесплатный резерв отключён.');
  }

  function createRoomWithProvider(provider, roomName = makeRoomName()) {
    const room = {
      roomName,
      url: buildRoomUrl(roomName, provider.base),
      base: provider.base,
      createdAt: Date.now(),
      provider: provider.provider,
      providerId: provider.id || '',
      selfHosted: provider.selfHosted === true,
      temporaryFallback: provider.temporaryFallback === true,
      communityFallback: provider.communityFallback === true,
      requiresModeratorLogin: provider.requiresModeratorLogin === true,
      inline: provider.inline !== false,
      mode: 'FREE_VIDEO_CALL',
      video: true,
      pstn: false
    };
    saveRoom(room);
    return room;
  }

  let activeProvider = providerConfig(hasSelfHostedEverWorked() ? PROVIDERS.selfHosted : PROVIDERS.community);

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
    const [selfHosted, communityFallback] = await Promise.all([
      probeImage(SELF_HOSTED_BASE, 4000),
      publicFallbackAllowed() ? probeImage(TEMP_PUBLIC_FALLBACK_BASE, 5000) : Promise.resolve(false)
    ]);
    let emergencyFallback = false;
    if (!communityFallback && publicFallbackAllowed()) {
      try {
        await loadScript(`${normalizeBase(MODERATOR_FALLBACK_BASE)}external_api.js`, 5000);
        emergencyFallback = true;
      } catch (_) {}
    }
    if (selfHosted) markSelfHostedWorking();
    return {
      version: VERSION,
      selfHostedUrl: SELF_HOSTED_BASE,
      selfHostedOnline: selfHosted,
      publicFallbackAllowed: publicFallbackAllowed(),
      publicFallbackOnline: communityFallback || emergencyFallback,
      communityFallbackUrl: TEMP_PUBLIC_FALLBACK_BASE,
      communityFallbackOnline: communityFallback,
      emergencyFallbackUrl: MODERATOR_FALLBACK_BASE,
      emergencyFallbackOnline: emergencyFallback,
      emergencyFallbackRequiresModeratorLogin: true,
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
      #${UI_ID} .nova-call-loading,#${UI_ID} .nova-call-fallback{box-sizing:border-box;width:100%;height:100%;min-height:260px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:28px;color:#fff;text-align:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      #${UI_ID} .nova-call-spinner{width:38px;height:38px;border:4px solid rgba(255,255,255,.2);border-top-color:#4f94ff;border-radius:50%;animation:nova-call-spin .8s linear infinite} #${UI_ID} .nova-call-fallback b{font-size:21px} #${UI_ID} .nova-call-fallback p{max-width:440px;margin:0;color:rgba(255,255,255,.76);font-size:15px;line-height:1.45} #${UI_ID} .nova-call-fallback button{min-height:50px;padding:0 20px;background:#397fe8;border-color:#68a0f1;font-size:15px}
      #${UI_ID} .nova-call-actions{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;padding:8px 9px;background:rgba(4,9,24,.98);border-top:1px solid rgba(255,255,255,.12)} #${UI_ID} .nova-call-actions button:first-child{background:rgba(40,180,110,.18);border-color:rgba(80,230,145,.45)}
      #${UI_ID} .nova-call-note{grid-column:1/-1;color:rgba(255,255,255,.68);font:500 10px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;line-height:1.3}
      @keyframes nova-call-spin{to{transform:rotate(360deg)}}
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
    if (room?.selfHosted) return 'Свой NOVA Call сервер · видео';
    if (room?.requiresModeratorLogin) return 'Аварийный резерв Jitsi · нужен вход организатора';
    return 'Бесплатный резерв Jitsi · без регистрации';
  }

  function clearConnectionTimer() {
    clearTimeout(connectionTimer);
    connectionTimer = 0;
  }

  function disposeMeeting() {
    mountToken += 1;
    clearConnectionTimer();
    try { jitsiApi?.dispose?.(); } catch (_) {}
    jitsiApi = null;
    const root = document.getElementById(UI_ID);
    const mount = root?.querySelector('[data-nova-call-mount]');
    if (mount) mount.innerHTML = '';
  }

  function loadScript(src, timeoutMs = PUBLIC_API_TIMEOUT_MS) {
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
    const current = () => token === mountToken
      && activeCallRoom?.roomName === room.roomName
      && activeCallRoom?.providerId === room.providerId;
    api.addListener?.('videoConferenceJoined', () => {
      if (!current()) return;
      clearConnectionTimer();
      if (room.selfHosted) markSelfHostedWorking();
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
    api.addListener?.('errorOccurred', (event) => {
      if (!current()) return;
      const signature = `${event?.type || ''} ${event?.name || ''}`.toLowerCase();
      if (/conference|connection|authentication/.test(signature)) {
        handleRoomFailure(room, token, 'Jitsi connection error');
        return;
      }
      setCallStatus('ОШИБКА JITSI', 'error');
    });
    api.addListener?.('videoConferenceLeft', () => {
      if (!current()) return;
      clearConnectionTimer();
      setCallStatus('ЗВОНОК ЗАВЕРШЁН');
      releaseWakeLock();
    });
    api.addListener?.('readyToClose', () => {
      if (!current()) return;
      closeRoom();
    });
  }

  function setMountLoading(message = 'Подключаю быстрый бесплатный маршрут…') {
    const root = ensureCallUi();
    const mount = root.querySelector('[data-nova-call-mount]');
    if (!mount) return false;
    mount.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'nova-call-loading';
    const spinner = document.createElement('span');
    spinner.className = 'nova-call-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const label = document.createElement('b');
    label.textContent = message;
    box.append(spinner, label);
    mount.appendChild(box);
    return true;
  }

  function showExternalFallback(room, reason = '') {
    const root = ensureCallUi();
    const mount = root.querySelector('[data-nova-call-mount]');
    const provider = root.querySelector('[data-nova-call-provider]');
    const note = root.querySelector('[data-nova-call-note]');
    if (!mount) return false;
    clearConnectionTimer();
    if (provider) provider.textContent = providerText(room);
    mount.innerHTML = '';

    const box = document.createElement('div');
    box.className = 'nova-call-fallback';
    const title = document.createElement('b');
    title.textContent = room.requiresModeratorLogin
      ? 'Открой звонок отдельно'
      : 'Не удалось подключить звонок внутри NOVA';
    const message = document.createElement('p');
    message.textContent = room.requiresModeratorLogin
      ? 'Этот аварийный сервер просит первого участника войти как организатор. Отдельное окно не блокирует вход, как встроенный экран iPhone.'
      : 'Нажми кнопку ниже — звонок откроется напрямую в браузере.';
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = '↗ Открыть видеозвонок';
    open.addEventListener('click', () => openRoomExternal(room));
    box.append(title, message, open);

    if (reason) {
      const detail = document.createElement('small');
      detail.textContent = 'NOVA остановила бесконечную загрузку и подготовила рабочий запасной запуск.';
      box.appendChild(detail);
    }
    mount.appendChild(box);
    if (note) note.textContent = 'Ссылка комнаты сохранена. Кнопки «Маме» и «Ссылка» продолжают работать.';
    setCallStatus('НУЖНО ОТКРЫТЬ', 'error');
    return true;
  }

  async function handleRoomFailure(room, token, reason = '') {
    if (token !== mountToken) return false;
    clearConnectionTimer();

    if (room.selfHosted && publicFallbackAllowed()) {
      const fallback = createRoomWithProvider(PROVIDERS.community, room.roomName);
      activeProvider = providerConfig(PROVIDERS.community);
      activeCallRoom = fallback;
      setCallStatus('ВКЛЮЧАЮ РЕЗЕРВ…');
      return mountRoom(fallback, true);
    }

    if (room.communityFallback && publicFallbackAllowed()) {
      disposeMeeting();
      const fallback = createRoomWithProvider(PROVIDERS.moderator, room.roomName);
      activeProvider = providerConfig(PROVIDERS.moderator);
      activeCallRoom = fallback;
      return showExternalFallback(fallback, reason);
    }

    disposeMeeting();
    activeCallRoom = room;
    return showExternalFallback(room, reason);
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
    setMountLoading(navigator.onLine === false ? 'Нет интернета' : 'Подключаю видеозвонок…');

    if (navigator.onLine === false) return false;
    if (room.requiresModeratorLogin || room.inline === false) {
      showExternalFallback(room);
      return true;
    }

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
        userInfo: { displayName: 'Тумсоев' },
        configOverwrite: {
          prejoinPageEnabled: false,
          prejoinConfig: { enabled: false },
          startWithAudioMuted: false,
          startWithVideoMuted: false,
          disableDeepLinking: true,
          enableWelcomePage: false
        },
        interfaceConfigOverwrite: { MOBILE_APP_PROMO: false }
      });
      bindJitsiEvents(jitsiApi, room, token);
      setCallStatus('ЗАПУСК…');
      clearConnectionTimer();
      connectionTimer = setTimeout(() => {
        if (token === mountToken) handleRoomFailure(room, token, 'Connection timeout');
      }, room.selfHosted ? 9000 : CONNECTION_TIMEOUT_MS);
      return true;
    } catch (error) {
      return handleRoomFailure(room, token, error?.message || 'Jitsi API unavailable');
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
    let nextProvider = PROVIDERS.selfHosted;
    if (activeCallRoom.selfHosted) nextProvider = PROVIDERS.community;
    else if (activeCallRoom.communityFallback) nextProvider = PROVIDERS.moderator;
    if (nextProvider.temporaryFallback && !publicFallbackAllowed()) setPublicFallbackAllowed(true);
    const switched = createRoomWithProvider(nextProvider, activeCallRoom.roomName);
    activeProvider = providerConfig(nextProvider);
    activeCallRoom = switched;
    await mountRoom(switched, true);
    return switched;
  }

  async function createAndOpen() {
    const root = ensureCallUi();
    root.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    const provider = root.querySelector('[data-nova-call-provider]');
    if (provider) provider.textContent = 'Выбираю лучший маршрут…';
    setCallStatus('ГОТОВЛЮ…');
    setMountLoading();
    try {
      const room = await createBestRoom();
      activeCallRoom = room;
      await mountRoom(room, true);
      return activeCallRoom || room;
    } catch (error) {
      setCallStatus('НЕ УДАЛОСЬ', 'error');
      const fallback = createRoomWithProvider(PROVIDERS.moderator);
      activeCallRoom = fallback;
      showExternalFallback(fallback, error?.message || 'No route');
      throw error;
    }
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

  window.NOVA_FREE_CALLS = {
    version: VERSION,
    selfHostedBase: SELF_HOSTED_BASE,
    fallbackBase: TEMP_PUBLIC_FALLBACK_BASE,
    communityFallbackBase: TEMP_PUBLIC_FALLBACK_BASE,
    moderatorFallbackBase: MODERATOR_FALLBACK_BASE,
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
