# Server

Nexume 服务端的运行入口，也是 Docker 镜像的构建入口。

主要负责启动 HTTP、Web 和 MCP 服务，管理远程 Collector，并可按配置启用当前环境的本地采集能力。

Server 启动时初始化一个进程内 OpenCode Collector，并通过 Socket.IO 接受远程 Collector 连接。Session 不在 Server 持久化，每次查询由全部参与的 Collector 本地执行并由 Server 汇总。

## 开发

```bash
NEXUME_ACCESS_TOKEN=your-access-token \
NEXUME_COLLECTOR_TOKEN=your-collector-token \
bun run dev
```

开发 Web 地址为 `http://localhost:5174`，API 地址为 `http://localhost:3000`。

## 构建与启动

```bash
bun run build
NEXUME_ACCESS_TOKEN=your-access-token \
NEXUME_COLLECTOR_TOKEN=your-collector-token \
bun run start
```

Server 默认监听 `0.0.0.0:3000`。可通过 `HOST`、`PORT` 和 `OPENCODE_DB_PATH` 修改监听地址、端口和内部 OpenCode Collector 数据库路径。Web/API 与远程 Collector 分别使用 `NEXUME_ACCESS_TOKEN` 和 `NEXUME_COLLECTOR_TOKEN` 认证。

`GET /api/v1/collectors` 返回当前在线 Collector；`GET /api/v1/sessions?limit=50&cursor=...` 使用游标加载汇总 Session。
