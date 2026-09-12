(() => {
  'use strict';

  const VERSION = '1.2.0';
  const BADGE_ID = 'novaCallStatusBadge';
  const BUTTON_ID = 'novaCallCheckBtn';
  const MODAL_ID = 'novaCallDiagnosticsModal';

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
    })[ch]);
  }

  function getCalls() { return window.NOVA_FREE_CALLS || null; }

  function ensureBadge() {
    let badge = document.getElementById(BADGE_ID);
    if (badge) return badge;
    const anchor = document.getElementById('freeModeBadge');
    if (!anchor?.parentNode) return null;
    badge = document.createElement('span');
    badge.id = BADGE_ID;
    badge.className = 'version';
    badge.textContent = 'CALL ✓';
    badge.title = 'NOVA Call — нажми для полной проверки';
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
    badge.style.outline = kind === 'ready' ? '1px solid currentColor' : '';
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
      const fallbackReady = info.publicFallbackAllowed && info.communityFallbackOnline;
      const emergencyReady = info.publicFallbackAllowed && info.emergencyFallbackOnline;
      const ok = info.selfHostedOnline || fallbackReady;
      if (info.selfHostedOnline) {
        setBadge('ready', 'CALL READY');
        return { ok:true, state:'self-hosted', message:'Свой NOVA Call сервер доступен.', info };
      }
      if (fallbackReady) {
        setBadge('ready', 'CALL READY');
        return { ok:true, state:'free-fallback', message:'Бесплатный резерв без регистрации готов.', info };
      }
      if (emergencyReady) {
        setBadge('checking', 'CALL BACKUP');
        return { ok:false, state:'moderator-fallback', message:'Доступен только аварийный резерв: организатору потребуется войти в отдельном окне.', info };
      }
      setBadge('offline', 'CALL OFFLINE');
      return { ok:false, state:'offline', message:'Сейчас не найден доступный маршрут для бесплатного видеозвонка.', info };
    } catch (error) {
      setBadge('offline', 'CALL OFFLINE');
      return { ok:false, state:'error', message:error?.message || 'Ошибка проверки NOVA Call.' };
    }
  }

  function removeModal() { document.getElementById(MODAL_ID)?.remove(); }

  async function openDiagnostics() {
    removeModal();
    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText = ['position:fixed','inset:0','z-index:99999','background:rgba(0,0,0,.72)','display:flex','align-items:center','justify-content:center','padding:18px'].join(';');

    const card = document.createElement('div');
    card.style.cssText = ['width:min(560px,100%)','max-height:86vh','overflow:auto','background:#111','color:#fff','border:1px solid #555','border-radius:18px','padding:18px','font:16px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif'].join(';');
    card.innerHTML = '<b style="font-size:20px">NOVA Call — проверка</b><p>Проверяю видеосвязь…</p>';
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) removeModal(); });

    const result = await runCheck();
    const info = result.info || {};
    const stateLabel = result.ok ? '🟢 ГОТОВО' : '🔴 НЕ ГОТОВО';
    const selfLabel = info.selfHostedOnline ? '🟢 online' : '⚪ offline / не настроен';
    const fallbackLabel = info.publicFallbackAllowed ? (info.communityFallbackOnline ? '🟢 доступен без входа' : '🔴 недоступен') : '🔒 отключён';
    const emergencyLabel = info.emergencyFallbackOnline ? '🟡 доступен, нужен вход организатора' : 'резервируется только при сбое';
    const mediaLabel = info.mediaDevices ? '🟢 поддерживаются' : '🔴 недоступны';

    card.innerHTML = `
      <div style="display:flex;gap:10px;align-items:center;justify-content:space-between">
        <b style="font-size:20px">NOVA Call — проверка</b>
        <button type="button" data-close style="font-size:22px;background:none;color:#fff;border:0">✕</button>
      </div>
      <p><b>${stateLabel}</b></p><p>${esc(result.message)}</p>
      <div style="background:#1d1d1d;border-radius:12px;padding:12px">
        <div>Свой сервер: <b>${selfLabel}</b></div>
        <div>Бесплатный резерв без регистрации: <b>${fallbackLabel}</b></div>
        <div>Аварийный резерв: <b>${emergencyLabel}</b></div>
        <div>Камера/микрофон браузера: <b>${mediaLabel}</b></div>
        <div>Встроенный видеозвонок: <b>${info.iframeApi ? 'Jitsi IFrame API' : 'обычный режим'}</b></div>
        <div>Интернет: <b>${info.online === false ? '🔴 offline' : '🟢 online'}</b></div>
        <div>Платные API: <b>не используются</b></div>
      </div>
      <div style="display:grid;gap:10px;margin-top:14px">
        <button type="button" data-devices style="padding:13px;border-radius:12px;font-weight:700">🎥 Проверить камеру и микрофон</button>
        <button type="button" data-test-room style="padding:13px;border-radius:12px;font-weight:700">📹 Создать тестовый видеозвонок</button>
        <button type="button" data-last-room style="padding:13px;border-radius:12px">↻ Вернуться в последний звонок</button>
        <button type="button" data-recheck style="padding:13px;border-radius:12px">Проверить серверы ещё раз</button>
      </div>
      <div data-room style="margin-top:12px;word-break:break-all"></div>`;

    card.querySelector('[data-close]')?.addEventListener('click', removeModal);
    card.querySelector('[data-recheck]')?.addEventListener('click', openDiagnostics);
    card.querySelector('[data-devices]')?.addEventListener('click', async () => {
      const box = card.querySelector('[data-room]');
      const calls = getCalls();
      box.textContent = 'Запрашиваю разрешение…';
      const media = await calls?.testDevices?.();
      box.textContent = media?.ok
        ? '✅ Камера и микрофон работают. Тестовый поток остановлен.'
        : `⚠️ ${media?.error || 'Нет доступа к камере или микрофону.'}`;
    });
    card.querySelector('[data-test-room]')?.addEventListener('click', async () => {
      const box = card.querySelector('[data-room]');
      const calls = getCalls();
      if (!calls?.createAndOpen) { box.textContent = 'Модуль создания комнаты недоступен.'; return; }
      box.textContent = 'Создаю…';
      try {
        await calls.createAndOpen();
        box.textContent = '✅ Видеозвонок открыт внутри NOVA.';
      } catch (error) {
        box.textContent = error?.message || 'Не удалось создать комнату.';
      }
    });
    card.querySelector('[data-last-room]')?.addEventListener('click', () => {
      const box = card.querySelector('[data-room]');
      const ok = getCalls()?.reopenLastRoom?.();
      Promise.resolve(ok).then((value) => { if (!value) box.textContent = 'Нет недавнего звонка для восстановления.'; });
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
    setBadge(getCalls()?.diagnose ? 'ready' : 'offline', getCalls()?.diagnose ? 'CALL ✓' : 'CALL OFFLINE');
  }

  window.NOVA_CALL_DIAGNOSTICS = { version: VERSION, runCheck, openDiagnostics };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once:true });
  else bind();
})();
