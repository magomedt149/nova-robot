const crypto = require('crypto');

const AUTOCALLS_BASE_URL = 'https://app.autocalls.ai/api';
const FREE_CALL_LOCK = true;
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
  return { statusCode, headers, body: JSON.stringify(payload) };
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
  return (
    process.env.NOVA_AUTOCALLS_ALLOW_LOCALHOST === '1' &&
    /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin)
  );
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
    try { data = raw ? JSON.parse(raw) : {}; }
    catch (_) { data = raw ? { message: raw.slice(0, 500) } : {}; }

    if (!response.ok) {
      const error = new Error(String(data?.error || data?.message || `Autocalls HTTP ${response.status}`));
      error.status = response.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function listAssistants() {
  const payload = await autocallsRequest('/user/assistants/get?per_page=100&page=1');
  return Array.isArray(payload?.data)
    ? payload.data
    : (Array.isArray(payload?.assistants) ? payload.assistants : []);
}

async function resolveAssistant() {
  const assistants = await listAssistants();
  const configured = Number(process.env.AUTOCALLS_ASSISTANT_ID);

  if (Number.isInteger(configured) && configured > 0) {
    const existing = assistants.find((assistant) => Number(assistant?.id) === configured);
    return {
      id: configured,
      uuid: String(existing?.uuid || '').trim() || null,
      name: existing?.name || String(process.env.AUTOCALLS_ASSISTANT_NAME || '').trim() || null,
      phone_number_id: Number(existing?.phone_number_id) || null,
      source: existing ? 'env+discovery' : 'env'
    };
  }

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
    uuid: String(chosen.uuid || '').trim() || null,
    name: chosen.name || null,
    phone_number_id: Number(chosen.phone_number_id) || null,
    source: 'discovery'
  };
}

async function listOwnedPhoneNumbers() {
  const payload = await autocallsRequest('/user/phone-numbers/all');
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows
    .filter((item) => item && Number.isInteger(Number(item.id)) && Number(item.id) > 0)
    .map((item) => ({
      id: Number(item.id),
      phone_number: normalizePhoneNumber(item.phone_number),
      nickname: item.nickname || null,
      type: item.type || null,
      type_label: item.type_label || null,
      country_code: item.country_code || null,
      has_active_subscription: item.has_active_subscription === true
    }))
    .filter((item) =>
      item.phone_number &&
      (item.type === 'normal' || item.type === 'caller_id' || !item.type)
    );
}

async function resolveOwnedPhoneNumber({ id, phone_number }) {
  const phoneNumbers = await listOwnedPhoneNumbers();
  const wantedId = Number(id);
  const wantedPhone = normalizePhoneNumber(phone_number);

  const match = phoneNumbers.find((item) =>
    (Number.isInteger(wantedId) && wantedId > 0 && item.id === wantedId) ||
    (wantedPhone && item.phone_number === wantedPhone)
  );

  if (!match) {
    const error = new Error('Selected caller number was not found in this Autocalls account.');
    error.status = 404;
    throw error;
  }

  if (wantedPhone && match.phone_number !== wantedPhone) {
    const error = new Error('Selected caller number does not match its Autocalls ID.');
    error.status = 409;
    throw error;
  }

  return match;
}

async function freeTestConversation(message) {
  const assistant = await resolveAssistant();
  if (!assistant.uuid) {
    const error = new Error('The selected Autocalls assistant has no UUID for a free test conversation.');
    error.status = 409;
    throw error;
  }

  const created = await autocallsRequest('/conversations', {
    method: 'POST',
    body: {
      assistant_id: assistant.uuid,
      type: 'test'
    }
  });

  const conversationUuid = String(created?.conversation_id || created?.uuid || '').trim();
  let reply = null;
  const cleanMessage = String(message || '').trim();

  if (conversationUuid && cleanMessage) {
    reply = await autocallsRequest(`/conversations/${encodeURIComponent(conversationUuid)}/messages`, {
      method: 'POST',
      body: { message: cleanMessage.slice(0, 1000) }
    });
  }

  return {
    assistant: {
      id: assistant.id,
      uuid: assistant.uuid,
      name: assistant.name
    },
    conversation_uuid: conversationUuid || null,
    reply
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

  if (!isAllowedOrigin(origin)) return json(403, { ok: false, error: 'Origin is not allowed.' });

  const apiKey = String(process.env.AUTOCALLS_API_KEY || '').trim();
  const ownerKey = String(process.env.NOVA_AUTOCALLS_CALL_KEY || '').trim();
  if (!apiKey || !ownerKey) {
    return json(503, { ok: false, error: 'Autocalls backend is not configured.' }, origin);
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
  try { body = parseJsonBody(event); }
  catch (error) { return json(400, { ok: false, error: error?.message || 'Invalid JSON.' }, origin); }

  const action = String(body.action || '').trim().toLowerCase();

  try {
    if (action === 'list_numbers') {
      const numbers = await listOwnedPhoneNumbers();
      return json(200, { ok: true, free_call_lock: FREE_CALL_LOCK, numbers }, origin);
    }

    if (action === 'resolve_number') {
      const number = await resolveOwnedPhoneNumber({
        id: body.from_phone_number_id,
        phone_number: body.from_phone_number
      });
      return json(200, { ok: true, free_call_lock: FREE_CALL_LOCK, number }, origin);
    }

    if (action === 'free_test') {
      const result = await freeTestConversation(body.message);
      return json(200, {
        ok: true,
        free_call_lock: FREE_CALL_LOCK,
        mode: 'FREE_TEST_ONLY',
        ...result
      }, origin);
    }

    if (action === 'make_call') {
      return json(402, {
        ok: false,
        free_call_lock: FREE_CALL_LOCK,
        error: 'NOVA FREE CALL LOCK: real phone calls through Autocalls are billable and are blocked. No /user/make_call request was sent.'
      }, origin);
    }

    return json(400, { ok: false, error: 'Unknown Autocalls action.' }, origin);
  } catch (error) {
    const upstreamStatus = Number(error?.status);
    const statusCode =
      upstreamStatus === 401 || upstreamStatus === 403 ? 502 :
      upstreamStatus >= 400 && upstreamStatus < 500 ? upstreamStatus :
      502;

    return json(statusCode, {
      ok: false,
      free_call_lock: FREE_CALL_LOCK,
      error: error?.name === 'AbortError'
        ? 'Autocalls request timed out.'
        : String(error?.message || 'Autocalls request failed.')
    }, origin);
  }
};
