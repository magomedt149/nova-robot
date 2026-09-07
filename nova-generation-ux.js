(() => {
  'use strict';

  if (window.__novaGenerationUxInstalled) return;
  window.__novaGenerationUxInstalled = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const jobs = new Map();
  const BYPASS_ATTR = 'data-nova-generation-ux-bypass';
  let pendingLaunchButton = null;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function status(message) {
    const local = $('#novaMediaStatus');
    if (local) local.textContent = message;
    const global = $('#statusText');
    if (global) global.textContent = message;
  }

  function emit(detail) {
    try {
      window.dispatchEvent(new CustomEvent('nova-video-job', {
        detail: { at: Date.now(), ...detail }
      }));
    } catch (_) {}
  }

  function readNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function parseCredits(value) {
    if (typeof value === 'number') return Math.max(0, value);
    const match = String(value || '').replace(/\s+/g, '').match(/(\d+(?:[.,]\d+)?)/);
    return match ? Math.max(0, Number(match[1].replace(',', '.')) || 0) : 0;
  }

  function billingSnapshot() {
    let raw = {};
    try {
      raw = window.NovaGenerationBilling?.snapshot?.() || window.NovaGenerationBilling || {};
    } catch (_) {}
    const mode = raw.mode === 'paid' ? 'paid' : 'free';
    const costCredits = mode === 'paid' ? readNumber(raw.costCredits ?? raw.cost ?? 0) : 0;
    const balanceCredits = Number.isFinite(Number(raw.balanceCredits)) ? Number(raw.balanceCredits) : null;
    return {
      mode,
      costCredits,
      balanceCredits,
      refundPolicy: raw.refundPolicy || 'unknown'
    };
  }

  function providerSnapshot() {
    let raw = {};
    try {
      raw = window.NovaGenerationProvider?.snapshot?.() || window.NovaGenerationProvider || {};
    } catch (_) {}
    return {
      provider: raw.provider || raw.name || 'NOVA Local',
      model: raw.model || 'Local Motion',
      fallbackProvider: raw.fallbackProvider || '',
      remote: Boolean(raw.remote)
    };
  }

  function fileSnapshot() {
    const image = $('#novaProImageRef')?.files?.[0] || null;
    const video = $('#novaProVideoRef')?.files?.[0] || null;
    return { image, video };
  }

  function styleLabel(value) {
    return ({
      cinema: 'Кино',
      motion: 'Motion',
      threed: '2.5D',
      hologram: 'Голограмма',
      action: 'Action'
    })[value] || value || 'Motion';
  }

  function currentReviewSnapshot(button) {
    const billing = billingSnapshot();
    const provider = providerSnapshot();
    const files = fileSnapshot();
    const prompt = ($('#novaProPrompt')?.value || $('#novaSimpleVideoPrompt')?.value || '').trim();
    const duration = Math.max(1, Math.min(15, readNumber($('#novaProDuration')?.value, 5)));
    const ratio = $('#novaProRatio')?.value || '9:16';
    const style = $('#novaProStyle')?.value || 'motion';
    const extend = button?.id === 'novaProExtend';
    return {
      ...billing,
      ...provider,
      files,
      prompt,
      duration,
      ratio,
      style,
      extend,
      title: extend ? 'Продолжение видео' : 'Генерация видео'
    };
  }

  function validateReview(snapshot) {
    if (!window.MediaRecorder) {
      return {
        state: 'error',
        title: 'Не удалось завершить проверку',
        message: 'Этот браузер не поддерживает локальную запись видео через MediaRecorder.'
      };
    }
    if (!HTMLCanvasElement.prototype.captureStream) {
      return {
        state: 'error',
        title: 'Не удалось завершить проверку',
        message: 'Этот браузер не поддерживает локальный захват кадра для генерации видео.'
      };
    }
    const files = snapshot.files || {};
    if (files.image && !String(files.image.type || '').startsWith('image/')) {
      return {
        state: 'file-error',
        title: 'Не удалось обработать файл',
        message: 'Выбранный файл изображения имеет неподдерживаемый формат.',
        fileName: files.image.name
      };
    }
    if (files.video && !String(files.video.type || '').startsWith('video/')) {
      return {
        state: 'file-error',
        title: 'Не удалось обработать файл',
        message: 'Выбранный видеофайл имеет неподдерживаемый формат.',
        fileName: files.video.name
      };
    }
    if (snapshot.extend && !files.video && !$('#novaProPlayer')?.src) {
      return {
        state: 'warning',
        title: 'Нужен исходный ролик',
        message: 'Для продолжения видео сначала выберите или загрузите исходный ролик.'
      };
    }
    if (!snapshot.extend && !files.image && !files.video && !snapshot.prompt) {
      return {
        state: 'warning',
        title: 'Добавьте описание видео',
        message: 'Напишите, что должно происходить в ролике, или загрузите reference.'
      };
    }
    if (snapshot.mode === 'paid' && snapshot.balanceCredits !== null && snapshot.balanceCredits < snapshot.costCredits) {
      return {
        state: 'insufficient',
        title: 'Недостаточно кредитов',
        message: 'Для этой генерации требуется больше кредитов, чем доступно сейчас.'
      };
    }
    return {
      state: 'ready',
      title: 'Всё готово к запуску',
      message: 'NOVA проверила файлы, модель и параметры генерации. Можно запускать.'
    };
  }

  function ensureStyles() {
    if ($('#novaGenerationUxStyles')) return;
    const style = document.createElement('style');
    style.id = 'novaGenerationUxStyles';
    style.textContent = `
      .nova-generation-dialog{position:fixed;inset:0;z-index:10080;display:grid;place-items:center;padding:18px;background:rgba(1,4,13,.72);backdrop-filter:blur(14px)}
      .nova-generation-dialog[hidden]{display:none!important}
      .nova-generation-dialog-card{width:min(620px,100%);max-height:min(88vh,760px);overflow:auto;border:1px solid rgba(119,176,255,.28);border-radius:22px;background:linear-gradient(155deg,rgba(12,24,52,.98),rgba(5,10,24,.99));box-shadow:0 28px 90px rgba(0,0,0,.56);color:#eff6ff;padding:17px}
      .nova-generation-dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.nova-generation-dialog-head h3{margin:0;font-size:20px}.nova-generation-dialog-head p{margin:5px 0 0;color:#a5bddf;font-size:12px;line-height:1.45}
      .nova-generation-dialog-close{border:0;background:rgba(255,255,255,.08);color:#fff;width:34px;height:34px;border-radius:11px;font-size:20px}
      .nova-review-state{margin:13px 0;padding:11px;border-radius:14px;border:1px solid rgba(94,154,255,.22);background:rgba(37,88,181,.12)}
      .nova-review-state[data-state="ready"]{border-color:rgba(67,226,160,.28);background:rgba(27,159,104,.10)}
      .nova-review-state[data-state="warning"],.nova-review-state[data-state="insufficient"]{border-color:rgba(255,190,85,.30);background:rgba(181,112,26,.11)}
      .nova-review-state[data-state="error"],.nova-review-state[data-state="file-error"]{border-color:rgba(255,96,116,.30);background:rgba(190,43,65,.11)}
      .nova-review-state b{display:block;font-size:14px}.nova-review-state span{display:block;margin-top:4px;color:#b8c9e4;font-size:12px;line-height:1.45}
      .nova-review-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}.nova-review-item{padding:10px;border-radius:13px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.08)}
      .nova-review-item small{display:block;color:#8ea9cf;font-size:10px;text-transform:uppercase;letter-spacing:.04em}.nova-review-item b{display:block;margin-top:4px;font-size:13px;word-break:break-word}
      .nova-review-billing{padding:12px;border-radius:15px;border:1px solid rgba(63,229,164,.24);background:rgba(26,163,108,.10);margin:10px 0}.nova-review-billing b{display:block;color:#7ef1c6}.nova-review-billing span{display:block;margin-top:4px;color:#b6cae4;font-size:12px}
      .nova-review-billing.paid{border-color:rgba(255,190,85,.28);background:rgba(184,117,25,.10)}.nova-review-billing.paid b{color:#ffd58c}
      .nova-generation-dialog-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.nova-generation-dialog-actions button{border:1px solid rgba(112,166,255,.22);border-radius:12px;background:rgba(255,255,255,.07);color:#eef5ff;padding:10px 13px;font-weight:850}
      .nova-generation-dialog-actions .primary{border:0;background:linear-gradient(135deg,#167dff,#7248ff);color:#fff}.nova-generation-dialog-actions .danger{border-color:rgba(255,91,109,.30);background:rgba(197,43,63,.16);color:#ffd2d8}.nova-generation-dialog-actions button:disabled{opacity:.45;cursor:not-allowed}
      .nova-job-ux-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:8px}.nova-job-ux-summary>span{padding:7px;border-radius:10px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.07);font-size:10px;color:#a9bddb}.nova-job-ux-summary b{display:block;margin-top:2px;color:#edf5ff;font-size:11px}
      .nova-job-ux-panel{margin-top:9px;padding:10px;border-radius:13px;border:1px solid rgba(111,166,255,.17);background:rgba(19,45,91,.12)}.nova-job-ux-panel h4{margin:0;font-size:13px}.nova-job-ux-panel p{margin:5px 0 0;color:#a9bfdc;font-size:11px;line-height:1.45}
      .nova-job-ux-panel.error{border-color:rgba(255,96,116,.27);background:rgba(180,44,63,.10)}.nova-job-ux-panel.canceled{border-color:rgba(140,164,201,.20);background:rgba(120,136,164,.08)}.nova-job-ux-panel.success{border-color:rgba(58,225,159,.24);background:rgba(29,159,106,.09)}
      .nova-job-ux-finance{margin-top:7px;font-size:11px;color:#c1d2e9}.nova-job-ux-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}.nova-job-ux-actions button{border:1px solid rgba(111,166,255,.22);border-radius:10px;background:rgba(255,255,255,.06);color:#edf5ff;padding:8px 10px;font-weight:800}.nova-job-ux-actions .primary{background:rgba(62,121,255,.25)}.nova-job-ux-details{margin-top:7px;padding:7px;border-radius:9px;background:rgba(0,0,0,.18);font-size:10px;color:#9db2d2;white-space:pre-wrap;word-break:break-word}
      .nova-generation-job[data-state="failed"]>.nova-job-actions,.nova-generation-job[data-state="canceled"]>.nova-job-actions{display:none}
      @media(max-width:560px){.nova-review-grid,.nova-job-ux-summary{grid-template-columns:1fr}.nova-generation-dialog-card{padding:14px;border-radius:18px}}
    `;
    document.head.appendChild(style);
  }

  function ensureReviewDialog() {
    let dialog = $('#novaGenerationReviewDialog');
    if (dialog) return dialog;
    dialog = document.createElement('section');
    dialog.id = 'novaGenerationReviewDialog';
    dialog.className = 'nova-generation-dialog';
    dialog.hidden = true;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    return dialog;
  }

  function closeReview() {
    pendingLaunchButton = null;
    const dialog = $('#novaGenerationReviewDialog');
    if (dialog) dialog.hidden = true;
  }

  function launchAfterReview(snapshot) {
    const button = pendingLaunchButton;
    if (!button) return;
    if (snapshot.mode === 'paid') {
      const expected = billingSnapshot();
      if (expected.costCredits !== snapshot.costCredits || expected.mode !== snapshot.mode) {
        openReview(button);
        status('Стоимость изменилась. Подтверди новую цену перед запуском.');
        return;
      }
    }
    closeReview();
    button.setAttribute(BYPASS_ATTR, '1');
    try {
      button.click();
      status(snapshot.mode === 'paid'
        ? `Генерация запускается за ${snapshot.costCredits} кредитов…`
        : 'Генерация запускается бесплатно…');
    } finally {
      button.removeAttribute(BYPASS_ATTR);
    }
  }

  function renderReview(dialog, snapshot, check) {
    const source = snapshot.files.video?.name || snapshot.files.image?.name || (snapshot.prompt ? 'Текст → видео' : 'Не выбран');
    const billingHtml = snapshot.mode === 'paid'
      ? `<div class="nova-review-billing paid"><b>Платная генерация · ${escapeHtml(snapshot.costCredits)} кредитов</b><span>${snapshot.balanceCredits === null ? 'Баланс будет проверен перед запуском.' : `Доступно: ${escapeHtml(snapshot.balanceCredits)} · После запуска: ${escapeHtml(Math.max(0, snapshot.balanceCredits - snapshot.costCredits))}`}</span></div>`
      : '<div class="nova-review-billing"><b>Бесплатный режим · $0 · 0 кредитов</b><span>До запуска и после отмены NOVA не списывает кредиты.</span></div>';

    const launchDisabled = !['ready'].includes(check.state);
    const launchText = snapshot.mode === 'paid'
      ? `Запустить за ${snapshot.costCredits} кредитов`
      : 'Запустить бесплатно';

    dialog.innerHTML = `
      <div class="nova-generation-dialog-card">
        <div class="nova-generation-dialog-head">
          <div><h3>Проверить перед запуском</h3><p>NOVA показывает все важные параметры до начала генерации.</p></div>
          <button class="nova-generation-dialog-close" type="button" data-review-action="close" aria-label="Закрыть">×</button>
        </div>
        <div class="nova-review-state" data-state="${escapeHtml(check.state)}"><b>${escapeHtml(check.title)}</b><span>${escapeHtml(check.message)}${check.fileName ? ` Файл: ${escapeHtml(check.fileName)}` : ''}</span></div>
        <div class="nova-review-grid">
          <div class="nova-review-item"><small>Задание</small><b>${escapeHtml(snapshot.title)}</b></div>
          <div class="nova-review-item"><small>Источник</small><b>${escapeHtml(source)}</b></div>
          <div class="nova-review-item"><small>Провайдер</small><b>${escapeHtml(snapshot.provider)}</b></div>
          <div class="nova-review-item"><small>Модель</small><b>${escapeHtml(snapshot.model)}</b></div>
          <div class="nova-review-item"><small>Длительность</small><b>${escapeHtml(snapshot.duration)} сек</b></div>
          <div class="nova-review-item"><small>Формат</small><b>${escapeHtml(snapshot.ratio)}</b></div>
          <div class="nova-review-item"><small>Стиль</small><b>${escapeHtml(styleLabel(snapshot.style))}</b></div>
          <div class="nova-review-item"><small>Ожидаемое время</small><b>≈ ${escapeHtml(Math.max(2, Math.ceil(snapshot.duration + 2)))} сек локально</b></div>
        </div>
        ${billingHtml}
        <div class="nova-generation-dialog-actions">
          <button class="primary" type="button" data-review-action="launch" ${launchDisabled ? 'disabled' : ''}>${escapeHtml(launchText)}</button>
          <button type="button" data-review-action="edit">Изменить настройки</button>
          ${check.state === 'file-error' ? '<button type="button" data-review-action="pick-file">Загрузить заново</button>' : ''}
          <button type="button" data-review-action="close">Отмена</button>
        </div>
      </div>`;

    dialog.onclick = (event) => {
      const action = event.target.closest('[data-review-action]')?.dataset.reviewAction;
      if (!action) return;
      if (action === 'close') closeReview();
      else if (action === 'edit') {
        closeReview();
        $('#novaProPrompt')?.focus();
      } else if (action === 'pick-file') {
        const input = snapshot.files.video ? $('#novaProVideoRef') : $('#novaProImageRef');
        input?.click();
      } else if (action === 'launch' && !launchDisabled) {
        launchAfterReview(snapshot);
      }
    };
  }

  function openReview(button) {
    ensureStyles();
    const dialog = ensureReviewDialog();
    pendingLaunchButton = button;
    dialog.hidden = false;
    dialog.innerHTML = `
      <div class="nova-generation-dialog-card">
        <div class="nova-generation-dialog-head"><div><h3>Проверяем настройки…</h3><p>NOVA проверяет файлы, модель, провайдера и стоимость.</p></div></div>
        <div class="nova-review-state" data-state="checking"><b>Проверка</b><span>Проверка аудио и файлов… Проверка модели… Проверка провайдера… Расчёт стоимости…</span></div>
      </div>`;
    requestAnimationFrame(() => {
      if (pendingLaunchButton !== button || dialog.hidden) return;
      const snapshot = currentReviewSnapshot(button);
      renderReview(dialog, snapshot, validateReview(snapshot));
    });
  }

  function normalizeJob(detail) {
    const prev = jobs.get(detail.id) || {};
    const billing = billingSnapshot();
    const provider = providerSnapshot();
    const previousProgress = readNumber(prev.progress, 0);
    const merged = {
      provider: 'NOVA Local',
      model: 'Local Motion',
      mode: 'free',
      costCredits: 0,
      chargedCredits: 0,
      refundedCredits: 0,
      refundPolicy: 'unknown',
      ...prev,
      ...detail
    };
    merged.provider = detail.provider || prev.provider || provider.provider;
    merged.model = detail.model || prev.model || provider.model;
    merged.mode = detail.mode || prev.mode || billing.mode;
    merged.costCredits = detail.costCredits ?? prev.costCredits ?? parseCredits(detail.cost ?? prev.cost);
    if (merged.mode !== 'paid') {
      merged.costCredits = 0;
      merged.chargedCredits = 0;
      merged.refundedCredits = 0;
    }
    if (detail.status === 'canceled') merged.stoppedAtProgress = prev.stoppedAtProgress ?? previousProgress;
    if (detail.status === 'canceling' && merged.cancelRequestedAt == null) merged.cancelRequestedAt = Date.now();
    jobs.set(detail.id, merged);
    return merged;
  }

  function errorInfo(error) {
    const raw = String(error || '').trim();
    const q = raw.toLowerCase();
    if (/indexeddb|quota|storage|сохран|медиатек|database/.test(q)) {
      return {
        type: 'saving',
        title: 'Не удалось сохранить видео',
        message: 'Видео могло быть создано, но NOVA не смогла сохранить его в Медиатеку.',
        action: 'outputs',
        actionLabel: 'Открыть результаты'
      };
    }
    if (/network|failed to fetch|offline|соедин|internet|интернет|timeout|timed out/.test(q)) {
      return {
        type: 'network',
        title: 'Ошибка соединения',
        message: 'Соединение было потеряно. NOVA не запускает второе платное задание автоматически.',
        action: 'retry',
        actionLabel: 'Повторить генерацию'
      };
    }
    if (/provider|service unavailable|server|503|429|seedance|wan|higgsfield/.test(q)) {
      return {
        type: 'provider',
        title: 'Провайдер временно недоступен',
        message: 'Провайдер не смог завершить запрос. Повторный запуск выполняется только по твоей команде.',
        action: 'retry',
        actionLabel: 'Повторить генерацию'
      };
    }
    if (/file|format|файл|изображ|audio|video source|reference/.test(q)) {
      return {
        type: 'file',
        title: 'Ошибка исходного файла',
        message: 'Один из исходных файлов не удалось прочитать или использовать.',
        action: 'pick-file',
        actionLabel: 'Выбрать другой файл'
      };
    }
    return {
      type: 'model',
      title: 'Ошибка генерации',
      message: 'Модель или локальный рендер не смогли завершить создание видео.',
      action: 'retry',
      actionLabel: 'Повторить генерацию'
    };
  }

  function financeText(job, state) {
    if (job.mode !== 'paid') return state === 'canceled'
      ? 'Стоимость: $0 · 0 кредитов · Кредиты не списаны.'
      : 'Стоимость: $0 · 0 кредитов.';
    const charged = readNumber(job.chargedCredits, readNumber(job.costCredits, 0));
    const refunded = readNumber(job.refundedCredits, 0);
    const finalCost = Math.max(0, charged - refunded);
    if (state === 'canceled' && job.refundPending) {
      return `Списано: ${charged} · Возврат обрабатывается.`;
    }
    if (state === 'canceled' && refunded > 0) {
      return `Списано: ${charged} · Возвращено: ${refunded} · Итог: ${finalCost} кредитов.`;
    }
    return `Списано: ${charged} кредитов.`;
  }

  function enhanceJobCard(job) {
    const card = document.querySelector(`.nova-generation-job[data-job-id="${CSS.escape(job.id)}"]`);
    if (!card) return;

    let summary = $('.nova-job-ux-summary', card);
    if (!summary) {
      summary = document.createElement('div');
      summary.className = 'nova-job-ux-summary';
      const meta = $('.nova-job-meta', card);
      (meta || $('.nova-job-progress', card))?.insertAdjacentElement('afterend', summary);
    }
    if (summary) {
      summary.innerHTML = `
        <span>Провайдер<b>${escapeHtml(job.provider || 'NOVA Local')}</b></span>
        <span>Модель<b>${escapeHtml(job.model || 'Local Motion')}</b></span>
        <span>Режим<b>${job.mode === 'paid' ? 'Платный' : 'Бесплатный'}</b></span>
        <span>Кредиты<b>${job.mode === 'paid' ? escapeHtml(job.costCredits || 0) : '0 · $0'}</b></span>`;
    }

    card.querySelectorAll('.nova-job-ux-panel').forEach((node) => node.remove());

    if (job.status === 'failed') {
      const info = errorInfo(job.error);
      const panel = document.createElement('section');
      panel.className = 'nova-job-ux-panel error';
      panel.innerHTML = `
        <h4>${escapeHtml(info.title)}</h4>
        <p>${escapeHtml(info.message)}</p>
        <div class="nova-job-ux-finance">${escapeHtml(financeText(job, 'failed'))}</div>
        <div class="nova-job-ux-actions">
          <button class="primary" type="button" data-nova-ux-action="${escapeHtml(info.action)}" data-job-id="${escapeHtml(job.id)}">${escapeHtml(info.actionLabel)}</button>
          <button type="button" data-nova-ux-action="edit" data-job-id="${escapeHtml(job.id)}">Изменить и повторить</button>
          <button type="button" data-nova-ux-action="details" data-job-id="${escapeHtml(job.id)}">Показать детали</button>
        </div>
        <div class="nova-job-ux-details" hidden>${escapeHtml(job.error || 'Неизвестная ошибка')}</div>`;
      card.appendChild(panel);
    } else if (job.status === 'canceling') {
      const panel = document.createElement('section');
      panel.className = 'nova-job-ux-panel canceled';
      panel.innerHTML = '<h4>Отменяется…</h4><p>NOVA отправила запрос на отмену. Ждём подтверждения фактического состояния задания.</p>';
      card.appendChild(panel);
    } else if (job.status === 'canceled') {
      const stopped = readNumber(job.stoppedAtProgress, 0);
      const panel = document.createElement('section');
      panel.className = 'nova-job-ux-panel canceled';
      panel.innerHTML = `
        <h4>Генерация отменена</h4>
        <p>${stopped > 0 ? `Задание остановлено примерно на ${Math.round(stopped)}%.` : 'Задание успешно остановлено.'}</p>
        <div class="nova-job-ux-finance">${escapeHtml(financeText(job, 'canceled'))}</div>
        <div class="nova-job-ux-actions">
          <button class="primary" type="button" data-nova-ux-action="retry" data-job-id="${escapeHtml(job.id)}">Повторить генерацию</button>
          <button type="button" data-nova-ux-action="edit" data-job-id="${escapeHtml(job.id)}">Изменить и повторить</button>
        </div>`;
      card.appendChild(panel);
    } else if (job.status === 'completed') {
      const panel = document.createElement('section');
      panel.className = 'nova-job-ux-panel success';
      panel.innerHTML = `
        <h4>Видео готово</h4>
        <p>Ролик успешно создан и сохранён в Медиатеке.</p>
        <div class="nova-job-ux-finance">${escapeHtml(financeText(job, 'completed'))}</div>`;
      card.appendChild(panel);
    }
  }

  function ensureCancelDialog() {
    let dialog = $('#novaGenerationCancelDialog');
    if (dialog) return dialog;
    dialog = document.createElement('section');
    dialog.id = 'novaGenerationCancelDialog';
    dialog.className = 'nova-generation-dialog';
    dialog.hidden = true;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    return dialog;
  }

  function cancelCopy(job) {
    const early = ['preparing', 'queued', 'uploading'].includes(job.status);
    if (job.mode !== 'paid') {
      return {
        title: early ? 'Отменить задание?' : 'Остановить генерацию?',
        message: early
          ? 'Задание ещё не завершило подготовку. NOVA остановит его до дальнейшей обработки.'
          : 'Генерация уже началась. Текущий незавершённый результат будет потерян.',
        finance: 'Стоимость: $0 · 0 кредитов. За отмену ничего не списывается.',
        confirm: early ? 'Да, отменить задание' : 'Остановить генерацию'
      };
    }
    const charged = readNumber(job.chargedCredits, readNumber(job.costCredits, 0));
    if (early && charged === 0) {
      return {
        title: 'Отменить задание?',
        message: 'Задание ещё не было оплачено у провайдера.',
        finance: 'Кредиты ещё не списаны.',
        confirm: 'Да, отменить задание'
      };
    }
    if (job.refundPolicy === 'full') {
      return {
        title: 'Остановить генерацию?',
        message: 'Провайдер уже получил задание.',
        finance: `Списано: ${charged} кредитов. Ожидаемый возврат: ${charged} кредитов.`,
        confirm: 'Остановить генерацию'
      };
    }
    if (job.refundPolicy === 'none') {
      return {
        title: 'Остановить генерацию?',
        message: 'Провайдер уже начал работу. Возврат не гарантирован.',
        finance: `Списано: ${charged} кредитов.`,
        confirm: 'Остановить без гарантии возврата'
      };
    }
    return {
      title: 'Остановить генерацию?',
      message: 'Провайдер уже начал работу. NOVA покажет фактический возврат после подтверждения провайдера.',
      finance: `Списано: ${charged} кредитов. Возможен полный, частичный или нулевой возврат.`,
      confirm: 'Остановить генерацию'
    };
  }

  function openCancel(jobId) {
    ensureStyles();
    const job = jobs.get(jobId) || { id: jobId, status: 'generating', mode: 'free', costCredits: 0 };
    const copy = cancelCopy(job);
    const dialog = ensureCancelDialog();
    dialog.hidden = false;
    dialog.innerHTML = `
      <div class="nova-generation-dialog-card">
        <div class="nova-generation-dialog-head">
          <div><h3>${escapeHtml(copy.title)}</h3><p>${escapeHtml(copy.message)}</p></div>
          <button class="nova-generation-dialog-close" type="button" data-cancel-action="close" aria-label="Закрыть">×</button>
        </div>
        <div class="nova-review-grid">
          <div class="nova-review-item"><small>Статус</small><b>${escapeHtml(job.status || 'generating')}</b></div>
          <div class="nova-review-item"><small>Прогресс</small><b>${Math.round(readNumber(job.progress, 0))}%</b></div>
          <div class="nova-review-item"><small>Провайдер</small><b>${escapeHtml(job.provider || 'NOVA Local')}</b></div>
          <div class="nova-review-item"><small>Модель</small><b>${escapeHtml(job.model || 'Local Motion')}</b></div>
        </div>
        <div class="nova-review-billing ${job.mode === 'paid' ? 'paid' : ''}"><b>${escapeHtml(copy.finance)}</b><span>NOVA не запускает новое платное задание автоматически после отмены.</span></div>
        <div class="nova-generation-dialog-actions">
          <button class="danger" type="button" data-cancel-action="confirm">${escapeHtml(copy.confirm)}</button>
          <button class="primary" type="button" data-cancel-action="close">Продолжить генерацию</button>
        </div>
      </div>`;
    dialog.onclick = (event) => {
      const action = event.target.closest('[data-cancel-action]')?.dataset.cancelAction;
      if (!action) return;
      if (action === 'close') {
        dialog.hidden = true;
        return;
      }
      if (action === 'confirm') {
        dialog.hidden = true;
        emit({
          id: job.id,
          status: 'canceling',
          progress: readNumber(job.progress, 0),
          stage: 'Отменяется…',
          cancelRequestedAt: Date.now()
        });
        status('Отменяем генерацию…');
        setTimeout(() => $('#novaProStopRender')?.click(), 0);
      }
    };
  }

  function handleUxAction(button) {
    const action = button.dataset.novaUxAction;
    const jobId = button.dataset.jobId;
    if (action === 'details') {
      const details = button.closest('.nova-job-ux-panel')?.querySelector('.nova-job-ux-details');
      if (!details) return;
      details.hidden = !details.hidden;
      button.textContent = details.hidden ? 'Показать детали' : 'Скрыть детали';
      return;
    }
    if (action === 'edit') {
      window.NovaUnifiedVideoStudio?.open?.('create');
      $('#novaProPrompt')?.focus();
      return;
    }
    if (action === 'pick-file') {
      window.NovaUnifiedVideoStudio?.open?.('create');
      ($('#novaProImageRef') || $('#novaProVideoRef'))?.click();
      return;
    }
    if (action === 'outputs') {
      window.NovaUnifiedVideoStudio?.open?.('create');
      $('#novaProOutputs')?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (action === 'retry') {
      window.NovaUnifiedVideoStudio?.open?.('create');
      const launch = $('#novaProMotion');
      if (launch) openReview(launch);
      else status(`Не удалось повторить задание ${jobId || ''}.`);
    }
  }

  function wireEvents() {
    window.addEventListener('nova-video-job', (event) => {
      const detail = event.detail || {};
      if (!detail.id) return;
      const job = normalizeJob(detail);
      requestAnimationFrame(() => enhanceJobCard(job));
      if (detail.status === 'preparing') {
        status(job.mode === 'paid'
          ? `Генерация запущена · ${job.costCredits || 0} кредитов.`
          : 'Генерация запущена · $0 · 0 кредитов.');
      } else if (detail.status === 'canceled') {
        status(job.mode === 'paid' && job.refundPending
          ? 'Генерация отменена. Возврат кредитов обрабатывается.'
          : 'Генерация отменена.');
      } else if (detail.status === 'failed') {
        status(errorInfo(detail.error).title);
      }
    });

    document.addEventListener('click', (event) => {
      const uxButton = event.target.closest('[data-nova-ux-action]');
      if (uxButton) {
        event.preventDefault();
        event.stopPropagation();
        handleUxAction(uxButton);
        return;
      }

      const cancel = event.target.closest('.nova-generation-job button[data-job-action="cancel"]');
      if (cancel) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const id = cancel.closest('.nova-generation-job')?.dataset.jobId;
        if (id) openCancel(id);
        return;
      }

      const launch = event.target.closest('#novaProMotion,#novaProExtend');
      if (!launch) return;
      if (launch.hasAttribute(BYPASS_ATTR)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openReview(launch);
    }, true);
  }

  function install() {
    ensureStyles();
    ensureReviewDialog();
    ensureCancelDialog();
    wireEvents();
    window.NovaGenerationUX = Object.freeze({
      openReview: () => {
        const launch = $('#novaProMotion');
        if (launch) openReview(launch);
      },
      getJob(id) {
        const job = jobs.get(id);
        return job ? { ...job } : null;
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
