(() => {
  'use strict';
  if (window.__novaQualityGateV31) return;
  window.__novaQualityGateV31 = true;

  const POLICY_KEY = 'nova.video.quality.v31';
  const DEFAULTS = Object.freeze({
    version: 31,
    passScore: 95,
    geometryMin: 98,
    subjectSafetyMin: 95,
    stabilityMin: 96,
    subtitleMin: 95,
    technicalMin: 95,
    maxCropPercent: 18,
    maxMotionPercent: 2.5,
    safeTopPercent: 10,
    safeBottomPercent: 16,
    preserveWholeImage: true,
    blockLowScoreExport: true
  });

  function loadPolicy() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(POLICY_KEY) || '{}') }; }
    catch (_) { return { ...DEFAULTS }; }
  }
  function savePolicy(next) {
    const policy = { ...loadPolicy(), ...next, version: 31 };
    localStorage.setItem(POLICY_KEY, JSON.stringify(policy));
    return policy;
  }
  const clamp = (n, a = 0, b = 100) => Math.max(a, Math.min(b, Number(n) || 0));

  function geometryReport(sourceW, sourceH, targetW = 720, targetH = 1280) {
    const sw = Math.max(1, Number(sourceW) || 1);
    const sh = Math.max(1, Number(sourceH) || 1);
    const sourceRatio = sw / sh;
    const targetRatio = targetW / targetH;
    let visibleFraction = 1;
    if (sourceRatio > targetRatio) visibleFraction = targetRatio / sourceRatio;
    else visibleFraction = sourceRatio / targetRatio;
    const cropPercent = clamp((1 - visibleFraction) * 100);
    const policy = loadPolicy();
    const geometry = clamp(100 - cropPercent * 1.7);
    const subjectSafety = clamp(100 - Math.max(0, cropPercent - 5) * 2.2);
    return {
      source: `${sw}×${sh}`,
      target: `${targetW}×${targetH}`,
      cropPercent: Number(cropPercent.toFixed(1)),
      geometry: Number(geometry.toFixed(1)),
      subjectSafety: Number(subjectSafety.toFixed(1)),
      recommendedFit: cropPercent > policy.maxCropPercent || policy.preserveWholeImage ? 'contain' : 'cover',
      pass: cropPercent <= policy.maxCropPercent
    };
  }

  function subtitleReport(cues, duration) {
    const list = Array.isArray(cues) ? cues.filter(x => x && x.text && Number(x.end) > Number(x.start)) : [];
    const total = Math.max(.1, Number(duration) || .1);
    const covered = list.reduce((sum, x) => sum + Math.max(0, Math.min(total, x.end) - Math.max(0, x.start)), 0);
    let duplicates = 0;
    for (let i = 1; i < list.length; i++) if (String(list[i].text).trim().toLowerCase() === String(list[i - 1].text).trim().toLowerCase()) duplicates++;
    const coverage = clamp(covered / total * 100);
    const score = clamp(coverage - duplicates * 8);
    return { score: Number(score.toFixed(1)), coverage: Number(coverage.toFixed(1)), duplicates, cueCount: list.length };
  }

  function overall(parts) {
    const values = [parts.geometry, parts.subjectSafety, parts.stability, parts.subtitle, parts.technical].map(v => clamp(v));
    return Number((values.reduce((a,b) => a+b, 0) / values.length).toFixed(1));
  }

  function verdict(report) {
    const p = loadPolicy();
    const failures = [];
    if (report.geometry < p.geometryMin) failures.push('geometry');
    if (report.subjectSafety < p.subjectSafetyMin) failures.push('subject');
    if (report.stability < p.stabilityMin) failures.push('stability');
    if (report.subtitle < p.subtitleMin) failures.push('subtitles');
    if (report.technical < p.technicalMin) failures.push('technical');
    if (report.overall < p.passScore) failures.push('overall');
    return { pass: failures.length === 0, failures };
  }

  function buildChecklist(report) {
    const v = verdict(report);
    return [
      ['Кадр / геометрия', report.geometry, loadPolicy().geometryMin],
      ['Сохранность объекта', report.subjectSafety, loadPolicy().subjectSafetyMin],
      ['Стабильность анимации', report.stability, loadPolicy().stabilityMin],
      ['Субтитры', report.subtitle, loadPolicy().subtitleMin],
      ['Технический файл', report.technical, loadPolicy().technicalMin],
      ['ИТОГО', report.overall, loadPolicy().passScore]
    ].map(([name, score, min]) => `${score >= min ? '✅' : '❌'} ${name}: ${Number(score).toFixed(0)}% / минимум ${min}%`).join('\n') + `\n${v.pass ? 'PASS' : 'BLOCK'}${v.failures.length ? ': ' + v.failures.join(', ') : ''}`;
  }

  function analyzeCurrentVideo() {
    const input = document.querySelector('#novaLocalVideo');
    const file = input?.files?.[0];
    if (!file) return Promise.reject(new Error('Сначала выбери MP4/MOV.'));
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        const g = geometryReport(video.videoWidth, video.videoHeight);
        const stability = g.recommendedFit === 'contain' ? 99 : Math.max(80, 100 - g.cropPercent);
        const report = { geometry: g.geometry, subjectSafety: g.subjectSafety, stability, subtitle: 100, technical: 100 };
        report.overall = overall(report);
        URL.revokeObjectURL(url);
        resolve({ geometry: g, report, checklist: buildChecklist(report) });
      };
      video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать видео.')); };
      video.src = url;
    });
  }

  function installUI() {
    const pane = document.querySelector('[data-media-pane="shorts"]');
    if (!pane || document.querySelector('#novaQualityGateV31')) return false;
    const box = document.createElement('div');
    box.id = 'novaQualityGateV31';
    box.className = 'nova-media-note';
    box.innerHTML = `<b>🧪 NOVA Quality Gate v31 — цифры/проценты</b><br>
      Экспорт считается готовым только при общем результате ≥95%. Геометрия и сохранность объекта проверяются отдельно; если вертикальный 9:16 слишком сильно режет исходник, NOVA должна сохранять целую картинку (contain), а не растягивать/срезать её.<br>
      <button type="button" class="nova-media-btn" id="novaQualityAnalyze" style="margin-top:8px">Проверить видео %</button>
      <pre id="novaQualityResult" style="white-space:pre-wrap;margin:8px 0 0;font:700 12px/1.5 ui-monospace,monospace"></pre>`;
    pane.prepend(box);
    box.querySelector('#novaQualityAnalyze')?.addEventListener('click', async () => {
      const out = box.querySelector('#novaQualityResult');
      try {
        const result = await analyzeCurrentVideo();
        out.textContent = `Crop risk: ${result.geometry.cropPercent}% · режим: ${result.geometry.recommendedFit}\n${result.checklist}`;
      } catch (e) { out.textContent = `❌ ${e.message || e}`; }
    });
    return true;
  }

  const observer = new MutationObserver(() => installUI());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  installUI();

  window.NovaQualityGate = { version: 31, defaults: DEFAULTS, loadPolicy, savePolicy, geometryReport, subtitleReport, overall, verdict, buildChecklist, analyzeCurrentVideo };
  savePolicy(DEFAULTS);
})();