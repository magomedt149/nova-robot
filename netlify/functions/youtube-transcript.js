function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(payload)
  };
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const PROXY_BUILDERS = [
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
  (url) => `https://yacdn.org/proxy/${url}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${url}`,
  (url) => `https://corsproxy.org/?${encodeURIComponent(url)}`
];
const INVIDIOUS = [
  'https://y.com.sb',
  'https://invidious.flokinet.to',
  'https://invidious.darkness.services',
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de'
];

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

function transcriptFromJson3(data) {
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

function transcriptFromXml(xml) {
  const out = [];
  const re = /<text\b[^>]*>([\s\S]*?)<\/text>/gi;
  let match;
  while ((match = re.exec(String(xml || '')))) {
    const text = decodeHtml(match[1]).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text) out.push(text);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

function transcriptFromVtt(vtt) {
  const out = [];
  let last = '';
  for (const raw of String(vtt || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line || line === 'WEBVTT' || line.includes('-->') || /^\d+$/.test(line) || /^NOTE\b/.test(line)) continue;
    const text = decodeHtml(line.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (!text || text === last) continue;
    out.push(text);
    last = text;
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

function parseTranscriptBody(text) {
  const clean = String(text || '').trim();
  if (!clean) return '';
  try {
    const data = JSON.parse(clean);
    const transcript = transcriptFromJson3(data);
    if (transcript) return transcript;
  } catch (_) {}
  return transcriptFromXml(clean) || transcriptFromVtt(clean);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function tryProxyRace(targetUrl) {
  return new Promise((resolve) => {
    let finished = 0;
    let settled = false;
    const total = PROXY_BUILDERS.length;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    PROXY_BUILDERS.forEach((build, index) => {
      fetchWithTimeout(build(targetUrl), {
        headers: { 'User-Agent': UA, 'Accept': 'application/json,text/plain,*/*' }
      }, 10000)
        .then(async (response) => {
          if (settled || !response.ok) return;
          const text = await response.text();
          const transcript = parseTranscriptBody(text);
          if (transcript) finish({ transcript, proxyIndex: index });
        })
        .catch(() => {})
        .finally(() => {
          finished += 1;
          if (!settled && finished === total) finish(null);
        });
    });
  });
}

async function tryProxyTimedText(videoId) {
  const urls = [
    `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=en&fmt=json3`,
    `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=en&fmt=json3&kind=asr`,
    `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=en-US&fmt=json3`,
    `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=en-US&fmt=json3&kind=asr`
  ];
  for (const target of urls) {
    const result = await tryProxyRace(target);
    if (result?.transcript) {
      return {
        transcript: result.transcript,
        language: 'en',
        trackName: '',
        isAutoGenerated: target.includes('kind=asr'),
        method: `cors-proxy-${result.proxyIndex + 1}`
      };
    }
  }
  return null;
}

function extractCaptionTracks(html) {
  const marker = '"captionTracks":';
  const startMarker = html.indexOf(marker);
  if (startMarker < 0) return [];
  const start = html.indexOf('[', startMarker + marker.length);
  if (start < 0) return [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '[') depth += 1;
    if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch (_) { return []; }
      }
    }
  }
  return [];
}

function chooseTrack(tracks) {
  if (!Array.isArray(tracks) || !tracks.length) return null;
  return tracks.find((t) => String(t.languageCode || '').toLowerCase() === 'en')
    || tracks.find((t) => String(t.languageCode || '').toLowerCase().startsWith('en'))
    || tracks[0];
}

async function tryWatchPage(videoId) {
  try {
    const watch = await fetchWithTimeout(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en&gl=US`, {
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+410; SOCS=CAI'
      },
      redirect: 'follow'
    }, 9000);
    if (!watch.ok) return null;
    const html = await watch.text();
    const tracks = extractCaptionTracks(html);
    const track = chooseTrack(tracks);
    if (!track?.baseUrl) return null;

    const url = `${track.baseUrl}${track.baseUrl.includes('?') ? '&' : '?'}fmt=json3`;
    const response = await fetchWithTimeout(url, { headers: { 'User-Agent': UA, 'Referer': 'https://www.youtube.com/' } }, 9000);
    if (!response.ok) return null;
    const transcript = parseTranscriptBody(await response.text());
    if (!transcript) return null;

    const title = decodeHtml(html.match(/<title>(.*?)<\/title>/i)?.[1] || '').replace(/\s*-\s*YouTube\s*$/i, '').trim();
    return {
      transcript,
      language: track.languageCode || 'en',
      trackName: track.name?.simpleText || '',
      isAutoGenerated: track.kind === 'asr',
      title,
      method: 'youtube-watch'
    };
  } catch (_) {
    return null;
  }
}

function chooseInvidiousCaption(captions) {
  if (!Array.isArray(captions) || !captions.length) return null;
  const isEnglish = (c) => String(c.language_code || '').toLowerCase().startsWith('en') || /english/i.test(c.label || '');
  const isAuto = (c) => /auto|generated/i.test(c.label || '');
  return captions.find((c) => isEnglish(c) && !isAuto(c))
    || captions.find(isEnglish)
    || captions.find((c) => !isAuto(c))
    || captions[0];
}

async function tryOneInvidious(instance, videoId) {
  const videoResponse = await fetchWithTimeout(`${instance}/api/v1/videos/${encodeURIComponent(videoId)}`, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' }
  }, 7000);
  if (!videoResponse.ok) throw new Error('video failed');
  const data = await videoResponse.json();
  const caption = chooseInvidiousCaption(data?.captions || []);
  if (!caption?.url) throw new Error('no captions');
  const captionUrl = caption.url.startsWith('http') ? caption.url : `${instance}${caption.url}`;
  const response = await fetchWithTimeout(captionUrl.includes('fmt=') ? captionUrl : `${captionUrl}${captionUrl.includes('?') ? '&' : '?'}fmt=vtt`, {
    headers: { 'User-Agent': UA }
  }, 9000);
  if (!response.ok) throw new Error('caption failed');
  const transcript = parseTranscriptBody(await response.text());
  if (!transcript) throw new Error('empty caption');
  return {
    transcript,
    language: caption.language_code || 'en',
    trackName: caption.label || '',
    isAutoGenerated: /auto|generated/i.test(caption.label || ''),
    title: data?.title || '',
    method: `invidious:${new URL(instance).hostname}`
  };
}

async function tryInvidious(videoId) {
  try {
    return await Promise.any(INVIDIOUS.map((instance) => tryOneInvidious(instance, videoId)));
  } catch (_) {
    return null;
  }
}

async function getTitle(videoId) {
  try {
    const response = await fetchWithTimeout(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`, {
      headers: { 'User-Agent': UA }
    }, 5000);
    if (!response.ok) return '';
    const data = await response.json();
    return data?.title || '';
  } catch (_) {
    return '';
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' } };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const input = body.url || event.queryStringParameters?.url || '';
    const videoId = getVideoId(input);
    if (!videoId) return json(400, { ok: false, error: 'Неверная ссылка YouTube.' });

    let result = await tryWatchPage(videoId);
    if (!result) result = await tryProxyTimedText(videoId);
    if (!result) result = await tryInvidious(videoId);

    if (!result?.transcript) {
      return json(404, {
        ok: false,
        error: 'Не удалось получить субтитры: YouTube и резервные бесплатные источники временно недоступны.',
        details: { strategies: ['youtube-watch', 'cors-proxy-timedtext', 'invidious'] }
      });
    }

    const title = result.title || await getTitle(videoId) || 'YouTube video';
    return json(200, {
      ok: true,
      videoId,
      title,
      language: result.language || 'en',
      trackName: result.trackName || '',
      isAutoGenerated: Boolean(result.isAutoGenerated),
      method: result.method || 'fallback',
      transcript: result.transcript
    });
  } catch (error) {
    return json(500, { ok: false, error: error?.message || 'Ошибка получения YouTube-расшифровки.' });
  }
};
