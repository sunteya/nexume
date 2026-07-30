# Nexume

[English](README.md) | [简体中文](README.zh-CN.md)

Nexume is an AI agent data and context hub. It brings together sessions and other data created by AI agents such as Codex and OpenCode across different devices and projects, making past work easier to find, manage, and reuse.

The first phase focuses on unified session management, including local and remote collection, browsing, search, filtering, and lifecycle management. In the future, Nexume will expose reusable, traceable context to AI agents, automation tools, and third-party applications through APIs and MCP.

Nexume is planned to support desktop, server, Docker, and CLI use cases on Windows, macOS, and Linux.

## Supported Agents

- OpenCode
- Alma

## Status

The project is in early implementation. Desktop supports local read-only OpenCode and Alma browsing. Server starts internal local collectors and accepts authenticated remote Collectors over Socket.IO; it merges collector data with cursor-based loading. Codex, MCP, search, and full management capabilities remain planned work.
