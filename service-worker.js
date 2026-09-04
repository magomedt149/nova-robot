const CACHE = 'nova-v63-blender-camera-bridge-20260904';
const API_CACHE = 'nova-api-economy-v2';
const METERED_NETLIFY_HOST = /(^|\\.)netlify\\.app$/i.test(self.location.hostname);
const YOUTUBE_TTL_MS = 24 * 60 * 60 * 1000;
const TRANSLATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const CORE = [
  './',
  './index.html',
  './update.html',
  './version.json',
  './styles.css',
  './app.js',
  './english-lessons.js',
  './brain.js',
  './voice-fix.js',
  './beach-mode.js',
  './photo-studio.js',
  './hollywood-studio.js',
  './neural-russian-tts.js',
  './nova-russian-pronunciation.js',
  './nova-tts-diagnostics.js',
  './nova-ios-photo-save.js',
  './nova-media-studio.js',
  './nova-video-upgrade.js',
  './nova-whisper.js',
  './nova-whisper-worker.js',
  './nova-voice-editor.js',
  './nova-transcript-editor-sync.js',
  './nova-multi-shorts.js',
  './nova-media-library.js',
  './nova-ios-output-actions.js',
  './nova-video-pro.js',
  './nova-3d-director.js',
  './nova-blender-camera.js',
  './nova-unified-video-studio.js',
  './motion-studio/index.html',
  './motion-studio/styles.css',
  './motion-studio/app.js',
  './motion-studio/director.js',
  './motion-studio/remote-gpu.js',
  './notebook-tools.js',
  './local-ai-worker.js',
  './nova-free-runtime.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

const PUBLIC_PROXY_BUILDERS = [
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
  (url) => `https://yacdn.org/proxy/${url}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${url}`,
  (url) => `https://corsproxy.org/?${encodeURIComponent(url)}`
];

const YT_INVIDIOUS = [
  'https://y.com.sb',
  'https://invidious.flokinet.to',
  'https://invidious.darkness.services',
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)));
});

self.addEventListener('activate', (event) => {
  const keep = new Set([CACHE, API_CACHE]);
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'NOVA_SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'NOVA_CLEAR_APP_CACHES') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(
        keys.filter((key) => /^nova-|^tumsoev-motion-/i.test(key) && key !== API_CACHE)
          .map((key) => caches.delete(key))
      ))
    );
  }
});

function getVideoId(input) {
  const value = String(input || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.hostname === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
    if (url.hostname.includes('youtube.com')) {
      if (url.searchParams.get('v')) return url.searchParams.get('v');
      const parts = url.pathname.split('/').filter(Boolean);
      const marker = parts.findIndex((p) => ['shorts', 'embed', 'live', 'v'].includes(p));
      if (marker >= 0 && parts[marker + 1]) return parts[marker + 1];
    }
  } catch (_) {}
  return '';
}

function decodeHtml(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function parseJson3(data) {
  const out = [];
  let last = '';
  for (const event of data?.events || []) {
    if (!event?.segs?.length) continue;
    const text = event.segs.map((s) => s.utf8 || '').join('').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text || text === last) continue;
    out.push(text);
    last = text;
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

function parseVttOrXml(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  try {
    const parsed = JSON.parse(text);
    const transcript = parseJson3(parsed);
    if (transcript) return transcript;
  } catch (_) {}

  const xml = [];
  const xmlRe = /<text\b[^>]*>([\s\S]*?)<\/text>/gi;
  let match;
  while ((match = xmlRe.exec(text))) {
    const piece = decodeHtml(match[1]).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (piece) xml.push(piece);
  }
  if (xml.length) return xml.join(' ').replace(/\s+/g, ' ').trim();

  const vtt = [];
  let last = '';
  for (const rawLine of text.replace(/\r/g, '').split('\n')) {
    const line = rawLine.trim();
    if (!line || line === 'WEBVTT' || line.includes('-->') || /^\d+$/.test(line) || /^NOTE\b/.test(line)) continue;
    const piece = decodeHtml(line.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (!piece || piece === last) continue;
    vtt.push(piece);
    last = piece;
  }
  return vtt.join(' ').replace(/\s+/g, ' ').trim();
}

function fetchTimed(url, timeoutMs = 7500, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function raceCaptionProxies(targetUrl) {
  return new Promise((resolve) => {
    let done = false;
    let settled = 0;
    const total = PUBLIC_PROXY_BUILDERS.length;
    PUBLIC_PROXY_BUILDERS.forEach((build, index) => {
      fetchTimed(build(targetUrl), 8000)
        .then(async (response) => {
          if (done || !response.ok) return;
          const transcript = parseVttOrXml(await response.text());
          if (transcript && !done) {
            done = true;
            resolve({ transcript, method: `browser-cors-proxy-${index + 1}` });
          }
        })
        .catch(() => {})
        .finally(() => {
          settled += 1;
          if (!done && settled === total) resolve(null);
        });
    });
  });
}

async function browserTimedText(videoId) {
  const candidates = [
    { url: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3`, auto: false },
    { url: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3&kind=asr`, auto: true },
    { url: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en-US&fmt=json3`, auto: false },
    { url: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en-US&fmt=json3&kind=asr`, auto: true }
  ];
  for (const candidate of candidates) {
    const result = await raceCaptionProxies(candidate.url);
    if (result?.transcript) return { ...result, language: 'en', isAutoGenerated: candidate.auto };
  }
  return null;
}

function chooseInvCaption(captions) {
  if (!Array.isArray(captions) || !captions.length) return null;
  const english = (c) => String(c.language_code || '').toLowerCase().startsWith('en') || /english/i.test(c.label || '');
  const auto = (c) => /auto|generated/i.test(c.label || '');
  return captions.find((c) => english(c) && !auto(c))
    || captions.find(english)
    || captions.find((c) => !auto(c))
    || captions[0];
}

async function oneInvidious(instance, videoId) {
  const videoResponse = await fetchTimed(`${instance}/api/v1/videos/${videoId}`, 6000);
  if (!videoResponse.ok) throw new Error('video');
  const data = await videoResponse.json();
  const caption = chooseInvCaption(data?.captions || []);
  if (!caption?.url) throw new Error('caption');
  const captionUrl = caption.url.startsWith('http') ? caption.url : `${instance}${caption.url}`;
  const response = await fetchTimed(captionUrl.includes('fmt=') ? captionUrl : `${captionUrl}${captionUrl.includes('?') ? '&' : '?'}fmt=vtt`, 7500);
  if (!response.ok) throw new Error('caption');
  const transcript = parseVttOrXml(await response.text());
  if (!transcript) throw new Error('empty');
  return {
    transcript,
    title: data?.title || 'YouTube video',
    language: caption.language_code || 'en',
    isAutoGenerated: /auto|generated/i.test(caption.label || ''),
    method: `browser-invidious:${new URL(instance).hostname}`
  };
}

async function browserInvidious(videoId) {
  try {
    return await Promise.any(YT_INVIDIOUS.map((instance) => oneInvidious(instance, videoId)));
  } catch (_) {
    return null;
  }
}

async function firstBrowserTranscript(videoId) {
  const requireResult = (promise) => promise.then((result) => {
    if (!result?.transcript) throw new Error('no transcript');
    return result;
  });
  try {
    return await Promise.any([
      requireResult(browserTimedText(videoId)),
      requireResult(browserInvidious(videoId))
    ]);
  } catch (_) {
    return null;
  }
}

function apiCacheRequest(kind, key) {
  return new Request(`${self.location.origin}/__nova_api_cache__/${kind}/${encodeURIComponent(key)}`, { method: 'GET' });
}

async function getFreshApiCache(kind, key, ttlMs) {
  try {
    const cache = await caches.open(API_CACHE);
    const req = apiCacheRequest(kind, key);
    const response = await cache.match(req);
    if (!response) return null;
    const storedAt = Number(response.headers.get('X-Nova-Cached-At') || 0);
    if (!storedAt || Date.now() - storedAt > ttlMs) {
      await cache.delete(req);
      return null;
    }
    return response;
  } catch (_) {
    return null;
  }
}

async function putApiCache(kind, key, response) {
  if (!response?.ok) return;
  try {
    const body = await response.clone().arrayBuffer();
    const headers = new Headers(response.headers);
    headers.set('X-Nova-Cached-At', String(Date.now()));
    headers.set('X-Nova-Cache', 'stored');
    const stored = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
    const cache = await caches.open(API_CACHE);
    await cache.put(apiCacheRequest(kind, key), stored);
  } catch (_) {}
}

function fastHash(value) {
  const text = String(value || '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

async function browserYoutubeEconomy(request) {
  let body = {};
  try { body = await request.clone().json(); } catch (_) {}
  const videoId = getVideoId(body?.url || '');
  if (!videoId) return jsonResponse({ ok: false, error: 'Неверная ссылка YouTube.' }, 400);

  const cached = await getFreshApiCache('youtube', videoId, YOUTUBE_TTL_MS);
  if (cached) return cached;

  const result = await firstBrowserTranscript(videoId);
  if (result?.transcript) {
    const response = jsonResponse({
      ok: true,
      videoId,
      title: result.title || 'YouTube video',
      language: result.language || 'en',
      trackName: '',
      isAutoGenerated: Boolean(result.isAutoGenerated),
      method: result.method || 'browser-economy',
      transcript: result.transcript
    });
    await putApiCache('youtube', videoId, response);
    return response;
  }

  return jsonResponse({
    ok: false,
    error: 'Субтитры временно недоступны в бесплатном браузерном режиме.'
  }, 404);
}

function splitTranslateText(text, max = 430) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [clean];
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    const part = sentence.trim();
    if (!part) continue;
    if ((current + ' ' + part).trim().length <= max) {
      current = (current + ' ' + part).trim();
    } else {
      if (current) chunks.push(current);
      if (part.length <= max) current = part;
      else {
        for (let i = 0; i < part.length; i += max) chunks.push(part.slice(i, i + max));
        current = '';
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function fetchTranslationJson(url) {
  try {
    const direct = await fetchTimed(url, 7000, { headers: { Accept: 'application/json' } });
    if (direct.ok) return await direct.json();
  } catch (_) {}

  for (const build of PUBLIC_PROXY_BUILDERS) {
    try {
      const response = await fetchTimed(build(url), 8000, { headers: { Accept: 'application/json,text/plain,*/*' } });
      if (!response.ok) continue;
      const text = await response.text();
      try { return JSON.parse(text); } catch (_) {}
    } catch (_) {}
  }
  return null;
}

async function translateChunkBrowser(chunk, from, to) {
  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', chunk);
  url.searchParams.set('langpair', `${from}|${to}`);
  const data = await fetchTranslationJson(url.toString());
  const translated = data?.responseData?.translatedText;
  if (!translated) throw new Error(data?.responseDetails || 'Translation unavailable');
  return decodeHtml(translated);
}

async function browserTranslate(text, from, to) {
  const chunks = splitTranslateText(text);
  if (!chunks.length) return '';
  const out = [];
  for (const chunk of chunks) out.push(await translateChunkBrowser(chunk, from, to));
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

async function cachedTranslate(request) {
  let body = {};
  try { body = await request.clone().json(); } catch (_) {}
  const text = String(body?.text || '').trim();
  const from = String(body?.from || 'en').toLowerCase();
  const to = String(body?.to || 'ru').toLowerCase();
  if (!text) return jsonResponse({ ok: false, error: 'Введите текст для перевода.' }, 400);

  const key = `${from}-${to}-${text.length}-${fastHash(text)}`;
  const cached = await getFreshApiCache('translate', key, TRANSLATE_TTL_MS);
  if (cached) return cached;

  try {
    const translatedText = await browserTranslate(text, from, to);
    if (translatedText) {
      const response = jsonResponse({ ok: true, translatedText, from, to, provider: 'MyMemory-browser' });
      await putApiCache('translate', key, response);
      return response;
    }
  } catch (_) {}

  return jsonResponse({
    ok: false,
    error: 'Перевод временно недоступен в бесплатном браузерном режиме.'
  }, 503);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const sameOrigin = url.origin === self.location.origin;

  if (event.request.method === 'POST' && sameOrigin && (url.pathname.endsWith('/__nova_free__/youtube-transcript') || url.pathname.endsWith('/.netlify/functions/youtube-transcript'))) {
    event.respondWith(browserYoutubeEconomy(event.request));
    return;
  }

  if (event.request.method === 'POST' && sameOrigin && (url.pathname.endsWith('/__nova_free__/translate') || url.pathname.endsWith('/.netlify/functions/translate'))) {
    event.respondWith(cachedTranslate(event.request));
    return;
  }

  if (event.request.method !== 'GET') return;

  if (sameOrigin && (url.pathname.endsWith('/update.html') || url.pathname.endsWith('/version.json') || url.pathname.endsWith('/manifest.webmanifest'))) {
    if (METERED_NETLIFY_HOST) {
      event.respondWith(
        caches.match(event.request, { ignoreSearch: true })
          .then((cached) => cached || fetch(event.request, { cache: 'no-store' })
            .then((response) => {
              if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
              return response;
            }))
          .catch(() => caches.match('./index.html'))
      );
    } else {
      event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => caches.match(event.request, { ignoreSearch: true })));
    }
    return;
  }

  if (sameOrigin && url.pathname.startsWith('/.netlify/functions/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (sameOrigin && METERED_NETLIFY_HOST) {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true })
        .then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(event.request, copy));
            }
            return response;
          });
        })
        .catch(() => {
          if (event.request.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        })
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && sameOrigin) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })
        .then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        }))
  );
});
