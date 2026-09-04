(() => {
  'use strict';

  const $ = (s, root = document) => root.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const LANGUAGES = [
    { code: 'en', locale: 'en-US', label: '🇺🇸 English' },
    { code: 'ru', locale: 'ru-RU', label: '🇷🇺 Русский' },
    { code: 'es', locale: 'es-ES', label: '🇪🇸 Español' },
    { code: 'fr', locale: 'fr-FR', label: '🇫🇷 Français' },
    { code: 'de', locale: 'de-DE', label: '🇩🇪 Deutsch' },
    { code: 'it', locale: 'it-IT', label: '🇮🇹 Italiano' },
    { code: 'pt', locale: 'pt-BR', label: '🇧🇷 Português' },
    { code: 'tr', locale: 'tr-TR', label: '🇹🇷 Türkçe' },
    { code: 'uk', locale: 'uk-UA', label: '🇺🇦 Українська' },
    { code: 'pl', locale: 'pl-PL', label: '🇵🇱 Polski' },
    { code: 'ar', locale: 'ar-SA', label: '🇸🇦 العربية' },
    { code: 'hi', locale: 'hi-IN', label: '🇮🇳 हिन्दी' },
    { code: 'zh-CN', locale: 'zh-CN', label: '🇨🇳 中文' },
    { code: 'ja', locale: 'ja-JP', label: '🇯🇵 日本語' },
    { code: 'ko', locale: 'ko-KR', label: '🇰🇷 한국어' }
  ];

  let youtubeTranscript = '';
  let youtubeTitle = '';
  let youtubeSourceLanguage = 'en';
  let currentSpeech = null;
  let availableVoices = [];

  function languageByCode(code) {
    const clean = normalizeLangCode(code);
    return LANGUAGES.find((item) => normalizeLangCode(item.code) === clean) || LANGUAGES[0];
  }

  function normalizeLangCode(code) {
    const value = String(code || 'en').trim().toLowerCase().replace('_', '-');
    if (value.startsWith('zh')) return 'zh-cn';
    return value.split('-')[0];
  }

  function languageOptions(selected) {
    return LANGUAGES.map((lang) => `<option value="${lang.code}"${lang.code === selected ? ' selected' : ''}>${lang.label}</option>`).join('');
  }

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
      .nova-note-pane[hidden]{display:none}.nova-note-field{display:grid;gap:7px;margin:10px 0}.nova-note-field label{font-size:13px;color:#aac3ec;font-weight:700}.nova-note-field textarea,.nova-note-field input,.nova-note-field select,.nova-note-select{width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.14);background:#070d20;color:white;border-radius:16px;padding:13px;font:inherit;outline:none;min-height:46px}.nova-note-field textarea{min-height:120px;resize:vertical}.nova-note-field input:focus,.nova-note-field textarea:focus,.nova-note-field select:focus,.nova-note-select:focus{border-color:#5e91ff;box-shadow:0 0 0 3px rgba(55,118,255,.15)}
      .nova-note-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.nova-note-grid.voice-grid{grid-template-columns:1fr}.nova-note-field.compact{margin:5px 0}.nova-note-field.compact label{font-size:12px}.nova-note-field.compact select{padding:10px 12px;border-radius:13px}
      .nova-note-actions{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.nova-note-btn{border:0;border-radius:14px;padding:11px 13px;font-weight:800;background:rgba(255,255,255,.09);color:#fff}.nova-note-btn.primary{background:linear-gradient(135deg,#1479ff,#7a45ff)}.nova-note-btn.good{background:linear-gradient(135deg,#08a66c,#20c997)}.nova-note-btn.warn{background:linear-gradient(135deg,#ff8a18,#ff5a36)}.nova-note-btn:disabled{opacity:.45}
      .nova-note-status{min-height:22px;margin:8px 0;color:#9fc0ef;font-size:13px}.nova-note-result{white-space:pre-wrap;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:13px;min-height:74px;line-height:1.5}.nova-note-meta{font-size:12px;color:#8aa5cf;margin-top:8px}.nova-note-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(90,153,255,.3);background:rgba(45,104,255,.12);border-radius:999px;padding:5px 9px;font-size:12px;color:#cfe2ff}
      @media(max-width:520px){.nova-note-grid{grid-template-columns:1fr}.nova-note-tabs{grid-template-columns:1fr}}
      @media(min-width:740px){.nova-note-modal{place-items:center}.nova-note-card{border-radius:28px}.nova-note-grid.voice-grid{grid-template-columns:1fr 1fr}}
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
        <div class="nova-note-tabs"><button class="nova-note-tab active" data-note-tab="translate" type="button">🌐 Перевод + TTS</button><button class="nova-note-tab" data-note-tab="youtube" type="button">▶ YouTube пересказ</button></div>

        <div class="nova-note-pane" data-note-pane="translate">
          <div class="nova-note-grid">
            <div class="nova-note-field compact"><label for="novaSourceLanguage">С языка</label><select id="novaSourceLanguage">${languageOptions('en')}</select></div>
            <div class="nova-note-field compact"><label for="novaTargetLanguage">На язык</label><select id="novaTargetLanguage">${languageOptions('ru')}</select></div>
          </div>
          <div class="nova-note-field"><label for="novaEnglishText">Текст или голос</label><textarea id="novaEnglishText" placeholder="Напиши текст или нажми 🎙️"></textarea></div>
          <div class="nova-note-field compact"><label for="novaTranslateVoice">Голос озвучивания</label><select id="novaTranslateVoice"><option value="">Авто — лучший доступный голос</option></select></div>
          <div class="nova-note-actions"><button class="nova-note-btn" id="novaListenEnglish" type="button">🎙️ Слушать речь</button><button class="nova-note-btn primary" id="novaTranslateBtn" type="button">Перевести</button><button class="nova-note-btn good" id="novaSpeakRussian" type="button">🔊 Озвучить перевод</button><button class="nova-note-btn" id="novaStopSpeech" type="button">⏹ Стоп</button></div>
          <div class="nova-note-status" id="novaTranslateStatus"></div>
          <div class="nova-note-result" id="novaRussianText">Здесь появится перевод.</div>
          <div class="nova-note-meta">Перевод работает без платного API. Голоса берутся из TTS, доступного на твоём устройстве.</div>
        </div>

        <div class="nova-note-pane" data-note-pane="youtube" hidden>
          <div class="nova-note-field"><label for="novaYoutubeUrl">Ссылка на публичный YouTube</label><input id="novaYoutubeUrl" inputmode="url" placeholder="https://youtube.com/watch?v=…"></div>
          <div class="nova-note-grid voice-grid">
            <div class="nova-note-field compact"><label for="novaYoutubeTargetLanguage">Язык пересказа</label><select id="novaYoutubeTargetLanguage">${languageOptions('ru')}</select></div>
            <div class="nova-note-field compact"><label for="novaYoutubeVoice">Голос пересказа</label><select id="novaYoutubeVoice"><option value="">Авто — лучший доступный голос</option></select></div>
          </div>
          <div class="nova-note-actions"><button class="nova-note-btn primary" id="novaGetTranscript" type="button">1. Получить текст</button><button class="nova-note-btn warn" id="novaMakeRecap" type="button">2. Сделать пересказ</button><button class="nova-note-btn good" id="novaPlayRecap" type="button">▶ Слушать пересказ</button><button class="nova-note-btn" id="novaStopRecap" type="button">⏹ Стоп</button></div>
          <div class="nova-note-status" id="novaYoutubeStatus"></div>
          <div class="nova-note-meta" id="novaYoutubeMeta"></div>
          <div class="nova-note-result" id="novaYoutubeResult">Вставь ссылку. NOVA возьмёт доступные субтитры YouTube, выделит главное, переведёт на выбранный язык и озвучит выбранным TTS-голосом.</div>
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
    refreshAllVoiceLists();
  }

  function selectTab(name) {
    document.querySelectorAll('[data-note-tab]').forEach((b) => b.classList.toggle('active', b.dataset.noteTab === name));
    document.querySelectorAll('[data-note-pane]').forEach((p) => { p.hidden = p.dataset.notePane !== name; });
  }

  async function translateText(text, from = 'en', to = 'ru') {
    const clean = String(text || '').trim();
    if (!clean) throw new Error('Нет текста для перевода.');
    const source = String(from || 'en');
    const target = String(to || 'ru');
    if (normalizeLangCode(source) === normalizeLangCode(target)) return clean;

    try {
      if (window.Translator?.create) {
        const translator = await window.Translator.create({ sourceLanguage: source, targetLanguage: target });
        return await translator.translate(clean);
      }
    } catch (_) {}

    const response = await fetch('./.netlify/functions/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean, from: source, to: target })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || 'Перевод временно недоступен.');
    return data.translatedText;
  }

  function loadVoices() {
    if (!('speechSynthesis' in window)) return [];
    availableVoices = speechSynthesis.getVoices() || [];
    return availableVoices;
  }

  function voiceKey(voice) {
    return voice.voiceURI || `${voice.name}|${voice.lang}`;
  }

  function populateVoiceSelect(selectId, languageCode) {
    const select = $(selectId);
    if (!select) return;
    const previous = select.value;
    const lang = languageByCode(languageCode);
    const target = normalizeLangCode(lang.locale);
    const voices = loadVoices();
    const matching = voices.filter((voice) => normalizeLangCode(voice.lang) === target);
    const list = matching.length ? matching : voices;

    select.innerHTML = '<option value="">Авто — лучший доступный голос</option>';
    list.forEach((voice) => {
      const option = document.createElement('option');
      option.value = voiceKey(voice);
      option.textContent = `${voice.name} — ${voice.lang}${voice.localService ? ' · устройство' : ''}`;
      select.appendChild(option);
    });

    if (previous && [...select.options].some((option) => option.value === previous)) select.value = previous;
  }

  function refreshAllVoiceLists() {
    populateVoiceSelect('#novaTranslateVoice', $('#novaTargetLanguage')?.value || 'ru');
    populateVoiceSelect('#novaYoutubeVoice', $('#novaYoutubeTargetLanguage')?.value || 'ru');
  }

  function findVoice(selectId, languageCode) {
    const select = $(selectId);
    const voices = loadVoices();
    if (select?.value) {
      const exact = voices.find((voice) => voiceKey(voice) === select.value);
      if (exact) return exact;
    }
    const target = normalizeLangCode(languageByCode(languageCode).locale);
    return voices.find((voice) => normalizeLangCode(voice.lang) === target) || null;
  }

  function speakText(text, languageCode, voiceSelectId) {
    const clean = String(text || '').trim();
    if (!clean || clean === 'Здесь появится перевод.') return;
    if (!('speechSynthesis' in window)) return;
    stopSpeech();
    const lang = languageByCode(languageCode);
    const utter = new SpeechSynthesisUtterance(clean);
    utter.lang = lang.locale;
    utter.rate = 0.94;
    utter.pitch = 1;
    const voice = findVoice(voiceSelectId, languageCode);
    if (voice) utter.voice = voice;
    currentSpeech = utter;
    speechSynthesis.speak(utter);
  }

  function stopSpeech() {
    currentSpeech = null;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  function startSpeechRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const status = $('#novaTranslateStatus');
    if (!Recognition) {
      status.textContent = 'На этом браузере распознавание голоса недоступно. Можно вставить текст вручную.';
      return;
    }
    const sourceCode = $('#novaSourceLanguage')?.value || 'en';
    const recognition = new Recognition();
    recognition.lang = languageByCode(sourceCode).locale;
    recognition.interimResults = true;
    recognition.continuous = false;
    let finalText = '';
    recognition.onstart = () => { status.textContent = `🎙️ Слушаю: ${languageByCode(sourceCode).label}…`; };
    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += piece + ' '; else interim += piece;
      }
      $('#novaEnglishText').value = (finalText + interim).trim();
    };
    recognition.onerror = (e) => { status.textContent = `Ошибка микрофона: ${e.error || 'unknown'}`; };
    recognition.onend = () => { status.textContent = finalText ? 'Речь распознана. Нажми «Перевести».' : 'Готово.'; };
    recognition.start();
  }

  function sentenceSplit(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g)?.map((s) => s.trim()).filter(Boolean) || [];
  }

  function tokenize(text) {
    try { return String(text || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]{1,}/gu) || []; }
    catch (_) { return String(text || '').toLowerCase().match(/[a-z0-9][a-z0-9'-]{1,}/g) || []; }
  }

  function makeExtractiveSummary(text, target = 8) {
    const sentences = sentenceSplit(text).filter((s) => s.length > 30);
    if (sentences.length <= target) return sentences.join(' ');
    const stop = new Set('the a an and or but if then than that this these those is are was were be been being to of in on for from with as by at it its i you he she they we my your our their his her not no do does did have has had can could would should will just about into over after before during how what when where why who whom which there here also very more most some any all each other such only own same so too'.split(' '));
    const freq = new Map();
    for (const word of tokenize(text)) {
      if (!stop.has(word)) freq.set(word, (freq.get(word) || 0) + 1);
    }
    const scored = sentences.map((sentence, index) => {
      const words = tokenize(sentence);
      const raw = words.reduce((sum, word) => sum + (freq.get(word) || 0), 0);
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
      const response = await fetch('./.netlify/functions/youtube-transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Не удалось получить расшифровку.');
      youtubeTranscript = data.transcript || '';
      youtubeTitle = data.title || 'YouTube video';
      youtubeSourceLanguage = data.language || 'en';
      $('#novaYoutubeMeta').innerHTML = `<span class="nova-note-chip">${escapeHtml(youtubeSourceLanguage || 'unknown')}</span> ${escapeHtml(youtubeTitle)}${data.isAutoGenerated ? ' · авто-субтитры' : ''}`;
      result.textContent = youtubeTranscript.slice(0, 2600) + (youtubeTranscript.length > 2600 ? '…' : '');
      status.textContent = `Текст получен: ${youtubeTranscript.length.toLocaleString('ru-RU')} символов. Выбери язык и голос, затем нажми «Сделать пересказ».`;
    } catch (error) {
      youtubeTranscript = '';
      result.textContent = error.message;
      status.textContent = 'Не получилось получить субтитры.';
    }
  }

  async function makeYoutubeRecap() {
    const status = $('#novaYoutubeStatus');
    const result = $('#novaYoutubeResult');
    if (!youtubeTranscript) {
      await loadYoutubeTranscript();
      if (!youtubeTranscript) return;
    }
    try {
      const targetLanguage = $('#novaYoutubeTargetLanguage')?.value || 'ru';
      status.textContent = 'Выделяю главное из ролика…';
      const summary = makeExtractiveSummary(youtubeTranscript, youtubeTranscript.length > 12000 ? 10 : 7);
      await sleep(120);
      status.textContent = `Перевожу пересказ: ${languageByCode(targetLanguage).label}…`;
      const translated = await translateText(summary, youtubeSourceLanguage || 'en', targetLanguage);
      result.textContent = translated;
      result.dataset.recap = translated;
      result.dataset.recapLanguage = targetLanguage;
      status.textContent = `✅ Пересказ готов: ${languageByCode(targetLanguage).label}. Запускаю выбранный голос.`;
      speakText(translated, targetLanguage, '#novaYoutubeVoice');
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
    document.querySelectorAll('[data-note-tab]').forEach((button) => button.addEventListener('click', () => selectTab(button.dataset.noteTab)));

    $('#novaSourceLanguage')?.addEventListener('change', () => {
      $('#novaTranslateStatus').textContent = `Язык распознавания: ${languageByCode($('#novaSourceLanguage').value).label}`;
    });
    $('#novaTargetLanguage')?.addEventListener('change', () => {
      populateVoiceSelect('#novaTranslateVoice', $('#novaTargetLanguage').value);
    });
    $('#novaYoutubeTargetLanguage')?.addEventListener('change', () => {
      populateVoiceSelect('#novaYoutubeVoice', $('#novaYoutubeTargetLanguage').value);
      const result = $('#novaYoutubeResult');
      if (result) delete result.dataset.recap;
    });

    $('#novaListenEnglish')?.addEventListener('click', startSpeechRecognition);
    $('#novaTranslateBtn')?.addEventListener('click', async () => {
      const status = $('#novaTranslateStatus');
      const result = $('#novaRussianText');
      const text = $('#novaEnglishText').value;
      const from = $('#novaSourceLanguage')?.value || 'en';
      const to = $('#novaTargetLanguage')?.value || 'ru';
      try {
        status.textContent = `Перевожу ${languageByCode(from).label} → ${languageByCode(to).label}…`;
        const translated = await translateText(text, from, to);
        result.textContent = translated;
        result.dataset.language = to;
        status.textContent = '✅ Перевод готов.';
      } catch (error) { status.textContent = error.message; }
    });
    $('#novaSpeakRussian')?.addEventListener('click', () => {
      const result = $('#novaRussianText');
      const language = result.dataset.language || $('#novaTargetLanguage')?.value || 'ru';
      speakText(result.textContent, language, '#novaTranslateVoice');
    });
    $('#novaStopSpeech')?.addEventListener('click', stopSpeech);
    $('#novaGetTranscript')?.addEventListener('click', loadYoutubeTranscript);
    $('#novaMakeRecap')?.addEventListener('click', makeYoutubeRecap);
    $('#novaPlayRecap')?.addEventListener('click', () => {
      const result = $('#novaYoutubeResult');
      const language = result.dataset.recapLanguage || $('#novaYoutubeTargetLanguage')?.value || 'ru';
      speakText(result.dataset.recap || result.textContent, language, '#novaYoutubeVoice');
    });
    $('#novaStopRecap')?.addEventListener('click', stopSpeech);
  }

  function initVoiceUpdates() {
    loadVoices();
    refreshAllVoiceLists();
    if ('speechSynthesis' in window) {
      if (typeof speechSynthesis.addEventListener === 'function') {
        speechSynthesis.addEventListener('voiceschanged', refreshAllVoiceLists);
      } else {
        const previous = speechSynthesis.onvoiceschanged;
        speechSynthesis.onvoiceschanged = (event) => {
          if (typeof previous === 'function') previous.call(speechSynthesis, event);
          refreshAllVoiceLists();
        };
      }
      setTimeout(refreshAllVoiceLists, 300);
      setTimeout(refreshAllVoiceLists, 1200);
    }
  }

  function init() {
    injectStyles();
    buildModal();
    addLaunchButtons();
    bind();
    initVoiceUpdates();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
