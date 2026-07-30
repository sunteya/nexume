# Desktop

面向个人电脑的完整桌面应用。

应用组合共享的 Server Runtime、Collector Core 和 Admin UI，在不依赖外部 Server 的情况下提供本地与远程采集、Session 管理和浏览器访问能力。

桌面端默认只读采集本机 OpenCode 和 Alma Session。可通过 `OPENCODE_DB_PATH` 和 `ALMA_DB_PATH` 覆盖数据库路径。

当前项目使用 Electrobun、Vue 3、TypeScript 和 Vite。应用启动时由操作系统分配一个可用端口，并在 `0.0.0.0` 上提供 Web、`/api/*` 和 `/socket.io`。每次启动生成一个随机 access token，并通过 URL fragment 交给访问实际端口的原生窗口。该 token 不持久化也不在管理页面展示。远程 Collector 使用管理页面生成的独立 token 连接。关闭窗口会同时停止内嵌 Server。

当前监听使用 HTTP，启动期 access token 与 Collector token 只适合在可信局域网中使用；跨不可信网络访问时应在前面部署 HTTPS 反向代理。

## 环境要求

- Bun 1.3.13 或更高版本。
- macOS 构建需要 macOS runner。
- Windows portable EXE 构建需要 Windows x64 runner。

## 开发

```bash
bun install
bun --filter @nexume/desktop start
```

执行类型检查：

```bash
bun run typecheck
```

## 平台构建

在 macOS 上生成 DMG：

```bash
bun run build
```

在 Windows x64 上生成绿色单文件 EXE：

```bash
bun run build:portable
```

最终 Windows 发布文件为：

```text
artifacts/portable/Nexume.exe
```

Electrobun 官方生成的 `Setup.exe` 和 `.installer` 目录只作为 portable 打包的中间产物，不应发布给用户。

`Nexume.exe` 首次运行时会将 Electrobun 运行组件静默释放到 `%LOCALAPPDATA%/Nexume/runtime/<version-hash>`，然后直接启动应用。该过程没有安装界面，不创建桌面或开始菜单快捷方式，也不写入注册表。后续启动会复用经过哈希校验的缓存。

GitHub Actions 工作流 `.github/workflows/desktop-build.yml` 会分别构建 macOS DMG 和 Windows `Nexume.exe`，并上传为独立 Artifact。

项目通过 `scripts/electrobun.ts` 启动 Electrobun CLI。该脚本会处理 Electrobun 1.18.1 在 macOS 26+ 上的 CLI ad-hoc 签名问题，并正确传播 CLI 退出码。
