(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const upload = $('#photoUpload');
  const image = $('#photoPreview');
  const result = $('#photoStudioResult');
  if (!upload || !image) return;

  const presetButtons = [...document.querySelectorAll('.preset-btn')];
  const qualityButtons = [...document.querySelectorAll('.quality-btn')];
  const exposure = $('#exposureRange');
  const contrast = $('#contrastRange');
  const saturation = $('#saturationRange');
  const compare = $('#compareRange');
  const exportJpg = $('#exportJpg');
  const exportPng = $('#exportPng');
  const presetClasses = presetButtons.map((b) => `hollywood-${b.dataset.preset}`);
  let quality = 'HD';

  function applyManualLook() {
    if (!image.src) return;
    const e = Number(exposure?.value || 100) / 100;
    const c = Number(contrast?.value || 100) / 100;
    const s = Number(saturation?.value || 100) / 100;
    image.style.opacity = String(Number(compare?.value || 100) / 100);
    image.style.filter = `brightness(${e}) contrast(${c}) saturate(${s})`;
  }

  presetButtons.forEach((button) => button.addEventListener('click', () => {
    upload.classList.remove(...presetClasses);
    presetButtons.forEach((b) => b.classList.remove('active'));
    button.classList.add('active');
    upload.classList.add(`hollywood-${button.dataset.preset}`);
    if (result) result.textContent = `Пресет «${button.textContent.trim()}» применён. Настрой свет и экспортируй результат.`;
  }));

  qualityButtons.forEach((button) => button.addEventListener('click', () => {
    qualityButtons.forEach((b) => b.classList.remove('active'));
    button.classList.add('active');
    quality = button.dataset.quality;
    if (result) result.textContent = quality === '4K'
      ? 'Выбран экспорт 4K. Браузер увеличит изображение локально; настоящее восстановление деталей требует отдельной ИИ-модели.'
      : `Выбрано качество ${quality}.`;
  }));

  [exposure, contrast, saturation, compare].forEach((el) => el?.addEventListener('input', applyManualLook));

  function exportImage(type) {
    if (!image.src) {
      if (result) result.textContent = 'Сначала загрузи фотографию.';
      return;
    }
    const scale = quality === '4K' ? 4 : quality === '2K' ? 2 : 1;
    const naturalWidth = image.naturalWidth || 1080;
    const naturalHeight = image.naturalHeight || 1080;
    const maxWidth = quality === '4K' ? 3840 : quality === '2K' ? 2560 : 1920;
    const ratio = Math.min(scale, maxWidth / naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(naturalHeight * ratio));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.filter = image.style.filter || getComputedStyle(image).filter;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const mime = type === 'png' ? 'image/png' : 'image/jpeg';
    canvas.toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `nova-hollywood-${quality.toLowerCase()}.${type}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      if (result) result.textContent = `Готово: изображение сохранено в ${quality} (${type.toUpperCase()}).`;
    }, mime, 0.96);
  }

  exportJpg?.addEventListener('click', () => exportImage('jpg'));
  exportPng?.addEventListener('click', () => exportImage('png'));

  function loadNOVAFeature(src, id) {
    if (document.getElementById(id)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.id = id;
      script.src = src;
      script.defer = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Не загрузился ${src}`));
      document.head.appendChild(script);
    });
  }

  async function loadVideoStudioStack() {
    try {
      await loadNOVAFeature('./nova-media-studio.js?v=30.0.0', 'nova-media-studio-loader');
      await loadNOVAFeature('./nova-whisper.js?v=30.0.0', 'nova-whisper-loader');
      await loadNOVAFeature('./nova-voice-editor.js?v=30.0.0', 'nova-voice-editor-loader');
      await loadNOVAFeature('./nova-transcript-editor-sync.js?v=30.0.0', 'nova-transcript-editor-sync-loader');
      await loadNOVAFeature('./nova-ios-photo-save.js?v=30.3.0', 'nova-ios-photo-save-loader');
      await loadNOVAFeature('./nova-video-upgrade.js?v=30.3.0', 'nova-video-upgrade-loader');
      await loadNOVAFeature('./nova-multi-shorts.js?v=30.2.0', 'nova-multi-shorts-loader');
      await loadNOVAFeature('./nova-media-library.js?v=30.3.0', 'nova-media-library-loader');
      await loadNOVAFeature('./nova-ios-output-actions.js?v=30.3.0', 'nova-ios-output-actions-loader');
      await loadNOVAFeature('./nova-director-continuity-lock.js?v=32.0.0', 'nova-director-continuity-lock-loader');
      await loadNOVAFeature('./nova-video-pro.js?v=31.0.0', 'nova-video-pro-loader');
    } catch (error) {
      console.warn('[NOVA Video Studio] optional module load failed:', error);
    }
  }

  loadVideoStudioStack();
})();