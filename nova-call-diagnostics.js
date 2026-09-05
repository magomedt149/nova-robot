(() => {
  'use strict';

  const VERSION = '1.0.0';
  const BADGE_ID = 'novaCallStatusBadge';
  const BUTTON_ID = 'novaCallCheckBtn';
  const MODAL_ID = 'novaCallDiagnosticsModal';

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
    })[ch]);
  }

  function getCalls() {
    return window.NOVA_FREE_CALLS || null;
  }

  function ensureBadge() {
    let badge = document.getElementById(BADGE_ID);
    if (badge) return badge;
    const anchor = document.getElementById('freeModeBadge');
    if (!anchor?.parentNode) return null;
    badge = document.createElement('span');
    badge.id = BADGE_ID;
    badge.className = 'version';
    badge.textContent = 'CALL…';
    badge.title = 'NOVA Call — автоматическая проверка';
    anchor.insertAdjacentElement('afterend', badge);
    return badge;
  }

  function setBadge(kind, text) {
    const badge = ensureBadge();
    if (!badge) return;
    badge.textContent = text;
    badge.dataset.state = kind;
    badge.style.cursor = 'pointer';
    badge.style.userSelect = 'none';
    if (kind === 'ready') {
      badge.style.outline = '1px solid currentColor';
    } else {
      badge.style.outline = '';
    }
  }

  async function runCheck() {
    const calls = getCalls();
    if (!calls?.diagnose) {
      const result = { ok:false, state:'missing', message:'Модуль NOVA FREE CALL не загружен.' };
      setBadge('offline', 'CALL OFFLINE');
      return result;
    }

    setBadge('checking', 'CALL…');

    try {
      const info = await calls.diagnose();
      const fallbackReady = info.publicFallbackAllowed && info.publicFallbackOnline;
      const ok = info.selfHostedOnline || fallbackReady;

      if (info.selfHostedOnline) {
        setBadge('ready', 'CALL READY');
        return {
          ok:true,
          state:'self-hosted',
          message:'Свой NOVA Call сервер доступен.',
          info
        };
      }

      if (fallbackReady) {
        setBadge('ready', 'CALL READY');
        return {
          ok:true,
          state:'free-fallback',
          message:'Бесплатный режим готов. Свой сервер не нужен для запуска сейчас.',
          info
        };
      }

      setBadge('offline', 'CALL OFFLINE');
      return {
        ok:false,
        state:'offline',
        message:'Сейчас не найден доступный маршрут для бесплатного интернет-звонка.',
        info
      };
    } catch (error) {
      setBadge('offline', 'CALL OFFLINE');
      return {
        ok:false,
        state:'error',
        message:error?.message || 'Ошибка проверки NOVA Call.'
      };
    }
  }

  function removeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  async function openDiagnostics() {
    removeModal();

    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText = [
      'position:fixed','inset:0','z-index:99999','background:rgba(0,0,0,.72)',
      'display:flex','align-items:center','justify-content:center','padding:18px'
    ].join(';');

    const card = document.createElement('div');
    card.style.cssText = [
      'width:min(560px,100%)','max-height:86vh','overflow:auto',
      'background:#111','color:#fff','border:1px solid #555','border-radius:18px',
      'padding:18px','font:16px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif'
    ].join(';');
    card.innerHTML = '<b style="font-size:20px">NOVA Call — проверка запуска</b><p>Проверяю бесплатный маршрут…</p>';
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) removeModal();
    });

    const result = await runCheck();
    const info = result.info || {};
    const stateLabel = result.ok ? '🟢 ГОТОВО' : '🔴 НЕ ГОТОВО';
    const selfLabel = info.selfHostedOnline ? '🟢 online' : '⚪ offline / не настроен';
    const fallbackLabel = info.publicFallbackAllowed
      ? (info.publicFallbackOnline ? '🟢 доступен' : '🔴 недоступен')
      : '🔒 отключён';

    card.innerHTML = `
      <div style="display:flex;gap:10px;align-items:center;justify-content:space-between">
        <b style="font-size:20px">NOVA Call — проверка запуска</b>
        <button type="button" data-close style="font-size:22px;background:none;color:#fff;border:0">✕</button>
      </div>
      <p><b>${stateLabel}</b></p>
      <p>${esc(result.message)}</p>
      <div style="background:#1d1d1d;border-radius:12px;padding:12px">
        <div>Свой сервер: <b>${selfLabel}</b></div>
        <div>Бесплатный резерв: <b>${fallbackLabel}</b></div>
        <div>Режим: <b>Интернет-звонок, без Autocalls/PSTN</b></div>
        <div>Платные API: <b>не используются</b></div>
      </div>
      <div style="display:grid;gap:10px;margin-top:14px">
        <button type="button" data-test-room style="padding:13px;border-radius:12px;font-weight:700">Создать тестовую комнату бесплатно</button>
        <button type="button" data-recheck style="padding:13px;border-radius:12px">Проверить ещё раз</button>
      </div>
      <div data-room style="margin-top:12px;word-break:break-all"></div>
    `;

    card.querySelector('[data-close]')?.addEventListener('click', removeModal);
    card.querySelector('[data-recheck]')?.addEventListener('click', openDiagnostics);
    card.querySelector('[data-test-room]')?.addEventListener('click', async () => {
      const box = card.querySelector('[data-room]');
      const calls = getCalls();
      if (!calls?.createBestRoom) {
        box.textContent = 'Модуль создания комнаты недоступен.';
        return;
      }
      box.textContent = 'Создаю…';
      try {
        const room = await calls.createBestRoom();
        box.innerHTML = `
          <b>Тестовая комната создана:</b><br>
          <a href="${esc(room.url)}" target="_blank" rel="noopener" style="color:#8ab4f8">${esc(room.url)}</a>
          <br><small>Никакой телефонный номер не набирается и деньги не списываются.</small>
        `;
      } catch (error) {
        box.textContent = error?.message || 'Не удалось создать комнату.';
      }
    });
  }

  function bind() {
    const button = document.getElementById(BUTTON_ID);
    if (button && !button.dataset.novaCallBound) {
      button.dataset.novaCallBound = '1';
      button.addEventListener('click', openDiagnostics);
    }

    const badge = ensureBadge();
    if (badge && !badge.dataset.novaCallBound) {
      badge.dataset.novaCallBound = '1';
      badge.addEventListener('click', openDiagnostics);
    }

    window.setTimeout(runCheck, 1200);
  }

  window.NOVA_CALL_DIAGNOSTICS = {
    version: VERSION,
    runCheck,
    openDiagnostics
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once:true });
  } else {
    bind();
  }
})();
