#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GATEWAY = (ROOT / "mcp-gateway" / "github-gateway.js").read_text(encoding="utf-8")


def test_github_mcp_uses_official_readonly_endpoint_and_headers():
    assert "https://api.githubcopilot.com/mcp/readonly" in GATEWAY
    assert "'X-MCP-Readonly': 'true'" in GATEWAY
    assert "'X-MCP-Lockdown': 'true'" in GATEWAY
    assert "new Set(['get_me', 'get_file_contents'])" in GATEWAY


def test_public_gateway_cannot_run_without_gateway_key():
    assert "const HOST = String(process.env.HOST || '127.0.0.1').trim();" in GATEWAY
    assert "NOVA_MCP_ALLOW_UNAUTHENTICATED_LOCAL" in GATEWAY
    assert "LOOPBACK_HOSTS.has(HOST)" in GATEWAY
    assert "Public GitHub MCP gateway requires NOVA_MCP_GATEWAY_KEY" in GATEWAY
    assert "if (!GATEWAY_KEY) return true;" not in GATEWAY


def test_gateway_enforces_rpc_and_tool_allowlists_locally():
    assert "function validateRpcPayload(body)" in GATEWAY
    assert "ALLOWED_RPC_METHODS" in GATEWAY
    assert "if (!ALLOWED_TOOLS.has(name))" in GATEWAY
    assert "MCP tool is not allowed by NOVA gateway" in GATEWAY


def test_gateway_has_upstream_timeout_and_no_store():
    assert "AbortController" in GATEWAY
    assert "NOVA_MCP_UPSTREAM_TIMEOUT_MS" in GATEWAY
    assert "Cache-Control" in GATEWAY
