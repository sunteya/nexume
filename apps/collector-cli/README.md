# Collector CLI

面向服务器、无桌面环境和自动化部署用户的命令行采集端。Collector 通过 Socket.IO 长连接接收 Server 查询，在本机读取 OpenCode Session 后返回结果，并在断线后自动重连。

## 启动

```bash
bun run start -- \
  --server-url http://127.0.0.1:3000 \
  --token collector-token
```

可通过 `--id`、`--name` 和 `--db-path` 指定 Collector ID、名称与 OpenCode 数据库路径。ID 和名称默认使用本机 hostname，同一 Server 上必须保持唯一。
