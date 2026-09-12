(() => {
  'use strict';

  if (window.__novaVideoUpgradeInstalled) return;
  window.__novaVideoUpgradeInstalled = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const FFMPEG_MODULE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/+esm';
  const FFMPEG_UTIL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/+esm';
  const FFMPEG_CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';

  let previewUrl = '';
  let latestEnglishSrt = '';
  let latestCues = [];
  let ffmpegState = null;
  const generatedUrls = [];

  function status(message) {
    const local = $('#novaMediaStatus');
    if (local) local.textContent = message;
    const global = $('#statusText');
    if (global) global.textContent = message;
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function parseTime(value) {
    const parts = String(value || '').trim().replace(',', '.').split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return Number(parts[0]) || 0;
  }

  function parseSrt(text) {
    return String(text || '').replace(/\r/g, '').trim().split(/\n\s*\n/).map((block) => {
      const lines = block.split('\n').filter(Boolean);
      const timingIndex = lines.findIndex((line) => line.includes('-->'));
      if (timingIndex < 0) return null;
      const [a, b] = lines[timingIndex].split('-->').map((v) => v.trim().split(/\s+/)[0]);
      const start = parseTime(a);
      const end = parseTime(b);
      const value = cleanText(lines.slice(timingIndex + 1).join(' ').replace(/<[^>]+>/g, ''));
      if (!value || !(end > start)) return null;
      return { start, end, duration: end - start, text: value };
    }).filter(Boolean);
  }

  function injectStyles() {
    if ($('#novaVideoUpgradeStyles')) return;
    const style = document.createElement('style');
    style.id = 'novaVideoUpgradeStyles';
    style.textContent = `
      .nova-video-preview-wrap{position:relative;margin:10px 0;border:1px solid rgba(112,173,255,.25);border-radius:16px;overflow:hidden;background:#02050d;min-height:150px}
      .nova-video-preview-wrap video{display:block;width:100%;max-height:360px;background:#000}
      .nova-video-overlay{position:absolute;left:6%;right:6%;bottom:14px;text-align:center;color:#fff;font-weight:900;font-size:clamp(14px,3.4vw,21px);line-height:1.2;text-shadow:0 2px 8px #000,0 0 3px #000;background:rgba(0,0,0,.28);border-radius:9px;padding:6px 9px;pointer-events:none}
      .nova-subtitle-quality{margin:7px 0;padding:8px 10px;border-radius:12px;background:rgba(255,255,255,.05);font-size:12px;color:#b9cdee}
      .nova-subtitle-quality.good{color:#9ff0c9;background:rgba(17,143,91,.14)}
      .nova-subtitle-quality.warn{color:#ffd590;background:rgba(195,116,13,.14)}
      .nova-motion-preview{position:relative;overflow:hidden;border-radius:16px;background:#000;border:1px solid rgba(122,173,255,.24);min-height:180px;margin:10px 0}
      .nova-motion-preview video{display:block;width:100%;max-height:360px;transform-origin:center center}
      .nova-motion-preview.cinema video{filter:contrast(1.14) saturate(.9) brightness(.93)}
      .nova-motion-preview.cinema:before,.nova-motion-preview.cinema:after{content:'';position:absolute;left:0;right:0;height:9%;background:#000;z-index:2;pointer-events:none}.nova-motion-preview.cinema:before{top:0}.nova-motion-preview.cinema:after{bottom:0}
      .nova-motion-preview.hologram video{filter:hue-rotate(145deg) saturate(1.8) contrast(1.15);opacity:.76;animation:novaHoloPulse 1.4s ease-in-out infinite alternate}
      .nova-motion-preview.threed video{filter:drop-shadow(6px 0 0 rgba(255,0,60,.45)) drop-shadow(-6px 0 0 rgba(0,220,255,.45));transform:perspective(900px) rotateY(-5deg) scale(1.02)}
      .nova-motion-preview.motion video{animation:novaMotionControl 8s ease-in-out infinite alternate}
      .nova-motion-preview.animation video{animation:novaFloatVideo 4.2s ease-in-out infinite alternate}
      @keyframes novaMotionControl{0%{transform:scale(1.02) translate3d(-1.5%,0,0)}50%{transform:scale(1.1) translate3d(1.5%,-1%,0)}100%{transform:scale(1.16) translate3d(-.5%,1%,0)}}
      @keyframes novaFloatVideo{0%{transform:perspective(900px) rotateX(1deg) rotateY(-2deg) translateY(0)}100%{transform:perspective(900px) rotateX(-1deg) rotateY(2deg) translateY(-7px)}}
      @keyframes novaHoloPulse{0%{opacity:.62}100%{opacity:.88}}
      .nova-motion-plan{white-space:pre-wrap;line-height:1.45;padding:10px 12px;border-radius:13px;background:rgba(255,255,255,.045);color:#c7d7ef;font-size:12px}
      @media(max-width:620px){.nova-media-tabs{grid-template-columns:1fr 1fr!important}.nova-video-preview-wrap video,.nova-motion-preview video{max-height:300px}}
    `;
    document.head.appendChild(style);
  }

  function setPreviewFile(file) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    if (!file) return;
    previewUrl = URL.createObjectURL(file);
    const preview = $('#novaLocalPreview');
    const motion = $('#novaMotionPreviewVideo');
    if (preview) preview.src = previewUrl;
    if (motion) motion.src = previewUrl;
    status(`Видео выбрано: ${file.name}. MP4 и MOV поддерживаются.`);
  }

  function subtitleQuality(cues) {
    const preview = $('#novaLocalPreview');
    const duration = Number(preview?.duration || 0) || Math.max(0, ...cues.map((c) => c.end));
    const normalized = cues.map((c) => cleanText(c.text).toLowerCase());
    let repeated = 0;
    let covered = 0;
    let longestGap = 0;
    let previousEnd = 0;
    cues.forEach((cue, index) => {
      covered += Math.max(0, cue.duration);
      if (index > 0 && normalized[index] === normalized[index - 1]) repeated += 1;
      if (index > 0) longestGap = Math.max(longestGap, Math.max(0, cue.start - previousEnd));
      previousEnd = Math.max(previousEnd, cue.end);
    });
    const unique = new Set(normalized.filter(Boolean)).size;
    const coverage = duration > 0 ? Math.min(1, covered / duration) : 0;
    const warnings = [];
    if (!cues.length) warnings.push('Нет субтитров.');
    if (repeated) warnings.push(`Повторяющихся соседних реплик: ${repeated}.`);
    if (duration >= 8 && coverage > 0 && coverage < 0.35) warnings.push(`Субтитры покрывают только ~${Math.round(coverage * 100)}% длительности.`);
    if (cues.length >= 4 && unique / cues.length < 0.55) warnings.push('Слишком много одинаковых реплик — возможна неполная расшифровка.');
    if (longestGap > 7) warnings.push(`Есть большой разрыв без субтитров: ~${longestGap.toFixed(1)} сек.`);
    return { duration, coverage, repeated, unique, warnings };
  }

  function renderQuality() {
    const node = $('#novaSubtitleQuality');
    if (!node) return;
    const qa = subtitleQuality(latestCues);
    if (!latestCues.length) {
      node.className = 'nova-subtitle-quality warn';
      node.textContent = 'English SRT ещё не создан. После Whisper NOVA автоматически проверит полноту и повторы.';
      return;
    }
    if (qa.warnings.length) {
      node.className = 'nova-subtitle-quality warn';
      node.textContent = `🟡 Проверка EN SRT: ${latestCues.length} реплик. ${qa.warnings.join(' ')} Исправь строки в редакторе перед финальным видео, если речь действительно пропущена.`;
    } else {
      node.className = 'nova-subtitle-quality good';
      node.textContent = `🟢 EN SRT выглядит цельным: ${latestCues.length} реплик, явных повторов и больших провалов не найдено.`;
    }
  }

  function syncSubtitleOverlay() {
    const video = $('#novaLocalPreview');
    const overlay = $('#novaVideoOverlay');
    if (!video || !overlay) return;
    const t = Number(video.currentTime || 0);
    const cue = latestCues.find((item) => t >= item.start && t < item.end);
    overlay.textContent = cue?.text || '';
    overlay.hidden = !cue;
  }

  async function captureLatestEnglishSrt() {
    const links = [...document.querySelectorAll('#novaDubDownloads a')];
    const preferred = links.find((a) => a.textContent.includes('English SRT · исправленный'))
      || links.find((a) => a.textContent.includes('English SRT'));
    if (!preferred?.href) return;
    try {
      const response = await fetch(preferred.href);
      if (!response.ok) return;
      const text = await response.text();
      const cues = parseSrt(text);
      if (!cues.length) return;
      latestEnglishSrt = text;
      latestCues = cues;
      renderQuality();
      syncSubtitleOverlay();
    } catch (_) {}
  }

  async function ensureFfmpeg() {
    if (ffmpegState) return ffmpegState;
    status('Загружаю бесплатный FFmpeg для нового MP4/MOV с английской дорожкой (~31 МБ, один раз)…');
    const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([
      import(FFMPEG_MODULE),
      import(FFMPEG_UTIL)
    ]);
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({
      coreURL: await toBlobURL(`${FFMPEG_CORE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${FFMPEG_CORE}/ffmpeg-core.wasm`, 'application/wasm')
    });
    ffmpegState = { ffmpeg, fetchFile };
    return ffmpegState;
  }

  async function muxEnglishSubtitles() {
    const file = $('#novaLocalVideo')?.files?.[0];
    if (!file) return status('Сначала выбери исходное MP4 или MOV.');
    await captureLatestEnglishSrt();
    if (!latestEnglishSrt || !latestCues.length) return status('Сначала создай или исправь English SRT через Whisper.');

    const qa = subtitleQuality(latestCues);
    if (qa.repeated >= 2) return status('Остановлено: в EN SRT есть повторяющиеся соседние реплики. Сначала исправь субтитры в редакторе.');

    const { ffmpeg, fetchFile } = await ensureFfmpeg();
    const originalExt = /\.mov$/i.test(file.name) ? 'mov' : 'mp4';
    const input = `nova-input-${Date.now()}.${originalExt}`;
    const subs = `nova-subs-${Date.now()}.srt`;
    const output = `nova-output-${Date.now()}.${originalExt}`;
    try {
      status(`Собираю новое ${originalExt.toUpperCase()} с исправленной English subtitle track без перекодирования видео…`);
      await ffmpeg.writeFile(input, await fetchFile(file));
      await ffmpeg.writeFile(subs, new TextEncoder().encode(latestEnglishSrt));
      const code = await ffmpeg.exec([
        '-i', input, '-i', subs,
        '-map', '0:v?', '-map', '0:a?', '-map', '1:0',
        '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'mov_text',
        '-metadata:s:s:0', 'language=eng', '-metadata:s:s:0', 'title=English',
        '-movflags', '+faststart', output
      ]);
      if (code !== 0) throw new Error(`FFmpeg завершился с кодом ${code}.`);
      const data = await ffmpeg.readFile(output);
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data.buffer || data);
      const blob = new Blob([bytes], { type: originalExt === 'mov' ? 'video/quicktime' : 'video/mp4' });
      const url = URL.createObjectURL(blob);
      generatedUrls.push(url);
      const downloads = $('#novaDubDownloads');
      if (downloads) {
        downloads.querySelectorAll('[data-nova-video-mux],[data-nova-video-photo]').forEach((n) => n.remove());
        const link = document.createElement('a');
        const base = file.name.replace(/\.[^.]+$/, '') || 'NOVA_video';
        const outputName = `${base}_EN_SUBTITLES_FIXED.${originalExt}`;
        link.href = url;
        link.download = outputName;
        link.textContent = `⬇ Новое ${originalExt.toUpperCase()} + исправленный EN SRT`;
        link.dataset.novaVideoMux = '1';
        downloads.appendChild(link);

        if (window.NovaIOSSave?.makePhotoButton) {
          const photoButton = window.NovaIOSSave.makePhotoButton({
            blob,
            name: outputName,
            label: `📲 ${originalExt.toUpperCase()} → «Фото»`,
            className: 'nova-media-btn',
            dataset: { novaVideoPhoto: '1' }
          });
          downloads.appendChild(photoButton);
        }
      }
      status(`✅ Новое ${originalExt.toUpperCase()} готово. На iPhone нажми «${originalExt.toUpperCase()} → Фото» и в системном меню выбери «Сохранить видео».`);
    } catch (error) {
      status(`Не удалось собрать новое видео: ${error?.message || error}`);
    } finally {
      try { await ffmpeg.deleteFile(input); } catch (_) {}
      try { await ffmpeg.deleteFile(subs); } catch (_) {}
      try { await ffmpeg.deleteFile(output); } catch (_) {}
    }
  }

  function selectCustomTab(name) {
    document.querySelectorAll('[data-media-tab]').forEach((button) => button.classList.toggle('active', button.dataset.mediaTab === name));
    document.querySelectorAll('[data-media-pane]').forEach((pane) => { pane.hidden = pane.dataset.mediaPane !== name; });
  }

  function applyMotionStyle() {
    const wrap = $('#novaMotionPreviewWrap');
    const mode = $('#novaMotionMode')?.value || 'motion';
    if (!wrap) return;
    wrap.className = `nova-motion-preview ${mode}`;
    const labels = {
      motion: 'Motion Control: плавный push-in + pan, без скачков камеры.',
      cinema: 'Cinema: контраст, мягкая цветокоррекция и киношные полосы.',
      threed: '3D: локальный anaglyph/depth-look preview.',
      hologram: 'Hologram: голубой голографический preview; полноценная WebGL-голограмма — в соседней вкладке.',
      animation: 'Animation: плавная 3D-плавающая анимация исходного видео.'
    };
    const plan = $('#novaMotionPlan');
    if (plan) plan.textContent = `${labels[mode]}\nДля отдельной генерации анимации открой Motion Studio. Для настоящей 3D-голограммы используй вкладку «3D голограмма».`;
  }

  function addMotionPane(modal) {
    const tabs = $('.nova-media-tabs', modal);
    if (!tabs || $('#novaMotionTab')) return;
    tabs.style.gridTemplateColumns = 'repeat(4,1fr)';
    const tab = document.createElement('button');
    tab.id = 'novaMotionTab';
    tab.className = 'nova-media-tab';
    tab.type = 'button';
    tab.dataset.mediaTab = 'motion';
    tab.textContent = '🎬 Motion / Cinema';
    tabs.appendChild(tab);

    const card = $('.nova-media-card', modal);
    const statusNode = $('#novaMediaStatus', modal);
    const pane = document.createElement('div');
    pane.className = 'nova-media-pane';
    pane.dataset.mediaPane = 'motion';
    pane.hidden = true;
    pane.innerHTML = `
      <div class="nova-media-note"><b>🎬 Video Motion / Cinema</b><br>Один раздел для MP4/MOV preview, Motion Control, Cinema, 3D-look, анимации и перехода в локальный Motion Studio. Платные генерации не запускаются.</div>
      <div class="nova-media-grid">
        <div class="nova-media-field"><label for="novaMotionMode">Режим</label><select id="novaMotionMode"><option value="motion">Motion Control</option><option value="cinema">Cinema</option><option value="threed">3D look</option><option value="hologram">Hologram look</option><option value="animation">Animation</option></select></div>
        <div class="nova-media-field"><label>Источник</label><input value="То же MP4/MOV из вкладки Видео" disabled></div>
      </div>
      <div class="nova-media-actions"><button class="nova-media-btn primary" id="novaOpenMotionStudio" type="button">🎞 Открыть Motion Studio</button><button class="nova-media-btn" id="novaOpenHologram" type="button">🫧 3D голограмма</button></div>
      <div class="nova-motion-preview motion" id="novaMotionPreviewWrap"><video id="novaMotionPreviewVideo" controls playsinline muted></video></div>
      <div class="nova-motion-plan" id="novaMotionPlan">Motion Control: плавный push-in + pan, без скачков камеры.</div>`;
    card.insertBefore(pane, statusNode || null);

    tab.addEventListener('click', () => selectCustomTab('motion'));
    $('#novaMotionMode', pane)?.addEventListener('change', applyMotionStyle);
    $('#novaOpenMotionStudio', pane)?.addEventListener('click', () => { window.location.href = './motion-studio/'; });
    $('#novaOpenHologram', pane)?.addEventListener('click', () => {
      const holoTab = document.querySelector('[data-media-tab="holo"]');
      if (holoTab) holoTab.click();
    });
    applyMotionStyle();
  }

  function addVideoPreview(modal) {
    const input = $('#novaLocalVideo', modal);
    if (!input || $('#novaLocalPreview')) return;
    input.accept = 'video/mp4,video/quicktime,.mp4,.mov';
    const grid = input.closest('.nova-media-grid');
    if (!grid) return;

    const box = document.createElement('div');
    box.innerHTML = `
      <div class="nova-video-preview-wrap"><video id="novaLocalPreview" controls playsinline></video><div class="nova-video-overlay" id="novaVideoOverlay" hidden></div></div>
      <div class="nova-subtitle-quality warn" id="novaSubtitleQuality">English SRT ещё не создан. После Whisper NOVA автоматически проверит полноту и повторы.</div>
      <div class="nova-media-actions"><button class="nova-media-btn" id="novaSubtitleCheck" type="button">✓ Проверить EN SRT</button><button class="nova-media-btn primary" id="novaMuxSubtitleVideo" type="button">🎥 Новое MP4/MOV + EN subtitles</button></div>
      <div class="nova-media-note">Кнопка создаёт новый MP4/MOV с отдельной английской subtitle track и не пережимает исходное видео. На iPhone после сборки появится отдельная кнопка «В Фото», которая открывает системное меню iOS. Для проверки текста субтитры также показываются поверх preview.</div>`;
    grid.insertAdjacentElement('afterend', box);

    const preview = $('#novaLocalPreview');
    preview?.addEventListener('timeupdate', syncSubtitleOverlay);
    preview?.addEventListener('loadedmetadata', renderQuality);
    input.addEventListener('change', () => setPreviewFile(input.files?.[0] || null));
    $('#novaSubtitleCheck')?.addEventListener('click', () => captureLatestEnglishSrt().then(renderQuality));
    $('#novaMuxSubtitleVideo')?.addEventListener('click', () => muxEnglishSubtitles().catch((error) => status(`Видео: ${error?.message || error}`)));
    if (input.files?.[0]) setPreviewFile(input.files[0]);
  }

  function watchDownloads() {
    const observer = new MutationObserver(() => { captureLatestEnglishSrt().catch(() => {}); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function installWhenReady() {
    const tryInstall = () => {
      const modal = $('#novaMediaModal');
      const input = $('#novaLocalVideo');
      if (!modal || !input) return false;
      injectStyles();
      addVideoPreview(modal);
      addMotionPane(modal);
      watchDownloads();
      return true;
    };
    if (tryInstall()) return;
    const observer = new MutationObserver(() => {
      if (tryInstall()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installWhenReady, { once: true });
  else installWhenReady();
})();