# Collector Core

提供可复用的 AI Agent 数据采集能力。

当前包含 Claude Code、Codex、OpenCode、Alma 的 Session 摘要同步、详情读取和标题修改能力，以及可复用的 Socket.IO Collector 连接运行时。连接运行时负责自动重连、状态上报以及响应 Server 下发的 Session 查询。

Claude Code 默认读取 `${CLAUDE_CONFIG_DIR:-~/.claude}/projects` 中的 JSONL 历史，仅把主会话作为独立 Session；可通过 `ClaudeCodeCollectorOptions.projectsPath` 覆盖路径。

本模块不依赖 `server-core` 或任何 GUI。

`CollectorConnection` 使用默认 Socket.IO namespace，并通过 `CollectorConnectionOptions.metadata` 上报 hostname、version 和 agents。连接认证只包含 token 与这组运行时 metadata。
