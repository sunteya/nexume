# Desktop

面向个人电脑的完整桌面应用。

应用组合 `server-core`、`collector-core` 和 `admin-ui`，在不依赖外部 Server 或独立 Collector 的情况下提供本地采集与 Session 管理能力。

当前项目使用 Electrobun、Vue 3、TypeScript 和 Vite。应用启动时先在系统用户数据目录迁移 Nexume SQLite 数据库，首次打开显示初始化页面；初始化完成后在进程内组合 `server-core` 与 OpenCode Collector，并通过 Electrobun RPC 向共享的 `admin-ui` 提供本机 Session 数据。

## 环境要求

- Bun 1.3.13 或更高版本。
- macOS 构建需要 macOS runner。
- Windows portable EXE 构建需要 Windows x64 runner。

## 开发

```bash
bun install
bun --filter @nexume/desktop start
```

使用 Vite HMR：

```bash
bun run dev:hmr
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

项目通过 `scripts/electrobun.ts` 启动 Electrobun CLI。该脚本会处理 Electrobun 1.18.1 在 macOS 26+ 上的 CLI ad-hoc 签名问题，并正确传播 CLI 退出码。主进程使用直连 localhost 的方式探测 Vite HMR，避免 `HTTP_PROXY` 等环境变量把未启动的本地开发服务误判为可用。
