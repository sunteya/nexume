# Server Core

提供可复用的 Collector 注册、在线列表和多来源 Session 游标汇总能力。

Server Core 不依赖 Socket.IO 或 HTTP。应用层把本地和远程 Collector 注册为统一数据源，Core 负责全局排序、独立游标推进和部分失败处理。

本模块不依赖任何应用或 GUI。
