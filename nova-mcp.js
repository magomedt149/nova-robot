(() => {
  'use strict';

  const BRIDGE_VERSION = '1.1.0';
  const NOVA_VERSION = '27.28.0';
  const MCP_PROTOCOL_VERSION = '2026-07-28';
  const ENDPOINT_KEY = 'nova.mcp.endpoint';
  const TOKEN_KEY = 'nova.mcp.token.session';
  const GITHUB_GATEWAY_KEY = 'nova.mcp.github.gateway';
  const GITHUB_UPSTREAM = 'https://api.githubcopilot.com/mcp/';
  const GITHUB_LOCAL_GATEWAY = 'http://127.0.0.1:8787/mcp/github';
  const GITHUB_ALLOWED_TOOLS = new Set(['get_me', 'get_file_contents']);

  const state = {
    endpoint: localStorage.getItem(ENDPOINT_KEY) || '',
    connected: false,
    connecting: false,
    sessionId: '',
    serverInfo: null,
    capabilities: {},
    protocolVersion: MCP_PROTOCOL_VERSION,
    tools: [],
    resources: [],
    prompts: [],
    nextId: 0,
    provider: ''
  };

  const $ = (selector, root = document) => root.querySelector(selector);

  function normalizeEndpoint(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const url = new URL(raw, location.href);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
      throw new Error('Для MCP нужен HTTPS. HTTP разрешён только для localhost.');
    }
    if (url.username || url.password) {
      throw new Error('Не вставляй логин или токен в URL.');
    }
    return url.toString();
  }

  function isDirectGitHubEndpoint(value) {
    try { return new URL(String(value || '')).hostname === 'api.githubcopilot.com'; }
    catch (_) { return false; }
  }

  function isGitHubGatewayEndpoint(value) {
    try { return /\/mcp\/github\/?$/i.test(new URL(String(value || '')).pathname); }
    catch (_) { return false; }
  }

  function selectGitHubPreset() {
    const saved = localStorage.getItem(GITHUB_GATEWAY_KEY) || GITHUB_LOCAL_GATEWAY;
    const input = $('#novaMcpEndpoint');
    if (input) input.value = saved;
    state.endpoint = saved;
    state.provider = 'github';
    renderStatus(
      saved.startsWith('http://127.0.0.1')
        ? 'GitHub MCP выбран. localhost работает только на компьютере с gateway; для iPhone нужен публичный HTTPS gateway.'
        : 'GitHub MCP выбран: официальный GitHub сервер через NOVA gateway.',
      'idle'
    );
    render();
  }

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  }

  function setToken(value) {
    const token = String(value || '').trim();
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  }

  function parseSse(text) {
    const blocks = String(text || '').split(/\r?\n\r?\n/);
    let last = null;
    for (const block of blocks) {
      const data = block.split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n');
      if (!data || data === '[DONE]') continue;
      try { last = JSON.parse(data); } catch (_) {}
    }
    return last;
  }

  async function rpc(method, params, options = {}) {
    if (!state.endpoint) throw new Error('MCP endpoint не задан.');
    const notification = options.notification === true;
    const payload = {
      jsonrpc: '2.0',
      method
    };
    if (!notification) payload.id = ++state.nextId;
    if (params !== undefined) payload.params = params;

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    };
    if (state.sessionId) headers['Mcp-Session-Id'] = state.sessionId;
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;

    const response = await fetch(state.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'follow'
    });

    const sessionId = response.headers.get('Mcp-Session-Id');
    if (sessionId) state.sessionId = sessionId;

    if (notification && response.status === 202) return null;
    const raw = await response.text();
    if (!response.ok) {
      throw new Error('MCP HTTP ' + response.status + (raw ? ': ' + raw.slice(0, 220) : ''));
    }
    if (!raw.trim()) return null;

    const type = response.headers.get('content-type') || '';
    let message = null;
    if (type.includes('text/event-stream')) message = parseSse(raw);
    else {
      try { message = JSON.parse(raw); }
      catch (_) { message = parseSse(raw); }
    }
    if (!message) throw new Error('MCP вернул пустой или непонятный ответ.');
    if (message.error) {
      const detail = message.error.message || JSON.stringify(message.error);
      throw new Error(detail);
    }
    return message.result;
  }

  async function listOptional(method) {
    try {
      const result = await rpc(method, {});
      if (method === 'resources/list') return result?.resources || [];
      if (method === 'prompts/list') return result?.prompts || [];
    } catch (_) {}
    return [];
  }

  async function refreshCapabilities() {
    const toolsResult = await rpc('tools/list', {});
    const listedTools = Array.isArray(toolsResult?.tools) ? toolsResult.tools : [];
    state.tools = state.provider === 'github'
      ? listedTools.filter((tool) => GITHUB_ALLOWED_TOOLS.has(String(tool?.name || '')))
      : listedTools;
    const [resources, prompts] = await Promise.all([
      listOptional('resources/list'),
      listOptional('prompts/list')
    ]);
    state.resources = resources;
    state.prompts = prompts;
    render();
    return state.tools;
  }

  async function connect(endpoint, token) {
    if (state.connecting) return;
    state.connecting = true;
    renderStatus('Подключение…', 'busy');
    try {
      state.endpoint = normalizeEndpoint(endpoint || state.endpoint);
      if (!state.endpoint) throw new Error('Укажи адрес MCP-сервера, например https://server.example/mcp');
      if (isDirectGitHubEndpoint(state.endpoint)) {
        throw new Error('GitHub блокирует прямое MCP-подключение из браузера. Используй NOVA GitHub Gateway, а не api.githubcopilot.com напрямую.');
      }
      state.provider = isGitHubGatewayEndpoint(state.endpoint) ? 'github' : '';
      localStorage.setItem(ENDPOINT_KEY, state.endpoint);
      if (state.provider === 'github') localStorage.setItem(GITHUB_GATEWAY_KEY, state.endpoint);
      setToken(token);

      state.sessionId = '';
      const result = await rpc('initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: 'NOVA MCP Bridge',
          version: BRIDGE_VERSION
        }
      });

      state.protocolVersion = result?.protocolVersion || MCP_PROTOCOL_VERSION;
      state.serverInfo = result?.serverInfo || null;
      state.capabilities = result?.capabilities || {};
      await rpc('notifications/initialized', {}, { notification: true });
      state.connected = true;
      await refreshCapabilities();
      renderStatus('MCP подключён', 'ok');
      updateChip();
      return result;
    } catch (error) {
      state.connected = false;
      state.sessionId = '';
      renderStatus(error?.message || 'Ошибка MCP', 'error');
      updateChip();
      throw error;
    } finally {
      state.connecting = false;
    }
  }

  async function disconnect() {
    const endpoint = state.endpoint;
    const sessionId = state.sessionId;
    if (endpoint && sessionId) {
      try {
        const headers = { 'Mcp-Session-Id': sessionId };
        const token = getToken();
        if (token) headers.Authorization = 'Bearer ' + token;
        await fetch(endpoint, {
          method: 'DELETE',
          headers,
          credentials: 'omit',
          cache: 'no-store'
        });
      } catch (_) {}
    }
    state.connected = false;
    state.sessionId = '';
    state.serverInfo = null;
    state.capabilities = {};
    state.tools = [];
    state.resources = [];
    state.prompts = [];
    renderStatus('MCP отключён', 'idle');
    updateChip();
    render();
  }

  async function callTool(name, args = {}) {
    if (!state.connected) throw new Error('Сначала подключи MCP-сервер.');
    if (state.provider === 'github' && !GITHUB_ALLOWED_TOOLS.has(name)) {
      throw new Error('FREE LOCK: этот GitHub MCP-инструмент не разрешён: ' + name);
    }
    const tool = state.tools.find((item) => item.name === name);
    if (!tool) throw new Error('Инструмент не найден: ' + name);

    const ok = window.confirm(
      'NOVA FREE LOCK\n\nВызвать внешний MCP-инструмент "' + name + '"?\n' +
      'NOVA не выполняет внешние tool-вызовы автоматически.'
    );
    if (!ok) throw new Error('Вызов отменён пользователем.');

    renderStatus('Выполняю ' + name + '…', 'busy');
    try {
      const result = await rpc('tools/call', { name, arguments: args || {} });
      renderStatus('Готово: ' + name, 'ok');
      return result;
    } catch (error) {
      renderStatus(error?.message || 'Ошибка инструмента', 'error');
      throw error;
    }
  }

  async function testGitHubRead() {
    if (!state.connected) throw new Error('Сначала подключи GitHub MCP.');
    if (!state.tools.some((item) => item.name === 'get_file_contents')) {
      throw new Error('GitHub MCP не выдал get_file_contents. Проверь gateway и права токена.');
    }
    const result = await callTool('get_file_contents', {
      owner: 'magomedt149',
      repo: 'nova-robot',
      path: 'version.json',
      ref: 'refs/heads/main'
    });
    const out = $('#novaMcpResult');
    if (out) {
      out.hidden = false;
      out.textContent = stringifyResult(result);
    }
    renderStatus('GitHub MCP проверен: version.json прочитан', 'ok');
    return result;
  }

  function selfTest() {
    const checks = [
      ['MCP Bridge загружен', true],
      ['HTTPS/secure context', window.isSecureContext || ['localhost', '127.0.0.1'].includes(location.hostname)],
      ['fetch доступен', typeof fetch === 'function'],
      ['localStorage доступен', (() => { try { localStorage.setItem('__nova_mcp_test', '1'); localStorage.removeItem('__nova_mcp_test'); return true; } catch (_) { return false; } })()],
      ['FREE LOCK: автозапуск tool выключен', true],
      ['Токен хранится только в sessionStorage', true],
      ['Прямой GitHub MCP из браузера блокируется и не используется', true],
      ['GitHub preset использует gateway + read-only policy', true],
      ['GitHub client allowlist: только get_me + get_file_contents', GITHUB_ALLOWED_TOOLS.size === 2]
    ];
    const passed = checks.every(([, ok]) => ok);
    renderStatus(passed ? 'MCP Bridge готов к подключению' : 'Есть проблема в окружении', passed ? 'ok' : 'error');
    const box = $('#novaMcpDiagnostics');
    if (box) {
      box.innerHTML = checks.map(([label, ok]) => '<div>' + (ok ? '✅' : '❌') + ' ' + escapeHtml(label) + '</div>').join('');
    }
    return { passed, checks };
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[char]);
  }

  function stringifyResult(value) {
    try { return JSON.stringify(value, null, 2); }
    catch (_) { return String(value); }
  }

  function renderStatus(text, tone = 'idle') {
    const node = $('#novaMcpStatus');
    if (!node) return;
    node.textContent = text;
    node.dataset.tone = tone;
  }

  function updateChip() {
    const chip = $('#novaMcpChip');
    if (!chip) return;
    chip.textContent = state.connected ? 'MCP ON' : 'MCP OFF';
    chip.dataset.connected = state.connected ? 'true' : 'false';
    chip.title = state.connected && state.serverInfo?.name
      ? 'MCP: ' + state.serverInfo.name
      : 'MCP Bridge';
  }

  function render() {
    const endpointInput = $('#novaMcpEndpoint');
    if (endpointInput && document.activeElement !== endpointInput) endpointInput.value = state.endpoint || '';
    const server = $('#novaMcpServer');
    if (server) {
      const name = state.serverInfo?.name || 'не подключён';
      const version = state.serverInfo?.version ? ' ' + state.serverInfo.version : '';
      server.textContent = name + version;
    }
    const counts = $('#novaMcpCounts');
    if (counts) counts.textContent = state.tools.length + ' tools • ' + state.resources.length + ' resources • ' + state.prompts.length + ' prompts';

    const list = $('#novaMcpTools');
    if (list) {
      if (!state.connected) {
        list.innerHTML = '<div class="nova-mcp-empty">Подключи MCP-сервер — здесь появятся его инструменты.</div>';
      } else if (!state.tools.length) {
        list.innerHTML = '<div class="nova-mcp-empty">Сервер подключён, но tools не объявлены.</div>';
      } else {
        list.innerHTML = state.tools.map((tool) => {
          const description = tool.description ? '<small>' + escapeHtml(tool.description) + '</small>' : '';
          return '<button type="button" class="nova-mcp-tool" data-mcp-tool="' + escapeHtml(tool.name) + '"><b>⚙️ ' + escapeHtml(tool.name) + '</b>' + description + '</button>';
        }).join('');
      }
    }
    updateChip();
  }

  function openPanel() {
    const modal = $('#novaMcpModal');
    if (modal) {
      modal.hidden = false;
      render();
      setTimeout(() => $('#novaMcpEndpoint')?.focus(), 50);
    }
  }

  function closePanel() {
    const modal = $('#novaMcpModal');
    if (modal) modal.hidden = true;
  }

  function installUi() {
    if ($('#novaMcpModal')) return;

    const style = document.createElement('style');
    style.textContent = [
      '.nova-mcp-chip{display:inline-flex;align-items:center;border:1px solid rgba(121,169,255,.32);border-radius:999px;padding:4px 8px;font-size:11px;font-weight:800;letter-spacing:.04em;background:rgba(12,19,42,.7);color:#9fb7ff}',
      '.nova-mcp-chip[data-connected="true"]{color:#7dffb2;border-color:rgba(125,255,178,.42)}',
      '.nova-mcp-modal[hidden]{display:none!important}.nova-mcp-modal{position:fixed;inset:0;z-index:9999;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.58);backdrop-filter:blur(7px);padding:12px}',
      '.nova-mcp-card{width:min(760px,100%);max-height:86vh;overflow:auto;background:linear-gradient(180deg,#0b1230,#050817);border:1px solid rgba(137,171,255,.25);border-radius:22px;padding:16px;color:#eef3ff;box-shadow:0 24px 80px rgba(0,0,0,.55)}',
      '.nova-mcp-head{display:flex;align-items:center;gap:10px}.nova-mcp-head h2{margin:0;flex:1;font-size:20px}.nova-mcp-close{border:0;background:#182044;color:#fff;border-radius:12px;width:36px;height:36px;font-size:24px}',
      '.nova-mcp-note{font-size:13px;line-height:1.45;color:#b9c5ea}.nova-mcp-field{display:grid;gap:6px;margin:10px 0}.nova-mcp-field input{width:100%;box-sizing:border-box;border:1px solid #28345e;background:#070c22;color:#fff;border-radius:12px;padding:12px;font-size:14px}',
      '.nova-mcp-actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.nova-mcp-actions button{border:1px solid #334475;background:#111a3a;color:#fff;border-radius:12px;padding:10px 12px;font-weight:700}.nova-mcp-actions .primary{background:#2d5cff;border-color:#4771ff}.nova-mcp-status{padding:10px 12px;border-radius:12px;background:#0d1430;color:#b9c5ea}.nova-mcp-status[data-tone="ok"]{color:#7dffb2}.nova-mcp-status[data-tone="error"]{color:#ff9b9b}.nova-mcp-status[data-tone="busy"]{color:#ffd37d}',
      '.nova-mcp-meta{display:grid;gap:4px;margin:10px 0;font-size:12px;color:#aebcdf}.nova-mcp-tools{display:grid;gap:8px;margin-top:12px}.nova-mcp-tool{text-align:left;border:1px solid #27345f;background:#0b1230;color:#fff;border-radius:14px;padding:11px}.nova-mcp-tool b,.nova-mcp-tool small{display:block}.nova-mcp-tool small{margin-top:5px;color:#aebcdf;line-height:1.35}.nova-mcp-empty{padding:12px;color:#98a7ce;border:1px dashed #28345e;border-radius:12px}.nova-mcp-diag{font-size:12px;line-height:1.6;color:#b9c5ea;margin-top:10px}.nova-mcp-result{white-space:pre-wrap;max-height:220px;overflow:auto;background:#050817;border:1px solid #27345f;border-radius:12px;padding:10px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#dce5ff}'
    ].join('');

    const modal = document.createElement('section');
    modal.id = 'novaMcpModal';
    modal.className = 'nova-mcp-modal';
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'novaMcpTitle');
    modal.innerHTML = [
      '<div class="nova-mcp-card">',
      '<div class="nova-mcp-head"><h2 id="novaMcpTitle">🔌 NOVA MCP Bridge</h2><button id="novaMcpClose" class="nova-mcp-close" type="button" aria-label="Закрыть">×</button></div>',
      '<p class="nova-mcp-note">Подключает NOVA к MCP-серверам через Streamable HTTP. Никаких платных API автоматически: внешний tool вызывается только после твоего подтверждения. Секретный токен не сохраняется постоянно.</p>',
      '<div class="nova-mcp-status" data-tone="idle"><b>GitHub MCP</b><br><small>Официальный upstream: ' + GITHUB_UPSTREAM + '<br>NOVA PWA подключается через свой HTTPS gateway, потому что GitHub блокирует прямые browser cross-origin MCP-запросы.</small></div>',
      '<label class="nova-mcp-field"><span>MCP endpoint</span><input id="novaMcpEndpoint" type="url" inputmode="url" autocomplete="off" placeholder="https://your-server.example/mcp"></label>',
      '<label class="nova-mcp-field"><span>Bearer token (необязательно, только на эту сессию)</span><input id="novaMcpToken" type="password" autocomplete="off" placeholder="Не сохраняется в localStorage"></label>',
      '<div class="nova-mcp-actions"><button id="novaMcpGitHubPreset" type="button">GitHub MCP</button><button id="novaMcpConnect" class="primary" type="button">Подключить</button><button id="novaMcpGitHubTest" type="button">Тест GitHub</button><button id="novaMcpDisconnect" type="button">Отключить</button><button id="novaMcpRefresh" type="button">Обновить tools</button><button id="novaMcpSelfTest" type="button">Самопроверка</button></div>',
      '<div id="novaMcpStatus" class="nova-mcp-status">MCP Bridge готов. Сервер ещё не подключён.</div>',
      '<div class="nova-mcp-meta"><div>Сервер: <b id="novaMcpServer">не подключён</b></div><div id="novaMcpCounts">0 tools • 0 resources • 0 prompts</div><div>Protocol: <b>' + MCP_PROTOCOL_VERSION + '</b> • Bridge: <b>' + BRIDGE_VERSION + '</b></div></div>',
      '<div id="novaMcpDiagnostics" class="nova-mcp-diag"></div>',
      '<div id="novaMcpTools" class="nova-mcp-tools"></div>',
      '<pre id="novaMcpResult" class="nova-mcp-result" hidden></pre>',
      '</div>'
    ].join('');

    document.head.appendChild(style);
    document.body.appendChild(modal);

    const statusRow = $('.status-row');
    if (statusRow && !$('#novaMcpChip')) {
      const chip = document.createElement('button');
      chip.id = 'novaMcpChip';
      chip.className = 'nova-mcp-chip';
      chip.type = 'button';
      chip.textContent = 'MCP OFF';
      chip.addEventListener('click', openPanel);
      statusRow.appendChild(chip);
    }

    const quickActions = $('#quickActions');
    if (quickActions && !$('#novaMcpQuickBtn')) {
      const button = document.createElement('button');
      button.id = 'novaMcpQuickBtn';
      button.className = 'action-btn';
      button.type = 'button';
      button.innerHTML = '<span>🔌</span><b>MCP</b>';
      button.addEventListener('click', openPanel);
      quickActions.appendChild(button);
    }

    $('#novaMcpClose')?.addEventListener('click', closePanel);
    $('#novaMcpGitHubPreset')?.addEventListener('click', selectGitHubPreset);
    modal.addEventListener('click', (event) => { if (event.target === modal) closePanel(); });
    $('#novaMcpConnect')?.addEventListener('click', async () => {
      try {
        await connect($('#novaMcpEndpoint')?.value, $('#novaMcpToken')?.value);
        const tokenInput = $('#novaMcpToken');
        if (tokenInput) tokenInput.value = '';
      } catch (_) {}
    });
    $('#novaMcpGitHubTest')?.addEventListener('click', async () => {
      try { await testGitHubRead(); }
      catch (error) { renderStatus(error?.message || 'Ошибка GitHub MCP', 'error'); }
    });
    $('#novaMcpDisconnect')?.addEventListener('click', disconnect);
    $('#novaMcpRefresh')?.addEventListener('click', async () => {
      try {
        if (!state.connected) throw new Error('Сначала подключи MCP-сервер.');
        renderStatus('Обновляю список…', 'busy');
        await refreshCapabilities();
        renderStatus('Список MCP обновлён', 'ok');
      } catch (error) { renderStatus(error?.message || 'Ошибка', 'error'); }
    });
    $('#novaMcpSelfTest')?.addEventListener('click', selfTest);
    $('#novaMcpTools')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-mcp-tool]');
      if (!button) return;
      const name = button.dataset.mcpTool;
      const tool = state.tools.find((item) => item.name === name);
      const hasSchema = tool?.inputSchema && Object.keys(tool.inputSchema?.properties || {}).length;
      let args = {};
      if (hasSchema) {
        const raw = window.prompt('JSON-аргументы для ' + name + ':', '{}');
        if (raw === null) return;
        try { args = JSON.parse(raw || '{}'); }
        catch (_) { renderStatus('Неверный JSON', 'error'); return; }
      }
      const out = $('#novaMcpResult');
      try {
        const result = await callTool(name, args);
        if (out) {
          out.hidden = false;
          out.textContent = stringifyResult(result);
        }
      } catch (error) {
        if (out) {
          out.hidden = false;
          out.textContent = error?.message || String(error);
        }
      }
    });

    const composer = $('#composer');
    composer?.addEventListener('submit', async (event) => {
      const input = $('#messageInput');
      const value = String(input?.value || '').trim();
      if (!/^(mcp|мсп|мпс|мср)\b/i.test(value)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (input) input.value = '';
      openPanel();

      const lower = value.toLowerCase();
      if (/отключ/.test(lower)) {
        await disconnect();
      } else if (/самопров|тест/.test(lower)) {
        selfTest();
      } else if (/обнов|инструмент|tools/.test(lower) && state.connected) {
        try { await refreshCapabilities(); renderStatus('Список MCP обновлён', 'ok'); }
        catch (error) { renderStatus(error?.message || 'Ошибка', 'error'); }
      } else if (/статус/.test(lower)) {
        renderStatus(state.connected ? 'MCP подключён' : 'MCP Bridge активен, сервер не подключён', state.connected ? 'ok' : 'idle');
      }
    }, true);

    const versionBadge = document.querySelector('.status-row .version:not(#freeModeBadge)');
    if (versionBadge) versionBadge.textContent = 'v' + NOVA_VERSION;
    render();
    selfTest();
  }

  window.NOVAMCP = Object.freeze({
    version: BRIDGE_VERSION,
    protocolVersion: MCP_PROTOCOL_VERSION,
    getState: () => ({
      endpoint: state.endpoint,
      connected: state.connected,
      sessionId: state.sessionId ? 'active' : '',
      serverInfo: state.serverInfo,
      capabilities: state.capabilities,
      protocolVersion: state.protocolVersion,
      tools: state.tools.map((tool) => ({ name: tool.name, description: tool.description || '' })),
      resources: state.resources.length,
      prompts: state.prompts.length,
      provider: state.provider
    }),
    open: openPanel,
    selectGitHubPreset,
    connect,
    disconnect,
    refreshTools: refreshCapabilities,
    callTool,
    testGitHubRead,
    selfTest
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installUi, { once: true });
  } else {
    installUi();
  }
})();