(() => {
  'use strict';

  if (window.NovaRussianPronunciation) return;

  const VERSION = '1.0.0';

  // Piper/espeak-ng already supplies the general Russian grapheme-to-phoneme rules.
  // This layer handles text normalization and pronunciation exceptions before Piper.
  // Unknown Russian words are intentionally preserved and passed to Piper instead of
  // being replaced by a different voice or a demo sample.
  const PHRASES = Object.freeze([
    [/\bт\.\s*е\.\b/gi, 'то есть'],
    [/\bт\.\s*д\.\b/gi, 'так далее'],
    [/\bт\.\s*п\.\b/gi, 'тому подобное'],
    [/\bи\s*т\.\s*д\.\b/gi, 'и так далее'],
    [/\bи\s*т\.\s*п\.\b/gi, 'и тому подобное'],
    [/\bг\.\b/gi, 'год'],
    [/\bгг\.\b/gi, 'годы'],
    [/\bруб\.\b/gi, 'рублей'],
    [/\bкоп\.\b/gi, 'копеек'],
    [/\bсек\.\b/gi, 'секунд'],
    [/\bмин\.\b/gi, 'минут'],
    [/\bчас\.\b/gi, 'часов']
  ]);

  const BRANDS = Object.freeze([
    [/\bNOVA\b/gi, 'НОВА'],
    [/\bTUMSOEV\b/gi, 'Тумсоев'],
    [/\bChatGPT\b/gi, 'чат джи-пи-ти'],
    [/\bOpenAI\b/gi, 'оупен эй-ай'],
    [/\bTTS\b/gi, 'ти-ти-эс'],
    [/\bAI\b/gi, 'эй-ай'],
    [/\bMP3\b/gi, 'эм-пэ-три'],
    [/\bWAV\b/gi, 'вэйв'],
    [/\bMP4\b/gi, 'эм-пэ-фор'],
    [/\bGitHub\b/gi, 'гитхаб'],
    [/\bYouTube\b/gi, 'ютуб'],
    [/\biPhone\b/gi, 'айфон'],
    [/\bPiper\b/gi, 'пайпер']
  ]);

  // Stable spelling exceptions. We prefer safe orthography (especially ё) rather than
  // pitch/formant tricks, so Irina's identity never changes between videos.
  const WORDS = Object.freeze({
    'ещё': 'ещё',
    'всё': 'всё',
    'трёх': 'трёх',
    'четырёх': 'четырёх',
    'пятёрка': 'пятёрка',
    'шестёрка': 'шестёрка',
    'актёр': 'актёр',
    'актёры': 'актёры',
    'партнёр': 'партнёр',
    'партнёры': 'партнёры',
    'режиссёр': 'режиссёр',
    'режиссёры': 'режиссёры',
    'надёжный': 'надёжный',
    'надёжно': 'надёжно',
    'объём': 'объём',
    'объёмный': 'объёмный',
    'приём': 'приём',
    'приёмы': 'приёмы',
    'съёмка': 'съёмка',
    'съёмки': 'съёмки',
    'пойдёт': 'пойдёт',
    'идёт': 'идёт',
    'найдёт': 'найдёт',
    'получит': 'получит',
    'клиент': 'клиент',
    'заказ': 'заказ',
    'портфолио': 'портфолио',
    'фриланс': 'фриланс',
    'нейросеть': 'нейросеть',
    'видеоролик': 'видеоролик'
  });

  const ONES = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
  const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

  function under1000(value, feminine = false) {
    let n = Math.max(0, Math.floor(Number(value) || 0));
    if (!n) return '';
    const parts = [];
    const h = Math.floor(n / 100);
    if (h) parts.push(HUNDREDS[h]);
    n %= 100;
    if (n >= 10 && n <= 19) {
      parts.push(TEENS[n - 10]);
      return parts.join(' ');
    }
    const t = Math.floor(n / 10);
    if (t) parts.push(TENS[t]);
    const o = n % 10;
    if (o) {
      if (feminine && o === 1) parts.push('одна');
      else if (feminine && o === 2) parts.push('две');
      else parts.push(ONES[o]);
    }
    return parts.join(' ');
  }

  function pluralForm(n, one, few, many) {
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 14) return many;
    const mod10 = n % 10;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
  }

  function integerToWords(value) {
    const raw = Number(value);
    if (!Number.isFinite(raw)) return String(value);
    const negative = raw < 0;
    let n = Math.abs(Math.trunc(raw));
    if (n === 0) return 'ноль';
    if (n > 999999999) return String(value);
    const parts = [];
    const millions = Math.floor(n / 1000000);
    if (millions) {
      parts.push(under1000(millions));
      parts.push(pluralForm(millions, 'миллион', 'миллиона', 'миллионов'));
      n %= 1000000;
    }
    const thousands = Math.floor(n / 1000);
    if (thousands) {
      parts.push(under1000(thousands, true));
      parts.push(pluralForm(thousands, 'тысяча', 'тысячи', 'тысяч'));
      n %= 1000;
    }
    if (n) parts.push(under1000(n));
    return `${negative ? 'минус ' : ''}${parts.join(' ')}`.trim();
  }

  function replaceIntegerToken(match) {
    if (/^0\d{2,}$/.test(match)) return match.split('').map((d) => integerToWords(Number(d))).join(' ');
    return integerToWords(Number(match));
  }

  function normalizeNumbers(text) {
    return String(text || '')
      .replace(/№\s*(\d+)/g, (_, n) => `номер ${replaceIntegerToken(n)}`)
      .replace(/(\d+)\s*%/g, (_, n) => `${replaceIntegerToken(n)} процентов`)
      .replace(/\$\s*(\d+)/g, (_, n) => `${replaceIntegerToken(n)} долларов`)
      .replace(/€\s*(\d+)/g, (_, n) => `${replaceIntegerToken(n)} евро`)
      .replace(/₽\s*(\d+)/g, (_, n) => `${replaceIntegerToken(n)} рублей`)
      .replace(/\b\d+\b/g, replaceIntegerToken);
  }

  function applyWordDictionary(text) {
    return String(text || '').replace(/[А-Яа-яЁё-]+/g, (word) => {
      const lower = word.toLowerCase();
      const replacement = WORDS[lower];
      if (!replacement) return word;
      if (word === word.toUpperCase()) return replacement.toUpperCase();
      if (word[0] === word[0]?.toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
      return replacement;
    });
  }

  function normalize(input) {
    let text = String(input || '');
    try { text = text.normalize('NFKC'); } catch (_) {}
    text = text
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/[“”„«»]/g, '"')
      .replace(/[’‘]/g, "'")
      .replace(/[—–]/g, ' — ')
      .replace(/…/g, '...');

    for (const [pattern, replacement] of BRANDS) text = text.replace(pattern, replacement);
    for (const [pattern, replacement] of PHRASES) text = text.replace(pattern, replacement);

    text = normalizeNumbers(text);
    text = applyWordDictionary(text);

    return text
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/\s*—\s*/g, ' — ')
      .replace(/([!?]){2,}/g, '$1')
      .replace(/\.{4,}/g, '...')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function diagnose() {
    const samples = [
      'NOVA: урок 4. Клиент получит 10 секунд видео.',
      'TTS Ирины — 100% бесплатно. Ещё один тест.',
      '№25, 2026 год, 3 проекта и 2 видео.'
    ];
    const results = samples.map((input) => ({ input, output: normalize(input) }));
    return {
      ok: results.every((row) => row.output && /[А-Яа-яЁё]/.test(row.output)),
      version: VERSION,
      engine: 'Piper Russian G2P + NOVA normalization',
      unknownWords: 'pass-through-to-piper',
      samples: results
    };
  }

  window.NovaRussianPronunciation = Object.freeze({
    version: VERSION,
    alphabet: 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',
    normalize,
    integerToWords,
    diagnose,
    dictionarySize: Object.keys(WORDS).length,
    dictionaryMode: 'exceptions + universal Piper Russian G2P'
  });
})();