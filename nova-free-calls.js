(() => {
  'use strict';

  const VERSION = '1.1.1';
  const ROOM_PREFIX = 'NOVA-TUMSOEV';
  const SELF_HOSTED_BASE = 'https://call.tumsoev.com/';
  const TEMP_PUBLIC_FALLBACK_BASE = 'https://meet.jit.si/';
  const STORAGE_KEY = 'nova.freeCalls.lastRoom.v1';
  const SELF_HOSTED_SEEN_KEY = 'nova.freeCalls.selfHostedSeen.v1';
  const PUBLIC_FALLBACK_ALLOWED_KEY = 'nova.freeCalls.publicFallbackAllowed.v1';

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
    return `${normalizedBase}${room}#config.startAudioOnly=true&config.startWithVideoMuted=true`;
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
      mode: 'FREE_INTERNET_CALL',
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
      permanentlyPreferSelfHosted: hasSelfHostedEverWorked()
    };
  }

  async function shareRoom(room = getLastRoom()) {
    if (!room?.url) return false;
    const data = {
      title: 'NOVA FREE CALL',
      text: 'Бесплатный интернет-звонок NOVA',
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

  function openRoom(room = getLastRoom()) {
    if (!room?.url) return false;
    window.location.assign(room.url);
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
    openRoom,
    createAndOpen,
    diagnose,
    resolveProvider,
    setPublicFallbackAllowed,
    publicFallbackAllowed
  };
})();
