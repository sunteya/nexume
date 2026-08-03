# Nexume

[English](README.md) | [简体中文](README.zh-CN.md)

Nexume is an AI agent data and context hub. It brings together sessions and other data created by AI agents such as Claude Code, Codex, and OpenCode across different devices and projects, making past work easier to find, manage, and reuse.

The first phase focuses on unified session management, including local and remote collection, browsing, search, filtering, and lifecycle management. In the future, Nexume will expose reusable, traceable context to AI agents, automation tools, and third-party applications through APIs and MCP.

Nexume is planned to support desktop, server, Docker, and CLI use cases on Windows, macOS, and Linux.

## Running

Nexume supports two deployment modes.

### Method 1: Desktop App (Standalone)

Download the Desktop App from [GitHub Releases](https://github.com/sunteya/nexume/releases/latest):

- macOS Apple silicon (ARM64): DMG image. The current build is not signed or notarized, so macOS may require approval in Privacy & Security before first launch.
- Windows x64: portable ZIP containing `Nexume.exe`. No installer is required; runtime files are cached under `%LOCALAPPDATA%/Nexume` on first launch.

To open the current unsigned macOS build, drag `Nexume.app` into Applications, then run:

```bash
sudo xattr -dr com.apple.quarantine /Applications/Nexume.app
```

You can then launch Nexume normally from Applications.

### Method 2: Docker + Collector

Create `compose.yml`:

```yaml
services:
  server:
    image: sunteya/nexume:0.1.0
    restart: unless-stopped
    environment:
      NEXUME_ACCESS_TOKEN: your-access-token
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
```

After starting the Server, create a Remote Collector in the management page and copy its token. Install [Bun](https://bun.com/), then run the Collector on the machine containing your AI agent session data:

```bash
bunx nexume config set \
  --server-url http://your-server:3000 \
  --collector-token nxc_your-collector-token

bunx nexume collector
```

See the [`nexume` CLI](apps/cli/README.md) for global installation and data path options.

## Supported Agents

- Codex, including Codex history in the renamed ChatGPT desktop app
- Claude Code
- OpenCode
- Alma

## Status

The project is in early implementation. Desktop supports browsing local Claude Code, Codex, OpenCode, and Alma sessions. Server starts internal local collectors and accepts authenticated remote Collectors over Socket.IO; it merges collector data with cursor-based loading. MCP, search, and full management capabilities remain planned work.
