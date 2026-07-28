# Server

Nexume 服务端的运行入口，也是 Docker 镜像的构建入口。

主要负责托管共享 Server Runtime，启动 HTTP、Web 和 Socket.IO 服务，管理远程 Collector，并可按配置启用当前环境的本地采集能力。

Server 启动时首先迁移自己的 SQLite 数据库。首次启动需要在 Web 页面完成初始化，可选择是否同时创建进程内 OpenCode Collector。之后可在 Collectors 页面创建、改名、删除本机或远程 Collector，并查看远程 Collector 的独立连接 token。Session 暂不在 Server 持久化，每次查询由全部在线 Collector 本地执行并由 Server 汇总。

## 开发

```bash
NEXUME_ACCESS_TOKEN=your-access-token \
bun run dev
```

开发 Web 地址为 `http://localhost:5174`，API 地址为 `http://localhost:3000`。

## 构建与启动

```bash
bun run build
NEXUME_ACCESS_TOKEN=your-access-token \
bun run start
```

Server 默认监听 `0.0.0.0:3000`，并将数据库与缓存写入当前工作目录下的 `data`。可通过 `HOST`、`PORT`、`NEXUME_DATA_DIR` 和 `OPENCODE_DB_PATH` 修改监听地址、端口、数据目录和内部 OpenCode Collector 数据库路径。Web/API 与首次初始化使用 `NEXUME_ACCESS_TOKEN` 认证。远程 Collector 使用管理页面生成的独立 token，通过默认 Socket.IO namespace 和 `/socket.io` path 连接。

`GET /api/collectors` 返回已配置的 Collector 和在线状态；`GET /api/sessions?limit=50&cursor=...` 使用游标加载汇总 Session。
