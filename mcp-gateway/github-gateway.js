'use strict';

const http = require('http');
const { timingSafeEqual } = require('crypto');

const PORT = Number(process.env.PORT || 8787);
const UPSTREAM = 'https://api.githubcopilot.com/mcp/';
const GITHUB_TOKEN = String(process.env.GITHUB_PERSONAL_ACCESS_TOKEN || '').trim();
const GATEWAY_KEY = String(process.env.NOVA_MCP_GATEWAY_KEY || '').trim();
const ALLOWED_ORIGINS = String(
  process.env.NOVA_ALLOWED_ORIGINS || 'https://magomedt149.github.io,http://localhost:8000,http://127.0.0.1:8000'
).split(',').map((x) => x.trim()).filter(Boolean);
const MAX_BODY = 2 * 1024 * 1024;

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && timingSafeEqual(aa, bb);
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
  if (!GATEWAY_KEY) return true;
  const auth = String(req.headers.authorization || '');
  return safeEqual(auth.replace(/^Bearer\s+/i, '').trim(), GATEWAY_KEY);
}

function collect(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Request too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function proxy(req, res) {
  if (!GITHUB_TOKEN) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'GITHUB_PERSONAL_ACCESS_TOKEN is not configured' }));
    return;
  }
  if (!authorized(req)) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Unauthorized gateway request' }));
    return;
  }

  const headers = {
    Accept: 'application/json, text/event-stream',
    Authorization: 'Bearer ' + GITHUB_TOKEN,
    'X-MCP-Readonly': 'true',
    'X-MCP-Lockdown': 'true',
    'X-MCP-Tools': 'get_me,get_file_contents'
  };
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
  if (req.headers['mcp-session-id']) headers['Mcp-Session-Id'] = req.headers['mcp-session-id'];

  const body = ['GET', 'HEAD', 'DELETE'].includes(req.method) ? undefined : await collect(req);
  const upstream = await fetch(UPSTREAM, {
    method: req.method,
    headers,
    body,
    redirect: 'manual',
    cache: 'no-store'
  });

  res.statusCode = upstream.status;
  const type = upstream.headers.get('content-type');
  const session = upstream.headers.get('mcp-session-id');
  if (type) res.setHeader('Content-Type', type);
  if (session) res.setHeader('Mcp-Session-Id', session);
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

const server = http.createServer(async (req, res) => {
  if (!applyCors(req, res)) {
    res.statusCode = 403;
    res.end('Origin not allowed');
    return;
  }
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') {
    res.statusCode = GITHUB_TOKEN ? 200 : 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      ok: Boolean(GITHUB_TOKEN),
      upstream: UPSTREAM,
      readonly: true,
      tools: ['get_me', 'get_file_contents']
    }));
    return;
  }

  if (url.pathname !== '/mcp/github') {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  if (!['POST', 'DELETE', 'GET'].includes(req.method)) {
    res.statusCode = 405;
    res.end('Method not allowed');
    return;
  }

  try { await proxy(req, res); }
  catch (error) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: error?.message || String(error) }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('NOVA GitHub MCP Gateway listening on port ' + PORT);
  console.log('Upstream: ' + UPSTREAM);
  console.log('Mode: READ ONLY / get_me,get_file_contents');
});
