# Contracts

定义跨模块共享的数据模型、通信结构、校验规则和协议版本。

本模块不包含文件扫描、数据存储、网络请求或界面逻辑，也不依赖其他业务 package。

Collector Socket 握手使用 `CollectorSocketAuth`，只发送 token 和运行时 metadata。运行时 metadata 仅包含 hostname、version 和 agents；Collector 的管理端 ID 与名称由 Server token 绑定。
