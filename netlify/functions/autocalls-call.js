const crypto = require('crypto');

const AUTOCALLS_BASE_URL = 'https://app.autocalls.ai/api';
const DEFAULT_ALLOWED_ORIGINS = [
  'https://magomedt149.github.io',
  'https://dashing-otter-990b47.netlify.app'
];

function json(statusCode, payload, origin = '') {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff'
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return {
    statusCode,
    headers,
    body: JSON.stringify(payload)
  };
}

function allowedOrigins() {
  const extra = String(process.env.NOVA_AUTOCALLS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...extra]);
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (allowedOrigins().has(origin)) return true;
  if (
    process.env.NOVA_AUTOCALLS_ALLOW_LOCALHOST === '1' &&
    /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin)
  ) {
    return true;
  }
  return false;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseJsonBody(event) {
  if (!event.body) return {};
  if (event.body.length > 4096) throw new Error('Request body is too large.');
  return JSON.parse(event.body);
}

function normalizePhoneNumber(value) {
  const phone = String(value || '').trim();
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return null;
  return phone;
}

async function autocallsRequest(path, options = {}) {
  const apiKey = String(process.env.AUTOCALLS_API_KEY || '').trim();
  if (!apiKey) throw new Error('AUTOCALLS_API_KEY is not configured.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${AUTOCALLS_BASE_URL}${path}`, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });

    const raw = await response.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (_) {
      data = raw ? { message: raw.slice(0, 500) } : {};
    }

    if (!response.ok) {
      const message = String(data?.error || data?.message || `Autocalls HTTP ${response.status}`);
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveAssistant() {
  const configured = Number(process.env.AUTOCALLS_ASSISTANT_ID);
  if (Number.isInteger(configured) && configured > 0) {
    return {
      id: configured,
      name: String(process.env.AUTOCALLS_ASSISTANT_NAME || '').trim() || null,
      source: 'env'
    };
  }

  const payload = await autocallsRequest('/user/assistants/get?per_page=100&page=1');
  const assistants = Array.isArray(payload?.data)
    ? payload.data
    : (Array.isArray(payload?.assistants) ? payload.assistants : []);

  const outbound = assistants.filter((assistant) =>
    assistant &&
    String(assistant.type || '').toLowerCase() === 'outbound' &&
    Number.isInteger(Number(assistant.id)) &&
    Number(assistant.id) > 0
  );

  const chosen =
    outbound.find((assistant) => String(assistant.status || '').toLowerCase() === 'active') ||
    outbound[0];

  if (!chosen) {
    const error = new Error('No outbound Autocalls assistant is available.');
    error.status = 409;
    throw error;
  }

  return {
    id: Number(chosen.id),
    name: chosen.name || null,
    source: 'discovery'
  };
}

exports.handler = async (event) => {
  const origin = String(event.headers?.origin || event.headers?.Origin || '').trim();

  if (event.httpMethod === 'OPTIONS') {
    if (!isAllowedOrigin(origin)) return json(403, { ok: false, error: 'Origin is not allowed.' });
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'Content-Type, X-NOVA-Call-Key',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed.' }, isAllowedOrigin(origin) ? origin : '');
  }

  if (!isAllowedOrigin(origin)) {
    return json(403, { ok: false, error: 'Origin is not allowed.' });
  }

  const apiKey = String(process.env.AUTOCALLS_API_KEY || '').trim();
  const ownerKey = String(process.env.NOVA_AUTOCALLS_CALL_KEY || '').trim();
  if (!apiKey || !ownerKey) {
    return json(503, {
      ok: false,
      error: 'Autocalls calling backend is not configured.'
    }, origin);
  }

  const suppliedOwnerKey = String(
    event.headers?.['x-nova-call-key'] ||
    event.headers?.['X-NOVA-Call-Key'] ||
    ''
  );

  if (!safeEqual(suppliedOwnerKey, ownerKey)) {
    return json(401, { ok: false, error: 'NOVA call authorization failed.' }, origin);
  }

  let body;
  try {
    body = parseJsonBody(event);
  } catch (error) {
    return json(400, { ok: false, error: error?.message || 'Invalid JSON.' }, origin);
  }

  if (body.confirmed !== true) {
    return json(412, {
      ok: false,
      error: 'Explicit call confirmation is required.'
    }, origin);
  }

  const confirmedAt = Number(body.confirmed_at);
  const confirmationAge = Date.now() - confirmedAt;
  if (!Number.isFinite(confirmedAt) || confirmationAge < -10000 || confirmationAge > 90000) {
    return json(412, {
      ok: false,
      error: 'Call confirmation expired. Confirm the call again.'
    }, origin);
  }

  const phoneNumber = normalizePhoneNumber(body.phone_number);
  if (!phoneNumber) {
    return json(422, {
      ok: false,
      error: 'Phone number must be in E.164 format, for example +19165551234.'
    }, origin);
  }

  try {
    const assistant = await resolveAssistant();
    const result = await autocallsRequest('/user/make_call', {
      method: 'POST',
      body: {
        phone_number: phoneNumber,
        assistant_id: assistant.id
      }
    });

    return json(200, {
      ok: true,
      phone_number: phoneNumber,
      assistant: {
        id: assistant.id,
        name: assistant.name
      },
      message: result?.message || 'Call initiated successfully'
    }, origin);
  } catch (error) {
    const upstreamStatus = Number(error?.status);
    const statusCode =
      upstreamStatus === 401 || upstreamStatus === 403 ? 502 :
      upstreamStatus >= 400 && upstreamStatus < 500 ? upstreamStatus :
      502;

    return json(statusCode, {
      ok: false,
      error: error?.name === 'AbortError'
        ? 'Autocalls request timed out.'
        : String(error?.message || 'Autocalls call failed.')
    }, origin);
  }
};
