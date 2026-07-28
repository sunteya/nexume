# Packages

本目录包含供多个应用复用的核心模块。

- `contracts`：公共数据模型与通信协议。
- `collector-core`：Agent 数据采集能力。
- `server-core`：数据管理与上下文服务能力。
- `storage`：SQLite 持久化、全局设置与应用迁移能力。
- `admin-ui`：完整管理界面。

Package 不得依赖 `apps` 中的任何应用。
