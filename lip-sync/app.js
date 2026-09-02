(() => {
  'use strict';
  const key = 'tumsoev-lipsync-checklist-v1';
  const boxes = [...document.querySelectorAll('[data-step]')];
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch (_) {}
  boxes.forEach((box) => {
    box.checked = Boolean(saved[box.dataset.step]);
    box.addEventListener('change', () => {
      saved[box.dataset.step] = box.checked;
      localStorage.setItem(key, JSON.stringify(saved));
    });
  });
})();
