# Collector CLI

面向服务器、无桌面环境和自动化部署用户的命令行采集端。Collector 通过 Socket.IO 长连接接收 Server 查询，在本机读取 OpenCode 和 Alma Session 后返回结果，并在断线后自动重连。

## 启动

```bash
bun run start -- \
  --server-url http://127.0.0.1:3000 \
  --token collector-token
```

Collector 的管理端 ID 和名称由 Server token 绑定。CLI 自动上报本机 hostname、Collector 版本和支持的 agents；可选 `--db-path` 指定 OpenCode 数据库路径，`--alma-db-path` 指定 Alma 数据库路径。
