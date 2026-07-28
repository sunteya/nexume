# Storage

Nexume 的共享持久化、全局设置与应用迁移能力，由 Server 和 Desktop 共同使用。

数据库使用 `bun:sqlite`，迁移由 Umzug 执行。SQL migration 以文本静态打包，TypeScript migration 可通过统一 context 访问数据库、数据目录和缓存目录。应用只自动执行向前迁移，已执行版本记录在 `system_migrations`，全局设置存储在 `settings`。

迁移通过 `migrations.ts` 静态注册，保证 Desktop 发布包包含全部代码和 SQL。TypeScript migration 使用 `defineMigration` 定义，涉及缓存文件时必须可重复执行，并使用临时文件与原子重命名避免留下不完整文件。

Server 默认将数据写入当前工作目录下的 `data`，可通过 `NEXUME_DATA_DIR` 覆盖。Desktop 使用 Electrobun 的系统用户数据目录。
