# 配置层与 `.wasteland` 目录

## 目的

本文档描述当前 `wasteland` 的配置加载规则、`.wasteland/` 目录约定，以及与环境变量之间的覆盖关系。

精确的可执行约束以 `.trellis/spec/backend/runtime-contracts.md` 为准；本文档负责解释为什么当前配置层这样收口。

---

## 当前目录约定

项目级目录统一使用 `.wasteland/`（仅配置，不再存数据）：

```text
.wasteland/
  settings.json
  auth.json
```

当前各文件/目录职责：

- `.wasteland/settings.json`：结构化配置入口；适合 provider/model/role/runtime 等默认值
- `.wasteland/auth.json`：本地 secrets；适合 API key、token 等敏感值

## 中央数据根（09-06-central-log-store 起）

日志 / transcript / 导出物不再写项目本地，统一收敛到中央数据根（OpenCode 模式：单根 + projectID 命名空间）：

```text
~/.wasteland/data/
  migration                  # 数据版本（当前 1）
  project/<projectId>.json   # { id, vcs, worktree, created }
  logs/<projectId>/          # FileSink 日志（含 sessions/<sid>.jsonl + error.jsonl）
  sessions/<projectId>/      # session transcript（*.jsonl）
  exports/<projectId>/       # 日志导出物
```

- projectID：git 仓库取 root commit hash（目录改名稳定），非 git 目录回退 `local-<sha1(cwd)[:16]>`；
- 数据根：`WASTELAND_DATA_DIR` 显式覆盖，否则 `WASTELAND_HOME/data`；
  `WASTELAND_LOG_DIR` / `WASTELAND_SESSION_DIR` 保留为单目录调试覆盖；
- 旧 `.wasteland/{logs,sessions}` 原地保留但不再读写（M2 清理另起任务）；
- 读侧（TUI `/logs`、sessions/resume/export/logs 命令）默认跨项目聚合，本项目置顶，他项目带工作目录标签。

用户级全局配置默认位于：

```text
~/.wasteland/settings.json
~/.wasteland/auth.json
```

如果设置了 `WASTELAND_HOME`，则全局配置根目录会改为：

```text
$WASTELAND_HOME/settings.json
$WASTELAND_HOME/auth.json
```

---

## 配置优先级

当前 `chat` 命令的结构配置优先级固定为：

1. CLI 参数
2. `WASTELAND_*` 运行时环境变量
3. 项目配置 `.wasteland/settings.json`
4. 用户全局配置 `~/.wasteland/settings.json`
5. 内置默认值

`$auth` 的取值优先级固定为：

1. 进程环境变量同名 key
2. 项目配置 `.wasteland/auth.json`
3. 用户全局配置 `~/.wasteland/auth.json`

这样做的目的：

- CLI 参数适合一次性覆盖
- `WASTELAND_*` 环境变量适合脚本或 CI 的运行时覆盖
- 项目 `settings.json` 适合当前项目默认值
- 用户全局配置适合跨项目默认值
- `auth.json` 适合把敏感值从结构配置里拆出去

---

## 当前配置模型

当前已经落地的最小配置模型如下：

```json
{
  "defaultProvider": "local",
  "runtime": {
    "defaultRole": "chat",
    "permissionMode": "default",
    "maxStepsPerTurn": 30,
    "debug": false
  },
  "models": {
    "chat_model": {
      "provider": "local",
      "model": "local"
    }
  },
  "roles": {
    "chat": {
      "model": "chat_model"
    }
  },
  "providers": {
    "local": {}
  }
}
```

字段说明：

- `defaultProvider`：默认 provider id
- `models.<modelId>`：模型别名与 provider/model 路由
- `roles.<roleId>`：角色语义、默认模型和默认权限
- `runtime.defaultRole`：未显式传 `--role` 时的默认角色
- `runtime.permissionMode`：默认权限模式
- `runtime.maxStepsPerTurn`：单轮最大 step 数
- `runtime.doomLoopThreshold`：连续同名同参工具调用阈值（默认 `3`），达阈值即短路本轮；`0` 表示关闭检测
- `runtime.debug`：默认是否打开调试 trace
- `providers.<providerId>`：按 provider 透传的配置对象，当前由 `ProviderRegistry.resolve(id, config)` 交给具体 provider
- `{"$auth":"KEY_NAME"}`：通用敏感值引用；当前会从 `auth.json` 或进程环境变量解析成真实字符串

> **数值配置的 `0` 语义**：只有**计数类**支持 `0 = 关闭`（`doomLoopThreshold` 关闭检测、
> `multiAgent[x].maxRetries` 不重试）。时长/间隔类有刻意设的下限（`spinnerIntervalMs` `16..1000`、
> `typewriterRateMs` `5..200`）；护栏类的 `0` 是**失效**而非关闭，故拒绝（`maxStepsPerTurn`、
> `childAgentTimeout`）；比例类为 `(0,1]`。详见 `docs/user-guide/configuration.md`。

---

## 环境变量

当前有效环境变量：

- `WASTELAND_HOME`
- `WASTELAND_PROVIDER`
- `WASTELAND_PERMISSION_MODE`
- `WASTELAND_MAX_STEPS_PER_TURN`
- `WASTELAND_DOOM_LOOP_THRESHOLD`
- `WASTELAND_DEBUG`
- `WASTELAND_SESSION_DIR`

兼容中的旧变量：

- `RX_CLI_SESSION_DIR`

兼容规则：

- 新实现只把 `WASTELAND_SESSION_DIR` 作为主文档入口
- `RX_CLI_SESSION_DIR` 仅保留 session 输出目录覆盖的旧兼容别名
- 其他 `RX_CLI_*` 风格环境变量当前不再扩展
- 非 `WASTELAND_*` 的 provider 私有密钥不再走特判桥接，统一改为 `auth.json + $auth`

当前推荐的 Qwen 分层写法：

```json
{
  "defaultProvider": "qwen",
  "providers": {
    "qwen": {
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode",
      "apiKey": {
        "$auth": "OPENAI_API_KEY"
      },
      "model": "qwen3-max"
    }
  }
}
```

```json
{
  "OPENAI_API_KEY": "sk-xxxx"
}
```

说明：

- `qwen.baseUrl` 可以写成 `.../compatible-mode` 或 `.../compatible-mode/v1`
- provider 内部会统一归一化到兼容接口根路径
- 当前推荐不要再把真实 key 放进 `settings.json`
- `config current` 会展示已加载的 `sources.projectAuth` / `sources.userAuth`，并对敏感字段脱敏
- 当前仓库默认忽略 `.wasteland/`，因此 `.wasteland/auth.json` 与 `.wasteland/settings.json` 都不会被默认提交

当前命令面已支持：

- `wasteland chat --role <name>`：按 role 解析模型、provider 和默认权限
- `config current`：输出当前生效配置，并对敏感字段脱敏

---

## 兼容与迁移

当前不会自动迁移旧 `.rx-cli/` 目录。

如果本地已有历史数据，建议手动迁移：

1. 把 `.rx-cli/sessions/` 合并到中央数据根的 `sessions/<projectId>/`（目录布局见上文「中央数据根」）
2. 确认没有脚本继续依赖 `RX_CLI_SESSION_DIR`
3. 后续统一改用 `WASTELAND_*` 与中央数据根

早期版本的项目本地目录 `.wasteland/{logs,sessions}` 已不再读写，其历史数据同样按上述目标迁入。

这样可以避免 runtime 在代码、文档和本地目录上继续维护两套主命名。
