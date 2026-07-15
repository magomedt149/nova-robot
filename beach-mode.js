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