(() => {
  'use strict';

  if (window.__novaUnifiedVideoStudioInstalled) return;
  window.__novaUnifiedVideoStudioInstalled = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const ACTIVE_KEY = 'nova.videoStudio.activeTab.v1';
  const VALID_TABS = new Set(['create', 'editor', 'motion', 'audio', 'subtitles', 'library']);
  let activeTab = 'create';
  let editorView = 'timeline';

  function status(message) {
    const local = $('#novaMediaStatus');
    if (local) local.textContent = message;
    const global = $('#statusText');
    if (global) global.textContent = message;
  }

  function selectUnderlying(name) {
    $$('[data-media-tab]').forEach((button) => button.classList.toggle('active', button.dataset.mediaTab === name));
    $$('[data-media-pane]').forEach((pane) => { pane.hidden = pane.dataset.mediaPane !== name; });
  }

  function remember(tab) {
    activeTab = VALID_TABS.has(tab) ? tab : 'create';
    try { localStorage.setItem(ACTIVE_KEY, activeTab); } catch (_) {}
  }

  function restore() {
    try {
      const value = localStorage.getItem(ACTIVE_KEY);
      return VALID_TABS.has(value) ? value : 'create';
    } catch (_) {
      return 'create';
    }
  }

  function ensureStyles() {
    if ($('#novaUnifiedVideoStudioStyles')) return;
    const style = document.createElement('style');
    style.id = 'novaUnifiedVideoStudioStyles';
    style.textContent = `
      #novaMediaModal .nova-media-card{width:min(1180px,100%);max-height:94vh}
      #novaMediaModal .nova-media-head h2{font-size:20px}
      #novaMediaModal .nova-media-tabs{display:none!important}
      .nova-unified-tabs{display:grid;grid-template-columns:repeat(6,minmax(130px,1fr));gap:7px;margin:12px 0 14px;overflow-x:auto;padding-bottom:2px;scrollbar-width:none}
      .nova-unified-tabs::-webkit-scrollbar{display:none}
      .nova-unified-tab{min-height:46px;border:1px solid rgba(255,255,255,.12);border-radius:13px;padding:9px 10px;background:rgba(255,255,255,.055);color:#dce8ff;font-weight:850;white-space:nowrap}
      .nova-unified-tab.active{background:linear-gradient(135deg,#176fff,#7447ff);border-color:transparent;color:#fff;box-shadow:0 8px 28px rgba(55,92,255,.22)}
      .nova-unified-free{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin:-4px 0 10px;font-size:11px;color:#93b3dd}
      .nova-unified-free b{padding:5px 8px;border-radius:999px;background:rgba(31,201,130,.12);border:1px solid rgba(54,232,164,.22);color:#7af0c4}
      .nova-unified-editor-tools{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px;padding:9px;border:1px solid rgba(92,151,255,.18);border-radius:13px;background:rgba(35,96,205,.07)}
      .nova-unified-editor-tools button{border:1px solid rgba(111,166,255,.22);border-radius:10px;background:rgba(255,255,255,.06);color:#eaf2ff;padding:8px 10px;font-weight:850}
      .nova-unified-editor-tools button.active{background:rgba(56,121,255,.28);border-color:rgba(107,166,255,.48)}
      #novaMediaModal[data-unified-tab="editor"][data-editor-view="timeline"] #novaProPane .nova-pro-layout{display:none}
      #novaMediaModal[data-unified-tab="editor"][data-editor-view="timeline"] #novaProPane>.nova-media-note{display:none}
      .nova-irina-quick{margin:0 0 12px;padding:12px;border:1px solid rgba(74,210,255,.2);border-radius:15px;background:linear-gradient(135deg,rgba(10,62,120,.18),rgba(90,55,180,.12))}
      .nova-irina-quick h3{margin:0 0 7px;font-size:15px}.nova-irina-lock{font-size:11px;color:#81e9c5;margin-bottom:8px}
      .nova-irina-quick textarea{width:100%;min-height:92px;box-sizing:border-box;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:#071027;color:#fff;padding:10px;font:inherit;resize:vertical}
      .nova-irina-row{display:grid;grid-template-columns:minmax(140px,.7fr) 1fr;gap:8px;margin-top:8px}.nova-irina-row select{width:100%;border:1px solid rgba(255,255,255,.14);border-radius:11px;background:#071027;color:#fff;padding:10px}
      .nova-irina-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.nova-irina-actions button{border:0;border-radius:11px;padding:9px 12px;background:rgba(255,255,255,.1);color:#fff;font-weight:850}.nova-irina-actions .primary{background:linear-gradient(135deg,#157bff,#7346ff)}
      .nova-motion-embed{display:grid;gap:10px}.nova-motion-embed-head{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}.nova-motion-embed-head b{font-size:15px}.nova-motion-embed-head span{font-size:11px;color:#83a9d7}
      .nova-motion-iframe-wrap{position:relative;min-height:660px;border:1px solid rgba(92,165,255,.2);border-radius:18px;overflow:hidden;background:#050914}.nova-motion-iframe{width:100%;height:72vh;min-height:660px;border:0;background:#050914}
      .nova-motion-placeholder{display:grid;place-items:center;min-height:420px;text-align:center;padding:24px;color:#a7bde0}.nova-motion-placeholder button{margin-top:12px;border:0;border-radius:12px;padding:10px 14px;background:linear-gradient(135deg,#157bff,#7346ff);color:#fff;font-weight:850}
      .nova-text-video-quick{margin:0 0 12px;padding:12px;border:1px solid rgba(104,173,255,.24);border-radius:16px;background:linear-gradient(135deg,rgba(19,85,190,.16),rgba(111,52,190,.10))}
      .nova-text-video-quick h3{margin:0 0 6px;font-size:16px}.nova-text-video-quick p{margin:0 0 9px;color:#9fb9dd;font-size:12px;line-height:1.45}
      .nova-text-video-quick textarea{width:100%;min-height:96px;box-sizing:border-box;border:1px solid rgba(255,255,255,.14);border-radius:13px;background:#061027;color:#fff;padding:11px;font:inherit;resize:vertical}
      .nova-text-video-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}.nova-text-video-actions button{border:0;border-radius:12px;padding:10px 13px;background:linear-gradient(135deg,#157bff,#7346ff);color:#fff;font-weight:900}.nova-text-video-actions span{font-size:11px;color:#8faad0}
      .nova-hidden-legacy-launch{display:none!important}
      @media(max-width:760px){
        #novaMediaModal{padding:5px}.nova-media-card{padding:12px!important;border-radius:18px!important}
        .nova-unified-tabs{display:flex}.nova-unified-tab{flex:0 0 auto;min-width:142px}
        .nova-irina-row{grid-template-columns:1fr}.nova-motion-iframe-wrap,.nova-motion-iframe{min-height:620px;height:72vh}
      }
    `;
    document.head.appendChild(style);
  }

  function ensureMotionPane(modal) {
    let pane = $('#novaUnifiedMotionPane');
    if (pane) return pane;
    const card = $('.nova-media-card', modal);
    const statusNode = $('#novaMediaStatus', modal);
    if (!card) return null;
    pane = document.createElement('div');
    pane.id = 'novaUnifiedMotionPane';
    pane.className = 'nova-media-pane';
    pane.dataset.mediaPane = 'unified-motion';
    pane.hidden = true;
    pane.innerHTML = `
      <div class="nova-motion-embed">
        <div class="nova-motion-embed-head"><b>✨ Motion + VFX Studio</b><span>LOCAL FIRST · FREE LOCK · Remote GPU только после подтверждения</span></div>
        <div class="nova-media-note">Здесь доступны длительность 3/5/8/10/15 сек, 16:9 и 9:16, стиль, движение, камера Static/Push-in/Orbit/Handheld, огонь, дым, искры, молния, обломки, взрыв, туман, дождь, сила VFX, Auto Director и локальный предпросмотр.</div>
        <div class="nova-motion-iframe-wrap" id="novaMotionFrameWrap">
          <div class="nova-motion-placeholder" id="novaMotionPlaceholder"><div><b>Motion + VFX готов к загрузке</b><br><small>Студия откроется внутри NOVA и не запускает внешний GPU автоматически.</small><br><button id="novaLoadMotionFrame" type="button">Открыть Motion + VFX</button></div></div>
        </div>
      </div>`;
    card.insertBefore(pane, statusNode || null);
    $('#novaLoadMotionFrame', pane)?.addEventListener('click', () => loadMotionFrame());
    return pane;
  }

  function loadMotionFrame() {
    const wrap = $('#novaMotionFrameWrap');
    if (!wrap) return;
    let frame = $('#novaMotionFrame');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'novaMotionFrame';
      frame.className = 'nova-motion-iframe';
      frame.title = 'NOVA Motion + VFX Studio';
      frame.loading = 'eager';
      frame.setAttribute('allow', 'clipboard-read; clipboard-write; fullscreen');
      frame.src = './motion-studio/?embedded=1';
      wrap.innerHTML = '';
      wrap.appendChild(frame);
      status('Motion + VFX загружается внутри NOVA…');
      frame.addEventListener('load', () => status('✅ Motion + VFX готов. Локальный режим бесплатный; Remote GPU требует подтверждения.'), { once: true });
    }
  }

  function ensureIrinaPanel() {
    const pane = $('[data-media-pane="story"]');
    if (!pane || $('#novaIrinaQuick')) return;
    const panel = document.createElement('section');
    const IRINA_SAMPLE = 'Привет, Тумсоев. Ирина готова озвучивать видео на русском языке чётко и естественно.';
    const DENIS_SAMPLE = 'Привет, Тумсоев. Денис готов озвучивать видео на русском языке чётким мужским голосом.';
    const DIALOGUE_SAMPLE = Object.freeze([
      { voice: 'irina', text: 'Привет, Денис. Ты меня слышишь?' },
      { voice: 'denis', text: 'Да, Ирина. Слышу отлично.' },
      { voice: 'irina', text: 'Тогда проверим наши голоса по очереди.' },
      { voice: 'denis', text: 'Готов. Сейчас говорю я, мужским голосом.' },
      { voice: 'irina', text: 'А теперь снова я. Диалог работает правильно.' }
    ]);
    panel.id = 'novaIrinaQuick';
    panel.className = 'nova-irina-quick';
    panel.innerHTML = `
      <h3>🎙️ Ирина / Денис — быстрый голосовой тест</h3>
      <div class="nova-irina-lock" id="novaQuickVoiceProfile">Ирина: ru_RU-irina-medium · pitch 1.0 · formant 1.0</div>
      <textarea id="novaIrinaQuickText">${IRINA_SAMPLE}</textarea>
      <div class="nova-irina-row"><select id="novaIrinaQuickVoice"><option value="irina">♀ Ирина</option><option value="denis">♂ Денис</option></select><div class="nova-media-note">Переключение сразу останавливает прежний голос. Кнопка «Слушать» всегда запускает выбранный профиль.</div></div>
      <div class="nova-irina-actions"><button class="primary" id="novaIrinaQuickPlay" type="button">▶ Слушать</button><button id="novaIrinaDialoguePlay" type="button">💬 Диалог Ирина + Денис</button><button id="novaIrinaQuickStop" type="button">⏹ Стоп</button></div>`;
    pane.prepend(panel);

    const voiceSelect = $('#novaIrinaQuickVoice', panel);
    const textBox = $('#novaIrinaQuickText', panel);
    const profile = $('#novaQuickVoiceProfile', panel);
    const ttsAtInit = window.NovaRussianTTS;
    const storedVoice = ttsAtInit?.getDefaultVoice?.();
    if (voiceSelect && (storedVoice === 'irina' || storedVoice === 'denis')) voiceSelect.value = storedVoice;

    const syncSelectedVoice = (stopCurrent = true) => {
      const tts = window.NovaRussianTTS;
      const voice = voiceSelect?.value === 'denis' ? 'denis' : 'irina';
      if (stopCurrent) {
        try { tts?.stop?.(); } catch (_) {}
      }
      try { tts?.setDefaultVoice?.(voice); } catch (_) {}
      if (textBox) {
        const current = textBox.value.trim();
        if (!current || current === IRINA_SAMPLE || current === DENIS_SAMPLE) {
          textBox.value = voice === 'denis' ? DENIS_SAMPLE : IRINA_SAMPLE;
        }
      }
      if (profile) {
        profile.textContent = voice === 'denis'
          ? 'Денис: мужской ru-RU · Piper ru_RU-denis-medium основной · системный iPhone резерв'
          : 'Ирина: женский ru-RU · Piper ru_RU-irina-medium → female iPhone fallback';
      }
      status(`Выбран голос: ${voice === 'denis' ? 'Денис' : 'Ирина'}.`);
      return voice;
    };

    voiceSelect?.addEventListener('change', () => syncSelectedVoice(true));
    syncSelectedVoice(false);

    $('#novaIrinaQuickPlay', panel)?.addEventListener('click', async () => {
      const tts = window.NovaRussianTTS;
      if (!tts?.speak) return status('Русские голоса ещё загружаются. Попробуй через несколько секунд.');
      const text = textBox?.value?.trim();
      const voice = voiceSelect?.value === 'denis' ? 'denis' : 'irina';
      if (!text) return status('Введи текст для озвучки.');
      try {
        tts.unlock?.();
        tts.stop?.();
        tts.setDefaultVoice?.(voice);
        status(`Говорит ${voice === 'denis' ? 'Денис' : 'Ирина'}…`);
        if (voice === 'denis' && tts.speakDenis) await tts.speakDenis(text);
        else if (voice === 'irina' && tts.speakIrina) await tts.speakIrina(text);
        else await tts.speak(text, voice);
      } catch (error) {
        status(`TTS ${voice === 'denis' ? 'Денис' : 'Ирина'}: ${error?.message || error}`);
      }
    });

    $('#novaIrinaDialoguePlay', panel)?.addEventListener('click', async () => {
      const tts = window.NovaRussianTTS;
      if (!tts?.speakDialogue) return status('Диалог Ирина + Денис ещё загружается. Попробуй через несколько секунд.');
      try {
        tts.unlock?.();
        tts.stop?.();
        if (textBox) {
          textBox.value = DIALOGUE_SAMPLE
            .map((turn) => `${turn.voice === 'denis' ? 'Денис' : 'Ирина'}: ${turn.text}`)
            .join('\n');
        }
        status('💬 Диалог: Ирина → Денис → Ирина → Денис → Ирина…');
        await tts.speakDialogue(DIALOGUE_SAMPLE);
        status('✅ Диалог Ирина + Денис завершён.');
      } catch (error) {
        status(`Диалог TTS: ${error?.message || error}`);
      }
    });

    $('#novaIrinaQuickStop', panel)?.addEventListener('click', () => {
      try { window.NovaRussianTTS?.stop?.(); } catch (_) {}
      status('Озвучка остановлена.');
    });
  }

  function ensureTextVideoQuick() {
    const pane = $('#novaProPane');
    if (!pane || $('#novaTextVideoQuick')) return;
    const box = document.createElement('section');
    box.id = 'novaTextVideoQuick';
    box.className = 'nova-text-video-quick';
    box.innerHTML = `
      <h3>✍️ Просто напиши, какое видео хочешь</h3>
      <p>Фото и видео загружать необязательно. Без reference NOVA бесплатно создаст локальный motion-клип с твоим текстом на экране. Если reference загружен — этот текст станет prompt для движения и стиля.</p>
      <textarea id="novaSimpleVideoPrompt" placeholder="Например: Ночной город, дождь, неон, плавное приближение камеры, кинематографический стиль"></textarea>
      <div class="nova-text-video-actions"><button id="novaSimpleVideoCreate" type="button">🎬 Создать 5 сек</button><span>FREE · LOCAL · без платных API</span></div>`;
    const note = $('.nova-media-note', pane);
    (note || pane.firstElementChild)?.insertAdjacentElement('afterend', box);

    const simple = $('#novaSimpleVideoPrompt', box);
    const pro = $('#novaProPrompt');
    simple?.addEventListener('input', () => { if (pro) pro.value = simple.value; });
    pro?.addEventListener('input', () => { if (simple && document.activeElement !== simple) simple.value = pro.value; });
    if (simple && pro?.value) simple.value = pro.value;

    $('#novaSimpleVideoCreate', box)?.addEventListener('click', () => {
      const text = simple?.value?.trim() || '';
      if (!text) return status('Напиши текст: что должно быть в видео.');
      if (pro) {
        pro.value = text;
        pro.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const duration = $('#novaProDuration');
      if (duration) duration.value = '5';
      const render = $('#novaProMotion');
      if (!render) return status('Video PRO ещё загружается.');
      render.click();
    });
  }

  function ensureEditorTools() {
    const pane = $('#novaProPane');
    if (!pane || $('#novaUnifiedEditorTools')) return;
    const tools = document.createElement('div');
    tools.id = 'novaUnifiedEditorTools';
    tools.className = 'nova-unified-editor-tools';
    tools.innerHTML = '<button id="novaEditorTimelineMode" class="active" type="button">🎞 Timeline · 5 сцен</button><button id="novaEditorShortsMode" type="button">📱 Multi Shorts ×5</button>';
    pane.prepend(tools);
    $('#novaEditorTimelineMode', tools)?.addEventListener('click', () => setEditorView('timeline'));
    $('#novaEditorShortsMode', tools)?.addEventListener('click', () => setEditorView('shorts'));
  }

  function setEditorView(view) {
    editorView = view === 'shorts' ? 'shorts' : 'timeline';
    const modal = $('#novaMediaModal');
    if (!modal) return;
    modal.dataset.editorView = editorView;
    $('#novaEditorTimelineMode')?.classList.toggle('active', editorView === 'timeline');
    $('#novaEditorShortsMode')?.classList.toggle('active', editorView === 'shorts');
    if (editorView === 'shorts' && $('[data-media-pane="shorts"]')) selectUnderlying('shorts');
    else selectUnderlying('pro');
    $$('.nova-unified-tab').forEach((button) => button.classList.toggle('active', button.dataset.unifiedTab === 'editor'));
    status(editorView === 'shorts' ? 'Редактор: Multi Shorts ×5.' : 'Редактор: Timeline · 5 сцен.');
  }

  function setActive(tab, options = {}) {
    const modal = $('#novaMediaModal');
    if (!modal) return;
    const next = VALID_TABS.has(tab) ? tab : 'create';
    remember(next);
    modal.dataset.unifiedTab = next;
    modal.dataset.editorView = editorView;
    $$('.nova-unified-tab').forEach((button) => button.classList.toggle('active', button.dataset.unifiedTab === next));

    if (next === 'create') selectUnderlying('pro');
    else if (next === 'editor') setEditorView(editorView);
    else if (next === 'motion') {
      selectUnderlying('unified-motion');
      if (options.loadMotion !== false) loadMotionFrame();
    }
    else if (next === 'audio') selectUnderlying('story');
    else if (next === 'subtitles') selectUnderlying('dub');
    else if (next === 'library') {
      selectUnderlying('library');
      try { window.NovaMediaLibrary?.refresh?.(); } catch (_) {}
    }
  }

  function buildTabs(modal) {
    if ($('#novaUnifiedTabs')) return;
    const card = $('.nova-media-card', modal);
    const legacy = $('.nova-media-tabs', modal);
    if (!card || !legacy) return;

    const note = legacy.previousElementSibling;
    const tabs = document.createElement('div');
    tabs.id = 'novaUnifiedTabs';
    tabs.className = 'nova-unified-tabs';
    tabs.innerHTML = `
      <button class="nova-unified-tab" data-unified-tab="create" type="button">🎬 Создать видео</button>
      <button class="nova-unified-tab" data-unified-tab="editor" type="button">✂️ Редактор</button>
      <button class="nova-unified-tab" data-unified-tab="motion" type="button">✨ Motion+VFX</button>
      <button class="nova-unified-tab" data-unified-tab="audio" type="button">🎙️ Ирина и звук</button>
      <button class="nova-unified-tab" data-unified-tab="subtitles" type="button">💬 Субтитры</button>
      <button class="nova-unified-tab" data-unified-tab="library" type="button">🗂 Медиатека</button>`;
    legacy.insertAdjacentElement('beforebegin', tabs);

    const free = document.createElement('div');
    free.className = 'nova-unified-free';
    free.innerHTML = '<b>FREE LOCK</b><span>Локальные функции без кредитов. Внешний GPU не запускается автоматически.</span>';
    tabs.insertAdjacentElement('afterend', free);

    $$('.nova-unified-tab', tabs).forEach((button) => button.addEventListener('click', () => setActive(button.dataset.unifiedTab)));
    if (note?.classList?.contains('nova-media-note')) note.textContent = 'Единая видеостудия NOVA: создание, монтаж, Motion/VFX, Ирина, субтитры и локальная медиатека в одном окне.';
  }

  function wireLaunchers(modal) {
    const launch = $('#videoStudioBtn');
    if (launch && launch.dataset.novaUnifiedWired !== '1') {
      launch.dataset.novaUnifiedWired = '1';
      launch.addEventListener('click', () => {
        modal.hidden = false;
        setActive(restore(), { loadMotion: false });
      });
    }
    const legacy = $('#novaMediaLaunch');
    if (legacy) legacy.classList.add('nova-hidden-legacy-launch');
  }

  function install() {
    const modal = $('#novaMediaModal');
    if (!modal) return false;
    ensureStyles();
    const title = $('.nova-media-head h2', modal);
    if (title) title.textContent = '🎬 NOVA VIDEO STUDIO';
    buildTabs(modal);
    ensureMotionPane(modal);
    ensureIrinaPanel();
    ensureTextVideoQuick();
    ensureEditorTools();
    wireLaunchers(modal);
    setActive(restore(), { loadMotion: false });
    window.NovaUnifiedVideoStudio = Object.freeze({
      open(tab = 'create') { modal.hidden = false; setActive(tab); },
      select: setActive,
      get activeTab() { return activeTab; }
    });
    return true;
  }

  function boot() {
    if (install()) return;
    const observer = new MutationObserver(() => {
      if (install()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
