(() => {
  'use strict';

  const $ = (s, root = document) => root.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let youtubeTranscript = '';
  let youtubeTitle = '';
  let currentSpeech = null;

  function injectStyles() {
    if ($('#novaNotebookStyles')) return;
    const style = document.createElement('style');
    style.id = 'novaNotebookStyles';
    style.textContent = `
      .nova-note-modal{position:fixed;inset:0;z-index:99999;display:grid;place-items:end center;background:rgba(2,6,20,.72);backdrop-filter:blur(12px);padding:16px}
      .nova-note-modal[hidden]{display:none}
      .nova-note-card{width:min(720px,100%);max-height:88vh;overflow:auto;border:1px solid rgba(129,190,255,.24);border-radius:28px 28px 18px 18px;background:linear-gradient(180deg,rgba(12,20,46,.98),rgba(5,9,24,.99));box-shadow:0 30px 90px rgba(0,0,0,.55);color:#f5f8ff;padding:18px}
      .nova-note-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.nova-note-head h2{font-size:19px;margin:0}.nova-note-close{border:0;background:rgba(255,255,255,.08);color:#fff;border-radius:50%;width:38px;height:38px;font-size:24px}
      .nova-note-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0 14px}.nova-note-tab{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#dbe8ff;border-radius:14px;padding:11px 8px;font-weight:800}.nova-note-tab.active{background:linear-gradient(135deg,#1c67ff,#6d3cff);color:white;border-color:transparent}
      .nova-note-pane[hidden]{display:none}.nova-note-field{display:grid;gap:7px;margin:10px 0}.nova-note-field label{font-size:13px;color:#aac3ec;font-weight:700}.nova-note-field textarea,.nova-note-field input{width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.14);background:#070d20;color:white;border-radius:16px;padding:13px;font:inherit;outline:none}.nova-note-field textarea{min-height:120px;resize:vertical}.nova-note-field input:focus,.nova-note-field textarea:focus{border-color:#5e91ff;box-shadow:0 0 0 3px rgba(55,118,255,.15)}
      .nova-note-actions{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.nova-note-btn{border:0;border-radius:14px;padding:11px 13px;font-weight:800;background:rgba(255,255,255,.09);color:#fff}.nova-note-btn.primary{background:linear-gradient(135deg,#1479ff,#7a45ff)}.nova-note-btn.good{background:linear-gradient(135deg,#08a66c,#20c997)}.nova-note-btn.warn{background:linear-gradient(135deg,#ff8a18,#ff5a36)}.nova-note-btn:disabled{opacity:.45}
      .nova-note-status{min-height:22px;margin:8px 0;color:#9fc0ef;font-size:13px}.nova-note-result{white-space:pre-wrap;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:13px;min-height:74px;line-height:1.5}.nova-note-meta{font-size:12px;color:#8aa5cf;margin-top:8px}.nova-note-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(90,153,255,.3);background:rgba(45,104,255,.12);border-radius:999px;padding:5px 9px;font-size:12px;color:#cfe2ff}
      @media(min-width:740px){.nova-note-modal{place-items:center}.nova-note-card{border-radius:28px}}
    `;
    document.head.appendChild(style);
  }

  function buildModal() {
    if ($('#novaNotebookModal')) return;
    const modal = document.createElement('section');
    modal.id = 'novaNotebookModal';
    modal.className = 'nova-note-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="nova-note-card" role="dialog" aria-modal="true" aria-label="NOVA Notebook">
        <div class="nova-note-head"><h2>🎧 NOVA Notebook</h2><button class="nova-note-close" id="novaNoteClose" type="button">×</button></div>
        <div class="nova-note-tabs"><button class="nova-note-tab active" data-note-tab="translate" type="button">🌐 EN → RU + TTS</button><button class="nova-note-tab" data-note-tab="youtube" type="button">▶ YouTube пересказ</button></div>

        <div class="nova-note-pane" data-note-pane="translate">
          <div class="nova-note-field"><label for="novaEnglishText">Английский текст или голос</label><textarea id="novaEnglishText" placeholder="Type English text here… или нажми 🎙️"></textarea></div>
          <div class="nova-note-actions"><button class="nova-note-btn" id="novaListenEnglish" type="button">🎙️ Слушать английский</button><button class="nova-note-btn primary" id="novaTranslateBtn" type="button">Перевести на русский</button><button class="nova-note-btn good" id="novaSpeakRussian" type="button">🔊 Озвучить по-русски</button><button class="nova-note-btn" id="novaStopSpeech" type="button">⏹ Стоп</button></div>
          <div class="nova-note-status" id="novaTranslateStatus"></div>
          <div class="nova-note-result" id="novaRussianText">Здесь появится русский перевод.</div>
          <div class="nova-note-meta">Перевод: бесплатный режим. Озвучка: TTS голос устройства, русский язык.</div>
        </div>

        <div class="nova-note-pane" data-note-pane="youtube" hidden>
          <div class="nova-note-field"><label for="novaYoutubeUrl">Ссылка на публичный YouTube</label><input id="novaYoutubeUrl" inputmode="url" placeholder="https://youtube.com/watch?v=…"></div>
          <div class="nova-note-actions"><button class="nova-note-btn primary" id="novaGetTranscript" type="button">1. Получить текст</button><button class="nova-note-btn warn" id="novaMakeRecap" type="button">2. Сделать RU аудиопересказ</button><button class="nova-note-btn good" id="novaPlayRecap" type="button">▶ Слушать пересказ</button><button class="nova-note-btn" id="novaStopRecap" type="button">⏹ Стоп</button></div>
          <div class="nova-note-status" id="novaYoutubeStatus"></div>
          <div class="nova-note-meta" id="novaYoutubeMeta"></div>
          <div class="nova-note-result" id="novaYoutubeResult">Вставь ссылку. NOVA возьмёт доступные субтитры YouTube, выделит главное, переведёт на русский и озвучит через TTS.</div>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  function addLaunchButtons() {
    const quick = $('#quickActions');
    if (!quick || $('#novaNotebookLaunch')) return;
    const translator = document.createElement('button');
    translator.id = 'novaTranslatorLaunch';
    translator.className = 'action-btn';
    translator.type = 'button';
    translator.innerHTML = '<span>🌐</span><b>Перевод</b>';
    translator.addEventListener('click', () => openModal('translate'));

    const notebook = document.createElement('button');
    notebook.id = 'novaNotebookLaunch';
    notebook.className = 'action-btn';
    notebook.type = 'button';
    notebook.innerHTML = '<span>🎧</span><b>YouTube</b>';
    notebook.addEventListener('click', () => openModal('youtube'));
    quick.append(translator, notebook);
  }

  function openModal(tab) {
    const modal = $('#novaNotebookModal');
    modal.hidden = false;
    selectTab(tab);
  }

  function selectTab(name) {
    document.querySelectorAll('[data-note-tab]').forEach((b) => b.classList.toggle('active', b.dataset.noteTab === name));
    document.querySelectorAll('[data-note-pane]').forEach((p) => { p.hidden = p.dataset.notePane !== name; });
  }

  async function translateText(text) {
    const clean = String(text || '').trim();
    if (!clean) throw new Error('Нет текста для перевода.');

    // Use the browser's built-in Translator API first when available.
    try {
      if (window.Translator?.create) {
        const translator = await window.Translator.create({ sourceLanguage: 'en', targetLanguage: 'ru' });
        return await translator.translate(clean);
      }
    } catch (_) {}

    const response = await fetch('/.netlify/functions/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean, from: 'en', to: 'ru' })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || 'Перевод временно недоступен.');
    return data.translatedText;
  }

  function speakRussian(text) {
    const clean = String(text || '').trim();
    if (!clean || clean === 'Здесь появится русский перевод.') return;
    stopSpeech();
    const utter = new SpeechSynthesisUtterance(clean);
    utter.lang = 'ru-RU';
    utter.rate = 0.94;
    utter.pitch = 1;
    const voices = speechSynthesis.getVoices();
    const ru = voices.find((v) => /^ru[-_]/i.test(v.lang)) || voices.find((v) => /Russian|Рус/i.test(v.name));
    if (ru) utter.voice = ru;
    currentSpeech = utter;
    speechSynthesis.speak(utter);
  }

  function stopSpeech() {
    currentSpeech = null;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  function startEnglishRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const status = $('#novaTranslateStatus');
    if (!Recognition) {
      status.textContent = 'На этом браузере распознавание голоса недоступно. Можно вставить английский текст вручную.';
      return;
    }
    const recognition = new Recognition();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    let finalText = '';
    recognition.onstart = () => { status.textContent = '🎙️ Слушаю английскую речь…'; };
    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += piece + ' '; else interim += piece;
      }
      $('#novaEnglishText').value = (finalText + interim).trim();
    };
    recognition.onerror = (e) => { status.textContent = `Ошибка микрофона: ${e.error || 'unknown'}`; };
    recognition.onend = () => { status.textContent = finalText ? 'Английская речь распознана. Нажми «Перевести на русский».' : 'Готово.'; };
    recognition.start();
  }

  function sentenceSplit(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) || [];
  }

  function makeExtractiveSummary(text, target = 8) {
    const sentences = sentenceSplit(text).filter((s) => s.length > 35);
    if (sentences.length <= target) return sentences.join(' ');
    const stop = new Set('the a an and or but if then than that this these those is are was were be been being to of in on for from with as by at it its i you he she they we my your our their his her not no do does did have has had can could would should will just about into over after before during how what when where why who whom which there here also very more most some any all each other such only own same so too'.split(' '));
    const freq = new Map();
    for (const word of text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []) {
      if (!stop.has(word)) freq.set(word, (freq.get(word) || 0) + 1);
    }
    const scored = sentences.map((sentence, index) => {
      const words = sentence.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || [];
      const raw = words.reduce((sum, w) => sum + (freq.get(w) || 0), 0);
      const lengthPenalty = Math.max(1, Math.sqrt(words.length || 1));
      const positionBoost = index < 3 ? 1.2 : 1;
      return { sentence, index, score: (raw / lengthPenalty) * positionBoost };
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, Math.min(target, sentences.length)).sort((a, b) => a.index - b.index).map((x) => x.sentence).join(' ');
  }

  async function loadYoutubeTranscript() {
    const url = $('#novaYoutubeUrl').value.trim();
    const status = $('#novaYoutubeStatus');
    const result = $('#novaYoutubeResult');
    if (!url) { status.textContent = 'Вставь ссылку YouTube.'; return; }
    status.textContent = 'Получаю доступные субтитры YouTube…';
    result.textContent = 'Загрузка…';
    try {
      const response = await fetch('/.netlify/functions/youtube-transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Не удалось получить расшифровку.');
      youtubeTranscript = data.transcript || '';
      youtubeTitle = data.title || 'YouTube video';
      $('#novaYoutubeMeta').innerHTML = `<span class="nova-note-chip">${escapeHtml(data.language || 'unknown')}</span> ${escapeHtml(youtubeTitle)}${data.isAutoGenerated ? ' · авто-субтитры' : ''}`;
      result.textContent = youtubeTranscript.slice(0, 2600) + (youtubeTranscript.length > 2600 ? '…' : '');
      status.textContent = `Текст получен: ${youtubeTranscript.length.toLocaleString('ru-RU')} символов. Теперь нажми «Сделать RU аудиопересказ».`;
    } catch (error) {
      youtubeTranscript = '';
      result.textContent = error.message;
      status.textContent = 'Не получилось получить субтитры.';
    }
  }

  async function makeRussianRecap() {
    const status = $('#novaYoutubeStatus');
    const result = $('#novaYoutubeResult');
    if (!youtubeTranscript) {
      await loadYoutubeTranscript();
      if (!youtubeTranscript) return;
    }
    try {
      status.textContent = 'Выделяю главное из ролика…';
      const englishSummary = makeExtractiveSummary(youtubeTranscript, youtubeTranscript.length > 12000 ? 10 : 7);
      await sleep(120);
      status.textContent = 'Перевожу пересказ на русский…';
      const russian = await translateText(englishSummary);
      result.textContent = russian;
      result.dataset.recap = russian;
      status.textContent = '✅ Русский пересказ готов. Запускаю TTS.';
      speakRussian(russian);
    } catch (error) {
      result.textContent = error.message;
      status.textContent = 'Ошибка при создании пересказа.';
    }
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
  }

  function bind() {
    $('#novaNoteClose')?.addEventListener('click', () => { $('#novaNotebookModal').hidden = true; stopSpeech(); });
    $('#novaNotebookModal')?.addEventListener('click', (e) => { if (e.target.id === 'novaNotebookModal') { e.currentTarget.hidden = true; stopSpeech(); } });
    document.querySelectorAll('[data-note-tab]').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.noteTab)));

    $('#novaListenEnglish')?.addEventListener('click', startEnglishRecognition);
    $('#novaTranslateBtn')?.addEventListener('click', async () => {
      const status = $('#novaTranslateStatus');
      const result = $('#novaRussianText');
      const text = $('#novaEnglishText').value;
      try {
        status.textContent = 'Перевожу EN → RU…';
        const translated = await translateText(text);
        result.textContent = translated;
        status.textContent = '✅ Перевод готов.';
      } catch (error) { status.textContent = error.message; }
    });
    $('#novaSpeakRussian')?.addEventListener('click', () => speakRussian($('#novaRussianText').textContent));
    $('#novaStopSpeech')?.addEventListener('click', stopSpeech);
    $('#novaGetTranscript')?.addEventListener('click', loadYoutubeTranscript);
    $('#novaMakeRecap')?.addEventListener('click', makeRussianRecap);
    $('#novaPlayRecap')?.addEventListener('click', () => speakRussian($('#novaYoutubeResult').dataset.recap || $('#novaYoutubeResult').textContent));
    $('#novaStopRecap')?.addEventListener('click', stopSpeech);
  }

  function init() {
    injectStyles();
    buildModal();
    addLaunchButtons();
    bind();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
