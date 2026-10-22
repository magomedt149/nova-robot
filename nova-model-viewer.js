(() => {
  'use strict';
  if (window.NovaModelViewer) return;
  const MAX_BYTES = 50 * 1024 * 1024;
  let viewer, panel, objectURL, revision = 0, loading;
  const $ = (id) => panel.querySelector('#' + id);
  const status = (text) => { $('novaModelStatus').textContent = text; };

  // Accept self-contained models only: opening a local file must not fetch assets
  // or decoder code from a CDN. Compressed models need an explicit offline export.
  function validateGLB(buffer) {
    const view = new DataView(buffer);
    if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 ||
        view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== view.byteLength ||
        view.getUint32(16, true) !== 0x4e4f534a) throw new Error('Нужен корректный GLB 2.0.');
    const length = view.getUint32(12, true);
    if (20 + length > view.byteLength) throw new Error('Файл GLB повреждён.');
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
    if (json.asset?.version !== '2.0') throw new Error('Нужен GLB версии 2.0.');
    const compressed = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'];
    if ([...(json.extensionsUsed || []), ...(json.extensionsRequired || [])].some(x => compressed.includes(x))) {
      throw new Error('Экспортируй GLB без Draco/Meshopt/KTX2: этот просмотр работает без внешних декодеров.');
    }
    for (const item of [...(json.buffers || []), ...(json.images || [])]) {
      if (item.uri && !/^data:/i.test(item.uri)) throw new Error('Текстуры и геометрия должны быть встроены в GLB.');
    }
    return json;
  }

  function reset() {
    revision++;
    viewer?.remove(); viewer = null;
    $('novaModelHost').replaceChildren();
    const ar = $('novaModelUSDZ'); ar.hidden = true; ar.removeAttribute('href');
    $('novaModelAR').disabled = true; $('novaModelReset').disabled = true;
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = null;
  }

  async function openFile(file) {
    reset(); const ticket = revision;
    if (!file) return;
    try {
      if (!file.size || file.size > MAX_BYTES) throw new Error('Выбери модель размером до 50 МБ.');
      const extension = file.name.split('.').pop().toLowerCase();
      if (!['glb', 'usdz'].includes(extension)) throw new Error('Поддерживаются GLB и USDZ.');
      status('Открываю модель на этом устройстве…');
      const buffer = await file.arrayBuffer();
      if (ticket !== revision) return;
      if (extension === 'usdz') {
        const bytes = new Uint8Array(buffer);
        if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Файл USDZ повреждён.');
        objectURL = URL.createObjectURL(new Blob([buffer], {type:'model/vnd.usdz+zip'}));
        const link = $('novaModelUSDZ'); link.href = objectURL; link.hidden = false;
        status(file.name + ' · Нажми «Открыть USDZ в комнате». Если PWA не открывает AR, используй Safari или сохрани файл в «Файлы».');
        return;
      }
      validateGLB(buffer);
      loading ||= import('./vendor/model-viewer-4.1.0.min.js').catch(error => { loading = null; throw error; });
      await loading;
      if (ticket !== revision) return;
      viewer = document.createElement('model-viewer');
      viewer.setAttribute('camera-controls', '');
      viewer.setAttribute('touch-action', 'none');
      viewer.setAttribute('ar', '');
      viewer.setAttribute('ar-modes', 'quick-look');
      viewer.setAttribute('shadow-intensity', '1');
      viewer.setAttribute('exposure', '1');
      viewer.setAttribute('alt', file.name);
      viewer.style.cssText = 'display:block;width:100%;height:360px;background:#101a2b;border-radius:12px;touch-action:none';
      viewer.addEventListener('load', () => {
        if (ticket !== revision) return;
        $('novaModelReset').disabled = false;
        $('novaModelAR').disabled = !viewer.canActivateAR;
        status(file.name + ' · Вращай одним пальцем, приближай двумя. Модель остаётся на устройстве.');
      });
      viewer.addEventListener('error', () => {
        if (ticket !== revision) return;
        $('novaModelAR').disabled = true;
        status('Не удалось показать GLB. Проверь файл и поддержку WebGL в Safari.');
      });
      objectURL = URL.createObjectURL(new Blob([buffer], {type:'model/gltf-binary'}));
      viewer.src = objectURL;
      $('novaModelHost').appendChild(viewer);
    } catch (error) { if (ticket === revision) status(error.message || 'Не удалось открыть модель.'); }
  }

  function install() {
    const host = document.querySelector('#nova3DPane .n3-wrap');
    if (!host || panel) return Boolean(panel);
    panel = document.createElement('section'); panel.className = 'n3-card';
    panel.innerHTML = `<h3>Моя 3D-модель · iPhone</h3>
      <p class="n3-note">GLB: вращение пальцем и приближение. USDZ: просмотр через камеру в AR Quick Look. Файлы никуда не загружаются. Это отдельный просмотр модели, без Blender Agent.</p>
      <label class="n3-field">Выбрать GLB или USDZ <input id="novaModelFile" type="file" accept=".glb,.usdz"></label>
      <div id="novaModelHost"></div>
      <div class="n3-actions"><button id="novaModelReset" type="button" disabled>Сбросить ракурс</button><button id="novaModelAR" type="button" disabled>Показать в комнате</button><button id="novaModelClear" type="button">Закрыть модель</button></div>
      <a id="novaModelUSDZ" rel="ar" hidden><img src="./icon-192.png" alt="Открыть USDZ в комнате" width="48" height="48"> Открыть USDZ в комнате</a>
      <p id="novaModelStatus" class="n3-note" role="status" aria-live="polite">Выбери свою 3D-модель. Фото и MP4 не являются 3D-моделями.</p>`;
    host.prepend(panel);
    $('novaModelFile').addEventListener('change', e => openFile(e.target.files[0]));
    $('novaModelClear').addEventListener('click', () => { reset(); $('novaModelFile').value = ''; status('Модель закрыта.'); });
    $('novaModelReset').addEventListener('click', () => { if (viewer) { viewer.cameraOrbit = '0deg 75deg auto'; viewer.fieldOfView = 'auto'; viewer.jumpCameraToGoal(); } });
    $('novaModelAR').addEventListener('click', async () => {
      try { await viewer?.activateAR(); } catch (_) { status('AR не открылся. Открой приложение в Safari или используй USDZ в «Файлах».'); }
    });
    return true;
  }
  window.NovaModelViewer = Object.freeze({validateGLB, openFile});
  const observer = new MutationObserver(() => { if (install()) observer.disconnect(); });
  if (!install()) observer.observe(document.documentElement, {childList:true, subtree:true});
})();
