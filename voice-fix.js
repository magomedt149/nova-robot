(() => {
  'use strict';

  const NativeRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!NativeRecognition) return;

  const WAKE_PATTERNS = [
    /\b(привет|здравствуй|здравствуйте|эй|алло)\s+(мама|мамма|нова|ново|новая|новой|новую|нава|наво|новаа)\b/giu,
    /\b(привет|здравствуй|здравствуйте|эй|алло)\s+но\s+ва\b/giu,
    /\b(hey|hi|hello)\s+(nova|nover|novah)\b/giu
  ];

  const COMMAND_FIXES = [
    [/\bещ[её]\s+шутк[уа]\b/giu, 'ещё шутку'],
    [/\bоткрой\s+приложени[ея]\b/giu, 'открой приложение'],
    [/\bпострой\s+маршру[тд]\b/giu, 'построй маршрут'],
    [/\bучим\s+английск(?:ий|и)\b/giu, 'учим английский']
  ];

  function normalizeTranscript(value) {
    let text = String(value || '')
      .normalize('NFKC')
      .replace(/[‐‑‒–—]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();

    for (const pattern of WAKE_PATTERNS) {
      text = text.replace(pattern, (_match, greeting) => {
        const english = /^(hey|hi|hello)$/i.test(greeting);
        return english ? `${greeting} Nova` : `${greeting} Нова`;
      });
    }

    for (const [pattern, replacement] of COMMAND_FIXES) {
      text = text.replace(pattern, replacement);
    }

    return text;
  }

  function cloneAlternative(alternative) {
    return {
      transcript: normalizeTranscript(alternative?.transcript),
      confidence: Number(alternative?.confidence) || 0
    };
  }

  function cloneResult(result) {
    const alternatives = [];
    for (let i = 0; i < (result?.length || 0); i += 1) {
      alternatives.push(cloneAlternative(result[i]));
    }
    Object.defineProperty(alternatives, 'isFinal', {
      value: Boolean(result?.isFinal),
      enumerable: true
    });
    Object.defineProperty(alternatives, 'item', {
      value(index) { return this[index] || null; },
      enumerable: false
    });
    return alternatives;
  }

  function cloneEvent(event) {
    const results = [];
    for (let i = 0; i < (event?.results?.length || 0); i += 1) {
      results.push(cloneResult(event.results[i]));
    }
    Object.defineProperty(results, 'item', {
      value(index) { return this[index] || null; },
      enumerable: false
    });
    return {
      resultIndex: Number(event?.resultIndex) || 0,
      results,
      interpretation: event?.interpretation,
      emma: event?.emma
    };
  }

  class NovaSpeechRecognition extends NativeRecognition {
    constructor() {
      super();
      this.__novaOnResult = null;
      super.onresult = (event) => {
        if (typeof this.__novaOnResult === 'function') {
          this.__novaOnResult.call(this, cloneEvent(event));
        }
      };
    }

    set onresult(handler) {
      this.__novaOnResult = typeof handler === 'function' ? handler : null;
    }

    get onresult() {
      return this.__novaOnResult;
    }
  }

  window.SpeechRecognition = NovaSpeechRecognition;
  window.webkitSpeechRecognition = NovaSpeechRecognition;
})();
