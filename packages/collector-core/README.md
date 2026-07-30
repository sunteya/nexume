# Collector Core

提供可复用的 AI Agent 数据采集能力。

当前包含 OpenCode、Alma 游标查询和可复用的 Socket.IO Collector 连接运行时。连接运行时负责自动重连、状态上报以及响应 Server 下发的 Session 查询。

本模块不依赖 `server-core` 或任何 GUI。

`CollectorConnection` 使用默认 Socket.IO namespace，并通过 `CollectorConnectionOptions.metadata` 上报 hostname、version 和 agents。连接认证只包含 token 与这组运行时 metadata。
