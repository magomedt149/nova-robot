const MAX_CHUNK = 450;

function splitText(text, max = MAX_CHUNK) {
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
      continue;
    }
    if (current) chunks.push(current);
    if (part.length <= max) {
      current = part;
    } else {
      for (let i = 0; i < part.length; i += max) chunks.push(part.slice(i, i + max));
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function translateChunk(chunk, from, to) {
  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', chunk);
  url.searchParams.set('langpair', `${from}|${to}`);
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'NOVA-Translator/1.0'
    }
  });
  if (!response.ok) throw new Error(`Translation service HTTP ${response.status}`);
  const data = await response.json();
  const translated = data?.responseData?.translatedText;
  if (!translated) throw new Error(data?.responseDetails || 'Translation unavailable');
  return translated;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' } };
  }
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const text = String(body.text || event.queryStringParameters?.text || '').trim();
    const from = String(body.from || event.queryStringParameters?.from || 'en').toLowerCase();
    const to = String(body.to || event.queryStringParameters?.to || 'ru').toLowerCase();
    if (!text) return json(400, { ok: false, error: 'Введите текст для перевода.' });
    if (text.length > 12000) return json(413, { ok: false, error: 'Слишком длинный текст. Максимум 12 000 символов за один запрос.' });

    const chunks = splitText(text);
    const out = [];
    for (const chunk of chunks) out.push(await translateChunk(chunk, from, to));
    return json(200, { ok: true, translatedText: out.join(' '), from, to, provider: 'MyMemory' });
  } catch (error) {
    return json(500, { ok: false, error: error?.message || 'Ошибка перевода.' });
  }
};

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
