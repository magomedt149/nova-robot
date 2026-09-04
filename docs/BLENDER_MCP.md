# Blender MCP for NOVA / Codex

This is an optional direct-control path for a coding agent running on the same computer as Blender.
It is **not enabled automatically**. The server can execute Blender Python, so install/enable it only when you trust the third-party project.

Upstream project: https://github.com/ahujasid/blender-mcp

## Why NOVA needs this

The repository's true-orbit renderer can already generate deterministic headless Blender camera paths.
BlenderMCP is an extra interactive layer: an agent can inspect the current scene, move objects/cameras, run Blender Python, and inspect screenshots instead of guessing from code.

## Safe setup

1. Install `uv` from the official Astral installer.
2. Install the Blender addon using the upstream project's documented command (`uvx blender-mcp install-addon`) or its manual addon instructions.
3. In Blender enable `Interface: Blender MCP` and start its MCP server from the BlenderMCP sidebar.
4. Copy the relevant `[mcp_servers.blender]` block from `.codex/config.blender-mcp.example.toml` into your personal Codex config.
5. Restart/reload Codex and verify the Blender tools appear.
6. Keep `AGENTS.md` and `.codex/skills/blender-360-orbit/SKILL.md` in the repo; those define NOVA's non-negotiable orbit quality rules.

## NOVA rule

For a 360 request, the agent must use one persistent 3D scene and one moving camera. It must never replace this with generated stills, crossfades, morphing, or 2D pan/zoom.

## Exact branded cars

A true camera path does not magically create an exact Toyota Supra mesh. For exact body geometry, provide a licensed/user-owned 3D asset (GLB/GLTF/FBX/OBJ/BLEND). Without one, NOVA renders a clearly labelled proxy blockout, then the approved motion can be used as control for the AI realism stage.
