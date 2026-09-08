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
