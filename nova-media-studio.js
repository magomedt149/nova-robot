(() => {
  'use strict';

  if (window.__novaMediaStudioInstalled) return;
  window.__novaMediaStudioInstalled = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const MAX_YOUTUBE_SECONDS = 120;
  const LAME_URL = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';
  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
  const PROXIES = [
    (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://api.codetabs.com/v1/proxy?quest=${url}`,
    (url) => `https://corsproxy.org/?${encodeURIComponent(url)}`
  ];

  let storyText = '';
  let storyMode = 'dialogue';
  let youtubeOriginal = [];
  let youtubeRussian = [];
  let youtubeEnglishSubs = [];
  let youtubeSourceLanguage = 'en';
  let threeState = null;
  let currentObjectUrls = [];

  function status(message) {
    const node = $('#novaMediaStatus');
    if (node) node.textContent = message;
    const global = $('#statusText');
    if (global) global.textContent = message;
  }

  function revokeDownloads() {
    currentObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    currentObjectUrls = [];
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function sentenceSplit(text) {
    return cleanText(text).match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g)?.map((s) => s.trim()).filter(Boolean) || [];
  }

  function countWords(text) {
    return cleanText(text).split(/\s+/).filter(Boolean).length;
  }

  function injectStyles() {
    if ($('#novaMediaStyles')) return;
    const style = document.createElement('style');
    style.id = 'novaMediaStyles';
    style.textContent = `
      .nova-media-modal{position:fixed;inset:0;z-index:100010;background:rgba(2,5,16,.78);backdrop-filter:blur(14px);display:grid;place-items:center;padding:12px}.nova-media-modal[hidden]{display:none}
      .nova-media-card{width:min(820px,100%);max-height:92vh;overflow:auto;background:linear-gradient(180deg,#0d1735,#060a1a);border:1px solid rgba(121,174,255,.28);border-radius:24px;padding:16px;color:#f6f8ff;box-shadow:0 30px 90px rgba(0,0,0,.55)}
      .nova-media-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.nova-media-head h2{margin:0;font-size:19px}.nova-media-close{width:38px;height:38px;border:0;border-radius:50%;font-size:24px;background:rgba(255,255,255,.09);color:white}
      .nova-media-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:12px 0}.nova-media-tab{border:1px solid rgba(255,255,255,.12);border-radius:13px;padding:10px 7px;background:rgba(255,255,255,.05);color:#dce8ff;font-weight:800}.nova-media-tab.active{background:linear-gradient(135deg,#176fff,#7447ff);border-color:transparent;color:white}
      .nova-media-pane[hidden]{display:none}.nova-media-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.nova-media-field{display:grid;gap:6px;margin:8px 0}.nova-media-field label{font-size:12px;color:#a9c1eb;font-weight:800}.nova-media-field input,.nova-media-field textarea,.nova-media-field select{box-sizing:border-box;width:100%;border:1px solid rgba(255,255,255,.14);border-radius:14px;background:#070d20;color:white;padding:11px;font:inherit}.nova-media-field textarea{min-height:105px;resize:vertical}
      .nova-media-actions{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.nova-media-btn{border:0;border-radius:13px;padding:10px 12px;background:rgba(255,255,255,.09);color:white;font-weight:800}.nova-media-btn.primary{background:linear-gradient(135deg,#157bff,#7346ff)}.nova-media-btn.good{background:linear-gradient(135deg,#079b67,#21c58e)}.nova-media-btn.warn{background:linear-gradient(135deg,#ff8c22,#f05b3e)}
      .nova-media-status{min-height:22px;color:#9dc0f0;font-size:13px;margin:7px 0}.nova-media-result{white-space:pre-wrap;line-height:1.48;min-height:85px;padding:12px;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:rgba(255,255,255,.045)}.nova-media-note{font-size:12px;color:#8fa8cf;margin:7px 0}.nova-media-downloads{display:flex;flex-wrap:wrap;gap:7px;margin:9px 0}.nova-media-downloads a{display:inline-flex;padding:9px 11px;border-radius:12px;background:rgba(40,136,255,.18);border:1px solid rgba(78,157,255,.3);color:#dceaff;text-decoration:none;font-weight:800}
      .nova-3d-wrap{position:relative;min-height:340px;border-radius:18px;overflow:hidden;background:#020610;border:1px solid rgba(91,171,255,.24)}.nova-3d-wrap canvas{width:100%!important;height:340px!important;display:block}.nova-3d-subtitle{position:absolute;left:7%;right:7%;bottom:18px;text-align:center;color:white;font-weight:900;font-size:17px;text-shadow:0 2px 8px #000;padding:7px 9px;background:rgba(0,0,0,.28);border-radius:10px}
      @media(max-width:620px){.nova-media-grid{grid-template-columns:1fr}.nova-media-tabs{grid-template-columns:1fr}.nova-media-card{border-radius:20px}.nova-3d-wrap canvas{height:300px!important}}
    `;
    document.head.appendChild(style);
  }

  function buildUi() {
    if ($('#novaMediaModal')) return;
    const modal = document.createElement('section');
    modal.id = 'novaMediaModal';
    modal.className = 'nova-media-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="nova-media-card" role="dialog" aria-modal="true" aria-label="NOVA Media Studio">
        <div class="nova-media-head"><h2>🎙️ NOVA Media Studio</h2><button class="nova-media-close" id="novaMediaClose" type="button">×</button></div>
        <div class="nova-media-note">Основные русские голоса: <b>Ирина</b> + <b>Денис</b>. Аудиокниги, двухголосные диалоги, YouTube/видео → MP3, английские SRT и локальная 3D-голограмма без платного API.</div>
        <div class="nova-media-tabs">
          <button class="nova-media-tab active" data-media-tab="story" type="button">📖 Рассказ 2 мин</button>
          <button class="nova-media-tab" data-media-tab="dub" type="button">🎞️ Видео → MP3</button>
          <button class="nova-media-tab" data-media-tab="holo" type="button">🫧 3D голограмма</button>
        </div>

        <div class="nova-media-pane" data-media-pane="story">
          <div class="nova-media-field"><label for="novaStoryTopic">Тема рассказа / аудиокниги</label><input id="novaStoryTopic" value="Ночной город, дождь, иногда град и загадочная голограмма"></div>
          <div class="nova-media-grid">
            <div class="nova-media-field"><label for="novaStoryMode">Голоса</label><select id="novaStoryMode"><option value="dialogue">Ирина + Денис — диалог</option><option value="irina">Ирина — аудиокнига</option><option value="denis">Денис — аудиокнига</option></select></div>
            <div class="nova-media-field"><label>Целевая длина</label><input value="≈ 2 минуты · 230–270 слов" disabled></div>
          </div>
          <div class="nova-media-actions"><button class="nova-media-btn primary" id="novaGenerateStory" type="button">✨ Создать рассказ</button><button class="nova-media-btn good" id="novaPlayStory" type="button">▶ Слушать</button><button class="nova-media-btn" id="novaStoryMp3" type="button">MP3</button><button class="nova-media-btn" id="novaStorySrt" type="button">EN subtitles .SRT</button></div>
          <div class="nova-media-result" id="novaStoryResult">NOVA может сама подготовить примерно двухминутный русский рассказ. Если локальный мозг уже включён — использует его; иначе создаёт рассказ встроенным бесплатным генератором.</div>
          <div class="nova-media-downloads" id="novaStoryDownloads"></div>
        </div>

        <div class="nova-media-pane" data-media-pane="dub" hidden>
          <div class="nova-media-field"><label for="novaDubYoutube">YouTube URL</label><input id="novaDubYoutube" inputmode="url" placeholder="https://youtube.com/watch?v=…"></div>
          <div class="nova-media-actions"><button class="nova-media-btn primary" id="novaYoutubeExact" type="button">YouTube → русский MP3 + EN SRT</button></div>
          <div class="nova-media-note">Режим сохраняет сегменты субтитров и их тайминг. Если исходник английский — он становится английскими субтитрами, а речь переводится на русский и чередуется голосами Ирина/Денис.</div>
          <hr style="border:0;border-top:1px solid rgba(255,255,255,.1);margin:14px 0">
          <div class="nova-media-grid">
            <div class="nova-media-field"><label for="novaLocalVideo">Локальное видео</label><input id="novaLocalVideo" type="file" accept="video/*"></div>
            <div class="nova-media-field"><label for="novaLocalSubs">Точные субтитры SRT/VTT</label><input id="novaLocalSubs" type="file" accept=".srt,.vtt,text/vtt,application/x-subrip"></div>
          </div>
          <div class="nova-media-actions"><button class="nova-media-btn good" id="novaLocalExact" type="button">Видео + субтитры → русский MP3 + EN SRT</button></div>
          <div class="nova-media-result" id="novaDubResult">Готово к обработке. Для локального видео точный режим использует его SRT/VTT; так тайминг не теряется.</div>
          <div class="nova-media-downloads" id="novaDubDownloads"></div>
        </div>

        <div class="nova-media-pane" data-media-pane="holo" hidden>
          <div class="nova-media-grid">
            <div class="nova-media-field"><label for="novaHoloWeather">Погода</label><select id="novaHoloWeather"><option value="rain-hail">Дождь + иногда град</option><option value="rain">Только дождь</option><option value="none">Без осадков</option></select></div>
            <div class="nova-media-field"><label for="novaHoloSubtitle">English subtitle</label><input id="novaHoloSubtitle" value="The city is quiet, but the hologram is still awake."></div>
          </div>
          <div class="nova-media-actions"><button class="nova-media-btn primary" id="novaStartHolo" type="button">▶ 3D preview</button><button class="nova-media-btn warn" id="novaRecordHolo" type="button">⏺ Записать 10 сек</button><button class="nova-media-btn" id="novaStopHolo" type="button">⏹ Стоп</button></div>
          <div class="nova-3d-wrap" id="nova3dWrap"><div class="nova-3d-subtitle" id="nova3dSubtitle">The city is quiet, but the hologram is still awake.</div></div>
          <div class="nova-media-downloads" id="novaHoloDownloads"></div>
          <div class="nova-media-note">3D-голограмма, дождь и периодический град рендерятся локально WebGL. Запись — локальный WebM/MP4, если формат поддерживает браузер.</div>
        </div>
        <div class="nova-media-status" id="novaMediaStatus">Готово. Платные AI-кредиты не используются.</div>
      </div>`;
    document.body.appendChild(modal);

    const quick = $('#quickActions');
    if (quick && !$('#novaMediaLaunch')) {
      const button = document.createElement('button');
      button.id = 'novaMediaLaunch';
      button.className = 'action-btn';
      button.type = 'button';
      button.innerHTML = '<span>🎙️</span><b>Аудио/3D</b>';
      button.addEventListener('click', () => { modal.hidden = false; });
      quick.appendChild(button);
    }
  }

  function selectTab(name) {
    document.querySelectorAll('[data-media-tab]').forEach((button) => button.classList.toggle('active', button.dataset.mediaTab === name));
    document.querySelectorAll('[data-media-pane]').forEach((pane) => { pane.hidden = pane.dataset.mediaPane !== name; });
  }

  function builtInStory(topic) {
    const subject = cleanText(topic) || 'ночной город и загадочная голограмма';
    const paragraphs = [
      `Вечером город медленно затихал. Над улицами шёл ровный дождь, и в мокром асфальте отражались вывески. История началась с темы: ${subject}. Ирина остановилась у старого павильона, где несколько лет никто не включал свет. Вдруг внутри появился голубоватый силуэт — не человек и не обычный экран, а объёмная голограмма, будто собранная из тысяч маленьких частиц.`,
      `— Ты тоже это видишь? — тихо спросила Ирина. Денис подошёл ближе и прислушался к дождю. — Вижу. И мне кажется, она пытается что-то сказать. Силуэт поднял руку, а вокруг него пробежали тонкие световые линии. На секунду дождь усилился, по крыше застучал редкий град, затем снова остались только мягкие капли.`,
      `Голограмма показала старую карту города. На ней одна улица светилась ярче остальных. Ирина решила идти первой, Денис включил фонарь и пошёл рядом. Они двигались через пустой сквер, где ветер раскачивал мокрые ветви. Каждый раз, когда они сомневались в направлении, световая фигура возникала впереди на несколько секунд и снова растворялась.`,
      `У старого моста они нашли маленький металлический футляр. Внутри лежала фотография и записка: «Если вы это нашли, значит город всё ещё помнит тех, кто его любил». Денис улыбнулся. — Значит, никакого сокровища? Ирина ответила: — Может быть, память и есть сокровище. В этот момент град окончательно прекратился, а дождь стал почти невесомым.`,
      `Когда они вернулись к павильону, голограмма уже мерцала слабее. Она словно ждала только одного — чтобы записка снова оказалась там, где её смогут увидеть другие. Ирина положила фотографию под стекло, Денис включил старую лампу. Свет разошёлся по комнате, голограмма подняла руку в прощальном жесте и рассыпалась светящимися частицами. Город снова стал обычным, но теперь в нём появилась новая история, которую можно было рассказать вслух.`
    ];
    return paragraphs.join('\n\n');
  }

  async function aiStory(topic) {
    const brain = window.NovaBrain;
    if (!brain?.getStatus || !brain?.handle || brain.getStatus().status !== 'ready') return null;
    const first = await brain.handle(`Напиши первую половину художественного рассказа на русском, 120–135 слов. Тема: ${topic}. Обязательно: естественный диалог Ирины и Дениса, дождь, иногда короткий град, таинственная 3D-голограмма. Без заголовка.`, { language: 'ru' });
    if (!first?.text) return null;
    const second = await brain.handle('Продолжи этот же рассказ ещё примерно на 120–135 слов и закончи сюжет. Сохрани Ирина и Денис, дождь, редкий град и голограмму. Без объяснений.', { language: 'ru' });
    if (!second?.text) return first.text;
    return `${first.text}\n\n${second.text}`;
  }

  async function generateStory() {
    const topic = $('#novaStoryTopic')?.value || '';
    storyMode = $('#novaStoryMode')?.value || 'dialogue';
    status('Создаю рассказ примерно на 2 минуты…');
    let generated = null;
    try { generated = await aiStory(topic); } catch (_) {}
    storyText = cleanText(generated || builtInStory(topic));
    if (countWords(storyText) < 210) storyText = `${storyText} ${cleanText(builtInStory(topic))}`;
    const words = storyText.split(/\s+/).slice(0, 275);
    storyText = words.join(' ');
    $('#novaStoryResult').textContent = storyText;
    status(`✅ Рассказ готов: ${countWords(storyText)} слов, примерно 2 минуты.`);
    revokeDownloads();
    $('#novaStoryDownloads').innerHTML = '';
  }

  function storyTurns(text, mode) {
    const sentences = sentenceSplit(text);
    if (mode === 'irina' || mode === 'denis') return [{ voice: mode, text: cleanText(text) }];
    return sentences.map((sentence, index) => ({ voice: index % 2 === 0 ? 'irina' : 'denis', text: sentence }));
  }

  async function playStory() {
    if (!storyText) await generateStory();
    const tts = window.NovaRussianTTS;
    if (!tts) return status('Русский Piper ещё не загрузился.');
    const turns = storyTurns(storyText, storyMode);
    try {
      if (storyMode === 'dialogue') await tts.speakDialogue(turns);
      else await tts.speak(storyText, storyMode);
    } catch (error) { status(`Ошибка TTS: ${error.message || error}`); }
  }

  function loadScript(url, marker) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-loader="${marker}"]`);
      if (existing) {
        if (existing.dataset.ready === '1') return resolve();
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.dataset.loader = marker;
      script.onload = () => { script.dataset.ready = '1'; resolve(); };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function decodeBlob(blob, ctx) {
    const buffer = await ctx.decodeAudioData((await blob.arrayBuffer()).slice(0));
    const channel = buffer.getChannelData(0);
    return { samples: new Float32Array(channel), sampleRate: buffer.sampleRate };
  }

  function joinSamples(parts, sampleRate, silenceSeconds = 0.12) {
    const silence = Math.floor(sampleRate * silenceSeconds);
    const total = parts.reduce((sum, part) => sum + part.length, 0) + Math.max(0, parts.length - 1) * silence;
    const out = new Float32Array(total);
    let offset = 0;
    parts.forEach((part, index) => {
      out.set(part, offset);
      offset += part.length;
      if (index < parts.length - 1) offset += silence;
    });
    return out;
  }

  function fitSamples(samples, targetFrames) {
    if (!samples.length || targetFrames <= 0) return new Float32Array(Math.max(0, targetFrames));
    if (samples.length === targetFrames) return samples;
    const out = new Float32Array(targetFrames);
    const ratio = (samples.length - 1) / Math.max(1, targetFrames - 1);
    for (let i = 0; i < targetFrames; i++) {
      const p = i * ratio;
      const a = Math.floor(p);
      const b = Math.min(samples.length - 1, a + 1);
      const t = p - a;
      out[i] = samples[a] * (1 - t) + samples[b] * t;
    }
    return out;
  }

  async function synthesizeTurnSamples(turn, ctx) {
    const tts = window.NovaRussianTTS;
    const blobs = await tts.synthesize(turn.text, turn.voice);
    const parts = [];
    let rate = ctx.sampleRate;
    for (const blob of blobs) {
      const decoded = await decodeBlob(blob, ctx);
      rate = decoded.sampleRate;
      parts.push(decoded.samples);
    }
    return { samples: joinSamples(parts, rate, 0.05), sampleRate: rate };
  }

  async function encodeMp3(samples, sampleRate) {
    if (!window.lamejs) await loadScript(LAME_URL, 'nova-lame');
    if (!window.lamejs) throw new Error('MP3-кодек не загрузился.');
    const encoder = new window.lamejs.Mp3Encoder(1, sampleRate, 128);
    const block = 1152;
    const mp3 = [];
    for (let i = 0; i < samples.length; i += block) {
      const slice = samples.subarray(i, Math.min(samples.length, i + block));
      const pcm = new Int16Array(slice.length);
      for (let j = 0; j < slice.length; j++) pcm[j] = Math.max(-32768, Math.min(32767, Math.round(slice[j] * 32767)));
      const buf = encoder.encodeBuffer(pcm);
      if (buf.length) mp3.push(new Uint8Array(buf));
    }
    const end = encoder.flush();
    if (end.length) mp3.push(new Uint8Array(end));
    return new Blob(mp3, { type: 'audio/mpeg' });
  }

  function addDownload(containerId, blob, filename, label) {
    const url = URL.createObjectURL(blob);
    currentObjectUrls.push(url);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.textContent = label;
    $(containerId)?.appendChild(link);
    return link;
  }

  async function storyMp3() {
    if (!storyText) await generateStory();
    const tts = window.NovaRussianTTS;
    if (!tts) return status('Piper TTS недоступен.');
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return status('AudioContext недоступен.');
    status('Создаю MP3 Ирина + Денис локально…');
    const ctx = new Ctx();
    const turns = storyTurns(storyText, storyMode);
    const parts = [];
    let sampleRate = ctx.sampleRate;
    for (let i = 0; i < turns.length; i++) {
      status(`Озвучиваю ${i + 1}/${turns.length}: ${turns[i].voice === 'denis' ? 'Денис' : 'Ирина'}…`);
      const decoded = await synthesizeTurnSamples(turns[i], ctx);
      sampleRate = decoded.sampleRate;
      parts.push(decoded.samples);
    }
    const audio = joinSamples(parts, sampleRate, 0.14);
    const mp3 = await encodeMp3(audio, sampleRate);
    $('#novaStoryDownloads').innerHTML = '';
    addDownload('#novaStoryDownloads', mp3, 'NOVA_story_Irina_Denis.mp3', '⬇ MP3 рассказ');
    status('✅ MP3 готов. Платных кредитов нет.');
    try { await ctx.close(); } catch (_) {}
  }

  async function translateText(text, from, to) {
    const clean = cleanText(text);
    if (!clean || from === to) return clean;
    try {
      if (window.Translator?.create) {
        const translator = await window.Translator.create({ sourceLanguage: from, targetLanguage: to });
        return await translator.translate(clean);
      }
    } catch (_) {}
    const response = await fetch('./__nova_free__/translate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: clean, from, to })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || 'Перевод недоступен.');
    return data.translatedText;
  }

  function formatSrtTime(seconds) {
    const ms = Math.max(0, Math.round(seconds * 1000));
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const x = ms % 1000;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(x).padStart(3,'0')}`;
  }

  function segmentsToSrt(segments) {
    return segments.map((segment, index) => `${index + 1}\n${formatSrtTime(segment.start)} --> ${formatSrtTime(segment.start + segment.duration)}\n${segment.text}\n`).join('\n');
  }

  async function storySrt() {
    if (!storyText) await generateStory();
    status('Перевожу рассказ на английский для субтитров…');
    const english = await translateText(storyText, 'ru', 'en');
    const sentences = sentenceSplit(english);
    const weights = sentences.map((s) => Math.max(1, countWords(s)));
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    let cursor = 0;
    const segments = sentences.map((text, index) => {
      const duration = 120 * (weights[index] / total);
      const item = { start: cursor, duration, text };
      cursor += duration;
      return item;
    });
    const srt = new Blob([segmentsToSrt(segments)], { type: 'application/x-subrip;charset=utf-8' });
    addDownload('#novaStoryDownloads', srt, 'NOVA_story_EN.srt', '⬇ English SRT');
    status('✅ Английские субтитры готовы.');
  }

  function getVideoId(input) {
    const value = String(input || '').trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
    try {
      const url = new URL(value);
      if (url.hostname === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
      if (url.hostname.includes('youtube.com')) {
        if (url.searchParams.get('v')) return url.searchParams.get('v');
        const parts = url.pathname.split('/').filter(Boolean);
        const marker = parts.findIndex((part) => ['shorts','embed','live'].includes(part));
        if (marker >= 0) return parts[marker + 1] || '';
      }
    } catch (_) {}
    return '';
  }

  async function fetchTextThroughProxy(url) {
    try {
      const direct = await fetch(url);
      if (direct.ok) return await direct.text();
    } catch (_) {}
    return new Promise((resolve) => {
      let done = false;
      let finished = 0;
      PROXIES.forEach((build) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8500);
        fetch(build(url), { signal: controller.signal })
          .then(async (response) => {
            if (!done && response.ok) {
              const text = await response.text();
              if (text && !done) { done = true; resolve(text); }
            }
          })
          .catch(() => {})
          .finally(() => {
            clearTimeout(timer);
            finished += 1;
            if (!done && finished === PROXIES.length) resolve('');
          });
      });
    });
  }

  function parseJson3Segments(raw, maxSeconds = MAX_YOUTUBE_SECONDS) {
    let data;
    try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return []; }
    const out = [];
    for (const event of data?.events || []) {
      if (!event?.segs?.length) continue;
      const start = Number(event.tStartMs || 0) / 1000;
      if (start > maxSeconds) break;
      const duration = Math.max(0.35, Number(event.dDurationMs || 1800) / 1000);
      const text = cleanText(event.segs.map((s) => s.utf8 || '').join('').replace(/\n/g, ' '));
      if (!text) continue;
      out.push({ start, duration: Math.min(duration, Math.max(0.35, maxSeconds - start)), text });
    }
    return out.filter((item) => item.duration > 0);
  }

  async function youtubeTimedSegments(videoId) {
    const candidates = [
      { lang: 'ru', auto: false }, { lang: 'ru', auto: true },
      { lang: 'en', auto: false }, { lang: 'en', auto: true }
    ];
    for (const candidate of candidates) {
      const url = `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=${candidate.lang}&fmt=json3${candidate.auto ? '&kind=asr' : ''}`;
      const raw = await fetchTextThroughProxy(url);
      const segments = parseJson3Segments(raw);
      if (segments.length) return { segments, language: candidate.lang, method: 'timedtext' };
    }
    return null;
  }

  function pseudoSegments(text, maxSeconds = MAX_YOUTUBE_SECONDS) {
    const sentences = sentenceSplit(text).slice(0, 60);
    let cursor = 0;
    const out = [];
    for (const sentence of sentences) {
      const duration = Math.max(1.4, Math.min(5.5, countWords(sentence) / 2.5));
      if (cursor >= maxSeconds) break;
      out.push({ start: cursor, duration: Math.min(duration, maxSeconds - cursor), text: sentence });
      cursor += duration;
    }
    return out;
  }

  async function loadYoutubeExact(url) {
    const videoId = getVideoId(url);
    if (!videoId) throw new Error('Неверная ссылка YouTube.');
    let timed = await youtubeTimedSegments(videoId);
    if (timed?.segments?.length) return timed;
    const response = await fetch('./__nova_free__/youtube-transcript', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok || !data.transcript) throw new Error(data.error || 'Субтитры недоступны.');
    return { segments: pseudoSegments(data.transcript), language: String(data.language || 'en').toLowerCase().split('-')[0], method: data.method || 'fallback' };
  }

  async function translateSegments(segments, from, to) {
    if (from === to) return segments.map((s) => ({ ...s }));
    const out = [];
    for (let i = 0; i < segments.length; i++) {
      status(`Перевод сегментов ${i + 1}/${segments.length}: ${from} → ${to}…`);
      let translated = '';
      try { translated = await translateText(segments[i].text, from, to); } catch (_) { translated = segments[i].text; }
      out.push({ ...segments[i], text: cleanText(translated) });
      if (i % 5 === 4) await sleep(80);
    }
    return out;
  }

  function assignDialogueVoices(segments) {
    let voice = 'irina';
    return segments.map((segment, index) => {
      const text = segment.text;
      if (/^(?:денис|мужчина|male|man)\s*[:—-]/i.test(text)) voice = 'denis';
      else if (/^(?:ирина|женщина|female|woman)\s*[:—-]/i.test(text)) voice = 'irina';
      else if (index > 0) voice = voice === 'irina' ? 'denis' : 'irina';
      return { ...segment, voice };
    });
  }

  async function timedDialogueMp3(segments) {
    const tts = window.NovaRussianTTS;
    if (!tts) throw new Error('Piper TTS не загружен.');
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('AudioContext недоступен.');
    const ctx = new Ctx();
    const voiced = assignDialogueVoices(segments);
    const sampleRate = ctx.sampleRate;
    const totalSeconds = Math.min(MAX_YOUTUBE_SECONDS, Math.max(...voiced.map((s) => s.start + s.duration), 1));
    const timeline = new Float32Array(Math.ceil(totalSeconds * sampleRate));
    for (let i = 0; i < voiced.length; i++) {
      const item = voiced[i];
      status(`Piper ${item.voice === 'denis' ? 'Денис' : 'Ирина'}: ${i + 1}/${voiced.length}…`);
      const decoded = await synthesizeTurnSamples(item, ctx);
      const targetFrames = Math.max(1, Math.round(item.duration * sampleRate));
      const fitted = fitSamples(decoded.samples, targetFrames);
      const offset = Math.max(0, Math.round(item.start * sampleRate));
      for (let j = 0; j < fitted.length && offset + j < timeline.length; j++) {
        timeline[offset + j] = Math.max(-1, Math.min(1, timeline[offset + j] + fitted[j]));
      }
    }
    const blob = await encodeMp3(timeline, sampleRate);
    try { await ctx.close(); } catch (_) {}
    return blob;
  }

  async function youtubeDub() {
    const url = $('#novaDubYoutube')?.value?.trim();
    if (!url) return status('Вставь ссылку YouTube.');
    revokeDownloads();
    $('#novaDubDownloads').innerHTML = '';
    $('#novaDubResult').textContent = 'Обработка…';
    try {
      status('Получаю субтитры и тайминг YouTube…');
      const loaded = await loadYoutubeExact(url);
      youtubeOriginal = loaded.segments.slice(0, 55);
      youtubeSourceLanguage = loaded.language === 'ru' ? 'ru' : 'en';
      youtubeRussian = await translateSegments(youtubeOriginal, youtubeSourceLanguage, 'ru');
      youtubeEnglishSubs = youtubeSourceLanguage === 'en' ? youtubeOriginal.map((s) => ({ ...s })) : await translateSegments(youtubeOriginal, 'ru', 'en');
      $('#novaDubResult').textContent = youtubeRussian.map((s, i) => `${i + 1}. ${s.text}`).join('\n');
      status('Создаю русский двухголосный MP3 с сохранением тайминга…');
      const mp3 = await timedDialogueMp3(youtubeRussian);
      const srt = new Blob([segmentsToSrt(youtubeEnglishSubs)], { type: 'application/x-subrip;charset=utf-8' });
      addDownload('#novaDubDownloads', mp3, 'NOVA_YouTube_RU_Irina_Denis.mp3', '⬇ Русский MP3');
      addDownload('#novaDubDownloads', srt, 'NOVA_YouTube_EN.srt', '⬇ English SRT');
      status(`✅ Готово: ${youtubeRussian.length} сегментов, до ${MAX_YOUTUBE_SECONDS} секунд.`);
    } catch (error) {
      $('#novaDubResult').textContent = error.message || String(error);
      status('Не удалось закончить обработку YouTube.');
    }
  }

  function parseTimecode(value) {
    const parts = String(value || '').trim().replace(',', '.').split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return Number(parts[0]) || 0;
  }

  function parseSubtitleFile(text) {
    const raw = String(text || '').replace(/\r/g, '').trim();
    const blocks = raw.split(/\n\s*\n/);
    const out = [];
    for (const block of blocks) {
      const lines = block.split('\n').filter(Boolean);
      const timingIndex = lines.findIndex((line) => line.includes('-->'));
      if (timingIndex < 0) continue;
      const [a, b] = lines[timingIndex].split('-->').map((v) => v.trim().split(/\s+/)[0]);
      const start = parseTimecode(a);
      const end = parseTimecode(b);
      const textLine = cleanText(lines.slice(timingIndex + 1).join(' ').replace(/<[^>]+>/g, ''));
      if (textLine && end > start) out.push({ start, duration: end - start, text: textLine });
    }
    return out.filter((s) => s.start < MAX_YOUTUBE_SECONDS).map((s) => ({ ...s, duration: Math.min(s.duration, MAX_YOUTUBE_SECONDS - s.start) }));
  }

  async function localVideoDub() {
    const video = $('#novaLocalVideo')?.files?.[0];
    const subs = $('#novaLocalSubs')?.files?.[0];
    if (!video || !subs) return status('Для точного локального режима выбери видео и его SRT/VTT.');
    revokeDownloads();
    $('#novaDubDownloads').innerHTML = '';
    const text = await subs.text();
    const original = parseSubtitleFile(text);
    if (!original.length) return status('Не удалось прочитать тайминг SRT/VTT.');
    const looksRussian = /[А-Яа-яЁё]/.test(original.slice(0, 8).map((s) => s.text).join(' '));
    const from = looksRussian ? 'ru' : 'en';
    const russian = await translateSegments(original, from, 'ru');
    const english = from === 'en' ? original : await translateSegments(original, 'ru', 'en');
    $('#novaDubResult').textContent = russian.map((s, i) => `${i + 1}. ${s.text}`).join('\n');
    const mp3 = await timedDialogueMp3(russian);
    const srt = new Blob([segmentsToSrt(english)], { type: 'application/x-subrip;charset=utf-8' });
    const base = video.name.replace(/\.[^.]+$/, '') || 'NOVA_video';
    addDownload('#novaDubDownloads', mp3, `${base}_RU_Irina_Denis.mp3`, '⬇ Русский MP3');
    addDownload('#novaDubDownloads', srt, `${base}_EN.srt`, '⬇ English SRT');
    status('✅ Локальное видео обработано по точному таймингу его субтитров.');
  }

  async function startHologram() {
    stopHologram();
    status('Запускаю локальную 3D-голограмму…');
    const THREE = await import(THREE_URL);
    const wrap = $('#nova3dWrap');
    const subtitle = $('#novaHoloSubtitle')?.value || '';
    $('#nova3dSubtitle').textContent = subtitle;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(46, Math.max(1, wrap.clientWidth) / 340, 0.1, 100);
    camera.position.set(0, 1.5, 6.2);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(Math.max(320, wrap.clientWidth), 340, false);
    wrap.prepend(renderer.domElement);

    const material = new THREE.MeshBasicMaterial({ color: 0x65dfff, transparent: true, opacity: 0.5, wireframe: true });
    const solid = new THREE.MeshBasicMaterial({ color: 0x8beaff, transparent: true, opacity: 0.16 });
    const holo = new THREE.Group();
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.48, 24, 16), material);
    head.position.y = 2.15;
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.8, 1.55, 20, 1, true), material);
    torso.position.y = 0.95;
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.28, 18, 12), solid);
    core.position.y = 1.1;
    holo.add(head, torso, core);
    const limbGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.45, 10, 1, true);
    [-1, 1].forEach((side) => {
      const arm = new THREE.Mesh(limbGeo, material); arm.position.set(0.85 * side, 1.05, 0); arm.rotation.z = 0.23 * side;
      const leg = new THREE.Mesh(limbGeo, material); leg.position.set(0.35 * side, -0.45, 0); leg.rotation.z = -0.05 * side;
      holo.add(arm, leg);
    });
    scene.add(holo);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.025, 8, 64), material);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.2;
    scene.add(ring);

    const rainCount = 950;
    const rainPos = new Float32Array(rainCount * 3);
    for (let i = 0; i < rainCount; i++) {
      rainPos[i * 3] = (Math.random() - 0.5) * 9;
      rainPos[i * 3 + 1] = Math.random() * 8 - 2;
      rainPos[i * 3 + 2] = (Math.random() - 0.5) * 5;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
    const rainMat = new THREE.PointsMaterial({ color: 0x9dcfff, size: 0.035, transparent: true, opacity: 0.75 });
    const rain = new THREE.Points(rainGeo, rainMat);
    scene.add(rain);

    const hailCount = 150;
    const hailPos = new Float32Array(hailCount * 3);
    for (let i = 0; i < hailCount; i++) {
      hailPos[i * 3] = (Math.random() - 0.5) * 9;
      hailPos[i * 3 + 1] = Math.random() * 8 - 2;
      hailPos[i * 3 + 2] = (Math.random() - 0.5) * 5;
    }
    const hailGeo = new THREE.BufferGeometry();
    hailGeo.setAttribute('position', new THREE.BufferAttribute(hailPos, 3));
    const hailMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, transparent: true, opacity: 0.9 });
    const hail = new THREE.Points(hailGeo, hailMat);
    scene.add(hail);

    const weather = $('#novaHoloWeather')?.value || 'rain-hail';
    rain.visible = weather !== 'none';
    hail.visible = false;
    let running = true;
    let frame = 0;
    const tick = (time) => {
      if (!running) return;
      frame += 1;
      holo.rotation.y = Math.sin(time * 0.00045) * 0.35;
      holo.position.y = Math.sin(time * 0.0012) * 0.06;
      material.opacity = 0.38 + (Math.sin(time * 0.007) + 1) * 0.09;
      ring.rotation.z += 0.009;
      if (rain.visible) {
        const p = rain.geometry.attributes.position.array;
        for (let i = 0; i < rainCount; i++) {
          p[i * 3 + 1] -= 0.07;
          if (p[i * 3 + 1] < -2) p[i * 3 + 1] = 6;
        }
        rain.geometry.attributes.position.needsUpdate = true;
      }
      if (weather === 'rain-hail') hail.visible = Math.floor(time / 6500) % 3 === 1;
      if (hail.visible) {
        const p = hail.geometry.attributes.position.array;
        for (let i = 0; i < hailCount; i++) {
          p[i * 3 + 1] -= 0.14;
          if (p[i * 3 + 1] < -2) p[i * 3 + 1] = 6;
        }
        hail.geometry.attributes.position.needsUpdate = true;
      }
      renderer.render(scene, camera);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    threeState = { renderer, scene, camera, stop() { running = false; } };
    status('✅ 3D-голограмма работает: дождь и периодический град локально.');
  }

  function stopHologram() {
    if (!threeState) return;
    try { threeState.stop(); threeState.renderer.dispose(); threeState.renderer.domElement.remove(); } catch (_) {}
    threeState = null;
  }

  async function recordHologram() {
    if (!threeState) await startHologram();
    const canvas = threeState?.renderer?.domElement;
    if (!canvas?.captureStream || typeof MediaRecorder === 'undefined') return status('Этот браузер не поддерживает запись canvas.');
    const stream = canvas.captureStream(30);
    const preferred = ['video/mp4;codecs=h264', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mimeType = preferred.find((type) => MediaRecorder.isTypeSupported?.(type)) || '';
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    const done = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.start(250);
    status('⏺ Записываю 3D-голограмму 10 секунд…');
    await sleep(10000);
    recorder.stop();
    await done;
    const type = recorder.mimeType || 'video/webm';
    const extension = type.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(chunks, { type });
    $('#novaHoloDownloads').innerHTML = '';
    addDownload('#novaHoloDownloads', blob, `NOVA_hologram_rain_hail_10s.${extension}`, `⬇ 3D видео 10 сек (${extension.toUpperCase()})`);
    status('✅ 3D-видео готово. Для русского диалога English SRT создаётся в разделе аудио/видео.');
  }

  function bind() {
    $('#novaMediaClose')?.addEventListener('click', () => { $('#novaMediaModal').hidden = true; });
    $('#novaMediaModal')?.addEventListener('click', (event) => { if (event.target.id === 'novaMediaModal') event.currentTarget.hidden = true; });
    document.querySelectorAll('[data-media-tab]').forEach((button) => button.addEventListener('click', () => selectTab(button.dataset.mediaTab)));
    $('#novaGenerateStory')?.addEventListener('click', generateStory);
    $('#novaPlayStory')?.addEventListener('click', playStory);
    $('#novaStoryMp3')?.addEventListener('click', () => storyMp3().catch((error) => status(`Ошибка MP3: ${error.message || error}`)));
    $('#novaStorySrt')?.addEventListener('click', () => storySrt().catch((error) => status(`Ошибка SRT: ${error.message || error}`)));
    $('#novaYoutubeExact')?.addEventListener('click', youtubeDub);
    $('#novaLocalExact')?.addEventListener('click', () => localVideoDub().catch((error) => status(`Ошибка видео: ${error.message || error}`)));
    $('#novaStartHolo')?.addEventListener('click', () => startHologram().catch((error) => status(`Ошибка 3D: ${error.message || error}`)));
    $('#novaStopHolo')?.addEventListener('click', stopHologram);
    $('#novaRecordHolo')?.addEventListener('click', () => recordHologram().catch((error) => status(`Ошибка записи: ${error.message || error}`)));
    $('#novaHoloSubtitle')?.addEventListener('input', (event) => { const node = $('#nova3dSubtitle'); if (node) node.textContent = event.target.value; });
    $('#novaStoryMode')?.addEventListener('change', (event) => { storyMode = event.target.value; });
  }

  function init() {
    injectStyles();
    buildUi();
    bind();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();