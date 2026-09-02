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

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const INVIDIOUS_STATIC = [
  'https://y.com.sb',
  'https://invidious.flokinet.to',
  'https://invidious.darkness.services',
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de'
];

function getVideoId(input) {
  const value = String(input || '').trim();
  if (/^[\w-]{11}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.hostname === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
    if (url.hostname.includes('youtube.com')) {
      if (url.pathname === '/watch') return url.searchParams.get('v') || '';
      const parts = url.pathname.split('/').filter(Boolean);
      const marker = parts.findIndex((p) => ['shorts', 'embed', 'live'].includes(p));
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

function decodeJsonEscapes(value) {
  if (!value) return '';
  try { return JSON.parse(`"${String(value).replace(/"/g, '\\"')}"`); }
  catch (_) { return String(value).replace(/\\u0026/g, '&').replace(/\\\//g, '/'); }
}

function extractBalanced(text, startIndex, openChar, closeChar) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return text.slice(startIndex, i + 1);
    }
  }
  return '';
}

function extractObjectAfterMarker(html, marker) {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = html.indexOf('{', markerIndex + marker.length);
  if (start < 0) return null;
  const raw = extractBalanced(html, start, '{', '}');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function extractArrayAfterMarker(html, marker) {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = html.indexOf('[', markerIndex + marker.length);
  if (start < 0) return null;
  const raw = extractBalanced(html, start, '[', ']');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function findPlayerResponseInHtml(html) {
  for (const marker of ['var ytInitialPlayerResponse =', 'ytInitialPlayerResponse =', 'window["ytInitialPlayerResponse"] =']) {
    const parsed = extractObjectAfterMarker(html, marker);
    if (parsed) return parsed;
  }
  return null;
}

function tracksFromPlayerResponse(playerResponse) {
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return Array.isArray(tracks) ? tracks : [];
}

function findConfigString(html, key) {
  for (const pattern of [new RegExp(`"${key}":"([^"\\n]+)"`), new RegExp(`'${key}':'([^'\\n]+)'`)]) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeJsonEscapes(match[1]);
  }
  return '';
}

async function fetchYoutubeiPlayer(html, videoId) {
  const apiKey = findConfigString(html, 'INNERTUBE_API_KEY');
  const clientVersion = findConfigString(html, 'INNERTUBE_CLIENT_VERSION') || '2.20260831.00.00';
  if (!apiKey) return null;
  const response = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}&prettyPrint=false`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://www.youtube.com',
      'Referer': `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      'User-Agent': DESKTOP_UA,
      'Accept-Language': 'en-US,en;q=0.9'
    },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion, hl: 'en', gl: 'US', utcOffsetMinutes: 0 } },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true
    })
  });
  if (!response.ok) return null;
  try { return await response.json(); } catch (_) { return null; }
}

function chooseTrack(tracks) {
  if (!Array.isArray(tracks) || !tracks.length) return null;
  return tracks.find((t) => String(t.languageCode || '').toLowerCase() === 'en')
    || tracks.find((t) => String(t.languageCode || '').toLowerCase().startsWith('en'))
    || tracks.find((t) => t.kind !== 'asr')
    || tracks[0];
}

function transcriptFromJson3(data) {
  const pieces = [];
  for (const ev of data?.events || []) {
    if (!ev.segs) continue;
    const text = ev.segs.map((s) => s.utf8 || '').join('');
    if (text.trim()) pieces.push(text.trim());
  }
  return pieces.join(' ').replace(/\s+/g, ' ').trim();
}

function transcriptFromXml(xml) {
  const pieces = [];
  const regex = /<text\b[^>]*>([\s\S]*?)<\/text>/gi;
  let match;
  while ((match = regex.exec(xml))) {
    const text = decodeHtml(match[1]).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text) pieces.push(text);
  }
  return pieces.join(' ').replace(/\s+/g, ' ').trim();
}

function transcriptFromVtt(vtt) {
  const lines = String(vtt || '').replace(/\r/g, '').split('\n');
  const pieces = [];
  let last = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line === 'WEBVTT' || line.includes('-->') || /^\d+$/.test(line) || /^NOTE\b/.test(line)) continue;
    const text = decodeHtml(line.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (!text || text === last) continue;
    pieces.push(text);
    last = text;
  }
  return pieces.join(' ').replace(/\s+/g, ' ').trim();
}

async function fetchTranscriptFromUrl(baseUrl) {
  if (!baseUrl) return '';
  const jsonUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}fmt=json3`;
  const response = await fetch(jsonUrl, { headers: { 'User-Agent': DESKTOP_UA, 'Accept-Language': 'en-US,en;q=0.9', 'Referer': 'https://www.youtube.com/' } });
  if (response.ok) {
    const text = await response.text();
    if (text.trim()) {
      try {
        const transcript = transcriptFromJson3(JSON.parse(text));
        if (transcript) return transcript;
      } catch (_) {
        const transcript = transcriptFromXml(text) || transcriptFromVtt(text);
        if (transcript) return transcript;
      }
    }
  }
  const xmlResponse = await fetch(baseUrl, { headers: { 'User-Agent': DESKTOP_UA } });
  if (!xmlResponse.ok) return '';
  const text = await xmlResponse.text();
  return transcriptFromXml(text) || transcriptFromVtt(text);
}

async function tryDirectTimedText(videoId) {
  for (const lang of ['en', 'en-US', 'en-GB']) {
    try {
      const url = `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(lang)}&fmt=json3`;
      const response = await fetch(url, { headers: { 'User-Agent': DESKTOP_UA } });
      if (!response.ok) continue;
      const text = await response.text();
      if (!text.trim()) continue;
      let transcript = '';
      try { transcript = transcriptFromJson3(JSON.parse(text)); }
      catch (_) { transcript = transcriptFromXml(text) || transcriptFromVtt(text); }
      if (transcript) return { transcript, language: lang, isAutoGenerated: false, trackName: '', method: 'direct-timedtext' };
    } catch (_) {}
  }
  return null;
}

function timedFetch(url, ms = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal, headers: { 'User-Agent': DESKTOP_UA, 'Accept': 'application/json,text/plain,*/*' } })
    .finally(() => clearTimeout(timer));
}

async function discoverInvidiousInstances() {
  try {
    const response = await timedFetch('https://api.invidious.io/instances.json?sort_by=health', 3000);
    if (!response.ok) return INVIDIOUS_STATIC;
    const raw = await response.json();
    const found = (Array.isArray(raw) ? raw : [])
      .map((entry) => entry?.[1])
      .filter((info) => info && info.api && info.type === 'https' && info.monitor?.down !== true)
      .sort((a, b) => (b.monitor?.uptime || 0) - (a.monitor?.uptime || 0))
      .map((info) => String(info.uri || '').replace(/\/$/, ''))
      .filter(Boolean)
      .slice(0, 6);
    return [...new Set([...found, ...INVIDIOUS_STATIC])].slice(0, 8);
  } catch (_) {
    return INVIDIOUS_STATIC;
  }
}

function chooseInvidiousCaption(captions) {
  if (!Array.isArray(captions) || !captions.length) return null;
  const english = (c) => String(c.language_code || '').toLowerCase().startsWith('en') || /english/i.test(c.label || '');
  const auto = (c) => /auto|generated/i.test(c.label || '');
  return captions.find((c) => english(c) && !auto(c))
    || captions.find(english)
    || captions.find((c) => !auto(c))
    || captions[0];
}

async function tryOneInvidious(instance, videoId) {
  const videoResponse = await timedFetch(`${instance}/api/v1/videos/${encodeURIComponent(videoId)}`, 7000);
  if (!videoResponse.ok) throw new Error(`video ${videoResponse.status}`);
  const data = await videoResponse.json();
  const caption = chooseInvidiousCaption(data?.captions || []);
  if (!caption?.url) throw new Error('no captions');

  const captionUrl = caption.url.startsWith('http') ? caption.url : `${instance}${caption.url}`;
  const vttUrl = captionUrl.includes('fmt=') ? captionUrl : `${captionUrl}${captionUrl.includes('?') ? '&' : '?'}fmt=vtt`;
  const capResponse = await timedFetch(vttUrl, 9000);
  if (!capResponse.ok) throw new Error(`caption ${capResponse.status}`);
  const body = await capResponse.text();
  const transcript = transcriptFromVtt(body) || transcriptFromXml(body);
  if (!transcript) throw new Error('empty caption');

  return {
    transcript,
    language: caption.language_code || '',
    trackName: caption.label || '',
    isAutoGenerated: /auto|generated/i.test(caption.label || ''),
    title: data?.title || '',
    method: `invidious:${new URL(instance).hostname}`
  };
}

async function tryInvidious(videoId) {
  const instances = await discoverInvidiousInstances();
  const attempts = instances.map((instance) => tryOneInvidious(instance, videoId));
  try {
    return await Promise.any(attempts);
  } catch (_) {
    return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*' } };
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const input = body.url || event.queryStringParameters?.url || '';
    const videoId = getVideoId(input);
    if (!videoId) return json(400, { ok: false, error: 'Неверная ссылка YouTube.' });

    let playerResponse = null;
    let tracks = [];
    let preferred = null;
    let transcript = '';
    let language = '';
    let trackName = '';
    let isAutoGenerated = false;
    let method = '';
    let title = '';

    try {
      const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en&gl=US&persist_hl=1`;
      const watch = await fetch(watchUrl, {
        headers: {
          'User-Agent': DESKTOP_UA,
          'Accept-Language': 'en-US,en;q=0.9',
          'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+410; SOCS=CAI'
        },
        redirect: 'follow'
      });
      if (watch.ok) {
        const html = await watch.text();
        playerResponse = findPlayerResponseInHtml(html);
        tracks = tracksFromPlayerResponse(playerResponse);
        method = 'initial-player-response';

        if (!tracks.length) {
          const directTracks = extractArrayAfterMarker(html, '"captionTracks":');
          if (Array.isArray(directTracks) && directTracks.length) {
            tracks = directTracks;
            method = 'watch-html-caption-tracks';
          }
        }

        if (!tracks.length) {
          const youtubei = await fetchYoutubeiPlayer(html, videoId);
          if (youtubei) {
            playerResponse = youtubei;
            tracks = tracksFromPlayerResponse(youtubei);
            method = 'youtubei-player';
          }
        }

        preferred = chooseTrack(tracks);
        if (preferred?.baseUrl) {
          transcript = await fetchTranscriptFromUrl(preferred.baseUrl);
          language = preferred.languageCode || '';
          trackName = preferred.name?.simpleText || preferred.name?.runs?.map((r) => r.text).join('') || '';
          isAutoGenerated = preferred.kind === 'asr';
        }

        title = playerResponse?.videoDetails?.title
          || decodeHtml(html.match(/<title>(.*?)<\/title>/i)?.[1] || '').replace(/\s*-\s*YouTube\s*$/i, '').trim();
      }
    } catch (_) {}

    if (!transcript) {
      const direct = await tryDirectTimedText(videoId);
      if (direct) {
        ({ transcript, language, trackName, isAutoGenerated, method } = direct);
      }
    }

    if (!transcript) {
      const inv = await tryInvidious(videoId);
      if (inv) {
        ({ transcript, language, trackName, isAutoGenerated, method } = inv);
        title = title || inv.title;
      }
    }

    if (!transcript) {
      const playability = playerResponse?.playabilityStatus?.status || '';
      const reason = playerResponse?.playabilityStatus?.reason || '';
      return json(404, {
        ok: false,
        error: 'Не удалось получить субтитры YouTube. Видео может не иметь доступной расшифровки или все бесплатные источники сейчас ограничены.',
        details: { playability, reason, tracksFound: tracks.length }
      });
    }

    return json(200, {
      ok: true,
      videoId,
      title,
      language,
      trackName,
      isAutoGenerated,
      method,
      transcript
    });
  } catch (error) {
    return json(500, { ok: false, error: error?.message || 'Ошибка получения YouTube-расшифровки.' });
  }
};
