# 应用

本目录包含 Nexume 的可运行应用和发布入口。

- `collector-cli`：无界面的采集端。
- `collector-gui`：带设置和状态界面的采集端。
- `server`：服务端进程和 Docker 镜像入口。
- `desktop`：集成完整本地能力的桌面应用。

应用负责组合所需 package，不承载可复用的核心业务逻辑。
