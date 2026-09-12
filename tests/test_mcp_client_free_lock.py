#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLIENT = (ROOT / "nova-mcp.js").read_text(encoding="utf-8")


def test_github_client_has_fixed_readonly_allowlist():
    assert "const GITHUB_ALLOWED_TOOLS = new Set(['get_me', 'get_file_contents']);" in CLIENT
    assert "listedTools.filter((tool) => GITHUB_ALLOWED_TOOLS.has" in CLIENT


def test_github_client_blocks_unexpected_tools_before_rpc():
    assert "state.provider === 'github' && !GITHUB_ALLOWED_TOOLS.has(name)" in CLIENT
    assert "FREE LOCK: этот GitHub MCP-инструмент не разрешён" in CLIENT


def test_github_public_free_bridge_is_readonly_and_tokenless():
    assert "const GITHUB_PUBLIC_API = 'https://api.github.com/';" in CLIENT
    assert "const GITHUB_PUBLIC_ALLOWED_TOOLS = new Set(['get_file_contents']);" in CLIENT
    assert "state.provider = 'github-public';" in CLIENT
    assert "GitHub FREE подключён — localhost и токен не нужны" in CLIENT
    assert "githubPublicGetFileContents" in CLIENT
    assert "setToken('');" in CLIENT


def test_github_public_mode_does_not_use_mcp_rpc_for_file_read():
    assert "state.provider === 'github-public'" in CLIENT
    assert "? await githubPublicCallTool(name, args || {})" in CLIENT
    assert "GitHub FREE разрешает только чтение публичных файлов." in CLIENT
