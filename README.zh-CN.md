# Nexume

[English](README.md) | [简体中文](README.zh-CN.md)

Nexume 是一个 AI Agent 数据与上下文中枢。它汇总 Codex、OpenCode 等 AI Agent 在不同设备和项目中产生的 Session 及其他数据，让过去的工作更容易被查找、管理和复用。

项目第一阶段聚焦统一的 Session 管理，包括本地与远程采集、浏览、搜索、筛选和生命周期管理。未来，Nexume 将通过 API 和 MCP，为 AI Agent、自动化工具及第三方应用提供可复用、可追溯的历史上下文。

Nexume 计划支持 Windows、macOS 和 Linux，并覆盖桌面端、服务器、Docker 和 CLI 等使用场景。

## 支持的 Agents

- OpenCode
- Alma

## 当前状态

项目目前处于早期实现阶段。Desktop 可只读浏览本机 OpenCode 和 Alma Session；Server 启动内部本地 Collector，并通过 Socket.IO 接受认证后的远程 Collector，再以游标方式汇总采集数据。Codex、MCP、搜索和完整管理能力仍在后续规划中。
