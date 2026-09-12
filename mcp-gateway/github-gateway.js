'use strict';

const http = require('http');
const { timingSafeEqual } = require('crypto');

const PORT = Number(process.env.PORT || 8787);
const HOST = String(process.env.HOST || '127.0.0.1').trim();
const UPSTREAM = 'https://api.githubcopilot.com/mcp/readonly';
const GITHUB_TOKEN = String(process.env.GITHUB_PERSONAL_ACCESS_TOKEN || '').trim();
const GATEWAY_KEY = String(process.env.NOVA_MCP_GATEWAY_KEY || '').trim();
const ALLOW_UNAUTHENTICATED_LOCAL =
  String(process.env.NOVA_MCP_ALLOW_UNAUTHENTICATED_LOCAL || '1').trim() === '1';
const ALLOWED_ORIGINS = String(
  process.env.NOVA_ALLOWED_ORIGINS || 'https://magomedt149.github.io,http://localhost:8000,http://127.0.0.1:8000'
).split(',').map((x) => x.trim()).filter(Boolean);
const MAX_BODY = 2 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = Math.max(5000, Number(process.env.NOVA_MCP_UPSTREAM_TIMEOUT_MS || 30000));
const ALLOWED_TOOLS = new Set(['get_me', 'get_file_contents']);
const ALLOWED_RPC_METHODS = new Set([
  'initialize',
  'notifications/initialized',
  'ping',
  'tools/list',
  'tools/call',
  'resources/list',
  'prompts/list'
]);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const LOCAL_UNAUTHENTICATED = LOOPBACK_HOSTS.has(HOST) && ALLOW_UNAUTHENTICATED_LOCAL;
const GATEWAY_AUTH_READY = Boolean(GATEWAY_KEY) || LOCAL_UNAUTHENTICATED;

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function applyCors(req, res) {
  const origin = String(req.headers.origin || '');
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST,DELETE,OPTIONS,GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Mcp-Session-Id');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id,Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  return !origin || ALLOWED_ORIGINS.includes(origin);
}

function authorized(req) {
  if (GATEWAY_KEY) {
    const auth = String(req.headers.authorization || '');
    return safeEqual(auth.replace(/^Bearer\s+/i, '').trim(), GATEWAY_KEY);
  }
  return LOCAL_UNAUTHENTICATED;
}

function collect(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        const error = new Error('Request too large');
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function validateRpcMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return 'Invalid JSON-RPC message';
  }
  const method = String(message.method || '');
  if (!ALLOWED_RPC_METHODS.has(method)) {
    return 'MCP method is not allowed by NOVA gateway: ' + method;
  }
  if (method === 'tools/call') {
    const name = String(message.params?.name || '');
    if (!ALLOWED_TOOLS.has(name)) {
      return 'MCP tool is not allowed by NOVA gateway: ' + name;
    }
  }
  return '';
}

function validateRpcPayload(body) {
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body || '').toString('utf8'));
  } catch (_) {
    return { ok: false, status: 400, error: 'Invalid JSON body' };
  }
  const messages = Array.isArray(payload) ? payload : [payload];
  if (!messages.length) return { ok: false, status: 400, error: 'Empty JSON-RPC batch' };
  for (const message of messages) {
    const error = validateRpcMessage(message);
    if (error) return { ok: false, status: 403, error };
  }
  return { ok: true };
}

async function proxy(req, res) {
  if (!GITHUB_TOKEN) {
    json(res, 503, { error: 'GITHUB_PERSONAL_ACCESS_TOKEN is not configured' });
    return;
  }
  if (!GATEWAY_AUTH_READY) {
    json(res, 503, {
      error: 'Public GitHub MCP gateway requires NOVA_MCP_GATEWAY_KEY',
      hint: 'For local development bind HOST=127.0.0.1. Public deployments must configure a gateway key.'
    });
    return;
  }
  if (!authorized(req)) {
    json(res, 401, { error: 'Unauthorized gateway request' });
    return;
  }

  let body;
  if (!['GET', 'HEAD', 'DELETE'].includes(req.method)) {
    body = await collect(req);
    const check = validateRpcPayload(body);
    if (!check.ok) {
      json(res, check.status, { error: check.error });
      return;
    }
  }

  const headers = {
    Accept: 'application/json, text/event-stream',
    Authorization: 'Bearer ' + GITHUB_TOKEN,
    'X-MCP-Readonly': 'true',
    'X-MCP-Lockdown': 'true',
    'X-MCP-Tools': Array.from(ALLOWED_TOOLS).join(',')
  };
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
  if (req.headers['mcp-session-id']) headers['Mcp-Session-Id'] = req.headers['mcp-session-id'];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(UPSTREAM, {
      method: req.method,
      headers,
      body,
      redirect: 'manual',
      cache: 'no-store',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  res.statusCode = upstream.status;
  const type = upstream.headers.get('content-type');
  const session = upstream.headers.get('mcp-session-id');
  if (type) res.setHeader('Content-Type', type);
  if (session) res.setHeader('Mcp-Session-Id', session);
  res.setHeader('Cache-Control', 'no-store');
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

function createServer() {
  return http.createServer(async (req, res) => {
    if (!applyCors(req, res)) {
      json(res, 403, { error: 'Origin not allowed' });
      return;
    }
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') {
      const ok = Boolean(GITHUB_TOKEN) && GATEWAY_AUTH_READY;
      json(res, ok ? 200 : 503, {
        ok,
        upstream: UPSTREAM,
        readonly: true,
        lockdown: true,
        tools: Array.from(ALLOWED_TOOLS),
        auth: GATEWAY_KEY ? 'gateway-key' : LOCAL_UNAUTHENTICATED ? 'loopback-local' : 'missing',
        host: HOST
      });
      return;
    }

    if (url.pathname !== '/mcp/github') {
      json(res, 404, { error: 'Not found' });
      return;
    }
    if (!['POST', 'DELETE', 'GET'].includes(req.method)) {
      json(res, 405, { error: 'Method not allowed' });
      return;
    }

    try {
      await proxy(req, res);
    } catch (error) {
      const status = Number(error?.statusCode) || (error?.name === 'AbortError' ? 504 : 502);
      json(res, status, {
        error: error?.name === 'AbortError'
          ? 'GitHub MCP upstream timed out'
          : (error?.message || String(error))
      });
    }
  });
}

function start() {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log('NOVA GitHub MCP Gateway listening on ' + HOST + ':' + PORT);
    console.log('Upstream: ' + UPSTREAM);
    console.log('Mode: READ ONLY + LOCKDOWN / ' + Array.from(ALLOWED_TOOLS).join(','));
    if (!GATEWAY_AUTH_READY) {
      console.error('FREE LOCK: configure NOVA_MCP_GATEWAY_KEY before exposing this gateway publicly.');
    }
  });
  return server;
}

if (require.main === module) start();

module.exports = {
  ALLOWED_RPC_METHODS,
  ALLOWED_TOOLS,
  GATEWAY_AUTH_READY,
  LOCAL_UNAUTHENTICATED,
  authorized,
  createServer,
  safeEqual,
  validateRpcMessage,
  validateRpcPayload
};
