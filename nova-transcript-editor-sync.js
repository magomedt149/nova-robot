(() => {
  'use strict';
  if (window.__novaTranscriptEditorSyncInstalled) return;
  window.__novaTranscriptEditorSyncInstalled = true;

  document.addEventListener('input', (event) => {
    const original = event.target.closest?.('#novaTranscriptEditor .nova-original');
    if (!original) return;
    const row = original.closest('.nova-editor-row');
    if (!row) return;
    const source = row.querySelector('.nova-editor-main input[disabled]')?.value?.toLowerCase();
    const target = source === 'ru' ? row.querySelector('.nova-ru') : row.querySelector('.nova-en');
    if (!target || target.value === original.value) return;
    target.value = original.value;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  });
})();