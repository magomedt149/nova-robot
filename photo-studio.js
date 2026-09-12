(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const modal = $('#photoStudioModal');
  const launch = $('#photoStudioBtn');
  if (!modal || !launch) return;

  const close = $('#photoStudioClose');
  const upload = $('#photoUpload');
  const input = $('#photoInput');
  const image = $('#photoPreview');
  const style = $('#styleSelect');
  const outfit = $('#outfitSelect');
  const background = $('#backgroundSelect');
  const generate = $('#photoGenerate');
  const reset = $('#photoReset');
  const result = $('#photoStudioResult');

  const classes = [
    'style-cinematic', 'style-anime', 'style-western', 'style-bw',
    'bg-studio', 'bg-city', 'bg-space', 'bg-white', 'bg-beach',
    'outfit-suit', 'outfit-western', 'outfit-sport', 'outfit-swimwear'
  ];

  let recognition = null;
  let listening = false;

  function injectVoiceControls() {
    if ($('#studioVoiceRow')) return;

    const voiceRow = document.createElement('div');
    voiceRow.id = 'studioVoiceRow';
    voiceRow.className = 'studio-voice-row';
    voiceRow.innerHTML = `
      <input id="studioCommand" type="text" maxlength="180"
        placeholder="Скажи: надень костюм и поставь фон Голливуд">
      <button id="studioMic" type="button" aria-label="Голосовая команда" aria-pressed="false">🎤</button>
      <button id="studioApplyCommand" type="button">Выполнить</button>
    `;

    const controls = $('.studio-controls', modal);
    controls.insertAdjacentElement('beforebegin', voiceRow);

    if (!$('#adultConfirm')) {
      const consent = document.createElement('label');
      consent.className = 'studio-adult-confirm';
      consent.innerHTML = '<input id="adultConfirm" type="checkbox"> Подтверждаю: на фото взрослый человек 18+ и у меня есть разрешение на обработку.';
      controls.insertAdjacentElement('afterend', consent);
    }

    const styleTag = document.createElement('style');
    styleTag.textContent = `
      .studio-voice-row{display:grid;grid-template-columns:minmax(0,1fr) 48px auto;gap:8px;margin:12px 0}
      .studio-voice-row input{min-width:0;border:1px solid rgba(255,255,255,.18);border-radius:14px;padding:12px 14px;background:rgba(4,8,24,.78);color:#fff;font:inherit}
      .studio-voice-row button{border:0;border-radius:14px;padding:0 14px;min-height:46px;font-weight:800;cursor:pointer}
      #studioMic{font-size:20px;background:linear-gradient(135deg,#6d5dfc,#17c3ff);color:#fff}
      #studioMic.is-listening{animation:studioPulse 1s infinite;box-shadow:0 0 0 8px rgba(23,195,255,.14)}
      #studioApplyCommand{background:linear-gradient(135deg,#f3b63f,#ff7d45);color:#111}
      .studio-adult-confirm{display:none;margin:10px 0;padding:10px 12px;border-radius:12px;background:rgba(255,185,64,.12);font-size:13px;line-height:1.35}
      .studio-adult-confirm.is-visible{display:block}
      @keyframes studioPulse{50%{transform:scale(1.05)}}
      @media(max-width:620px){.studio-voice-row{grid-template-columns:1fr 48px}.studio-voice-row #studioApplyCommand{grid-column:1/-1;min-height:44px}}
    `;
    document.head.appendChild(styleTag);

    $('#studioApplyCommand').addEventListener('click', () => runCommand($('#studioCommand').value));
    $('#studioCommand').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') runCommand(event.currentTarget.value);
    });
    $('#studioMic').addEventListener('click', toggleVoiceRecognition);
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ru-RU';
    utterance.rate = 0.96;
    window.speechSynthesis.speak(utterance);
  }

  function setResult(text, shouldSpeak = false) {
    result.textContent = text;
    if (shouldSpeak) speak(text);
  }

  function openStudio() {
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    injectVoiceControls();
  }

  function closeStudio() {
    stopRecognition();
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  function usesAdultMode() {
    return outfit.value === 'swimwear';
  }

  function updateAdultConfirm() {
    const wrapper = $('.studio-adult-confirm');
    if (wrapper) wrapper.classList.toggle('is-visible', usesAdultMode());
  }

  function applyPreview() {
    upload.classList.remove(...classes);
    if (style.value !== 'none') upload.classList.add(`style-${style.value}`);
    if (background.value !== 'none') upload.classList.add(`bg-${background.value}`);
    if (outfit.value !== 'none') upload.classList.add(`outfit-${outfit.value}`);
    updateAdultConfirm();
  }

  function clearStudio() {
    input.value = '';
    image.removeAttribute('src');
    upload.classList.remove('has-photo', ...classes);
    style.value = 'none';
    outfit.value = 'none';
    background.value = 'none';
    const adultConfirm = $('#adultConfirm');
    if (adultConfirm) adultConfirm.checked = false;
    const command = $('#studioCommand');
    if (command) command.value = '';
    updateAdultConfirm();
    setResult('Загрузи фотографию. Обработка выполняется только на устройстве и никуда не отправляется.');
  }

  function selectFromCommand(text) {
    const command = text.toLowerCase().trim();
    const changed = [];

    if (/костюм|делов|business|suit/.test(command)) { outfit.value = 'suit'; changed.push('деловой костюм'); }
    else if (/ковбой|western/.test(command)) { outfit.value = 'western'; changed.push('ковбойский стиль'); }
    else if (/спорт|sport/.test(command)) { outfit.value = 'sport'; changed.push('спортивный образ'); }
    else if (/купальник|пляжн(ый|ом) образ|swimwear/.test(command)) { outfit.value = 'swimwear'; changed.push('пляжный образ'); }

    if (/аниме|anime/.test(command)) { style.value = 'anime'; changed.push('аниме'); }
    else if (/ч[её]рно.?бел|black.?white|noir/.test(command)) { style.value = 'bw'; changed.push('чёрно-белый стиль'); }
    else if (/вестерн|western/.test(command)) { style.value = 'western'; changed.push('вестерн'); }
    else if (/кино|cinematic|голливуд/.test(command)) { style.value = 'cinematic'; changed.push('кинематографический стиль'); }

    if (/космос|space/.test(command)) { background.value = 'space'; changed.push('космический фон'); }
    else if (/ночн(ой|ый) город|city/.test(command)) { background.value = 'city'; changed.push('ночной город'); }
    else if (/бел(ый|ом) фон|white/.test(command)) { background.value = 'white'; changed.push('белый фон'); }
    else if (/пляж|beach/.test(command)) { background.value = 'beach'; changed.push('пляж'); }
    else if (/студи|hollywood|голливуд/.test(command)) { background.value = 'studio'; changed.push('фотостудию'); }

    applyPreview();
    return changed;
  }

  function runCommand(rawText) {
    const text = String(rawText || '').trim();
    if (!text) {
      setResult('Скажи или напиши, что изменить.', true);
      return;
    }

    const changed = selectFromCommand(text);
    if (!changed.length) {
      setResult('Я пока понимаю команды про костюм, ковбоя, спорт, пляжный образ, кино, аниме, город, студию, пляж и космос.', true);
      return;
    }

    setResult(`Готово: выбрано ${changed.join(', ')}. Теперь загрузи фото или нажми «Создать превью».`, true);
  }

  function stopRecognition() {
    if (recognition && listening) recognition.stop();
    listening = false;
    const mic = $('#studioMic');
    if (mic) {
      mic.classList.remove('is-listening');
      mic.setAttribute('aria-pressed', 'false');
    }
  }

  function toggleVoiceRecognition() {
    if (listening) {
      stopRecognition();
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setResult('На этом браузере голосовое распознавание недоступно. Напиши команду текстом.', true);
      return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = 'ru-RU';
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onstart = () => {
      listening = true;
      const mic = $('#studioMic');
      mic.classList.add('is-listening');
      mic.setAttribute('aria-pressed', 'true');
      setResult('Слушаю команду…');
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      $('#studioCommand').value = transcript;
      runCommand(transcript);
    };

    recognition.onerror = () => setResult('Не удалось распознать речь. Попробуй ещё раз или напиши команду.');
    recognition.onend = stopRecognition;
    recognition.start();
  }

  launch.addEventListener('click', openStudio);
  close.addEventListener('click', closeStudio);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeStudio();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeStudio();
  });

  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setResult('Выбери файл фотографии.');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setResult('Файл слишком большой. Максимум 12 МБ.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      image.src = reader.result;
      upload.classList.add('has-photo');
      applyPreview();
      setResult('Фото загружено. Выбери одежду, фон и стиль или скажи команду голосом.', true);
    };
    reader.onerror = () => setResult('Не удалось прочитать фотографию. Попробуй другой файл.');
    reader.readAsDataURL(file);
  });

  [style, outfit, background].forEach((control) => control.addEventListener('change', () => {
    if (outfit.value === 'swimwear' && background.value === 'none') background.value = 'beach';
    applyPreview();
  }));

  generate.addEventListener('click', () => {
    if (!image.src) {
      setResult('Сначала загрузи фотографию.', true);
      return;
    }

    const adultConfirm = $('#adultConfirm');
    if (usesAdultMode() && adultConfirm && !adultConfirm.checked) {
      setResult('Подтверди, что на фотографии взрослый человек 18+ и у тебя есть разрешение на обработку.', true);
      return;
    }

    applyPreview();
    setResult(usesAdultMode()
      ? 'Пляжный предпросмотр готов. Режим предназначен только для взрослых фотографий 18+ и не создаёт наготу.'
      : 'Предпросмотр готов. NOVA применила выбранный локальный стиль.', true);
  });

  reset.addEventListener('click', clearStudio);
})();