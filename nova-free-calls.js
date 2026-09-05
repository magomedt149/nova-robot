(() => {
  'use strict';

  const VERSION = '1.0.0';
  const ROOM_PREFIX = 'NOVA-TUMSOEV';
  const JITSI_BASE = 'https://meet.jit.si/';
  const STORAGE_KEY = 'nova.freeCalls.lastRoom.v1';

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

  function buildRoomUrl(roomName) {
    const room = encodeURIComponent(String(roomName || makeRoomName()).replace(/[^a-zA-Z0-9_-]/g, ''));
    return `${JITSI_BASE}${room}#config.startAudioOnly=true&config.startWithVideoMuted=true`;
  }

  function saveRoom(room) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(room));
    } catch (_) {}
  }

  function getLastRoom() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value ? JSON.parse(value) : null;
    } catch (_) {
      return null;
    }
  }

  function createRoom() {
    const roomName = makeRoomName();
    const url = buildRoomUrl(roomName);
    const room = {
      roomName,
      url,
      createdAt: Date.now(),
      provider: 'Jitsi Meet',
      mode: 'FREE_INTERNET_CALL',
      pstn: false
    };
    saveRoom(room);
    return room;
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

  function createAndOpen() {
    const room = createRoom();
    openRoom(room);
    return room;
  }

  window.NOVA_FREE_CALLS = {
    version: VERSION,
    createRoom,
    buildRoomUrl,
    getLastRoom,
    shareRoom,
    openRoom,
    createAndOpen
  };
})();
