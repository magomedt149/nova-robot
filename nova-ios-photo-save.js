(() => {
  'use strict';

  if (window.NovaIOSSave) return;

  const IOS_RE = /iPad|iPhone|iPod/i;
  const $ = (selector, root = document) => root.querySelector(selector);

  function isIOS() {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    const touchMac = platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1;
    return IOS_RE.test(ua) || touchMac;
  }

  function setStatus(message) {
    const local = $('#novaMediaStatus');
    if (local) local.textContent = message;
    const global = $('#statusText');
    if (global) global.textContent = message;
  }

  function safeName(name, fallback = 'NOVA_VIDEO.mp4') {
    const value = String(name || fallback).replace(/[\\/:*?"<>|]+/g, '_').trim();
    return value || fallback;
  }

  function blobToFile(blob, name) {
    const clean = safeName(name);
    const type = blob?.type || (/\.mov$/i.test(clean) ? 'video/quicktime' : 'video/mp4');
    try {
      return new File([blob], clean, { type, lastModified: Date.now() });
    } catch (_) {
      const fallback = new Blob([blob], { type });
      fallback.name = clean;
      fallback.lastModified = Date.now();
      return fallback;
    }
  }

  function canShareFiles(files) {
    if (!files?.length || typeof navigator.share !== 'function') return false;
    if (typeof navigator.canShare !== 'function') return true;
    try {
      return navigator.canShare({ files });
    } catch (_) {
      return false;
    }
  }

  function fallbackDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = safeName(name);
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return true;
  }

  async function shareRecords(records, options = {}) {
    const clean = (records || []).filter((item) => item?.blob).map((item, index) => ({
      blob: item.blob,
      name: safeName(item.name, `NOVA_VIDEO_${index + 1}.mp4`)
    }));
    if (!clean.length) throw new Error('Нет готового видео для сохранения.');

    const files = clean.map((item) => blobToFile(item.blob, item.name));
    if (canShareFiles(files)) {
      try {
        await navigator.share({
          files,
          title: options.title || (files.length > 1 ? `NOVA · ${files.length} videos` : files[0].name)
        });
        setStatus(isIOS()
          ? `✅ Открыто системное меню iPhone для ${files.length > 1 ? `${files.length} видео` : 'видео'}. Выбери «Сохранить видео», чтобы добавить в «Фото».`
          : '✅ Системное меню сохранения открыто.');
        return { method: 'share', count: files.length };
      } catch (error) {
        if (error?.name === 'AbortError') {
          setStatus('Сохранение отменено пользователем.');
          return { method: 'cancel', count: 0 };
        }
        if (files.length > 1) {
          setStatus('iPhone не принял пакет из нескольких видео. Используй кнопки «В Фото» у каждого Short.');
          return { method: 'share-failed', count: 0, error: String(error?.message || error) };
        }
      }
    }

    if (clean.length === 1) {
      fallbackDownload(clean[0].blob, clean[0].name);
      setStatus(isIOS()
        ? 'Safari не дал доступ к системному Share Sheet. Видео отправлено в загрузки; открой его и выбери «Поделиться» → «Сохранить видео».'
        : 'Видео отправлено в загрузки браузера.');
      return { method: 'download', count: 1 };
    }

    setStatus('Системное сохранение нескольких видео недоступно. Используй отдельные кнопки «В Фото» для каждого Short.');
    return { method: 'unsupported-multi', count: 0 };
  }

  async function saveBlob(blob, name, options = {}) {
    return shareRecords([{ blob, name }], options);
  }

  async function saveMany(records, options = {}) {
    return shareRecords(records, options);
  }

  function makePhotoButton({ blob, name, label = '📲 В «Фото»', className = 'nova-media-btn', dataset = {} } = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    Object.entries(dataset).forEach(([key, value]) => { button.dataset[key] = String(value); });
    button.addEventListener('click', () => {
      saveBlob(blob, name).catch((error) => setStatus(`Не удалось открыть сохранение: ${error?.message || error}`));
    });
    return button;
  }

  window.NovaIOSSave = Object.freeze({
    isIOS,
    canShareFiles,
    saveBlob,
    saveMany,
    makePhotoButton,
    fallbackDownload,
    version: '1.0.0'
  });
})();