# Server

Nexume 服务端的运行入口，也是 Docker 镜像的构建入口。

主要负责启动 HTTP、Web 和 MCP 服务，管理远程 Collector，并可按配置启用当前环境的本地采集能力。

当前版本初始化一个本地 OpenCode Collector，直接只读访问 OpenCode SQLite，暂不保存或同步 Session。

## 开发

```bash
NEXUME_ACCESS_TOKEN=your-token bun run dev
```

开发 Web 地址为 `http://localhost:5174`，API 地址为 `http://localhost:3000`。

## 构建与启动

```bash
bun run build
NEXUME_ACCESS_TOKEN=your-token bun run start
```

Server 默认监听 `0.0.0.0:3000`。可通过 `HOST`、`PORT` 和 `OPENCODE_DB_PATH` 修改监听地址、端口和 OpenCode 数据库路径。
