(() => {
  'use strict';
  const outfit = document.querySelector('#outfitSelect');
  const background = document.querySelector('#backgroundSelect');
  const controls = document.querySelector('.studio-controls');
  if (!outfit || !background || !controls) return;

  if (!outfit.querySelector('option[value="swimwear"]')) {
    const option = document.createElement('option');
    option.value = 'swimwear';
    option.textContent = 'Купальник (только 18+)';
    outfit.appendChild(option);
  }

  if (!background.querySelector('option[value="beach"]')) {
    const option = document.createElement('option');
    option.value = 'beach';
    option.textContent = 'Пляж';
    background.appendChild(option);
  }

  if (!document.querySelector('#adultConfirm')) {
    const label = document.createElement('label');
    label.className = 'adult-confirm';
    label.innerHTML = '<input id="adultConfirm" type="checkbox"><span>Подтверждаю: на фото взрослый человек 18+, и у меня есть его разрешение на обработку. Нагота не создаётся.</span>';
    controls.insertAdjacentElement('afterend', label);
  }
})();

(() => {
  'use strict';
  if (document.querySelector('script[data-nova-whisper]')) return;
  const script = document.createElement('script');
  script.src = './nova-whisper.js?v=30.0.0';
  script.defer = true;
  script.dataset.novaWhisper = '1';
  document.head.appendChild(script);
})();

(() => {
  'use strict';
  if (document.querySelector('script[data-nova-voice-editor]')) return;
  const script = document.createElement('script');
  script.src = './nova-voice-editor.js?v=32.0.0';
  script.defer = true;
  script.dataset.novaVoiceEditor = '1';
  document.head.appendChild(script);
})();