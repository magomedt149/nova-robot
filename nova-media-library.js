(() => {
  'use strict';

  if (window.NovaMediaLibrary) return;

  const $ = (selector, root = document) => root.querySelector(selector);
  const DB_NAME = 'nova-media-library-v1';
  const STORE = 'files';
  const records = new Map();
  const capturedHrefs = new Set();
  let dbPromise = null;
  let observer = null;

  function status(message) {
    const local = $('#novaMediaStatus');
    if (local) local.textContent = message;
    const global = $('#statusText');
    if (global) global.textContent = message;
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB недоступен.'));
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
          store.createIndex('fingerprint', 'fingerprint');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Не удалось открыть локальную медиатеку.'));
    });
    return dbPromise;
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error('Операция IndexedDB отменена.'));
      tx.onerror = () => reject(tx.error || new Error('Ошибка IndexedDB.'));
    });
  }

  async function loadStored() {
    try {
      const db = await openDb();
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).getAll();
      const stored = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
      stored.forEach((record) => records.set(record.id, { ...record, persisted: true }));
      await txDone(tx).catch(() => {});
    } catch (_) {}
    render();
  }

  async function persist(record) {
    try {
      const db = await openDb();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({
        id: record.id,
        name: record.name,
        type: record.type,
        size: record.size,
        createdAt: record.createdAt,
        source: record.source,
        fingerprint: record.fingerprint,
        blob: record.blob
      });
      await txDone(tx);
      record.persisted = true;
      return true;
    } catch (error) {
      record.persisted = false;
      if (error?.name === 'QuotaExceededError') status('🟡 Память iPhone/PWA заполнена: новый файл доступен сейчас, но не сохранён в постоянную медиатеку.');
      return false;
    }
  }

  async function deleteStored(id) {
    try {
      const db = await openDb();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      await txDone(tx);
    } catch (_) {}
  }

  function safeName(name) {
    return String(name || 'NOVA_FILE').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'NOVA_FILE';
  }

  function inferKind(name, type) {
    const mime = String(type || '').toLowerCase();
    if (mime.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(name)) return 'video';
    if (mime.startsWith('audio/') || /\.(mp3|wav|m4a|aac)$/i.test(name)) return 'audio';
    if (/\.(srt|vtt)$/i.test(name)) return 'subtitle';
    return 'file';
  }

  function iconFor(record) {
    const kind = inferKind(record.name, record.type);
    if (kind === 'video') return '🎬';
    if (kind === 'audio') return '🎵';
    if (kind === 'subtitle') return '💬';
    return '📄';
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  }

  function makeFingerprint(name, blob) {
    return `${safeName(name)}|${blob?.size || 0}|${blob?.type || ''}`;
  }

  function existingByFingerprint(fingerprint) {
    return [...records.values()].find((record) => record.fingerprint === fingerprint) || null;
  }

  async function registerBlob(blob, name, source = 'NOVA') {
    if (!(blob instanceof Blob) || !blob.size) return null;
    const filename = safeName(name);
    const fingerprint = makeFingerprint(filename, blob);
    const existing = existingByFingerprint(fingerprint);
    if (existing) return existing;
    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name: filename,
      type: blob.type || '',
      size: blob.size,
      createdAt: Date.now(),
      source,
      fingerprint,
      blob,
      persisted: false
    };
    records.set(record.id, record);
    render();
    await persist(record);
    render();
    return record;
  }

  async function blobFromLink(link) {
    const href = link?.href || '';
    if (!href) return null;
    const response = await fetch(href);
    if (!response.ok) throw new Error(`Не удалось прочитать ${link.download || 'файл'}.`);
    return response.blob();
  }

  function sourceFromLink(link) {
    if (link.closest('#novaShortDownloads')) return 'Multi Shorts';
    if (link.closest('#novaStoryDownloads')) return 'Рассказ / Аудиокнига';
    if (link.closest('#novaDubDownloads')) return 'Видео / Whisper';
    if (link.closest('#novaHoloDownloads')) return '3D Hologram';
    return 'NOVA Media Studio';
  }

  async function captureLink(link) {
    if (!(link instanceof HTMLAnchorElement)) return;
    if (link.dataset.novaLibraryOwn === '1') return;
    if (!link.download || !link.href) return;
    if (!link.closest('#novaMediaModal') && !link.closest('#novaShortDownloads')) return;
    if (capturedHrefs.has(link.href)) return;
    capturedHrefs.add(link.href);
    link.dataset.novaLibraryCaptured = '1';
    try {
      const blob = await blobFromLink(link);
      await registerBlob(blob, link.download, sourceFromLink(link));
    } catch (_) {
      capturedHrefs.delete(link.href);
    }
  }

  function scan(root = document) {
    const links = root.querySelectorAll?.('a[download]') || [];
    links.forEach((link) => captureLink(link).catch(() => {}));
  }

  function selectTab(name) {
    document.querySelectorAll('[data-media-tab]').forEach((button) => button.classList.toggle('active', button.dataset.mediaTab === name));
    document.querySelectorAll('[data-media-pane]').forEach((pane) => { pane.hidden = pane.dataset.mediaPane !== name; });
  }

  function injectStyles() {
    if ($('#novaLibraryStyles')) return;
    const style = document.createElement('style');
    style.id = 'novaLibraryStyles';
    style.textContent = `
      .nova-library-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin:8px 0}.nova-library-stats{font-size:12px;color:#9db7df}
      .nova-library-list{display:grid;gap:8px;margin:10px 0}.nova-library-item{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:9px;align-items:center;padding:10px;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:rgba(255,255,255,.04)}
      .nova-library-icon{font-size:24px}.nova-library-name{font-weight:850;overflow-wrap:anywhere}.nova-library-meta{font-size:11px;color:#86a3cd;margin-top:3px}.nova-library-actions{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end}.nova-library-actions button{border:1px solid rgba(90,157,255,.24);border-radius:10px;background:rgba(35,119,255,.14);color:#e8f1ff;padding:7px 9px;font-weight:800;font-size:11px}.nova-library-actions .danger{background:rgba(215,70,70,.13);border-color:rgba(255,95,95,.23)}
      .nova-library-empty{padding:18px;text-align:center;color:#88a4cf;border:1px dashed rgba(255,255,255,.12);border-radius:14px}
      @media(max-width:620px){.nova-library-item{grid-template-columns:auto 1fr}.nova-library-actions{grid-column:1/-1;justify-content:flex-start}.nova-library-actions button{flex:1 1 auto;min-height:40px}}
    `;
    document.head.appendChild(style);
  }

  function injectUi() {
    const modal = $('#novaMediaModal');
    if (!modal || $('#novaLibraryTab')) return false;
    const tabs = $('.nova-media-tabs', modal);
    const card = $('.nova-media-card', modal);
    const statusNode = $('#novaMediaStatus', modal);
    if (!tabs || !card) return false;

    const tab = document.createElement('button');
    tab.id = 'novaLibraryTab';
    tab.className = 'nova-media-tab';
    tab.type = 'button';
    tab.dataset.mediaTab = 'library';
    tab.textContent = '🗂 Медиатека';
    tabs.appendChild(tab);
    tabs.style.gridTemplateColumns = 'repeat(6,minmax(0,1fr))';

    const pane = document.createElement('div');
    pane.className = 'nova-media-pane';
    pane.dataset.mediaPane = 'library';
    pane.hidden = true;
    pane.innerHTML = `
      <div class="nova-media-note"><b>🗂 NOVA Медиатека</b><br>Здесь автоматически собираются готовые MP3, MP4, MOV, Shorts, SRT и другие файлы NOVA. Файлы хранятся локально на этом устройстве в IndexedDB. На iPhone видео можно отправить в «Фото», а MP3/SRT — в «Файлы» через системное меню.</div>
      <div class="nova-library-head">
        <div class="nova-media-actions"><button class="nova-media-btn" id="novaLibraryRefresh" type="button">↻ Обновить</button><button class="nova-media-btn primary" id="novaLibrarySaveVideos" type="button">📲 Все видео → «Фото»</button><button class="nova-media-btn" id="novaLibraryShareAll" type="button">📤 Все файлы → iPhone</button></div>
        <div class="nova-library-stats" id="novaLibraryStats">0 файлов</div>
      </div>
      <div class="nova-library-list" id="novaLibraryList"></div>`;
    card.insertBefore(pane, statusNode || null);

    tab.addEventListener('click', () => { selectTab('library'); render(); scan(document); });
    $('#novaLibraryRefresh', pane)?.addEventListener('click', () => { scan(document); loadStored().catch(() => {}); });
    $('#novaLibrarySaveVideos', pane)?.addEventListener('click', () => saveAllVideos().catch((error) => status(`Медиатека: ${error?.message || error}`)));
    $('#novaLibraryShareAll', pane)?.addEventListener('click', () => shareAll().catch((error) => status(`Медиатека: ${error?.message || error}`)));
    render();
    return true;
  }

  function recordArray() {
    return [...records.values()].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }

  async function downloadRecord(record) {
    if (!record?.blob) return;
    if (window.NovaIOSSave?.fallbackDownload) window.NovaIOSSave.fallbackDownload(record.blob, record.name);
    else {
      const url = URL.createObjectURL(record.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = record.name;
      link.dataset.novaLibraryOwn = '1';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
  }

  async function shareRecord(record) {
    if (!record?.blob) return;
    if (!window.NovaIOSSave?.saveBlob) return downloadRecord(record);
    return window.NovaIOSSave.saveBlob(record.blob, record.name, { title: record.name });
  }

  async function removeRecord(id) {
    records.delete(id);
    await deleteStored(id);
    render();
  }

  function render() {
    const list = $('#novaLibraryList');
    const stats = $('#novaLibraryStats');
    if (!list || !stats) return;
    const items = recordArray();
    const total = items.reduce((sum, item) => sum + Number(item.size || 0), 0);
    const videos = items.filter((item) => inferKind(item.name, item.type) === 'video').length;
    const audio = items.filter((item) => inferKind(item.name, item.type) === 'audio').length;
    stats.textContent = `${items.length} файлов · ${formatBytes(total)} · видео ${videos} · аудио ${audio}`;
    list.innerHTML = '';
    if (!items.length) {
      list.innerHTML = '<div class="nova-library-empty">Пока пусто. Создай MP3, готовое MP4/MOV, Hologram или Multi Shorts — они появятся здесь автоматически.</div>';
      return;
    }
    items.forEach((record) => {
      const kind = inferKind(record.name, record.type);
      const item = document.createElement('div');
      item.className = 'nova-library-item';
      const date = new Date(record.createdAt || Date.now()).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      item.innerHTML = `<div class="nova-library-icon">${iconFor(record)}</div><div><div class="nova-library-name"></div><div class="nova-library-meta">${formatBytes(record.size)} · ${record.source || 'NOVA'} · ${date}${record.persisted === false ? ' · только текущая сессия' : ''}</div></div><div class="nova-library-actions"></div>`;
      $('.nova-library-name', item).textContent = record.name;
      const actions = $('.nova-library-actions', item);
      const download = document.createElement('button');
      download.type = 'button';
      download.textContent = '⬇ Скачать';
      download.addEventListener('click', () => downloadRecord(record));
      actions.appendChild(download);
      const share = document.createElement('button');
      share.type = 'button';
      share.textContent = kind === 'video' ? '📲 В «Фото»' : '📲 На iPhone';
      share.addEventListener('click', () => shareRecord(record).catch((error) => status(`Сохранение: ${error?.message || error}`)));
      actions.appendChild(share);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'danger';
      remove.textContent = 'Удалить';
      remove.addEventListener('click', () => removeRecord(record.id));
      actions.appendChild(remove);
      list.appendChild(item);
    });
  }

  async function saveAllVideos() {
    const videos = recordArray().filter((record) => inferKind(record.name, record.type) === 'video');
    if (!videos.length) throw new Error('В медиатеке пока нет видео.');
    if (!window.NovaIOSSave?.saveMany) {
      for (const record of videos) await downloadRecord(record);
      return;
    }
    return window.NovaIOSSave.saveMany(videos.map((record) => ({ blob: record.blob, name: record.name })), { title: `NOVA · ${videos.length} videos` });
  }

  async function shareAll() {
    const all = recordArray();
    if (!all.length) throw new Error('Медиатека пока пустая.');
    if (!window.NovaIOSSave?.saveMany) {
      for (const record of all) await downloadRecord(record);
      return;
    }
    return window.NovaIOSSave.saveMany(all.map((record) => ({ blob: record.blob, name: record.name })), { title: `NOVA · ${all.length} files` });
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node.matches?.('a[download]')) captureLink(node).catch(() => {});
          scan(node);
        });
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scan(document);
  }

  function install() {
    injectStyles();
    const tryUi = () => injectUi();
    if (!tryUi()) {
      const uiObserver = new MutationObserver(() => {
        if (tryUi()) uiObserver.disconnect();
      });
      uiObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
    startObserver();
    loadStored().catch(() => {});
  }

  window.NovaMediaLibrary = Object.freeze({
    registerBlob,
    list: () => recordArray().map(({ blob, ...meta }) => ({ ...meta })),
    saveAllVideos,
    shareAll,
    refresh: () => { scan(document); return loadStored(); },
    version: '1.0.0'
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();