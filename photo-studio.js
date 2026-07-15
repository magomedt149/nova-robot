(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
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
  const adultConfirm = $('#adultConfirm');
  const generate = $('#photoGenerate');
  const reset = $('#photoReset');
  const result = $('#photoStudioResult');
  const classes = [
    'style-cinematic','style-anime','style-western','style-bw',
    'bg-studio','bg-city','bg-space','bg-white','bg-beach',
    'outfit-suit','outfit-western','outfit-sport','outfit-swimwear'
  ];

  function openStudio() {
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeStudio() {
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  function usesAdultMode() {
    return outfit.value === 'swimwear';
  }

  function applyPreview() {
    upload.classList.remove(...classes);
    if (style.value !== 'none') upload.classList.add(`style-${style.value}`);
    if (background.value !== 'none') upload.classList.add(`bg-${background.value}`);
    if (outfit.value !== 'none') upload.classList.add(`outfit-${outfit.value}`);
  }

  function clearStudio() {
    input.value = '';
    image.removeAttribute('src');
    upload.classList.remove('has-photo', ...classes);
    style.value = 'none';
    outfit.value = 'none';
    background.value = 'none';
    if (adultConfirm) adultConfirm.checked = false;
    result.textContent = 'Загрузи фотографию. Обработка выполняется только на устройстве и никуда не отправляется.';
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
      result.textContent = 'Выбери файл фотографии.';
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      result.textContent = 'Файл слишком большой. Максимум 12 МБ.';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      image.src = reader.result;
      upload.classList.add('has-photo');
      applyPreview();
      result.textContent = 'Фото загружено. Выбери одежду, фон и стиль.';
    };
    reader.readAsDataURL(file);
  });

  [style, outfit, background].forEach((control) => control.addEventListener('change', () => {
    applyPreview();
    if (outfit.value === 'swimwear' && background.value === 'none') background.value = 'beach';
    applyPreview();
  }));

  generate.addEventListener('click', () => {
    if (!image.src) {
      result.textContent = 'Сначала загрузи фотографию.';
      return;
    }
    if (usesAdultMode() && adultConfirm && !adultConfirm.checked) {
      result.textContent = 'Для режима купальника подтверди, что на фотографии взрослый человек 18+ и у тебя есть разрешение на обработку.';
      return;
    }
    applyPreview();
    result.textContent = usesAdultMode()
      ? 'Пляжный предпросмотр готов: купальник и пляж доступны только для взрослых фотографий 18+, без наготы.'
      : 'Предпросмотр готов. Это бесплатный локальный режим. Для настоящей реалистичной замены одежды потребуется отдельная серверная ИИ-модель.';
  });
  reset.addEventListener('click', clearStudio);
})();