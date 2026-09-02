(() => {
  'use strict';

  if (window.__novaIOSOutputActionsInstalled) return;
  window.__novaIOSOutputActionsInstalled = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const cache = new Map();
  let observer = null;

  function status(message) {
    const local = $('#novaMediaStatus');
    if (local) local.textContent = message;
    const global = $('#statusText');
    if (global) global.textContent = message;
  }

  function kindFromName(name) {
    if (/\.(mp4|mov|webm)$/i.test(name)) return 'video';
    if (/\.(mp3|wav|m4a|aac)$/i.test(name)) return 'audio';
    return 'file';
  }

  async function prefetch(link) {
    if (!(link instanceof HTMLAnchorElement) || !link.download || !link.href) return null;
    if (link.dataset.novaIOSDecorated === '1') return cache.get(link.href) || null;
    link.dataset.novaIOSDecorated = '1';
    try {
      const response = await fetch(link.href);
      if (!response.ok) throw new Error('file fetch failed');
      const blob = await response.blob();
      const record = { blob, name: link.download, kind: kindFromName(link.download), href: link.href };
      cache.set(link.href, record);
      window.NovaMediaLibrary?.registerBlob?.(blob, link.download, link.closest('#novaShortDownloads') ? 'Multi Shorts' : 'NOVA Media Studio').catch?.(() => {});
      decorate(link, record);
      updateFiveShortsButton();
      return record;
    } catch (_) {
      link.dataset.novaIOSDecorated = '';
      return null;
    }
  }

  function decorate(link, record) {
    if (link.nextElementSibling?.dataset?.novaIOSSaveFor === link.href) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nova-media-btn';
    button.dataset.novaIOSSaveFor = link.href;
    button.textContent = record.kind === 'video' ? '📲 В «Фото»' : '📲 На iPhone';
    button.addEventListener('click', () => {
      if (!window.NovaIOSSave?.saveBlob) return status('Системное сохранение iPhone не загрузилось.');
      window.NovaIOSSave.saveBlob(record.blob, record.name, { title: record.name })
        .catch((error) => status(`Сохранение: ${error?.message || error}`));
    });
    link.insertAdjacentElement('afterend', button);
  }

  function currentShortRecords() {
    return [...document.querySelectorAll('#novaShortDownloads a[download]')]
      .map((link) => cache.get(link.href))
      .filter((record) => record?.blob && record.kind === 'video');
  }

  function updateFiveShortsButton() {
    const downloads = $('#novaShortDownloads');
    if (!downloads) return;
    let button = $('#novaShortSaveFive');
    const current = currentShortRecords();
    if (current.length < 5) {
      if (button) button.hidden = true;
      return;
    }
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.id = 'novaShortSaveFive';
      button.className = 'nova-media-btn primary';
      button.textContent = '📲 Все 5 Shorts → «Фото»';
      button.addEventListener('click', () => {
        const records = currentShortRecords().slice(0, 5);
        if (records.length < 5) return status('Сначала дождись готовности всех пяти Shorts.');
        if (!window.NovaIOSSave?.saveMany) return status('Системное сохранение iPhone не загрузилось.');
        window.NovaIOSSave.saveMany(records.map(({ blob, name }) => ({ blob, name })), { title: 'NOVA · 5 Shorts' })
          .catch((error) => status(`Сохранение 5 Shorts: ${error?.message || error}`));
      });
      downloads.prepend(button);
    }
    button.hidden = false;
  }

  function eligible(link) {
    if (!(link instanceof HTMLAnchorElement) || !link.download) return false;
    if (!link.closest('#novaMediaModal')) return false;
    return /\.(mp4|mov|webm|mp3|wav|m4a|aac)$/i.test(link.download);
  }

  function scan(root = document) {
    const links = root.querySelectorAll?.('a[download]') || [];
    links.forEach((link) => { if (eligible(link)) prefetch(link).catch(() => {}); });
  }

  function install() {
    scan(document);
    observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches?.('a[download]') && eligible(node)) prefetch(node).catch(() => {});
        scan(node);
      }));
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();