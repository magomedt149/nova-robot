const CACHE = 'nova-v26-8-youtube-browser-bypass-20260902';
const CORE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './english-lessons.js',
  './brain.js',
  './notebook-tools.js',
  './local-ai-worker.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

const YT_PROXY_BUILDERS = [
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
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
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

function fetchTimed(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

function raceCaptionProxies(targetUrl) {
  return new Promise((resolve) => {
    let done = false;
    let settled = 0;
    const total = YT_PROXY_BUILDERS.length;
    YT_PROXY_BUILDERS.forEach((build, index) => {
      fetchTimed(build(targetUrl), 10000)
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
  const videoResponse = await fetchTimed(`${instance}/api/v1/videos/${videoId}`, 7000);
  if (!videoResponse.ok) throw new Error('video');
  const data = await videoResponse.json();
  const caption = chooseInvCaption(data?.captions || []);
  if (!caption?.url) throw new Error('caption');
  const captionUrl = caption.url.startsWith('http') ? caption.url : `${instance}${caption.url}`;
  const response = await fetchTimed(captionUrl.includes('fmt=') ? captionUrl : `${captionUrl}${captionUrl.includes('?') ? '&' : '?'}fmt=vtt`, 9000);
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

async function browserYoutubeBypass(request) {
  let originalResponse = null;
  try {
    originalResponse = await fetch(request.clone());
    if (originalResponse.ok) {
      const probe = await originalResponse.clone().json().catch(() => null);
      if (probe?.ok && probe?.transcript) return originalResponse;
    }
  } catch (_) {}

  let body = {};
  try { body = await request.clone().json(); } catch (_) {}
  const videoId = getVideoId(body?.url || '');
  if (!videoId) return originalResponse || new Response(JSON.stringify({ ok: false, error: 'Неверная ссылка YouTube.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  let result = await browserTimedText(videoId);
  if (!result) result = await browserInvidious(videoId);

  if (!result?.transcript) {
    if (originalResponse) return originalResponse;
    return new Response(JSON.stringify({ ok: false, error: 'Субтитры временно недоступны.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({
    ok: true,
    videoId,
    title: result.title || 'YouTube video',
    language: result.language || 'en',
    trackName: '',
    isAutoGenerated: Boolean(result.isAutoGenerated),
    method: result.method || 'browser-bypass',
    transcript: result.transcript
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/.netlify/functions/youtube-transcript')) {
    event.respondWith(browserYoutubeBypass(event.request));
    return;
  }

  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && url.origin === self.location.origin) {
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
