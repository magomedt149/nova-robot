(() => {
  'use strict';

  const VERSION = '27.0.0';
  const PROFILE_KEY = 'novaBehaviorProfile:v27';
  const SPEECH_KEY = 'novaSpeechCorrections:v27';
  const RECENT_KEY = 'novaRecentRequests:v27';
  const NativeRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const BaseBrain = window.NovaBrain || null;

  const DEFAULT_RULES_RU = [
    'Отвечай по-русски, если пользователь сам не переключил язык.',
    'Для вопросов про сегодня, сейчас, последние новости, цены, версии и другие меняющиеся данные сначала проверяй актуальность; не выдавай старые данные как свежие.',
    'Не заставляй пользователя повторять уже сказанное и не задавай повторный вопрос, если ответ можно вывести из контекста или памяти.',
    'Если задачу можно выполнить самостоятельно доступными инструментами, сначала попробуй выполнить её, а не перекладывай шаги на пользователя.',
    'Давай сначала прямой практичный ответ, затем короткое объяснение при необходимости.',
    'Если точных данных нет, прямо скажи об ограничении и предложи самый быстрый способ проверки вместо догадки.'
  ];

  const DEFAULT_RULES_EN = [
    'Reply in English only when the user switched to English.',
    'For changing facts such as today, current status, latest news, prices, releases, versions, or public figures, verify freshness before presenting a claim as current.',
    'Do not make the user repeat information already available in context or memory.',
    'When an available tool can complete the task, try the tool before asking the user to do manual work.',
    'Give the direct practical answer first, then a short explanation if useful.',
    'If exact live data is unavailable, say so clearly and use the safest verification path instead of guessing.'
  ];

  const BUILTIN_SPEECH_FIXES = [
    [/(привет|здравствуй|здравствуйте|эй|алло)\s+(мама|мамма|нова|ново|новая|новой|новую|нава|наво|новаа|новау|нову)/giu, (_m, hello) => `${hello} Нова`],
    [/(привет|здравствуй|здравствуйте|эй|алло)\s+но\s+ва/giu, (_m, hello) => `${hello} Нова`],
    [/\b(hey|hi|hello)\s+(nova|nover|novah|nava)\b/giu, (_m, hello) => `${hello} Nova`],
    [/ещ[её]\s+шутк[уа]/giu, 'ещё шутку'],
    [/открой\s+приложени[ея]/giu, 'открой приложение'],
    [/построй\s+маршру[тд]/giu, 'построй маршрут'],
    [/учим\s+английск(?:ий|и)/giu, 'учим английский'],
    [/вырубайс[ья]/giu, 'выключи микрофон'],
    [/отсоединяй\s+голосов(?:ой|ый)\s+чат/giu, 'выключи микрофон'],
    [/отключи(?:сь)?\s+голосов(?:ой|ый)\s+(?:режим|чат)/giu, 'выключи микрофон']
  ];

  const WAKE_SCORE = /(?:привет|здравствуй|здравствуйте|эй|алло)\s+(?:нова|nova)/i;
  const COMMAND_SCORE = /(?:шутк|анекдот|маршрут|карта|погода|таймер|запомни|задач|английск|гитара|танцуй|микрофон|youtube|ютуб)/i;
  const FRESHNESS_RE = /(?:сегодня|сейчас|ныне|последн(?:ий|яя|ее|ие|их)|свеж(?:ий|ая|ие)|актуальн|новост|цена|стоимость|курс|релиз|верси[яи]|обновлен|кто сейчас|президент сейчас|ceo|today|right now|current|currently|latest|recent|news|price|release|version|update)/i;
  const TOOLISH_RE = /^(?:запомни|запиши|сохрани|покажи|добавь|создай|удали|убери|выполни|заверши|поставь\s+таймер|таймер|погода|прогноз|посчитай|вычисли|реши|найди|поищи|загугли|открой|построй|remember|save|show|add|create|delete|remove|complete|timer|weather|forecast|calculate|find|search|google|open|build)(?:\s|$)/i;

  function clean(value, limit = 700) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/[\u0000-\u001f<>]/g, ' ')
      .replace(/[‐‑‒–—]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit);
  }

  function normalized(value) {
    return clean(value, 700)
      .toLocaleLowerCase('ru-RU')
      .replace(/ё/g, 'е')
      .replace(/[^a-zа-я0-9\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function safeJson(value, fallback) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function loadProfile() {
    const stored = safeJson(localStorage.getItem(PROFILE_KEY), {});
    return {
      rules: Array.isArray(stored.rules) ? stored.rules.map((item) => clean(item, 240)).filter(Boolean).slice(-20) : [],
      concise: stored.concise !== false,
      preferRussian: stored.preferRussian !== false,
      verifyFresh: stored.verifyFresh !== false,
      avoidRepeatQuestions: stored.avoidRepeatQuestions !== false,
      selfServeFirst: stored.selfServeFirst !== false,
      updatedAt: Number(stored.updatedAt) || 0
    };
  }

  let profile = loadProfile();

  function saveProfile() {
    profile.updatedAt = Date.now();
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch (_) { /* optional persistence */ }
  }

  function addRule(rule) {
    const value = clean(rule, 240);
    if (!value) return false;
    const key = normalized(value);
    profile.rules = profile.rules.filter((item) => normalized(item) !== key);
    profile.rules.push(value);
    profile.rules = profile.rules.slice(-20);
    saveProfile();
    return true;
  }

  function loadSpeechCorrections() {
    const stored = safeJson(localStorage.getItem(SPEECH_KEY), { items: [] });
    const items = Array.isArray(stored.items) ? stored.items : [];
    return items
      .map((item) => ({ from: clean(item?.from, 80), to: clean(item?.to, 80) }))
      .filter((item) => item.from && item.to)
      .slice(-40);
  }

  let speechCorrections = loadSpeechCorrections();

  function saveSpeechCorrection(from, to) {
    const source = clean(from, 80);
    const target = clean(to, 80);
    if (!source || !target || normalized(source) === normalized(target)) return false;
    const key = normalized(source);
    speechCorrections = speechCorrections.filter((item) => normalized(item.from) !== key);
    speechCorrections.push({ from: source, to: target });
    speechCorrections = speechCorrections.slice(-40);
    try { localStorage.setItem(SPEECH_KEY, JSON.stringify({ items: speechCorrections })); } catch (_) { /* optional */ }
    return true;
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function applyPersonalSpeechFixes(value) {
    let text = value;
    for (const item of speechCorrections) {
      const pattern = new RegExp(`${escapeRegExp(item.from)}`, 'giu');
      text = text.replace(pattern, item.to);
    }
    return text;
  }

  function normalizeTranscript(value) {
    let text = clean(value, 500);
    for (const [pattern, replacement] of BUILTIN_SPEECH_FIXES) text = text.replace(pattern, replacement);
    text = applyPersonalSpeechFixes(text);
    return clean(text, 500);
  }

  function alternativeScore(alternative) {
    const transcript = normalizeTranscript(alternative?.transcript);
    let score = Math.max(0, Math.min(1, Number(alternative?.confidence) || 0));
    if (WAKE_SCORE.test(transcript)) score += 1.25;
    if (COMMAND_SCORE.test(transcript)) score += 0.35;
    if (transcript.length >= 3) score += 0.05;
    return score;
  }

  function cloneResult(result) {
    const alternatives = [];
    for (let index = 0; index < (result?.length || 0); index += 1) {
      const raw = result[index];
      alternatives.push({
        transcript: normalizeTranscript(raw?.transcript),
        confidence: Number(raw?.confidence) || 0,
        __score: alternativeScore(raw)
      });
    }
    alternatives.sort((a, b) => b.__score - a.__score);
    alternatives.forEach((item) => { delete item.__score; });
    Object.defineProperty(alternatives, 'isFinal', { value: Boolean(result?.isFinal), enumerable: true });
    Object.defineProperty(alternatives, 'item', { value(index) { return this[index] || null; }, enumerable: false });
    return alternatives;
  }

  function cloneEvent(event) {
    const results = [];
    for (let index = 0; index < (event?.results?.length || 0); index += 1) results.push(cloneResult(event.results[index]));
    Object.defineProperty(results, 'item', { value(index) { return this[index] || null; }, enumerable: false });
    return {
      resultIndex: Number(event?.resultIndex) || 0,
      results,
      interpretation: event?.interpretation,
      emma: event?.emma
    };
  }

  if (NativeRecognition) {
    class NovaSpeechRecognition extends NativeRecognition {
      constructor() {
        super();
        this.__novaOnResult = null;
        super.onresult = (event) => {
          if (typeof this.__novaOnResult === 'function') this.__novaOnResult.call(this, cloneEvent(event));
        };
      }

      set onresult(handler) { this.__novaOnResult = typeof handler === 'function' ? handler : null; }
      get onresult() { return this.__novaOnResult; }
    }

    window.SpeechRecognition = NovaSpeechRecognition;
    window.webkitSpeechRecognition = NovaSpeechRecognition;
  }

  function parseSpeechTeaching(text, language) {
    const patterns = language === 'en'
      ? [/(?:when you hear|if you hear)\s+[“"']?(.+?)[”"']?\s+(?:understand|treat it|write it)\s+(?:as\s+)?[“"']?(.+?)[”"']?[.!]?$/i]
      : [/(?:когда|если)\s+(?:ты\s+)?слышишь\s+[«“"']?(.+?)[»”"']?\s+(?:понимай|пиши|исправляй)\s+(?:это\s+)?(?:как\s+)?[«“"']?(.+?)[»”"']?[.!]?$/i];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1] && match?.[2]) return { from: match[1], to: match[2] };
    }
    return null;
  }

  function parseBehaviorRule(text, language) {
    const lower = normalized(text);
    if (language === 'ru') {
      if (/^(?:запомни|сохрани)\s+(?:правило|настройку)\s*[:\-]?\s*(.+)$/i.test(text)) {
        return text.match(/^(?:запомни|сохрани)\s+(?:правило|настройку)\s*[:\-]?\s*(.+)$/i)?.[1] || '';
      }
      if (/^(?:всегда|никогда|не\s+спрашивай|отвечай|говори|проверяй|сначала\s+проверяй|не\s+заставляй)(?:\s|$)/.test(lower) && text.length <= 260) return text;
    } else {
      if (/^(?:remember|save)\s+(?:this\s+)?(?:rule|preference)\s*[:\-]?\s*(.+)$/i.test(text)) {
        return text.match(/^(?:remember|save)\s+(?:this\s+)?(?:rule|preference)\s*[:\-]?\s*(.+)$/i)?.[1] || '';
      }
      if (/^(?:always|never|do not ask|reply|speak|verify|check first)\b/i.test(text) && text.length <= 260) return text;
    }
    return '';
  }

  function rulesText(language) {
    const base = language === 'en' ? DEFAULT_RULES_EN : DEFAULT_RULES_RU;
    const combined = [...base, ...profile.rules].slice(-26);
    return combined.map((rule, index) => `${index + 1}. ${rule}`).join('\n');
  }

  function recentRequests() {
    const stored = safeJson(localStorage.getItem(RECENT_KEY), { items: [] });
    return Array.isArray(stored.items) ? stored.items : [];
  }

  function rememberRequest(text) {
    const items = recentRequests();
    items.push({ key: normalized(text), text: clean(text, 240), at: Date.now() });
    const trimmed = items.filter((item) => Date.now() - Number(item.at || 0) < 6 * 3600000).slice(-18);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify({ items: trimmed })); } catch (_) { /* optional */ }
    return trimmed;
  }

  function isVeryRecentRepeat(text) {
    const key = normalized(text);
    if (!key || key.length < 4) return false;
    return recentRequests().some((item) => item.key === key && Date.now() - Number(item.at || 0) < 45000);
  }

  function liveSearchAction(text, language) {
    const query = clean(text, 180);
    return {
      text: language === 'en'
        ? `This can change quickly. I will not pretend an old answer is current. I’m opening a live web search for “${query}”.`
        : `Это может быстро меняться. Я не буду выдавать старые данные за актуальные. Открываю живой поиск по запросу «${query}».`,
      action: { type: 'openUrl', url: `https://www.google.com/search?q=${encodeURIComponent(query)}` },
      source: 'fresh-web-search'
    };
  }

  function shouldUseLiveSearch(text) {
    if (!profile.verifyFresh || !FRESHNESS_RE.test(text)) return false;
    if (/(?:погод|прогноз|weather|forecast)/i.test(text)) return false;
    if (/^(?:который час|сколько времени|какая дата|какой сегодня день|time|date)\b/i.test(text)) return false;
    return true;
  }

  function instructionSuffix(language, repeated) {
    const defaults = language === 'en' ? DEFAULT_RULES_EN : DEFAULT_RULES_RU;
    const activeRules = [...defaults, ...profile.rules].slice(-18);
    const repeatRule = repeated
      ? (language === 'en'
        ? 'The user repeated this request recently. Do not ask them to restate it; either answer more usefully or explain exactly what was missing before.'
        : 'Пользователь недавно уже задавал этот запрос. Не проси повторять его; либо ответь полезнее, либо точно объясни, чего не хватило раньше.')
      : '';
    return `\n\n[NOVA RESPONSE POLICY — apply silently]\n${activeRules.map((rule) => `- ${rule}`).join('\n')}${repeatRule ? `\n- ${repeatRule}` : ''}`;
  }

  async function enhancedHandle(text, context = {}) {
    if (!BaseBrain?.handle) return null;
    const cleanText = clean(text, 700);
    if (!cleanText) return null;
    const language = context.language === 'en' ? 'en' : 'ru';

    const speechTeaching = parseSpeechTeaching(cleanText, language);
    if (speechTeaching) {
      if (!saveSpeechCorrection(speechTeaching.from, speechTeaching.to)) {
        return { text: language === 'en' ? 'That speech correction is already equivalent.' : 'Такое исправление ничего не меняет.', source: 'speech-learning' };
      }
      return {
        text: language === 'en'
          ? `Saved. When speech recognition hears “${speechTeaching.from}”, NOVA will treat it as “${speechTeaching.to}”.`
          : `Сохранила. Когда распознавание услышит «${speechTeaching.from}», NOVA будет понимать это как «${speechTeaching.to}».`,
        source: 'speech-learning'
      };
    }

    if (language === 'ru' && /^(?:покажи|какие)\s+(?:мои\s+)?(?:правила|настройки общения)|^как ты должна со мной общаться/i.test(cleanText)) {
      return { text: `Мои правила общения с тобой:\n${rulesText(language)}`, source: 'behavior-profile' };
    }
    if (language === 'en' && /^(?:show|what are)\s+(?:my\s+)?(?:rules|communication preferences)/i.test(cleanText)) {
      return { text: `Your communication rules:\n${rulesText(language)}`, source: 'behavior-profile' };
    }

    const behaviorRule = parseBehaviorRule(cleanText, language);
    if (behaviorRule) {
      addRule(behaviorRule);
      return {
        text: language === 'en'
          ? `Saved as a NOVA communication rule: ${clean(behaviorRule, 220)}`
          : `Сохранила как правило общения NOVA: ${clean(behaviorRule, 220)}`,
        source: 'behavior-profile'
      };
    }

    const repeated = isVeryRecentRepeat(cleanText);
    rememberRequest(cleanText);

    if (shouldUseLiveSearch(cleanText)) return liveSearchAction(cleanText, language);

    if (TOOLISH_RE.test(cleanText)) return BaseBrain.handle(cleanText, context);

    const status = BaseBrain.getStatus?.() || {};
    if (status.ready) {
      const enhancedText = `${cleanText}${instructionSuffix(language, repeated)}`;
      return BaseBrain.handle(enhancedText, context);
    }

    const result = await BaseBrain.handle(cleanText, context);
    if (result) return result;

    if (repeated && profile.avoidRepeatQuestions) {
      return {
        text: language === 'en'
          ? 'I remember you just asked this. I will not make you repeat it. My local AI brain is not active yet, so I do not have a reliable answer to this open-ended request.'
          : 'Я помню, что ты только что это спрашивал. Повторять не заставлю. Сейчас локальный ИИ-мозг не включён, поэтому надёжно ответить на такой свободный вопрос я пока не могу.',
        source: 'repeat-guard'
      };
    }
    return null;
  }

  if (BaseBrain?.handle) {
    window.NovaBrain = Object.freeze({
      ...BaseBrain,
      version: `${BaseBrain.version || '26'}+behavior-${VERSION}`,
      handle: enhancedHandle,
      getBehaviorProfile: () => JSON.parse(JSON.stringify({ ...profile, speechCorrections })),
      normalizeSpeech: normalizeTranscript
    });
  }

  window.NovaBehavior = Object.freeze({
    version: VERSION,
    getProfile: () => JSON.parse(JSON.stringify({ ...profile, speechCorrections })),
    normalizeSpeech: normalizeTranscript,
    addRule,
    addSpeechCorrection: saveSpeechCorrection
  });
})();
