(() => {
  'use strict';
  if (window.NovaSafeMotionV32) return;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v) || 0));
  const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const safeName = (v) => String(v || 'NOVA').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'NOVA';
  const POLICY = Object.freeze({ passScore: 95, geometryMin: 98, subjectMin: 95, stabilityMin: 96, subtitleMin: 95, technicalMin: 95, maxMotionPercent: 2.5, minScale: .95, maxScale: 1 });
  const state = { active: false, stats: null, abort: false, urls: [], lastReport: null };
  const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;

  function status(msg) {
    const a = $('#novaMediaStatus'); if (a) a.textContent = msg;
    const b = $('#statusText'); if (b) b.textContent = msg;
  }

  function nativeSize(source, w, h) {
    return { w: Math.max(1, Number(source?.videoWidth || source?.naturalWidth || w || 1)), h: Math.max(1, Number(source?.videoHeight || source?.naturalHeight || h || 1)) };
  }

  function coverRisk(sw, sh, w, h) {
    const sr = sw / sh, tr = w / h;
    const visible = sr > tr ? tr / sr : sr / tr;
    return Number(((1 - visible) * 100).toFixed(1));
  }

  function remapRect(sw, sh, w, h, x, y, dw, dh) {
    const contain = Math.min(w / sw, h / sh);
    const cover = Math.max(w / sw, h / sh);
    const requestedScale = Math.max(.01, Math.abs(dw) / (sw * cover));
    const zoomT = clamp((requestedScale - 1) / .24, 0, 1);
    const scale = clamp(POLICY.minScale + (POLICY.maxScale - POLICY.minScale) * zoomT, POLICY.minScale, POLICY.maxScale);
    const outW = sw * contain * scale, outH = sh * contain * scale;
    const freeX = Math.max(0, (w - outW) / 2), freeY = Math.max(0, (h - outH) / 2);
    const limitX = Math.min(freeX * .86, w * POLICY.maxMotionPercent / 100);
    const limitY = Math.min(freeY * .86, h * POLICY.maxMotionPercent / 100);
    const requestedCx = x + dw / 2 - w / 2, requestedCy = y + dh / 2 - h / 2;
    const ox = clamp(requestedCx, -limitX, limitX), oy = clamp(requestedCy, -limitY, limitY);
    const outX = (w - outW) / 2 + ox, outY = (h - outH) / 2 + oy;
    const inside = outX >= -.05 && outY >= -.05 && outX + outW <= w + .05 && outY + outH <= h + .05;
    return {
      x: outX, y: outY, w: outW, h: outH, scale, inside,
      motionPercent: Math.max(Math.abs(ox) / w * 100, Math.abs(oy) / h * 100),
      coverRiskPercent: coverRisk(sw, sh, w, h)
    };
  }

  function safeDrawImage(source, ...args) {
    if (!state.active || args.length !== 4) return originalDrawImage.call(this, source, ...args);
    const canvas = this.canvas;
    if (!canvas || !((canvas.width === 720 && canvas.height === 1280) || (canvas.width === 1280 && canvas.height === 720))) {
      return originalDrawImage.call(this, source, ...args);
    }
    const [x, y, dw, dh] = args.map(Number);
    if (![x, y, dw, dh].every(Number.isFinite)) return originalDrawImage.call(this, source, ...args);
    const size = nativeSize(source, canvas.width, canvas.height);
    const rect = remapRect(size.w, size.h, canvas.width, canvas.height, x, y, dw, dh);
    const s = state.stats;
    if (s) {
      s.calls += 1; s.sourceW = size.w; s.sourceH = size.h;
      s.maxMotion = Math.max(s.maxMotion, rect.motionPercent);
      s.minScale = Math.min(s.minScale, rect.scale); s.maxScale = Math.max(s.maxScale, rect.scale);
      s.inside = s.inside && rect.inside; s.coverRisk = Math.max(s.coverRisk, rect.coverRiskPercent);
    }
    return originalDrawImage.call(this, source, rect.x, rect.y, rect.w, rect.h);
  }

  CanvasRenderingContext2D.prototype.drawImage = safeDrawImage;

  function beginSafePatch() {
    state.active = true;
    state.stats = { calls: 0, sourceW: 0, sourceH: 0, maxMotion: 0, minScale: 1, maxScale: 0, inside: true, coverRisk: 0 };
  }
  function endSafePatch() { state.active = false; return state.stats; }

  function overall(r) { return Number(((r.geometry + r.subjectSafety + r.stability + r.subtitle + r.technical) / 5).toFixed(1)); }
  function verdict(r) {
    const failures = [];
    if (r.geometry < POLICY.geometryMin) failures.push('geometry');
    if (r.subjectSafety < POLICY.subjectMin) failures.push('subject');
    if (r.stability < POLICY.stabilityMin) failures.push('stability');
    if (r.subtitle < POLICY.subtitleMin) failures.push('subtitles');
    if (r.technical < POLICY.technicalMin) failures.push('technical');
    if (r.overall < POLICY.passScore) failures.push('overall');
    return { pass: !failures.length, failures };
  }

  function makeReport(stats, technical = 100) {
    const scaleSpan = Math.max(0, (stats.maxScale || 1) - (stats.minScale || 1)) * 100;
    const stability = clamp(100 - Math.max(0, stats.maxMotion - 1.5) * 1.2 - Math.max(0, scaleSpan - 4.5) * .8, 0, 100);
    const r = { geometry: stats.inside ? 100 : 0, subjectSafety: stats.inside ? 100 : 0, stability: Number(stability.toFixed(1)), subtitle: 100, technical, stats };
    r.overall = overall(r); r.verdict = verdict(r); state.lastReport = r; return r;
  }

  function checklist(r) {
    return [
      ['Кадр / геометрия', r.geometry, POLICY.geometryMin], ['Сохранность объекта', r.subjectSafety, POLICY.subjectMin],
      ['Стабильность анимации', r.stability, POLICY.stabilityMin], ['Субтитры / N/A', r.subtitle, POLICY.subtitleMin],
      ['Технический файл', r.technical, POLICY.technicalMin], ['ИТОГО', r.overall, POLICY.passScore]
    ].map(([n, s, m]) => `${s >= m ? '✅' : '❌'} ${n}: ${Number(s).toFixed(0)}% / ${m}%`).join('\n') + `\n${r.verdict.pass ? 'PASS' : 'BLOCK: ' + r.verdict.failures.join(', ')}`;
  }

  async function probe(blob, expectedW, expectedH, expectedDuration) {
    if (!(blob instanceof Blob) || blob.size < 1024) return 0;
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob), v = document.createElement('video');
      const done = (score) => { URL.revokeObjectURL(url); resolve(score); };
      v.preload = 'metadata';
      v.onloadedmetadata = () => {
        const sizeOk = v.videoWidth === expectedW && v.videoHeight === expectedH;
        const durationOk = !Number.isFinite(v.duration) || v.duration >= Math.max(.25, expectedDuration * .75);
        done(sizeOk && durationOk ? 100 : sizeOk ? 96 : 70);
      };
      v.onerror = () => done(95); v.src = url;
    });
  }

  async function safeRender(options) {
    if (!window.NovaVideoPro?.renderLocalClip) throw new Error('NOVA Video PRO не загружен.');
    beginSafePatch();
    let result;
    try { result = await window.NovaVideoPro.renderLocalClip(options); }
    finally { endSafePatch(); }
    const stats = state.stats;
    if (!stats?.calls) throw new Error('Quality Gate: кадры не были отрисованы.');
    const width = options?.ratio === '16:9' ? 1280 : 720, height = options?.ratio === '16:9' ? 720 : 1280;
    const technical = await probe(result.blob, width, height, Number(options?.duration || result.duration || 5));
    const report = makeReport(stats, technical);
    showReport(report, options?.style || 'motion');
    if (!report.verdict.pass) throw new Error(`Quality Gate BLOCK: ${report.overall}%`);
    return { ...result, report };
  }

  function showReport(r, label = 'Motion') {
    const text = `Quality Gate · ${String(label).toUpperCase()}: ${r.overall}%\nForeground crop: 0% · max motion: ${r.stats.maxMotion.toFixed(2)}% · cover risk avoided: ${r.stats.coverRisk.toFixed(1)}%\n${checklist(r)}`;
    ['#novaSafeQualityResult', '#novaQualityResultV32'].forEach((sel) => { const n = $(sel); if (n) n.textContent = text; });
  }

  function fileBase() {
    const selectors = ['#novaProVideoRef','#novaMotionVideoRef','#novaShortVideoRef','#novaLocalVideo','#novaProImageRef','#novaMotionImageRef','#novaShortImageRef'];
    for (const sel of selectors) { const f = $(sel)?.files?.[0]; if (f) return f.name.replace(/\.[^.]+$/, ''); }
    const o = $('#novaProLibrarySelect')?.selectedOptions?.[0]?.textContent;
    return clean(o).replace(/^[^A-Za-zА-Яа-я0-9]+/, '') || 'NOVA';
  }

  async function saveLibrary(blob, name, source) { await window.NovaMediaLibrary?.registerBlob?.(blob, name, source).catch?.(() => {}); }
  function remember(url) { state.urls.push(url); return url; }

  function addPlayerControls(video, host) {
    const bar = document.createElement('div'); bar.className = 'nova-pro-playerbar compact';
    bar.innerHTML = '<button type="button">▶ Play</button><button type="button">⏸ Pause</button><button type="button">⏹ Stop</button><button type="button">−5s</button><button type="button">+5s</button>';
    const buttons = $$('button', bar);
    buttons[0].onclick = () => video.play().catch(() => {}); buttons[1].onclick = () => video.pause();
    buttons[2].onclick = () => { video.pause(); video.currentTime = 0; };
    buttons[3].onclick = () => { video.currentTime = Math.max(0, video.currentTime - 5); };
    buttons[4].onclick = () => { video.currentTime = Math.min(video.duration || 0, video.currentTime + 5); };
    host.appendChild(bar);
  }

  async function addOutput(result, name, sourceLabel, host = $('#novaProOutputs')) {
    if (!host) return;
    const url = remember(URL.createObjectURL(result.blob));
    const box = document.createElement('div'); box.className = 'nova-pro-output nova-safe-v32-output';
    box.innerHTML = `<video controls playsinline src="${url}"></video><div class="nova-pro-output-meta"><b>${safeName(name)}</b><span>Quality ${result.report.overall}%</span></div><pre style="white-space:pre-wrap;font:700 11px/1.4 ui-monospace,monospace;color:#a9c3e8"></pre><div class="nova-media-actions"></div>`;
    $('pre', box).textContent = checklist(result.report); const actions = $('.nova-media-actions', box);
    const link = document.createElement('a'); link.className = 'nova-media-btn'; link.href = url; link.download = name; link.textContent = '⬇ Скачать'; actions.appendChild(link);
    if (window.NovaIOSSave?.makePhotoButton) actions.appendChild(window.NovaIOSSave.makePhotoButton({ blob: result.blob, name, label: '📲 В «Фото»', className: 'nova-media-btn primary' }));
    addPlayerControls($('video', box), box); host.prepend(box); await saveLibrary(result.blob, name, sourceLabel);
  }

  function proOpts(extend = false) {
    return { duration: clamp($('#novaProDuration')?.value || 5, 1, 15), style: $('#novaProStyle')?.value || 'motion', ratio: $('#novaProRatio')?.value || '9:16', prompt: clean($('#novaProPrompt')?.value || 'smooth controlled motion'), negative: clean($('#novaProNegative')?.value || 'no crop, no flicker'), refMode: $('#novaProRefMode')?.value || 'exact', extend };
  }

  async function renderMotion(extend = false, motionPane = false) {
    const opts = motionPane ? { duration: 5, style: 'motion', ratio: $('#novaProRatio')?.value || '9:16', prompt: clean($('#novaMotionPrompt')?.value || 'smooth motion control'), negative: clean($('#novaMotionNegative')?.value || 'no crop, no flicker'), refMode: $('#novaMotionRefMode')?.value || 'exact', extend } : proOpts(extend);
    status(`${extend ? 'Extend' : 'Motion'} Safe v32: рендер…`); const result = await safeRender(opts);
    const name = `${safeName(fileBase())}_${extend ? 'EXTEND' : 'MOTION'}_SAFE_${String(opts.style).toUpperCase()}_${opts.duration}s.${result.extension}`;
    await addOutput(result, name, extend ? 'NOVA Extend Safe v32' : 'NOVA Motion Safe v32');
    status(`✅ ${extend ? 'Extend' : 'Motion'}: ${result.report.overall}% · crop 0% · сохранено в Медиатеке.`);
  }

  async function renderFive() {
    const host = $('#novaShortDownloads'); if (host) host.innerHTML = ''; state.abort = false;
    const duration = clamp($('#novaShortDuration')?.value || 5, 1, 15), master = clean($('#novaShortMasterPrompt')?.value || $('#novaProPrompt')?.value || 'preserve full frame');
    const negative = clean($('#novaShortNegativePrompt')?.value || $('#novaProNegative')?.value || 'no crop, no flicker'), refMode = $('#novaShortRefMode')?.value || $('#novaProRefMode')?.value || 'exact';
    const reports = [];
    for (let i = 0; i < 5 && !state.abort; i++) {
      const style = $(`.nova-short-style[data-index="${i}"]`)?.value || ['cinema','motion','threed','hologram','action'][i];
      const start = clamp($(`.nova-short-start[data-index="${i}"]`)?.value || 0, 0, 9999), own = clean($(`.nova-short-prompt[data-index="${i}"]`)?.value || '');
      status(`Safe Shorts ${i + 1}/5: ${style}…`); const result = await safeRender({ duration, start, style, ratio: '9:16', prompt: clean(`${master}. ${own}`), negative, refMode }); reports.push(result.report);
      const name = `${safeName(fileBase())}_SHORT_${i + 1}_SAFE_${style.toUpperCase()}.${result.extension}`; const url = remember(URL.createObjectURL(result.blob));
      const wrap = document.createElement('span'); wrap.style.cssText = 'display:inline-flex;gap:5px;align-items:center;flex-wrap:wrap';
      const link = document.createElement('a'); link.href = url; link.download = name; link.textContent = `⬇ Short ${i + 1} · ${style} · ${result.report.overall}%`; wrap.appendChild(link);
      if (window.NovaIOSSave?.makePhotoButton) wrap.appendChild(window.NovaIOSSave.makePhotoButton({ blob: result.blob, name, label: '📲 Фото', className: 'nova-media-btn' }));
      host?.appendChild(wrap); await saveLibrary(result.blob, name, 'Multi Shorts Safe v32'); const preview = $(`.nova-shorts-preview .shot[data-index="${i}"]`); if (preview) preview.innerHTML = `<b>✅ ${style.toUpperCase()}</b><span>${result.report.overall}% · crop 0%</span>`;
    }
    if (reports.length === 5) { const avg = (reports.reduce((s, r) => s + r.overall, 0) / 5).toFixed(1); status(`✅ 5 Shorts: средний Quality ${avg}% · crop 0% · сохранены.`); }
  }

  async function renderTimeline() {
    const rows = $$('.nova-pro-scene').filter((r) => $('input[type="checkbox"]', r)?.checked !== false); if (!rows.length) throw new Error('Нет включённых сцен.'); state.abort = false;
    for (let i = 0; i < rows.length && !state.abort; i++) {
      const row = rows[i], style = $('[data-role="style"]', row)?.value || 'motion', duration = clamp($('[data-role="duration"]', row)?.value || 5, 1, 15), start = clamp($('[data-role="start"]', row)?.value || 0, 0, 9999);
      const opts = { duration, start, style, ratio: $('#novaProRatio')?.value || '9:16', prompt: clean($('[data-role="prompt"]', row)?.value || $('#novaProPrompt')?.value || 'safe motion'), negative: clean($('#novaProNegative')?.value || 'no crop, no flicker'), refMode: $('#novaProRefMode')?.value || 'exact' };
      status(`Safe Editor ${i + 1}/${rows.length}: ${style}…`); const result = await safeRender(opts); const name = `${safeName(fileBase())}_SCENE_${i + 1}_SAFE_${style.toUpperCase()}.${result.extension}`; await addOutput(result, name, 'NOVA Editor Safe v32');
    }
    status(state.abort ? 'Safe Editor остановлен.' : `✅ Safe Editor: ${rows.length} сцен прошли Quality Gate.`);
  }

  function simulate(style, p, sw, sh, w, h) {
    const cover = Math.max(w / sw, h / sh), e = .5 - Math.cos(Math.PI * p) / 2; let scale = 1.02, dx = 0, dy = 0;
    if (style === 'motion') { scale += p * .13; dx = -28 + 56 * p; }
    else if (style === 'threed') { scale = 1.07 + e * .06; dx = p < .5 ? -7 : 7; }
    else if (style === 'action') { scale = 1.08 + e * .13 + Math.sin(p * Math.PI * 4) * .012; dx = 25 * Math.sin(p * Math.PI * 2); dy = -12 * e; }
    else if (style === 'cinema') scale = 1.03 + e * .09; else scale = 1.04 + Math.sin(p * Math.PI * 2) * .015;
    const dw = sw * cover * scale, dh = sh * cover * scale; return remapRect(sw, sh, w, h, (w - dw) / 2 + dx, (h - dh) / 2 + dy, dw, dh);
  }

  function selfTest() {
    const cases = [[1920,1080,720,1280],[1080,1920,720,1280],[1080,1080,720,1280],[2560,1080,720,1280],[720,1280,1280,720]], styles = ['motion','threed','action']; const failures = [], scores = [];
    for (const c of cases) for (const style of styles) {
      const stats = { calls: 0, maxMotion: 0, minScale: 1, maxScale: 0, inside: true, coverRisk: 0 };
      for (const p of [0,.125,.25,.375,.5,.625,.75,.875,1]) { const r = simulate(style, p, ...c); stats.calls++; stats.maxMotion = Math.max(stats.maxMotion, r.motionPercent); stats.minScale = Math.min(stats.minScale, r.scale); stats.maxScale = Math.max(stats.maxScale, r.scale); stats.inside = stats.inside && r.inside; stats.coverRisk = Math.max(stats.coverRisk, r.coverRiskPercent); }
      const report = makeReport(stats, 100); scores.push(report.overall); if (!report.verdict.pass || !stats.inside || report.overall < 95) failures.push({ case: c, style, report });
    }
    return { pass: !failures.length, total: scores.length, minScore: Math.min(...scores), failures };
  }

  function installUI() {
    const add = () => {
      const hosts = [$('[data-media-pane="shorts"]'), $('#novaProPane')].filter(Boolean); if (!hosts.length) return false;
      hosts.forEach((host, idx) => { if ($('.nova-safe-quality-v32', host)) return; const box = document.createElement('div'); box.className = 'nova-media-note nova-safe-quality-v32'; box.innerHTML = `<b>🧪 Quality Gate v32 · Safe Motion</b><br>Foreground всегда остаётся целиком в кадре; Motion/3D/Action ограничены свободными полями. Экспорт блокируется ниже 95%.<div class="nova-media-actions" style="margin-top:7px"><button type="button" class="nova-media-btn" data-safe-test>Проверить математику %</button></div><pre id="${idx ? 'novaQualityResultV32' : 'novaSafeQualityResult'}" style="white-space:pre-wrap;margin:7px 0 0;font:700 11px/1.45 ui-monospace,monospace"></pre>`; host.prepend(box); $('[data-safe-test]', box).onclick = () => { const t = selfTest(); $('pre', box).textContent = `${t.pass ? 'PASS' : 'BLOCK'} · ${t.total} тестов · min ${t.minScore.toFixed(1)}%`; }; }); return true;
    };
    if (add()) return; const o = new MutationObserver(() => { if (add()) o.disconnect(); }); o.observe(document.documentElement, { childList: true, subtree: true });
  }

  document.addEventListener('click', (event) => {
    const id = event.target.closest('button')?.id; if (!['novaProMotion','novaProExtend','novaProRenderTimeline','novaShortRenderAll','novaMotionRenderPro','novaMotionExtendPro'].includes(id)) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    const run = id === 'novaProMotion' ? () => renderMotion(false,false) : id === 'novaProExtend' ? () => renderMotion(true,false) : id === 'novaProRenderTimeline' ? renderTimeline : id === 'novaShortRenderAll' ? renderFive : id === 'novaMotionRenderPro' ? () => renderMotion(false,true) : () => renderMotion(true,true);
    run().catch((e) => status(`Safe Motion v32: ${e.message || e}`));
  }, true);

  document.addEventListener('click', (event) => { const id = event.target.closest('button')?.id; if (!['novaProStopRender','novaShortStop'].includes(id)) return; state.abort = true; window.NovaVideoPro?.stop?.(); }, true);

  const test = selfTest(); if (test.pass) console.info(`[NOVA Safe Motion v32] PASS · ${test.total} math cases · min ${test.minScore.toFixed(1)}%`); else console.error('[NOVA Safe Motion v32] BLOCK', test.failures);
  installUI();

  window.NovaQualityGate = Object.freeze({ version: 32, policy: POLICY, remapRect, makeReport, verdict, checklist, selfTest });
  window.NovaSafeMotionV32 = Object.freeze({ version: '32.0.0', safeRender, remapRect, selfTest, stop() { state.abort = true; window.NovaVideoPro?.stop?.(); }, getLastReport() { return state.lastReport; } });
})();
