(() => {
  'use strict';
  if (window.NovaAutoMontage) return;

  const VERSION = '1.0.0';
  let running = false;

  function clean(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function status(message) {
    const node = document.getElementById('statusText');
    if (node) node.textContent = message;
    window.dispatchEvent(new CustomEvent('nova:auto-montage-status', { detail: { message } }));
  }

  function currentVideo() {
    return document.getElementById('novaLocalVideo')?.files?.[0] || null;
  }

  function safeBase(name) {
    return clean(name || 'NOVA').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_\-а-яА-ЯёЁ]+/g, '_').slice(0, 80) || 'NOVA';
  }

  async function savePreview(result, file) {
    if (!result?.blob?.size) return null;
    const extension = result.extension || (result.blob.type.includes('mp4') ? 'mp4' : 'webm');
    const name = `${safeBase(file?.name)}_AUTO_PREVIEW_5s.${extension}`;
    if (window.NovaMediaLibrary?.registerBlob) {
      return window.NovaMediaLibrary.registerBlob(result.blob, name, 'NOVA Auto Montage');
    }
    const url = URL.createObjectURL(result.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.textContent = '⬇ ' + name;
    link.style.display = 'inline-block';
    link.style.margin = '8px';
    (document.getElementById('chat') || document.body).appendChild(link);
    return { name, blob: result.blob };
  }

  async function run(options = {}) {
    if (running) throw new Error('Автомонтаж уже выполняется.');
    running = true;
    const steps = [];
    try {
      status('⚡ NOVA Автомонтаж: проверяю систему…');
      const health = await window.NovaHealth?.run?.({ announce: false });
      steps.push({ step: 'health', ok: health ? health.ok : true, detail: health || null });

      try { window.NovaUnifiedVideoStudio?.open?.('create'); } catch (_) {}

      const file = options.file || currentVideo();
      if (!file) {
        const error = new Error('Сначала открой VIDEO STUDIO и выбери MP4/MOV. Потом снова нажми «АВТОМОНТАЖ».');
        status('⚠️ ' + error.message);
        steps.push({ step: 'input', ok: false, error: error.message });
        return { ok: false, requiresFile: true, steps };
      }
      steps.push({ step: 'input', ok: true, name: file.name, size: file.size });

      if (window.NovaVideoPro?.useCurrentVideo) {
        try {
          window.NovaVideoPro.useCurrentVideo();
          steps.push({ step: 'reference', ok: true });
        } catch (error) {
          steps.push({ step: 'reference', ok: false, error: clean(error?.message || error) });
        }
      }

      if (options.transcribe !== false && window.NovaWhisper?.transcribeVideo) {
        status('⚡ Автомонтаж 1/2: Whisper распознаёт речь и делает субтитры…');
        try {
          const transcript = await window.NovaWhisper.transcribeVideo(file);
          steps.push({ step: 'whisper', ok: true, segments: transcript?.original?.length || 0 });
        } catch (error) {
          steps.push({ step: 'whisper', ok: false, error: clean(error?.message || error) });
        }
      }

      let preview = null;
      if (window.NovaVideoPro?.renderLocalClip) {
        status('⚡ Автомонтаж 2/2: делаю бесплатный 5-секундный превью-монтаж…');
        try {
          preview = await window.NovaVideoPro.renderLocalClip({
            duration: Math.min(5, Math.max(1, Number(options.duration || 5))),
            start: Math.max(0, Number(options.start || 0)),
            style: options.style || 'cinema',
            ratio: options.ratio || '9:16',
            prompt: options.prompt || 'cinematic stable edit, preserve identity, smooth motion, no face distortion',
            refMode: 'exact'
          });
          const saved = await savePreview(preview, file);
          steps.push({ step: 'preview', ok: true, name: saved?.name || null, bytes: preview.blob.size });
        } catch (error) {
          const message = clean(error?.message || error);
          steps.push({ step: 'preview', ok: false, error: message });
          if (/captureStream|MediaRecorder|недоступ/i.test(message)) {
            status('ℹ️ На этом iPhone локальный видеорендер ограничен браузером. Whisper/субтитры готовы; для MP4 открой Motion+VFX → бесплатный Colab после подтверждения.');
          }
        }
      }

      const ok = steps.some((x) => x.step === 'preview' && x.ok) || steps.some((x) => x.step === 'whisper' && x.ok);
      if (ok) {
        const previewOk = steps.some((x) => x.step === 'preview' && x.ok);
        status(previewOk ? '✅ NOVA Автомонтаж: 5-секундный тест готов и сохранён в Медиатеке.' : '✅ NOVA Автомонтаж: речь/субтитры готовы; видео-рендер требует поддерживаемого браузера или Colab.');
      }
      const report = { ok, version: VERSION, steps, completedAt: new Date().toISOString() };
      window.dispatchEvent(new CustomEvent('nova:auto-montage-complete', { detail: report }));
      return report;
    } finally {
      running = false;
    }
  }

  async function repairAndCheck() {
    const report = await window.NovaHealth?.repair?.({ reload: false });
    status(report?.ok ? '✅ NOVA проверена и кэш обновлён.' : '⚠️ Проверка завершена: есть проблемы, смотри статус.');
    return report;
  }

  function matchesMontage(text) {
    const value = clean(text).toLowerCase();
    return /(авто\s*монтаж|автомонтаж|смонтируй\s+(?:мне\s+)?(?:это\s+)?видео|сделай\s+монтаж)/i.test(value);
  }

  function matchesRepair(text) {
    const value = clean(text).toLowerCase();
    return /(проверь\s+(?:всё|все|себя|нову)|диагностик|исправь\s+нову|почини\s+нову)/i.test(value);
  }

  function installCommands() {
    const form = document.getElementById('composer');
    const input = document.getElementById('messageInput');
    if (!form || !input || form.dataset.novaAutoMontage === '1') return;
    form.dataset.novaAutoMontage = '1';
    form.addEventListener('submit', (event) => {
      const text = input.value || '';
      if (!matchesMontage(text) && !matchesRepair(text)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      input.value = '';
      if (matchesRepair(text)) repairAndCheck().catch((error) => status('⚠️ ' + clean(error?.message || error)));
      else run().catch((error) => status('⚠️ ' + clean(error?.message || error)));
    }, true);
  }

  function injectButton() {
    const host = document.getElementById('quickActions');
    if (!host || document.getElementById('novaAutoMontageBtn')) return;
    const button = document.createElement('button');
    button.id = 'novaAutoMontageBtn';
    button.className = 'action-btn';
    button.type = 'button';
    button.innerHTML = '<span>⚡</span><b>АВТОМОНТАЖ</b>';
    button.addEventListener('click', () => run().catch((error) => status('⚠️ ' + clean(error?.message || error))));
    host.appendChild(button);
  }

  function boot() {
    injectButton();
    installCommands();
  }

  window.NovaAutoMontage = Object.freeze({
    version: VERSION,
    run,
    repairAndCheck,
    get running() { return running; }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();