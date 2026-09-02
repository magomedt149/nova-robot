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
  const markers = [
    'var ytInitialPlayerResponse =',
    'ytInitialPlayerResponse =',
    'window["ytInitialPlayerResponse"] ='
  ];
  for (const marker of markers) {
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
  const patterns = [
    new RegExp(`"${key}":"([^"\\n]+)"`),
    new RegExp(`'${key}':'([^'\\n]+)'`)
  ];
  for (const pattern of patterns) {
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
      context: {
        client: {
          clientName: 'WEB',
          clientVersion,
          hl: 'en',
          gl: 'US',
          utcOffsetMinutes: 0
        }
      },
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

async function fetchTranscriptFromUrl(baseUrl) {
  if (!baseUrl) return '';
  const jsonUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}fmt=json3`;
  const response = await fetch(jsonUrl, {
    headers: {
      'User-Agent': DESKTOP_UA,
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.youtube.com/'
    }
  });
  if (response.ok) {
    const text = await response.text();
    if (text.trim()) {
      try {
        const parsed = JSON.parse(text);
        const transcript = transcriptFromJson3(parsed);
        if (transcript) return transcript;
      } catch (_) {
        const transcript = transcriptFromXml(text);
        if (transcript) return transcript;
      }
    }
  }

  const xmlResponse = await fetch(baseUrl, { headers: { 'User-Agent': DESKTOP_UA } });
  if (!xmlResponse.ok) return '';
  return transcriptFromXml(await xmlResponse.text());
}

async function tryDirectTimedText(videoId) {
  const languages = ['en', 'en-US', 'en-GB'];
  for (const lang of languages) {
    const url = `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(lang)}&fmt=json3`;
    try {
      const response = await fetch(url, { headers: { 'User-Agent': DESKTOP_UA } });
      if (!response.ok) continue;
      const text = await response.text();
      if (!text.trim()) continue;
      try {
        const transcript = transcriptFromJson3(JSON.parse(text));
        if (transcript) return { transcript, language: lang, isAutoGenerated: false, trackName: '' };
      } catch (_) {
        const transcript = transcriptFromXml(text);
        if (transcript) return { transcript, language: lang, isAutoGenerated: false, trackName: '' };
      }
    } catch (_) {}
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*' } };
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const input = body.url || event.queryStringParameters?.url || '';
    const videoId = getVideoId(input);
    if (!videoId) return json(400, { ok: false, error: 'Неверная ссылка YouTube.' });

    const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en&gl=US&persist_hl=1`;
    const watch = await fetch(watchUrl, {
      headers: {
        'User-Agent': DESKTOP_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+410; SOCS=CAI'
      },
      redirect: 'follow'
    });
    if (!watch.ok) throw new Error(`YouTube HTTP ${watch.status}`);
    const html = await watch.text();

    let playerResponse = findPlayerResponseInHtml(html);
    let tracks = tracksFromPlayerResponse(playerResponse);
    let method = 'initial-player-response';

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

    const preferred = chooseTrack(tracks);
    let transcript = '';
    let language = '';
    let trackName = '';
    let isAutoGenerated = false;

    if (preferred?.baseUrl) {
      transcript = await fetchTranscriptFromUrl(preferred.baseUrl);
      language = preferred.languageCode || '';
      trackName = preferred.name?.simpleText || preferred.name?.runs?.map((r) => r.text).join('') || '';
      isAutoGenerated = preferred.kind === 'asr';
    }

    if (!transcript) {
      const direct = await tryDirectTimedText(videoId);
      if (direct) {
        transcript = direct.transcript;
        language = direct.language;
        trackName = direct.trackName;
        isAutoGenerated = direct.isAutoGenerated;
        method = 'direct-timedtext';
      }
    }

    if (!transcript) {
      const playability = playerResponse?.playabilityStatus?.status || '';
      const reason = playerResponse?.playabilityStatus?.reason || '';
      return json(404, {
        ok: false,
        error: 'Не удалось получить субтитры YouTube. Видео может не иметь доступной расшифровки или YouTube ограничил серверный доступ.',
        details: { playability, reason, tracksFound: tracks.length }
      });
    }

    const title = playerResponse?.videoDetails?.title
      || decodeHtml(html.match(/<title>(.*?)<\/title>/i)?.[1] || '').replace(/\s*-\s*YouTube\s*$/i, '').trim();

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
