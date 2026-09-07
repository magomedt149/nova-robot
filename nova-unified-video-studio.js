(() => {
  'use strict';

  if (window.__novaUnifiedVideoStudioInstalled) return;
  window.__novaUnifiedVideoStudioInstalled = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const ACTIVE_KEY = 'nova.videoStudio.activeTab.v1';
  const VALID_TABS = new Set(['create', '3d', 'editor', 'motion', 'audio', 'subtitles', 'library']);
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
      .nova-unified-tabs{display:grid;grid-template-columns:repeat(7,minmax(124px,1fr));gap:7px;margin:12px 0 14px;overflow-x:auto;padding-bottom:2px;scrollbar-width:none}
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
      .nova-generation-center{position:sticky;bottom:0;z-index:18;margin:12px 0 0;padding:11px;border:1px solid rgba(110,174,255,.24);border-radius:18px;background:rgba(4,10,27,.94);backdrop-filter:blur(18px);box-shadow:0 -10px 35px rgba(0,0,0,.28)}
      .nova-generation-center[hidden]{display:none!important}.nova-generation-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}.nova-generation-head b{font-size:15px}.nova-generation-head span{font-size:10px;color:#7af0c4;border:1px solid rgba(54,232,164,.22);background:rgba(31,201,130,.10);border-radius:999px;padding:4px 7px}
      .nova-generation-jobs{display:grid;gap:9px}.nova-generation-job{border:1px solid rgba(255,255,255,.10);border-radius:15px;padding:10px;background:linear-gradient(135deg,rgba(28,61,118,.20),rgba(58,35,111,.12))}
      .nova-job-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.nova-job-status{font-weight:900;font-size:12px;letter-spacing:.04em}.nova-job-percent{font-size:28px;font-weight:900;line-height:1;color:#dbe9ff}.nova-job-stage{margin-top:4px;font-size:12px;color:#a7bfdf}.nova-job-eta{font-size:11px;color:#88a7d0;margin-top:3px}
      .nova-job-progress{height:7px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.08);margin:9px 0}.nova-job-progress>i{display:block;height:100%;width:0;background:linear-gradient(90deg,#3d8cff,#8f66ff);transition:width .22s ease}
      .nova-job-preview{margin-top:8px;border-radius:13px;overflow:hidden;min-height:96px;background:radial-gradient(circle at 25% 20%,rgba(72,131,255,.26),transparent 40%),#050a18;display:grid;place-items:center}.nova-job-preview img,.nova-job-preview video{width:100%;max-height:220px;object-fit:cover;display:block}.nova-job-preview .nova-job-placeholder{padding:24px;text-align:center;font-size:30px}.nova-job-preview .nova-job-placeholder small{display:block;font-size:11px;color:#91afd6;margin-top:7px}
      .nova-job-meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;font-size:10px;color:#97b1d3}.nova-job-meta span{padding:4px 6px;border-radius:999px;background:rgba(255,255,255,.055)}.nova-job-error{margin-top:8px;padding:8px;border-radius:10px;background:rgba(194,49,69,.12);border:1px solid rgba(255,94,115,.22);color:#ffbec6;font-size:11px}
      .nova-job-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}.nova-job-actions button{border:1px solid rgba(111,166,255,.22);border-radius:10px;background:rgba(255,255,255,.07);color:#edf4ff;padding:8px 10px;font-weight:850}.nova-job-actions button.primary{border:0;background:linear-gradient(135deg,#157bff,#7346ff)}.nova-job-actions button.warn{border-color:rgba(255,145,85,.30);color:#ffd0b1}
      .nova-generation-job[data-state="completed"]{border-color:rgba(66,224,163,.28)}.nova-generation-job[data-state="failed"]{border-color:rgba(255,92,112,.28)}.nova-generation-job[data-state="canceled"]{opacity:.84}
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

  async function currentHybridPhoto() {
    const direct = $('#novaProImageRef')?.files?.[0] || null;
    if (direct) return direct;
    const preview = $('#novaProImagePreview');
    if (!preview?.src || preview.hidden) return null;
    try {
      const response = await fetch(preview.src);
      if (!response.ok) return null;
      const blob = await response.blob();
      if (!String(blob.type || '').startsWith('image/')) return null;
      return new File([blob], 'NOVA_HYBRID_REFERENCE.png', { type: blob.type || 'image/png', lastModified: Date.now() });
    } catch (_) {
      return null;
    }
  }

  function inferHybridMotionMode(prompt) {
    const q = String(prompt || '').toLowerCase();
    if (/\b(run|running|sprint)\b|бег|беж|спринт/.test(q)) return 'run';
    if (/\b(dance|dancing)\b|танц/.test(q)) return 'dance';
    if (/\b(walk|walking|stride|gait)\b|ходьб|ид[её]т|идти|шага/.test(q)) return 'walk';
    if (/motion.?transfer|openpose|скелет|повтор.*движ/.test(q)) return 'motion-reference';
    return 'natural';
  }

  async function pushHybridReferenceToMotion() {
    const frame = $('#novaMotionFrame');
    if (!frame?.contentWindow) return false;
    const file = await currentHybridPhoto();
    if (!file) return false;
    const prompt = $('#novaProPrompt')?.value || $('#novaSimpleVideoPrompt')?.value || '';
    frame.contentWindow.postMessage({
      type: 'NOVA_HYBRID_REFERENCE',
      file,
      prompt,
      motionMode: inferHybridMotionMode(prompt)
    }, location.origin);
    status('✅ Hybrid: фото передано в Motion+VFX. Фон/текст защищаем, человек → image-to-video.');
    return true;
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
      frame.addEventListener('load', () => {
        status('✅ Motion + VFX готов. Локальный режим бесплатный; Remote GPU требует подтверждения.');
        pushHybridReferenceToMotion().catch(() => {});
      }, { once: true });
    } else {
      pushHybridReferenceToMotion().catch(() => {});
    }
  }

  function wireHybridBridge() {
    if (document.documentElement.dataset.novaHybridBridge === '1') return;
    document.documentElement.dataset.novaHybridBridge = '1';
    document.addEventListener('change', event => {
      if (event.target?.id === 'novaProImageRef') pushHybridReferenceToMotion().catch(() => {});
    });
    document.addEventListener('input', event => {
      if (event.target?.id === 'novaProPrompt') pushHybridReferenceToMotion().catch(() => {});
    });
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
      <div class="nova-text-video-actions"><button id="novaSimpleVideoCreate" type="button">🎬 Запустить генерацию</button><span>FREE · LOCAL · 0 кредитов</span></div>`;
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

  const generationJobs = new Map();

  function formatJobEta(seconds) {
    const value = Math.max(0, Number(seconds || 0));
    if (!value) return 'Осталось: почти готово';
    if (value < 60) return `Осталось: ≈ ${Math.max(1, Math.ceil(value))} сек`;
    return `Осталось: ≈ ${Math.ceil(value / 60)} мин`;
  }

  function generationStatusLabel(state) {
    return ({
      preparing: 'ПОДГОТОВКА',
      queued: 'В ОЧЕРЕДИ',
      uploading: 'ЗАГРУЗКА',
      generating: 'СОЗДАЁМ ВИДЕО',
      processing: 'ОБРАБОТКА',
      exporting: 'ЭКСПОРТ MP4',
      validating: 'ПРОВЕРКА',
      completed: 'ГОТОВО ✓',
      failed: 'ОШИБКА',
      canceling: 'ОСТАНАВЛИВАЕМ',
      canceled: 'ОТМЕНЕНО',
      retrying: 'ПОВТОР'
    })[state] || String(state || 'ЗАДАЧА').toUpperCase();
  }

  function currentGenerationPreview() {
    const image = $('#novaProImagePreview');
    if (image?.src && !image.hidden) return { kind: 'image', src: image.src };
    const video = $('#novaProPlayer');
    if (video?.src && !video.hidden) return { kind: 'video', src: video.src };
    return null;
  }

  function ensureGenerationCenter() {
    const pane = $('#novaProPane');
    if (!pane) return null;
    let center = $('#novaGenerationCenter');
    if (center) return center;
    center = document.createElement('section');
    center.id = 'novaGenerationCenter';
    center.className = 'nova-generation-center';
    center.hidden = true;
    center.innerHTML = `
      <div class="nova-generation-head"><b>🎬 Задания NOVA</b><span>FREE · 0 кредитов</span></div>
      <div id="novaGenerationJobs" class="nova-generation-jobs"></div>`;
    const quick = $('#novaTextVideoQuick', pane);
    if (quick) quick.insertAdjacentElement('afterend', center);
    else pane.prepend(center);

    center.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-job-action]');
      if (!button) return;
      const card = button.closest('.nova-generation-job');
      const id = card?.dataset.jobId;
      const action = button.dataset.jobAction;
      if (action === 'cancel') {
        const job = generationJobs.get(id);
        if (job) {
          job.status = 'canceling';
          job.stage = 'Останавливаем генерацию…';
          renderGenerationJob(job);
        }
        $('#novaProStopRender')?.click();
      } else if (action === 'retry') {
        $('#novaProMotion')?.click();
      } else if (action === 'library') {
        setActive('library');
      } else if (action === 'remove') {
        generationJobs.delete(id);
        card?.remove();
        if (!generationJobs.size) center.hidden = true;
      }
    });
    return center;
  }

  function renderGenerationJob(job) {
    const center = ensureGenerationCenter();
    const host = $('#novaGenerationJobs', center || document);
    if (!center || !host || !job?.id) return;
    center.hidden = false;

    let card = host.querySelector(`[data-job-id="${CSS.escape(job.id)}"]`);
    if (!card) {
      card = document.createElement('article');
      card.className = 'nova-generation-job';
      card.dataset.jobId = job.id;
      host.prepend(card);
    }
    card.dataset.state = job.status || 'preparing';

    const progress = Math.max(0, Math.min(100, Number(job.progress ?? 0)));
    const terminal = ['completed', 'failed', 'canceled'].includes(job.status);
    const active = !terminal;
    const preview = job.preview || null;
    const previewHtml = preview?.kind === 'image'
      ? `<img src="${preview.src}" alt="Превью задания NOVA">`
      : preview?.kind === 'video'
        ? `<video src="${preview.src}" muted playsinline preload="metadata"></video>`
        : `<div class="nova-job-placeholder">🎞️<small>Превью появится в процессе генерации</small></div>`;

    const meta = [
      job.duration ? `${job.duration} сек` : '',
      job.ratio || '',
      job.style || '',
      job.cost || '0 кредитов'
    ].filter(Boolean).map((x) => `<span>${String(x).replace(/[<>]/g, '')}</span>`).join('');

    card.innerHTML = `
      <div class="nova-job-top">
        <div><div class="nova-job-status">${generationStatusLabel(job.status)}</div><div class="nova-job-stage">${String(job.stage || '').replace(/[<>]/g, '')}</div><div class="nova-job-eta">${job.status === 'completed' ? 'Сохранено в Медиатеке' : terminal ? '' : formatJobEta(job.etaSeconds)}</div></div>
        <div class="nova-job-percent">${job.status === 'failed' ? '!' : job.status === 'canceled' ? '×' : `${Math.round(progress)}%`}</div>
      </div>
      <div class="nova-job-progress"><i style="width:${progress}%"></i></div>
      <div class="nova-job-preview">${previewHtml}</div>
      <div class="nova-job-meta">${meta}</div>
      ${job.name ? `<div class="nova-job-stage">📄 ${String(job.name).replace(/[<>]/g, '')}</div>` : ''}
      ${job.error ? `<div class="nova-job-error">${String(job.error).replace(/[<>]/g, '')}</div>` : ''}
      <div class="nova-job-actions">
        ${active ? '<button class="warn" type="button" data-job-action="cancel">⏹ Отменить</button>' : ''}
        ${terminal ? '<button type="button" data-job-action="retry">↻ Повторить</button>' : ''}
        ${job.status === 'completed' ? '<button class="primary" type="button" data-job-action="library">🗂 Открыть в Медиатеке</button>' : ''}
        ${terminal ? '<button type="button" data-job-action="remove">Скрыть</button>' : ''}
      </div>`;
  }

  function wireGenerationJobs() {
    ensureGenerationCenter();
    if (document.documentElement.dataset.novaGenerationJobsWired === '1') return;
    document.documentElement.dataset.novaGenerationJobsWired = '1';
    window.addEventListener('nova-video-job', (event) => {
      const next = event.detail || {};
      if (!next.id) return;
      const prev = generationJobs.get(next.id) || {
        id: next.id,
        status: 'preparing',
        progress: 0,
        preview: currentGenerationPreview()
      };
      const merged = { ...prev, ...next };
      if (!merged.preview) merged.preview = currentGenerationPreview();
      generationJobs.set(merged.id, merged);
      renderGenerationJob(merged);
      if (merged.status === 'completed') status('✅ Видео готово и уже находится в Медиатеке.');
      else if (merged.status === 'failed') status(`Ошибка генерации: ${merged.error || 'неизвестная ошибка'}`);
      else if (merged.status === 'canceled') status('Генерация отменена.');
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
    else if (next === '3d') {
      try { window.Nova3DDirector?.ensurePane?.(modal); } catch (_) {}
      selectUnderlying('3d');
      try { window.Nova3DDirector?.refresh?.(); } catch (_) {}
    }
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
      <button class="nova-unified-tab" data-unified-tab="3d" type="button">🧊 3D Director</button>
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
    if (note?.classList?.contains('nova-media-note')) note.textContent = 'Единая видеостудия NOVA: создание, 3D Block/Camera Path, монтаж, Motion/VFX, Ирина, субтитры и локальная медиатека в одном окне.';
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
    try { window.Nova3DDirector?.ensurePane?.(modal); } catch (_) {}
    const title = $('.nova-media-head h2', modal);
    if (title) title.textContent = '🎬 NOVA VIDEO STUDIO';
    buildTabs(modal);
    ensureMotionPane(modal);
    ensureIrinaPanel();
    ensureTextVideoQuick();
    wireGenerationJobs();
    ensureEditorTools();
    wireHybridBridge();
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
