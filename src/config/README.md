# 配置层

本目录当前承载 `wasteland` 的统一配置加载逻辑：

- `paths.ts`：`.wasteland` 相关路径与默认目录规则
- `settings-types.ts`：配置类型与默认值
- `load-settings.ts`：配置文件读取、`$auth` 解析与环境变量覆盖
- `resolve-chat-runtime.ts`：把 provider/model/role 解析成当前生效运行时配置

当前结构配置优先级：

1. CLI 参数
2. `WASTELAND_*` 运行时环境变量
3. 项目配置 `.wasteland/settings.json`
4. 用户全局配置 `~/.wasteland/settings.json`
5. 内置默认值

当前 auth 引用优先级：

1. 进程环境变量同名 key
2. 项目配置 `.wasteland/auth.json`
3. 用户全局配置 `~/.wasteland/auth.json`

当前环境变量约定：

- `WASTELAND_HOME`：覆盖全局配置根目录
- `WASTELAND_PROVIDER`
- `WASTELAND_PERMISSION_MODE`
- `WASTELAND_MAX_STEPS_PER_TURN`
- `WASTELAND_DEBUG`
- `WASTELAND_SESSION_DIR`
- `RX_CLI_SESSION_DIR`：仅保留 session 目录覆盖的旧兼容别名

当前推荐的分层方式：

- `.wasteland/settings.json`：可共享的结构化配置，例如 provider/model/role/runtime 默认值
- `.wasteland/auth.json`：本地 secrets，例如 `OPENAI_API_KEY`

配置里的敏感字段统一通过 `{"$auth":"KEY_NAME"}` 引用到 `auth.json` 或进程环境变量。

当前已支持的核心配置段：

- `defaultProvider`
- `providers`
- `models`
- `roles`
- `runtime.defaultRole`
- `runtime.permissionMode`
- `runtime.maxStepsPerTurn`
- `runtime.debug`
- provider/model/role 下的通用 `$auth` 引用

当前不会自动迁移旧 `.wasteland/` 目录；历史 transcript 原地保留（新数据写入中央数据根，见 docs/architecture/configuration.md 存储节）。

当前配置层只负责“加载和解析”，不直接创建 provider、也不直接运行 runtime。
