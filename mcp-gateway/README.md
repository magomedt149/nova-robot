# NOVA GitHub MCP Gateway

This gateway keeps the GitHub personal access token on the server and exposes the official GitHub MCP server to the NOVA browser client.

## Safety defaults

- Upstream is the official read-only endpoint: `https://api.githubcopilot.com/mcp/readonly`.
- Read-only + lockdown headers are always sent.
- Only `get_me` and `get_file_contents` are allowed.
- Public listeners require `NOVA_MCP_GATEWAY_KEY`.
- Unauthenticated mode is allowed only when the gateway is bound to loopback for local development.
- The GitHub token is never sent to the browser.

## Local development

```bash
GITHUB_PERSONAL_ACCESS_TOKEN=... node mcp-gateway/github-gateway.js
```

The default host is `127.0.0.1` and port is `8787`. NOVA can use:

```
http://127.0.0.1:8787/mcp/github
```

## Public HTTPS deployment

Set at least:

```bash
HOST=0.0.0.0
PORT=8787
GITHUB_PERSONAL_ACCESS_TOKEN=...
NOVA_MCP_GATEWAY_KEY=<long-random-secret>
NOVA_ALLOWED_ORIGINS=https://magomedt149.github.io
node mcp-gateway/github-gateway.js
```

Put the public gateway behind HTTPS. In NOVA, enter the public `https://.../mcp/github` endpoint and use `NOVA_MCP_GATEWAY_KEY` as the session-only bearer key.

Do not put `GITHUB_PERSONAL_ACCESS_TOKEN` in NOVA, GitHub Pages, source code, or browser storage.
