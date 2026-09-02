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
  const proto = window.BaseAudioContext?.prototype || window.AudioContext?.prototype || window.webkitAudioContext?.prototype;
  if (!proto?.decodeAudioData || proto.__novaDecodeGuardInstalled) return;
  const nativeDecode = proto.decodeAudioData;
  Object.defineProperty(proto, '__novaDecodeGuardInstalled', { value: true, configurable: true });
  proto.decodeAudioData = function guardedDecodeAudioData(...args) {
    const result = nativeDecode.apply(this, args);
    if (args.length > 1 || !result?.then) return result;
    let timer = 0;
    const timeout = new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error('Web Audio decode timeout; NOVA switches to FFmpeg.')), 8000);
    });
    return Promise.race([result, timeout]).finally(() => window.clearTimeout(timer));
  };
})();
