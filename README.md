# Nexume

[English](README.md) | [简体中文](README.zh-CN.md)

Nexume is an AI agent data and context hub. It brings together sessions and other data created by AI agents such as Claude Code, Codex, and OpenCode across different devices and projects, making past work easier to find, manage, and reuse.

The first phase focuses on unified session management, including local and remote collection, browsing, search, filtering, and lifecycle management. In the future, Nexume will expose reusable, traceable context to AI agents, automation tools, and third-party applications through APIs and MCP.

Nexume is planned to support desktop, server, Docker, and CLI use cases on Windows, macOS, and Linux.

## Supported Agents

- Codex, including Codex history in the renamed ChatGPT desktop app
- Claude Code
- OpenCode
- Alma

## Status

The project is in early implementation. Desktop supports browsing local Claude Code, Codex, OpenCode, and Alma sessions. Server starts internal local collectors and accepts authenticated remote Collectors over Socket.IO; it merges collector data with cursor-based loading. MCP, search, and full management capabilities remain planned work.
