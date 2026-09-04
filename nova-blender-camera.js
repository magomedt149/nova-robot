(() => {
  'use strict';

  if (window.NovaBlenderCamera) return;

  const $ = (selector, root = document) => root.querySelector(selector);
  const VERSION = '1.0.0';
  const REPO = 'magomedt149/nova-robot';
  const TRUE_3D_PATHS = new Set(['orbit', 'orbit360', 'arc', 'crane', 'topdown']);
  const state = {
    pane: null,
    recording: false,
    samples: [],
    startedAt: 0,
    lastSampleAt: 0,
    timer: 0,
    orientationHandler: null
  };

  function status(message) {
    const local = $('#novaMediaStatus');
    if (local) local.textContent = message;
    const global = $('#statusText');
    if (global) global.textContent = message;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function currentPlan() {
    const plan = window.Nova3DDirector?.getRenderPlan?.() || {};
    return {
      schema: 'nova.scene-pack.v2',
      project: 'NOVA 3D Director',
      source_prompt: String(plan.prompt || $('#nova3DPrompt')?.value || '').trim(),
      duration: clamp(plan.duration || $('#nova3DDuration')?.value || 5, 1, 15),
      format: plan.ratio || $('#nova3DRatio')?.value || '9:16',
      scene: plan.scene || $('#nova3DScene')?.value || 'car',
      camera: plan.path || $('#nova3DPath')?.value || 'orbit360',
      negative: plan.negative || '',
      render_policy: {
        preview_first: true,
        paid_generation: false,
        external_compute_requires_confirmation: true
      }
    };
  }

  function degreesFor(path) {
    if (path === 'orbit360') return 360;
    if (path === 'orbit' || path === 'arc') return 180;
    return 0;
  }

  function buildScenePack() {
    const plan = currentPlan();
    const degrees = degreesFor(plan.camera);
    return {
      ...plan,
      blocking: {
        subject_type: plan.scene === 'car' ? 'car' : plan.scene,
        camera_path: TRUE_3D_PATHS.has(plan.camera)
          ? {
              type: plan.camera === 'orbit' || plan.camera === 'orbit360' || plan.camera === 'arc' ? 'circle' : plan.camera,
              degrees,
              radius: 6,
              height: 2.2,
              target: [0, 0, plan.scene === 'car' ? 1.0 : 1.4],
              continuous: true,
              cuts: 0,
              interpolation: 'LINEAR'
            }
          : {
              type: 'linear',
              start: plan.camera === 'pull' ? [0, -5.6, 2.2] : [0, -7, 2.2],
              end: plan.camera === 'pull' ? [0, -7, 2.2] : [0, -5.6, 2.2],
              target: [0, 0, 1.4],
              continuous: true,
              cuts: 0,
              interpolation: 'LINEAR'
            }
      },
      virtual_camera: {
        source: state.samples.length ? 'iphone-deviceorientation' : 'none',
        note: 'iPhone orientation records rotation only. World-space camera translation remains the deterministic Blender path.',
        samples: normalizedOrientationSamples()
      },
      truthfulness_guard: {
        true_3d_required: TRUE_3D_PATHS.has(plan.camera),
        forbid_slideshow: true,
        forbid_crossfades: true,
        forbid_2d_panzoom_as_orbit: true,
        persistent_scene: true
      }
    };
  }

  function normalizedOrientationSamples() {
    if (!state.samples.length) return [];
    const first = state.samples[0];
    const delta = (value, base) => {
      let d = Number(value || 0) - Number(base || 0);
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      return Math.round(d * 1000) / 1000;
    };
    return state.samples.map((sample) => ({
      t: Math.round(sample.t * 1000) / 1000,
      yaw: delta(sample.alpha, first.alpha),
      pitch: delta(sample.beta, first.beta),
      roll: delta(sample.gamma, first.gamma)
    }));
  }

  function downloadText(name, text, type = 'application/json') {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function exportScenePack() {
    const pack = buildScenePack();
    const suffix = `${pack.camera}_${pack.duration}s_${pack.format.replace(':', 'x')}`;
    downloadText(`NOVA_scene_pack_${suffix}.json`, JSON.stringify(pack, null, 2));
    status('✅ Scene Pack сохранён. Он совместим с automation/nova_pipeline.py и Blender true-orbit renderer.');
  }

  function buildCommand() {
    const pack = currentPlan();
    const degrees = degreesFor(pack.camera) || 180;
    return `blender -b --python blender-colab/scripts/render_true_orbit.py -- --duration ${pack.duration} --fps 30 --ratio ${pack.format} --degrees ${degrees} --output NOVA_true_orbit.mp4`;
  }

  async function copyCommand() {
    const command = buildCommand();
    try {
      await navigator.clipboard.writeText(command);
      status('✅ Команда Blender скопирована. Локальный Blender создаст один непрерывный MP4 без кредитов.');
    } catch (_) {
      const box = $('#novaBlenderCommand');
      if (box) box.value = command;
      status('Команда готова ниже — скопируй вручную.');
    }
  }

  function stopOrientationCapture(message = '') {
    if (state.orientationHandler) window.removeEventListener('deviceorientation', state.orientationHandler);
    state.orientationHandler = null;
    if (state.timer) clearTimeout(state.timer);
    state.timer = 0;
    const wasRecording = state.recording;
    state.recording = false;
    const button = $('#novaBlenderPhoneCamera');
    if (button) button.textContent = '📱 Записать iPhone Camera';
    updateSummary();
    if (message) status(message);
    else if (wasRecording) status(`✅ iPhone Camera: записано ${state.samples.length} ориентационных точек. Позиция камеры остаётся Blender-path.`);
  }

  async function startOrientationCapture() {
    if (state.recording) return stopOrientationCapture('iPhone Camera остановлена.');
    const duration = currentPlan().duration;
    if (!('DeviceOrientationEvent' in window)) {
      status('На этом устройстве датчик ориентации недоступен. Blender camera path всё равно работает.');
      return;
    }
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== 'granted') throw new Error('доступ к датчику не разрешён');
      }
    } catch (error) {
      status(`iPhone Camera: ${error?.message || error}. Blender orbit можно использовать без датчика.`);
      return;
    }

    state.samples = [];
    state.startedAt = performance.now();
    state.lastSampleAt = 0;
    state.recording = true;
    const button = $('#novaBlenderPhoneCamera');
    if (button) button.textContent = '⏹ Остановить iPhone Camera';
    state.orientationHandler = (event) => {
      if (!state.recording) return;
      const now = performance.now();
      if (now - state.lastSampleAt < 30) return;
      state.lastSampleAt = now;
      state.samples.push({
        t: (now - state.startedAt) / 1000,
        alpha: Number(event.alpha || 0),
        beta: Number(event.beta || 0),
        gamma: Number(event.gamma || 0)
      });
      updateSummary();
    };
    window.addEventListener('deviceorientation', state.orientationHandler, { passive: true });
    state.timer = setTimeout(() => stopOrientationCapture(), duration * 1000);
    status(`📱 iPhone Camera: записываю повороты телефона ${duration} сек. Это добавляется поверх настоящей Blender-траектории.`);
  }

  function setControl(selector, value, eventName = 'change') {
    const node = $(selector);
    if (!node) return;
    node.value = value;
    node.dispatchEvent(new Event(eventName, { bubbles: true }));
  }

  function supraPreset() {
    setControl('#nova3DScene', 'car');
    setControl('#nova3DPath', 'orbit360');
    setControl('#nova3DDuration', '5');
    setControl('#nova3DRatio', '9:16');
    const prompt = $('#nova3DPrompt');
    if (prompt) {
      prompt.value = 'Toyota Supra стоит неподвижно. Одна камера делает непрерывный полный 360° облёт вокруг машины за 5 секунд, без склеек, без смены ракурсов, без слайдшоу. Вертикально 9:16.';
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
    }
    window.Nova3DDirector?.refresh?.();
    updateSummary();
    status('✅ Supra 360 preset: 5 сек · 9:16 · один непрерывный Blender camera path.');
  }

  function updateSummary() {
    const box = $('#novaBlenderSummary');
    const command = $('#novaBlenderCommand');
    if (!box && !command) return;
    const plan = currentPlan();
    const true3d = TRUE_3D_PATHS.has(plan.camera);
    if (box) box.textContent = `${true3d ? 'TRUE 3D' : 'LINEAR'} · ${plan.camera} · ${plan.duration}s · ${plan.format} · 0 cuts · phone samples: ${state.samples.length}`;
    if (command && document.activeElement !== command) command.value = buildCommand();
  }

  function ensureStyles() {
    if ($('#novaBlenderCameraStyles')) return;
    const style = document.createElement('style');
    style.id = 'novaBlenderCameraStyles';
    style.textContent = `
      .n3-blender{margin-top:12px;padding:12px;border:1px solid rgba(68,219,174,.24);border-radius:15px;background:linear-gradient(135deg,rgba(10,74,75,.17),rgba(24,56,120,.13))}
      .n3-blender-head{display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap}.n3-blender-head b{font-size:14px}.n3-blender-head span{font-size:10px;color:#79edc2;border:1px solid rgba(79,234,177,.24);border-radius:999px;padding:4px 7px}
      .n3-blender-note{margin:7px 0;font-size:11px;line-height:1.45;color:#9fc5d7}.n3-blender-actions{display:flex;gap:7px;flex-wrap:wrap;margin:8px 0}.n3-blender-actions button,.n3-blender-actions a{border:1px solid rgba(95,171,255,.23);border-radius:10px;background:rgba(255,255,255,.06);color:#fff;padding:8px 10px;font-weight:850;text-decoration:none}.n3-blender-actions .primary{border:0;background:linear-gradient(135deg,#0f9b73,#29c98e)}
      .n3-blender-summary{font-size:11px;color:#b7d6e8;margin:6px 0}.n3-blender-command{width:100%;box-sizing:border-box;min-height:68px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:#04101c;color:#dff7ff;padding:8px;font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical}
    `;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    const pane = $('#nova3DPane');
    if (!pane || $('#novaBlenderCameraPanel', pane)) return Boolean(pane);
    ensureStyles();
    const host = $('.n3-wrap', pane) || pane;
    const panel = document.createElement('section');
    panel.id = 'novaBlenderCameraPanel';
    panel.className = 'n3-blender';
    panel.innerHTML = `
      <div class="n3-blender-head"><b>🧊 Blender Camera Bridge</b><span>FREE · TRUE 3D · NO SLIDESHOW</span></div>
      <div class="n3-blender-note">Для Orbit/360 NOVA использует настоящий Blender camera path. Browser preview — только blockout. iPhone может записать повороты телефона; позиция камеры всегда идёт по непрерывной 3D-траектории.</div>
      <div class="n3-blender-actions">
        <button class="primary" id="novaBlenderSupra360" type="button">🚗 Supra 360 · 5s · 9:16</button>
        <button id="novaBlenderPhoneCamera" type="button">📱 Записать iPhone Camera</button>
        <button id="novaBlenderExportPack" type="button">⬇ Scene Pack JSON</button>
        <button id="novaBlenderCopyCommand" type="button">📋 Blender command</button>
        <a href="https://github.com/${REPO}/tree/blender-colab-studio" target="_blank" rel="noopener">☁ Blender Colab</a>
      </div>
      <div id="novaBlenderSummary" class="n3-blender-summary"></div>
      <textarea id="novaBlenderCommand" class="n3-blender-command" readonly></textarea>`;
    host.appendChild(panel);
    $('#novaBlenderSupra360', panel)?.addEventListener('click', supraPreset);
    $('#novaBlenderPhoneCamera', panel)?.addEventListener('click', startOrientationCapture);
    $('#novaBlenderExportPack', panel)?.addEventListener('click', exportScenePack);
    $('#novaBlenderCopyCommand', panel)?.addEventListener('click', copyCommand);
    ['#nova3DScene', '#nova3DPath', '#nova3DDuration', '#nova3DRatio', '#nova3DPrompt'].forEach((selector) => {
      $(selector)?.addEventListener('input', updateSummary);
      $(selector)?.addEventListener('change', updateSummary);
    });
    state.pane = pane;
    updateSummary();
    return true;
  }

  function open(plan) {
    try { window.NovaUnifiedVideoStudio?.select?.('3d'); } catch (_) {}
    ensurePanel();
    updateSummary();
    $('#novaBlenderCameraPanel')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    const p = plan || currentPlan();
    status(TRUE_3D_PATHS.has(p.path || p.camera)
      ? '🧊 Blender stage открыт: один непрерывный 3D camera path, без подмены картинками.'
      : 'Blender Camera Bridge готов.');
  }

  function install() {
    if (ensurePanel()) return;
    const observer = new MutationObserver(() => {
      if (ensurePanel()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.NovaBlenderCamera = Object.freeze({
    version: VERSION,
    ensurePanel,
    open,
    exportScenePack,
    startOrientationCapture,
    stopOrientationCapture,
    buildScenePack,
    buildCommand,
    isTrue3DPath: (path) => TRUE_3D_PATHS.has(path)
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
