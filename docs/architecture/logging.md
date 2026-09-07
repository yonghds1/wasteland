# wasteland 日志系统架构

本文描述 wasteland 统一日志子系统的稳定边界。Session transcript 仍由 `SessionManager` 维护，是 `resume` 的事实来源；runtime logging 负责排障、过滤与多 sink 分发，不替代 transcript。

## 1. 总体架构

```text
 Runtime / Provider / Tool / Permission / MCP / A2A / File audit
                              │
                              │ Logger.debug|info|warn|error
                              ▼
                  ┌────────────────────────┐
                  │ LogBus                 │
                  │ RxJS Subject<LogEntry> │
                  └───────────┬────────────┘
                              │ multicast
              ┌───────────────┼──────────────────┐
              ▼               ▼                  ▼
      ┌──────────────┐ ┌──────────────┐  ┌──────────────────┐
      │ FileSink     │ │ MemorySink   │  │ Observable sink  │
      │ JSONL +      │ │ tests        │  │ TUI LogsPage /   │
      │ rotation     │ │ fixtures     │  │ future exporters │
      └──────┬───────┘ └──────────────┘  └──────────────────┘
             │
             ├── runtime-YYYY-MM-DD.jsonl     all accepted levels
             └── error.jsonl                  warn + error duplicate

  ChatInputTurn ──► runAgentLoop ──► SessionManager
                                       └── data/sessions/<projectId>/<sid>.jsonl
                                           (independent resume transcript)
```

Core 只发布结构化事件，不直接写 `stdout` 或 `stderr`。每个 sink 可独立设置最低 level 与 scope 过滤；一个 sink 的失败不会阻断其它 sink 或 Agent 主流程。

## 2. `LogEntry` schema

顶层字段按下表顺序序列化。名称必须原样使用；`sessionId` 是兼容既有 runtime contract 的 camelCase 例外，嵌套的 usage/error 字段使用 snake_case。

| 顺序 | 字段 | 类型 | 必需 | 说明 |
|---:|---|---|:---:|---|
| 1 | `version` | `1` | 是 | schema 版本；不兼容变更必须升级版本 |
| 2 | `timestamp` | `string` | 是 | UTC ISO8601，毫秒精度 |
| 3 | `level` | `debug \| info \| warn \| error` | 是 | 严重级别 |
| 4 | `scope` | `LogScope` | 是 | 事件来源子系统 |
| 5 | `sessionId` | `string` | 是 | 会话关联键，供 `grep`/`show` 串联 |
| 6 | `turn` | `number` | 否 | 用户轮次，从 runtime 语义继承 |
| 7 | `step` | `number` | 否 | 当前 turn 内的 provider/tool step |
| 8 | `message` | `string` | 是 | 单行事件名或摘要；换行转义为 `\n` |
| 9 | `data` | `Record<string, unknown>` | 否 | tool input、usage、timings 与关联元数据 |
| 10 | `error` | `LogError` | 否 | `name/message/top_frame/stack` |

Assistant token 用量写在 `data.usage`，字段为 `input_tokens`、`output_tokens`、`cache_creation_input_tokens`、`cache_read_input_tokens`。工具耗时写在 `data.timings`，字段为 `preHookMs`、`permissionMs`、`toolMs`、`postHookMs`、`totalMs`。

一条 JSONL 示例：

```json
{"version":1,"timestamp":"2026-07-29T14:30:00.123Z","level":"info","scope":"tool","sessionId":"2026-07-29_143000_abc123","turn":2,"step":1,"message":"tool.completed","data":{"toolName":"read-file","usage":{"input_tokens":120,"output_tokens":24,"cache_creation_input_tokens":0,"cache_read_input_tokens":80},"timings":{"preHookMs":0,"permissionMs":1,"toolMs":8,"postHookMs":0,"totalMs":9}}}
```

## 3. Scope 列表

所有调用都至少提供 `sessionId`、`scope` 与 `message`；有 turn/step 时必须透传，避免跨 Agent 串线。

| Scope | 典型调用 | 典型事件 |
|---|---|---|
| `session` | `Logger.info({ scope: 'session', ... })` | session start/end、resume、子会话关联 |
| `turn` | `Logger.debug({ scope: 'turn', ... })` | user turn、assistant 完成、step 上限 |
| `provider` | `Logger.debug({ scope: 'provider', ... })` | 请求、响应、重试、模型错误、首 token 计时（`provider.first_chunk`，data.elapsedMs） |
| `tool` | `Logger.info({ scope: 'tool', ... })` | tool requested/started/result/failed、五段耗时 |
| `ui` | `Logger.debug({ scope: 'ui', ... })` | page 切换、输入路由、渲染诊断 |
| `skill` | `Logger.info({ scope: 'skill', ... })` | 技能解析、执行、失败 |
| `permission` | `Logger.info({ scope: 'permission', ... })` | allow/ask/deny 决策与模式 |
| `mcp` | `Logger.info({ scope: 'mcp', ... })` | transport 连接、RPC、registry 错误 |
| `a2a` | `Logger.info({ scope: 'a2a', ... })` | task request、SSE、webhook、adapter 状态 |
| `file` | `Logger.warn({ scope: 'file', ... })` | read-before-edit 审计、路径拒绝、文件访问 |

## 4. FileSink 文件布局（中央数据根 `~/.wasteland/data/logs/<projectId>/`）

```text
data/logs/<projectId>/
├── sessions/
│   └── <sessionId>.jsonl
└── error.jsonl
```

- 按 session 独立文件追加（`sessions/<sessionId>.jsonl`），同 session 事件天然聚合，无需再按日期切分扫描。
- `warn` 与 `error` 同时写入 session 文件和独立的 `error.jsonl`，优先排查时无需扫描全部 session 文件。
- 轮转档使用 `.1` 到 `.5`，数字越小越新；超过 age cap 的旧档使用 `.gz`。
- 当前可写文件保持 JSONL，一行一条事件，可直接使用 `grep` 与 `jq`。
- 中央 `data/sessions/<projectId>/` 的 transcript 与 FileSink 分流，`SessionRecord` 协议不变。

## 5. Rotation 策略

默认策略为：

- 单文件达到 `10 MiB`，在下一条写入前轮转。
- 最多保留 5 个轮转档，旧档按 `.1`、`.2` 依次后移。
- 旧档 mtime 超过 7 天后 gzip 归档。
- runtime 文件按 UTC 日期日切；size 与 age 两条轴独立生效。
- 写入和轮转经单一串行队列执行，避免多个 writer 并发拼接 JSONL。

环境变量用于覆盖日志量、目录与查看窗口：`WASTELAND_LOG_LEVEL` 调整写入量，`WASTELAND_LOG_DIR` 调整轮转根目录，`WASTELAND_LOG_TAIL_LINES` 调整默认查看窗口。10 MiB/5 档/7 天是当前稳定默认值；程序化使用 `FileSink` 时可通过 `RotatePolicy` 覆盖，不另设未实现的 rotation 环境变量。

## 6. Redaction denylist

FileSink 写入前递归处理 `data` 中的字符串。下面 8 类 baseline denylist 强制启用；`WASTELAND_LOG_REDACT` 只保留为匹配策略配置面，不允许把 baseline secret 以明文写盘。

| 规则 | 匹配内容 | 脱敏结果示意 |
|---|---|---|
| Authorization | `Authorization: ...` header | `Authorization: [REDACTED]` |
| Bearer | `Bearer <token>` | `Bearer [REDACTED]` |
| Env API key | `*_API_KEY=value` | 保留变量名，值替换为 `[REDACTED]` |
| OpenAI key | `sk-...` | `sk-[REDACTED]` |
| Slack bot token | `xoxb-...` | `xoxb-[REDACTED]` |
| GitHub PAT | `ghp_...` | `ghp_[REDACTED]` |
| JWT | 三段式 `eyJ...` token | `[REDACTED-JWT]` |
| PEM private key | `BEGIN ... PRIVATE KEY` block | `[REDACTED-PEM]` |

每次替换还带有 `[redacted:<rule-name>]` 审计前缀。Redactor 返回深拷贝，不修改 runtime 中的原始对象。

## 7. 主流 Agent 对齐矩阵

| 维度 | Claude Code | opencode | wasteland |
|---|---|---|---|
| 主目录 | `~/.claude/projects/<encoded-cwd>/` | `.opencode/` | `~/.wasteland/data/logs/<projectId>/` |
| 主日志文件 | `<sid>.jsonl` append-only | `debug.log` 单文件 | `sessions/<sid>.jsonl` 按 session 独立文件 |
| Session transcript | 与主日志同一 JSONL | `messages/<sid[:8]>/` | `data/sessions/<projectId>/<sid>.jsonl`，与 runtime log 分流 |
| Subagent | `subagents/agent-<id>.{jsonl,meta.json}` | 共享 slog | `logs/<projectId>/transcript/<sid>/subagents/agent-<id>.{jsonl,meta.json}` |
| 时间分解 | preHook/permission/tool/postHook/total | 简单 level | `data.timings` 的五段毫秒值 |
| CLI 调试入口 | `--verbose` | `-d` + `OPENCODE_DEV_DEBUG` | `--debug`/`-d` 与 `WASTELAND_LOG_LEVEL` |
| Schema 演进 | 未承诺稳定 | 内部结构稳定 | 固定字段顺序 + `version: 1` |
| 轮转/TTL | 无 | 无 | 10 MiB × 5 + 7 天 gzip |
| Redaction | transcript 明文 | 无统一规则 | 8 类 baseline denylist 强制脱敏 |
| 并发写保护 | 多 writer 曾导致 JSONL 损坏 | 单 slog writer | LogBus fan-out + FileSink 单串行写入队列 |
| 字段命名 | `sessionId`、`parentUuid` 等 | slog attributes | 固定顶层 key；usage/error 对齐 snake_case 字段 |

Subagent sidecar 的设计字段为 `agentType`、`description`、`toolUseId`、`spawnDepth`、`createdAt`，子日志以 `isSidechain: true` 标记。Session 关联使用 `parent_session_id`、`agent_id`、`tool_use_id` 三元组；这些扩展元数据放在 `data`，不改变固定顶层 schema。

## 8. 环境变量

| 环境变量 | 默认值 | 行为与兼容关系 |
|---|---|---|
| `WASTELAND_LOG_LEVEL` | `info` | `debug/info/warn/error`；显式值优先于 debug alias |
| `WASTELAND_LOG_DIR` | 单目录覆盖（调试用） | 覆盖 FileSink 与 `wasteland logs` 的默认日志根目录 |
| `WASTELAND_LOG_REDACT` | `true` | 配置 redaction 匹配策略；8 类 baseline denylist 始终保留 |
| `WASTELAND_LOG_TAIL_LINES` | `50` | 默认读取/展示的最近行数，必须是正整数 |

兼容关系：

```bash
# 等价于把日志最低等级提升到 debug
WASTELAND_DEBUG=1 wasteland

# 显式 level 优先
WASTELAND_DEBUG=1 WASTELAND_LOG_LEVEL=warn wasteland
```

`JOE_DEBUG` 是 `WASTELAND_DEBUG` 的旧 alias；新配置应使用 `WASTELAND_*` 名称。

## 9. CLI 子命令（已废弃）

> ⚠ `wasteland logs` 已废弃：TUI LogsPage 为唯一日志界面（搜索/过滤/对话合并/导出）。子命令保留可用，每次执行打印 stderr 提示后继续。

查看独立错误流，默认显示最近 20 条：

```bash
wasteland logs errors
wasteland logs errors --tail 100 --project <id|path>
```

按 `sessionId` 合并查看 runtime 与 error 事件，默认最多 200 条：

```bash
wasteland logs show <session-id>
wasteland logs show <session-id> --tail 500 --project <id|path>
```

查看各项目最近日志；`--level` 是最低等级，`--scope` 接受逗号分隔值，`--follow` 持续跟踪：

```bash
wasteland logs tail
wasteland logs tail --level warn --scope tool,permission --tail 50
wasteland logs tail --level debug --scope mcp,a2a --follow
```

无需 CLI 也可以直接定位：

```bash
grep '"sessionId":"<session-id>"' ~/.wasteland/data/logs/*/sessions/*.jsonl ~/.wasteland/data/logs/*/error.jsonl
jq 'select(.level=="error")' ~/.wasteland/data/logs/*/error.jsonl
```

## 10. TUI 快捷键

全局不在输入模式时，`T` 按以下顺序循环 page：

```text
chat(session) → sessions → logs → chat(session)
```

LogsPage 内按键（以页内 `?` 帮助条为准）：

| 按键 | 行为 |
|---|---|
| `↑`/`↓` | 切换选中 session |
| `Tab` | 循环 session |
| `Enter` | 展开/收起卡片详情（同毫秒多条按 seq 精确定位） |
| `]`/`[` | 下一个/上一个错误 |
| `/` | Omnibox 综合搜索（`level:`/`sid:`/`focus:on`/关键字；`sid:` 直接选中跳转） |
| `T` | 对话合并视图开关（transcript 用户/助手消息按时间插入） |
| `G`/`X` | 导出当前过滤为 markdown/JSON |
| `C` | 复制聚焦卡片到剪贴板 |
| `Home`/`End`/`PgUp`/`PgDn` | 右栏滚动 |
| `Esc` | 回到 chat |

TUI 本地命令 `/logs`、`/log`、`/debug` 可直接打开 LogsPage；`/logs errors`、`/logs show <sid>`、`/logs level <level>`、`/logs scope <scope,...>`、`/logs close` 与 `/logs help` 用于预设过滤和导航，不进入 skill registry 或 provider。

## 11. TUI 查问题体验（2026-09）

- **session 列表 5s 轮询**：新对话自动出现，选中按 sessionId 跟随不串台（指纹未变零渲染）。
- **对话合并视图**：`T` 把 transcript 的用户/助手消息插进日志流，一次看完“说了啥 + 系统干了啥”；走同一过滤/导出管线。
- **轮转档可见**：读 active + 最近 4 个 `.jsonl.N` 归档（与 CLI 一致），单档损坏只跳过该档。
- **全局时间线渐进式**：逐 session 追加渲染 + `x/50` 进度。
- **跳转自动聚焦**：`/logs show <sid>` 落地且该 session 有错时自动开错误聚焦；Omnibox 提交视为手动，后续不再自动开。
- **卡片键**：`seq` 优先（全局唯一），无 seq 按同毫秒序号兜底；错误上下文按下标定位。

---

需求与决策索引：[`.trellis/tasks/07-29-design-logging-system/prd.md`](../../.trellis/tasks/07-29-design-logging-system/prd.md)
