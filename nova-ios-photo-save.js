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

  function safeName(name, fallback = 'NOVA_FILE.mp4') {
    const value = String(name || fallback).replace(/[\\/:*?"<>|]+/g, '_').trim();
    return value || fallback;
  }

  function inferType(name, blob) {
    if (blob?.type) return blob.type;
    if (/\.mov$/i.test(name)) return 'video/quicktime';
    if (/\.mp4$/i.test(name)) return 'video/mp4';
    if (/\.mp3$/i.test(name)) return 'audio/mpeg';
    if (/\.srt$/i.test(name)) return 'application/x-subrip';
    return 'application/octet-stream';
  }

  function mediaKind(name, blob) {
    const type = inferType(name, blob);
    if (type.startsWith('video/')) return 'video';
    if (type.startsWith('audio/')) return 'audio';
    return 'file';
  }

  function blobToFile(blob, name) {
    const clean = safeName(name);
    const type = inferType(clean, blob);
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

  function successMessage(records) {
    const kinds = new Set(records.map((item) => mediaKind(item.name, item.blob)));
    const onlyVideo = kinds.size === 1 && kinds.has('video');
    const onlyAudio = kinds.size === 1 && kinds.has('audio');
    if (!isIOS()) return '✅ Системное меню сохранения открыто.';
    if (onlyVideo) return `✅ Открыто меню iPhone для ${records.length > 1 ? `${records.length} видео` : 'видео'}. Выбери «Сохранить видео», чтобы добавить в «Фото».`;
    if (onlyAudio) return `✅ Открыто меню iPhone для ${records.length > 1 ? `${records.length} аудиофайлов` : 'MP3'}. Выбери «Сохранить в Файлы» или нужное приложение.`;
    return `✅ Открыто системное меню iPhone для ${records.length} файлов. Видео можно сохранить в «Фото», остальные файлы — в «Файлы».`;
  }

  async function shareRecords(records, options = {}) {
    const clean = (records || []).filter((item) => item?.blob).map((item, index) => ({
      blob: item.blob,
      name: safeName(item.name, `NOVA_FILE_${index + 1}.mp4`)
    }));
    if (!clean.length) throw new Error('Нет готового файла для сохранения.');

    const files = clean.map((item) => blobToFile(item.blob, item.name));
    if (canShareFiles(files)) {
      try {
        await navigator.share({
          files,
          title: options.title || (files.length > 1 ? `NOVA · ${files.length} files` : files[0].name)
        });
        setStatus(successMessage(clean));
        return { method: 'share', count: files.length };
      } catch (error) {
        if (error?.name === 'AbortError') {
          setStatus('Сохранение отменено пользователем.');
          return { method: 'cancel', count: 0 };
        }
        if (files.length > 1) {
          setStatus('iPhone не принял пакет из нескольких файлов. Используй кнопку сохранения у нужного файла.');
          return { method: 'share-failed', count: 0, error: String(error?.message || error) };
        }
      }
    }

    if (clean.length === 1) {
      fallbackDownload(clean[0].blob, clean[0].name);
      const kind = mediaKind(clean[0].name, clean[0].blob);
      setStatus(isIOS()
        ? (kind === 'video'
          ? 'Safari не дал доступ к Share Sheet. Видео отправлено в загрузки; открой его и выбери «Поделиться» → «Сохранить видео».'
          : 'Safari не дал доступ к Share Sheet. Файл отправлен в загрузки; открой его и выбери «Поделиться» → «Сохранить в Файлы».')
        : 'Файл отправлен в загрузки браузера.');
      return { method: 'download', count: 1 };
    }

    setStatus('Системное сохранение нескольких файлов недоступно. Используй отдельные кнопки сохранения.');
    return { method: 'unsupported-multi', count: 0 };
  }

  async function saveBlob(blob, name, options = {}) {
    return shareRecords([{ blob, name }], options);
  }

  async function saveMany(records, options = {}) {
    return shareRecords(records, options);
  }

  function makePhotoButton({ blob, name, label = '📲 На iPhone', className = 'nova-media-btn', dataset = {} } = {}) {
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
    mediaKind,
    version: '1.1.0'
  });
})();