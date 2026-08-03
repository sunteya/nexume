# nexume

Nexume 的 Bun 命令行工具。当前提供 `collector` 子命令，用于在无桌面环境或远程机器上采集 Claude Code、Codex、OpenCode 和 Alma Session。

## 环境要求

- Bun 1.3.13 或更高版本
- 可访问 Nexume Server 的网络连接
- 在 Server 管理页面创建的 Remote Collector token

## 安装

全局安装：

```bash
bun add --global nexume
```

也可以通过 `bunx` 直接运行。首次使用时保存 Server 地址和 Collector token：

```bash
bunx nexume config set \
  --server-url http://127.0.0.1:3000 \
  --collector-token nxc_your-collector-token

bunx nexume collector
```

全局安装后使用相同的配置和启动命令：

```bash
nexume config set \
  --server-url http://127.0.0.1:3000 \
  --collector-token nxc_your-collector-token

nexume collector
```

## 主命令

```text
nexume --help
nexume --version
nexume config --help
nexume collector --help
```

## 配置

CLI 分别保存 API Access Token 和 Collector Token，两者用途不同，不能互换：

```text
serverUrl       所有远程命令共用的 Nexume Server 地址。
accessToken     用于 session list 等 HTTP/API 命令。
collectorToken  仅用于远程 Collector 连接和数据同步。
```

配置支持部分更新：

```bash
nexume config set --server-url https://nexume.example.com
nexume config set --access-token nxa_your-access-token
nexume config set --collector-token nxc_your-collector-token
nexume config show
```

`config show` 只显示 token 是否已经配置，不输出 token 原文。可以按字段或完整清理配置：

```bash
nexume config clear --access-token
nexume config clear --collector-token
nexume config clear --all
```

配置文件位置：

```text
macOS    ~/Library/Application Support/Nexume/config.json
Linux   ${XDG_CONFIG_HOME:-~/.config}/nexume/config.json
Windows %APPDATA%\Nexume\config.json
```

Unix 上的配置目录权限为 `0700`，文件权限为 `0600`。token 仍以明文保存在当前用户的配置文件中。

## Collector 参数

```text
--server-url <url>              临时覆盖已配置的 Nexume Server 地址。
--collector-token <token>       临时覆盖已配置的 Collector token。
--db-path <path>                OpenCode SQLite 数据库路径。
--alma-db-path <path>           Alma SQLite 数据库路径。
--codex-db-path <path>          Codex SQLite 数据库路径。
--claude-projects-path <path>   Claude Code 项目历史目录。
-h, --help                      显示帮助。
```

运行 `nexume collector` 时，命令行参数优先于持久化配置。合并后仍缺少 Server URL 或 Collector token 时，命令将提示先执行 `nexume config set`。

Collector 的 ID 和名称由 Collector token 绑定。CLI 自动上报本机 hostname、版本和可用的 Agent 数据源。

OpenCode、Alma、Codex 和 Claude Code 的路径参数均可省略。Codex 优先读取有效的 `$CODEX_HOME/state_5.sqlite`，否则读取 `~/.codex/state_5.sqlite`。Claude Code 默认读取 `${CLAUDE_CONFIG_DIR:-~/.claude}/projects`，只将主会话作为独立 Session 采集。

两类 token 都属于敏感凭据，不应写入仓库、日志或可共享的启动脚本。
