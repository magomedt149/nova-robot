(() => {
  'use strict';

  if (window.NovaTtsDiagnostics) return;

  const EXPECTED = Object.freeze({
    provider: 'piper',
    voiceId: 'ru_RU-irina-medium',
    locale: 'ru-RU',
    pitchFactor: 1,
    formantFactor: 1,
    perVideoVariation: false,
    allowSystemFallback: false,
    allowAutomaticVoiceSubstitution: false
  });

  function row(name, ok, actual, expected) {
    return { name, ok: Boolean(ok), actual, expected };
  }

  function run({ updateUi = true } = {}) {
    const tts = window.NovaRussianTTS;
    const pronunciation = window.NovaRussianPronunciation;
    const irina = tts?.voices?.irina;
    const lock = tts?.irinaLock;
    const checks = [
      row('tts-loaded', Boolean(tts), Boolean(tts), true),
      row('pronunciation-loaded', Boolean(pronunciation?.normalize), Boolean(pronunciation?.normalize), true),
      row('provider', irina?.provider === EXPECTED.provider, irina?.provider, EXPECTED.provider),
      row('voice-id', irina?.id === EXPECTED.voiceId, irina?.id, EXPECTED.voiceId),
      row('locale', irina?.locale === EXPECTED.locale, irina?.locale, EXPECTED.locale),
      row('voice-lock', lock?.voiceId === EXPECTED.voiceId, lock?.voiceId, EXPECTED.voiceId),
      row('pitch-locked', Number(lock?.pitchFactor) === 1, lock?.pitchFactor, 1),
      row('formants-locked', Number(lock?.formantFactor) === 1, lock?.formantFactor, 1),
      row('per-video-variation-disabled', lock?.perVideoVariation === false, lock?.perVideoVariation, false),
      row('system-fallback-disabled', lock?.allowSystemFallback === false, lock?.allowSystemFallback, false),
      row('voice-substitution-disabled', lock?.allowAutomaticVoiceSubstitution === false, lock?.allowAutomaticVoiceSubstitution, false)
    ];

    let normalizationSample = '';
    try {
      normalizationSample = pronunciation?.normalize?.('NOVA, урок 4. TTS Ирины: 10 секунд, 100%. Ещё один проект.') || '';
      checks.push(row('russian-normalization', /НОВА/.test(normalizationSample) && /десять/.test(normalizationSample) && /сто/.test(normalizationSample), normalizationSample, 'normalized Russian speech text'));
    } catch (error) {
      checks.push(row('russian-normalization', false, error?.message || String(error), 'normalized Russian speech text'));
    }

    const ok = checks.every((item) => item.ok);
    const report = Object.freeze({
      ok,
      checkedAt: new Date().toISOString(),
      expected: EXPECTED,
      voiceSignature: tts?.getVoiceSignature?.('irina') || null,
      pronunciationVersion: pronunciation?.version || null,
      normalizationSample,
      checks
    });

    if (updateUi) {
      const node = document.querySelector('#statusText');
      if (node) {
        node.textContent = ok
          ? '✅ Диагностика TTS: Ирина зафиксирована, русский словарь/нормализация активны.'
          : '⚠️ Диагностика TTS обнаружила несоответствие. Ирина не должна использоваться до исправления.';
      }
    }

    try { window.dispatchEvent(new CustomEvent('nova:tts-diagnostics', { detail: report })); } catch (_) {}
    return report;
  }

  function assertReady() {
    const report = run({ updateUi: false });
    if (!report.ok) {
      const failed = report.checks.filter((item) => !item.ok).map((item) => item.name).join(', ');
      throw new Error(`NOVA TTS diagnostics failed: ${failed}`);
    }
    return report;
  }

  window.NovaTtsDiagnostics = Object.freeze({ expected: EXPECTED, run, assertReady });
})();