# Research: opencode (opencode-ai/opencode) 日志/可观测性体系

- **Query**: 研究 opencode 这个 AI agent CLI 的日志/可观测性体系
- **Scope**: external (官方源码, 2025 仓库快照)
- **Date**: 2026-07-29
- **Target stack**: Go 1.x + Bubble Tea TUI + slog + SQLite + sqlc + 自研 pubsub.Broker

---

## 1. Sources

| 来源 | URL | 最后访问 / 版本 |
|---|---|---|
| GitHub 仓库 | https://github.com/opencode-ai/opencode | 本地 `git clone --depth 1`, commit `73ee493 docs(readme): update archive note` (2025 归档前主分支) |
| README | https://github.com/opencode-ai/opencode/blob/main/README.md | 同上, 行 36 / 81 / 285 / 438 等 |
| Schema | https://github.com/opencode-ai/opencode/blob/main/opencode-schema.json | `debug: false`, `debugLSP: false` |
| 官方文档 | https://opencode.ai/docs | 仓库已 archive, 文档站文档未必完整同步, 不作主要引用 |
| 关键源码路径(已本地拉取) | `internal/logging/`, `internal/config/config.go`, `internal/db/`, `internal/pubsub/`, `internal/session/`, `internal/message/`, `internal/llm/agent/agent.go`, `internal/llm/provider/{anthropic,copilot}.go`, `internal/tui/components/logs/`, `cmd/root.go` | 见后续章节 |

> 备注: 仓库主分支已转为 archive(`docs(readme): update archive note`), 项目实际上分叉至 `sst/opencode` 继续演进。本次研究锚定在 `opencode-ai/opencode` 这一历史主线。

---

## 2. 总体架构

opencode 的"日志"实际上是**三条正交通道**, 围绕一个进程内的 pubsub 总线(`internal/pubsub/broker.go`)连接 slog 与 TUI:

1. **运行时日志 (Runtime logs)** — Go `log/slog` 通过 `slog.NewTextHandler` 包装到自定义 `logging.NewWriter()`, writer 把每条 logfmt 记录解码为 `LogMessage` 并 `pubsub.Publish`。默认无文件落盘, 只挂在内存 broker 上给 TUI 消费。
2. **会话转录 (Session transcripts)** — 在 dev-debug 模式下, 每个 session/turn 的 request body、stream chunks、response、tool results 都独立写 JSON / NDJSON 到 `messages/<sessionPrefix>/`。
3. **持久化数据 (Persistent state)** — SQLite `opencode.db`(`sessions`、`messages`、`files` 三表), 由 sqlc 生成的 typed Go 代码操作, 不算严格意义的"日志", 但是真正的会话 transcript 来源。

```
+-------------------+    slog.Info(...)    +------------------------+
| 业务代码 (agent,  | -------------------> | slog.NewTextHandler     |
| provider, db, lsp) |                      |  -> logging.NewWriter()|
+-------------------+                      +-----------+------------+
                                                        | logfmt decode
                                                        v
                                              +-----------------------+
                                              | LogData              |
                                              |  .messages []        | <-- TUI logs panel
                                              |  Broker.publish()    |     (Subscribe ctx)
                                              +-----------+----------+
                                                          |
                                                          v
                                                +----------------------+
                                                | in-memory TUI log    |
                                                |   (table + detail)   |
                                                +----------------------+

(OPENCODE_DEV_DEBUG=true 时, slog handler 切到文件; 同时 messages/ 开启落盘)
                                                               
+-------------------+   WriteRequestMessageJson /   +---------------------+
| provider/agent    |   AppendToStreamSessionLogJson | messages/<sid[:8]>/ |
| (anthropic,copilot| -----------------------------> | <seq>_request.json  |
+-------------------+                                | <seq>_response_stream.log
                                                     | <seq>_response.json |
                                                     | <seq>_tool_results.json|
                                                     +---------------------+

+-------------------+    db.CreateSession /      +-----------------------+
| session/message   | -------------------------> | opencode.db (SQLite)  |
| services (sqlc)   |    db.CreateMessage        |  sessions, messages,  |
+-------------------+                             |  files                |
                                                  +-----------------------+
```

---

## 3. 日志分层与路径

### 3.1 三层落点

| 层 | 触发条件 | 默认路径 | 是否跨进程持久 |
|---|---|---|---|
| **Runtime log(slog)** | `cfg.Debug=true` 或 `-d` CLI flag → `slog.LevelDebug`; 文件落盘需要额外 `OPENCODE_DEV_DEBUG=true` | 默认仅内存 broker; `OPENCODE_DEV_DEBUG=true` 时写 `<Data.Directory>/debug.log` | 默认否; dev-debug 是 |
| **Session transcript** | `cfg.Debug=true` 且代码路径显式调用 `logging.WriteXxx` 才落盘(provider/agent 内部有 `if cfg.Debug` 守卫); 目录创建也只发生在 `OPENCODE_DEV_DEBUG=true` | `<Data.Directory>/messages/<sessionId[:8]>/<seq>_{request,response_stream,response,tool_results}.{json,log}` | 否(但写到本地磁盘) |
| **Panic log** | 任何 `defer logging.RecoverPanic(name, cleanup)` 触发 panic | `<cwd>/opencode-panic-<name>-<YYYYMMDD-HHMMSS>.log` | 否(本地) |
| **Persistent DB** | 始终 | `<Data.Directory>/opencode.db` (WAL 模式) | 是 |

> 关键发现: `--debug` 改 level,**不**改 sink;真正落盘需要 `OPENCODE_DEV_DEBUG=true`。生产里这两件事是分开配置、分开生效的。

### 3.2 路径解析

- `Data.Directory` 默认值是字面量 `.opencode`(`internal/config/config.go:101` `defaultDataDirectory = ".opencode"`), 由 viper 通过 `setDefault("data.directory", ...)` 设置; cwd 决定它是相对路径。
- 用户可通过 `.opencode.json` 的 `data.directory` 字段覆盖, 或通过 viper `SetEnvPrefix("OPENCODE")` 读取 `OPENCODE_DATA_DIRECTORY` 等环境变量(viper 自动把嵌套 key 拍平)。README 中提到的 `$HOME/.opencode/` 仅出现在自定义 commands 目录(`internal/tui/components/dialog/custom_commands.go:57`), 不是默认 data dir。
- `messages/` 子目录在 `OPENCODE_DEV_DEBUG=true` 时由 `config.Load` 显式 `os.MkdirAll(messagesPath, 0o756)` 创建。
- `debug.log` 同样在 `OPENCODE_DEV_DEBUG=true` 时由 `os.OpenFile(..., O_CREATE|O_WRONLY|O_APPEND, 0o666)` 追加打开。

### 3.3 Env / CLI 覆盖矩阵

| 触发器 | 作用 |
|---|---|
| `-d` / `--debug` CLI flag | `cmd/root.go:294`, `config.Load(cwd, debug)` 入参; `setDefaults(debug)` 设 `viper.SetDefault("debug", true)` 和 `viper.Set("log.level", "debug")`; 同时 `slog` level 降到 `Debug` |
| `OPENCODE_DEV_DEBUG=true` env | `config.go:163` 走 dev-debug 分支: 创建 `debug.log` + `messages/` 目录, 把 slog handler 切到文件 writer, 并设 `logging.MessageDir` |
| `OPENCODE_*` env (viper 自动) | 覆盖 `.opencode.json` 任何字段, 包括 `data.directory` |
| `cfg.DebugLSP` | LSP 子系统单独开关, 与 slog 解耦 |

---

## 4. 文件格式与字段

### 4.1 `debug.log` (slog text handler)

默认 slog 的 text handler 输出 logfmt 形式:

```
time=2025-... level=INFO msg="MCP message handling goroutine exiting" source=internal/llm/agent/mcp.go:123
time=2025-... level=DEBUG msg="Chat completion response" filepath=/.../messages/abcd1234/3_response.json
```

注意: opencode 显式在 `logger.go:25-34` 里**手工注入 `source=file:line`**(`getCaller` 用 `runtime.Caller(2)`), 这是 slog 本身的 text handler 做不到的。

### 4.2 `LogMessage` (内存 / pubsub 事件)

`internal/logging/message.go`:

```go
type LogMessage struct {
    ID          string        // UnixNano, writer.go:51
    Time        time.Time     // logfmt 的 time 字段解析为 RFC3339
    Level       string        // "info"/"debug"/"warn"/"error"
    Persist     bool          // $_persist=true 标记, 用于状态栏显示
    PersistTime time.Duration // $_persist_time=... 标记, 状态栏显示时长
    Message     string        `json:"msg"`
    Attributes  []Attr        // 其它所有 key=value, 用 []Attr (而非 map) 保证顺序
}
```

`writer.go` 把 logfmt 解码成这个结构:

- `time` → `Time`
- `level` → `Level`
- `msg` → `Message`
- `$_persist` → `Persist`
- `$_persist_time` → `PersistTime`
- 其余 → `Attributes[]`

### 4.3 Session transcript (`messages/<sid[:8]>/...`)

`logger.go:141-207` 提供四个写文件函数, 文件名按 `requestSeqId` (1-indexed) 区分:

| 函数 | 文件 | 格式 | 内容 |
|---|---|---|---|
| `WriteRequestMessageJson(sid, seq, msg)` | `<seq>_request.json` | 单个 JSON 对象(pretty marshal) | 整次 LLM request 的 preparedMessages/params |
| `AppendToStreamSessionLogJson(sid, seq, chunk)` | `<seq>_response_stream.log` | **NDJSON**(逐 chunk 追加, 每行一个 JSON) | SSE / stream 的每个 chunk |
| `AppendToStreamSessionLog(sid, seq, raw)` | 同上 | 同上(原文) | 已经是字符串的情况 |
| `WriteChatResponseJson(sid, seq, resp)` | `<seq>_response.json` | 单个 JSON 对象 | 累计后的 `acc.ChatCompletion` |
| `WriteToolResultsJson(sid, seq, results)` | `<seq>_tool_results.json` | 单个 JSON 对象 | tool call → tool result 列表 |

调用点(`provider/anthropic.go:259`, `provider/copilot.go:322/391/422/485`, `agent/agent.go:295`)全部用 `if cfg.Debug { ... }` 守卫,**不是默认行为**。Sequence id 计算: `agent.go:294` `seqId := (len(msgHistory) + 1) / 2`, 即 user-assistant 一轮算一个 seq。

### 4.4 Panic log

`logger.go:67-95 RecoverPanic` 直接 `fmt.Fprintf` 写纯文本:

```
Panic in TUI-message-handler: runtime error: ...

Time: 2025-...Z

Stack Trace:
goroutine 1 [running]:
runtime/debug.Stack()
        /usr/local/go/src/runtime/debug/stack.go:24 +0x88
...
```

文件名格式 `opencode-panic-<name>-YYYYMMDD-HHMMSS.log`, **写在 CWD**, 跟 data dir 没关系。

### 4.5 SQLite schema (`internal/db/migrations/20250424200609_initial.sql`)

```sql
sessions(
  id TEXT PK, parent_session_id TEXT, title TEXT,
  message_count INT, prompt_tokens INT, completion_tokens INT,
  cost REAL, updated_at INT, created_at INT
)
messages(
  id TEXT PK, session_id TEXT FK, role TEXT, parts TEXT (JSON),
  model TEXT, created_at INT, updated_at INT, finished_at INT
)
files(
  id TEXT PK, session_id TEXT FK, path TEXT, content TEXT, version TEXT
)
```

`parts` 是 JSON 数组, 内部 `ContentPart` 接口(text / reasoning / toolCall / toolResult / finish / image / binary / attachment)。

---

## 5. Debug / Verbose 模式边界

| 模式 | level | sink | 是否写 transcript | 是否写 debug.log |
|---|---|---|---|---|
| 默认 | `slog.LevelInfo` | 内存 broker | 否 | 否 |
| `--debug` / `-d` | `slog.LevelDebug` | 内存 broker(默认) | **是**(因为代码里 `if cfg.Debug` 守卫会触发) | 否 |
| `--debug` + `OPENCODE_DEV_DEBUG=true` | `slog.LevelDebug` | 文件 `debug.log` + 内存 broker(双写) | 是 | **是** |
| Panic 任意模式 | — | 文件 `opencode-panic-...log` | — | — |

边界要点:

- `-d` 是 **LSP-friendly** 的开关: 提升 slog level 到 debug, 让默认 INFO 也被收下来, 让 session transcript 函数被调用。但**默认不持久化**。
- 真正"我要看文件"必须再叠 `OPENCODE_DEV_DEBUG=true`。这是有意为之: 写盘有 I/O 成本, dev-debug 主要用于本地复现。
- `DebugLSP` 是独立 bool, 只控制 LSP 子模块的 debug 行为, 与 slog level 解耦。
- 启动时 `setDefaults(debug)` 还会设 `viper.Set("log.level", "debug")`, viper 在 viper 视角上这是配置 key; 实际读它的是下一行 `slog.NewTextHandler(..., &slog.HandlerOptions{Level: defaultLevel})`, 而 `defaultLevel` 来自 `cfg.Debug` 判断, **不是从 viper 读**。这是一个细微的设计点: `cfg.Debug` 充当唯一的"是否进入 debug"开关, 而 `log.level` 字段更多是 schema 占位。

---

## 6. Session / Sub-agent 关联结构

### 6.1 主-子 session 模型

`session.Service.CreateTaskSession(toolCallID, parentSessionID, title)`(`session.go:54`):

- 用 tool call ID 作为子 session 的 `id`
- 写入 `parent_session_id`
- 触发 `pubsub.Publish(CreatedEvent, session)`
- 同时 `CreateTitleSession(parentSessionID)` 创建 `title-<parentSessionID>` 这种辅助 session

### 6.2 日志视图: 每个 session 独立 transcript 目录

`logger.go:100-101`:
```go
func GetSessionPrefix(sessionId string) string { return sessionId[:8] }
```

也就是说 `messages/` 下的目录是 `sessionId` 前 8 字符——**子 session 独立目录**, 不与 parent 合并。但没有专门的"父子嵌套"目录结构(没有 `messages/<parent>/<child>/` 这种), 文件名也没带 `parent_id`。回溯父子关系只能靠 SQLite 的 `parent_session_id` 字段。

### 6.3 pubsub broker 与 session 的关系

- 一个 `session.service` 实例 = 一个 `pubsub.Broker[Session]`, 在 `cmd/root.go:setupSubscriptions` 里**全局只订阅一次**(`app.Sessions.Subscribe`)。
- 子 session 触发 `Publish(CreatedEvent, child)` 时, 所有订阅者(包括 TUI)都会收到事件, 但 TUI 那边是用 ID 局部识别父子关系, 不在 broker 层做路由。
- 多个 agent(目前 hard-coded: `coder`, `summarizer`, `task`, `title`, `config.go:40-44`)各自独立 `pubsub.Broker[AgentEvent]`, 也都挂到 `setupSubscriptions`。
- slog 层则是**全局 `slog.SetDefault`**, 所有 agent 共享同一个默认 logger → 同一个内存 broker。Debug 文件也是单一的 `debug.log`, 不按 agent 拆分。

> 也就是说: opencode 的"多 agent 日志"在磁盘上是混在一起的;**区分 agent 必须靠 source 调用点或 attribute**, 不是靠文件。

---

## 7. 轮转与保留策略

- **运行时日志 (`debug.log`)**: 无轮转。`os.OpenFile(..., O_APPEND|O_CREATE|O_WRONLY, 0o666)` 直接追加, 没有 maxSize、没有 time-based split、logrotate 不内置。
- **Session transcript (`messages/`)**: 无轮转。每个 session/seq 一个文件, session 多 → 文件多;没有按大小/时间清理逻辑。
- **Panic log**: 无轮转。每 panic 一次一个新文件, 文件名带时间戳避免覆盖。
- **SQLite**: 走 goose migration, 没有 vacuum / retention 调度。
- **内存 broker**(`internal/pubsub/broker.go`):
  ```go
  func NewBrokerWithOptions[T any](channelBufferSize, maxEvents int) *Broker[T]
  ```
  - `bufferSize=64`, `maxEvents=1000` 为默认值; 但**代码里 `maxEvents` 字段并未在 `Publish` 中实际使用**——它只是初始化的 hint, 没有 ring buffer / 容量丢弃逻辑。
  - 订阅者慢消费时, `cmd/root.go:235` `case <-time.After(2 * time.Second): logging.Warn("message dropped due to slow consumer", "name", name)`——有超时报错, 但**不会丢旧事件**, 只会丢新事件。

**结论**: opencode 在"清理 / 滚动 / TTL"这件事上几乎是 zero policy, 全权交给运维(README 也未提)。

---

## 8. UI 与日志的解耦方式

### 8.1 三层解耦

```
slog API call
  -> slog.SetDefault -> TextHandler
     -> logging.NewWriter() (interface io.Writer)
        -> logfmt decode
           -> defaultLogData.Add(msg)
              -> messages []LogMessage (in-memory)
              + pubsub.Broker[LogMessage].Publish
                 -> subscribers (TUI)
                    -> tea.Msg via cmd/root.go:setupSubscriptions
                       -> TUI logs page table + detail
```

### 8.2 关键设计点

- **slog → in-memory adapter 通过 `io.Writer` 接口**: `logging.NewWriter()` 实现 `Write(p []byte)`(`writer.go:46`), logfmt 解码完直接 `defaultLogData.Add`。这不是 wasm / bus, 而是**典型的 `io.Writer` 桥接模式**: slog 不需要知道下面有 pubsub。
- **统一 bus**: `cmd/root.go:255-259`:
  ```go
  setupSubscriber(ctx, &wg, "logging",    logging.Subscribe,       ch)
  setupSubscriber(ctx, &wg, "sessions",   app.Sessions.Subscribe,  ch)
  setupSubscriber(ctx, &wg, "messages",   app.Messages.Subscribe,  ch)
  setupSubscriber(ctx, &wg, "permissions",app.Permissions.Subscribe,ch)
  setupSubscriber(ctx, &wg, "coderAgent", app.CoderAgent.Subscribe,ch)
  ```
  所有"领域事件"通过同一个 `chan tea.Msg` 流入 TUI, TUI 的 `Update(msg tea.Msg)` 用类型 switch 分发(`table.go:38` `case pubsub.Event[logging.LogMessage]`)。
- **TUI 端只读**: TUI logs panel(`internal/tui/components/logs/table.go` / `details.go`)只是订阅者, 通过 `logging.List()` 拉当前快照 + 收新事件增量更新。**TUI 永远不写日志**, 永远不直接访问文件。
- **provider 直写文件 vs UI 展示**: Session transcript 文件是**provider/agent 直写**, **不经过 slog**, 因此 TUI 默认看不到(也不需要看, TUI 有自己的对话渲染)。这是个有意的分工: slog 用于"系统/调试信息", 文件用于"完整可重放 transcript"。
- **没有 wasm 层**: opencode 是纯 Go binary, TUI 是 bubble tea 进程内组件。wasm/bus 模式只在你**预期 host 端有独立运行时**(浏览器/JS UI)时才需要, opencode 不存在这个边界。

### 8.3 解耦带来的代价

- 因为 slog → broker 是异步 fan-out, log 顺序在 TUI 上**只反映 Add 的顺序**, 不会保证"谁先调用谁先到 UI"——这是 single-broker + single-mutex 的简化。
- 因为 file writer(`debug.log`)是 O_APPEND, 它与 broker **没有 backpressure 关系**: 文件满了/磁盘满只会让 `os.WriteString` 失败 → `logging.Error(...)`, 而 `logging.Error` 自身又会进入 broker, 形成可观察的循环(实际因为 mutex 在 writer 内, 不会真死锁, 但会刷屏)。

---

## 9. 与 wasteland 的契合点与差异

| 维度 | opencode | wasteland(假设 TUI+rxjs+adapter) | 契合 / 差异 |
|---|---|---|---|
| 日志 API | Go `log/slog` 全局 | JS / TS 通常 `console` 或自定义 Logger | 需要在 wasteland 侧提供类似 `setDefault(logger)` 的统一入口 |
| Adapter 桥接 | `io.Writer` 接口 | rxjs Subject / Observable | wasteland 已经天然有 rxjs 流, 桥接成本低 |
| 事件总线 | `pubsub.Broker[T]` 单进程 in-mem | rxjs multicast Subject | 等价物已存在 |
| 多 sink | dev-debug 时文件 + broker 双写 | 浏览器 console + localStorage + 上报 | 比 opencode 更复杂, opencode 单 file 模式值得参考 |
| Session transcript | provider/agent 直写文件(不走 slog) | TBD | opencode 的 split(slog 看系统态 / 文件看可重放数据)是可借鉴的清晰分工 |
| Level 控制 | `--debug` flag, level 切换与 sink 切换分离 | TBD | wasteland 应保留同样的分离: level 是 level, persistence 是 persistence |
| 路径 | `cfg.Data.Directory` + `messages/` 子目录 + `panic-<name>-<ts>.log` 在 cwd | TBD | panic 文件用 cwd 而非 data dir, 是个易踩坑的设计(磁盘权限 / 临时目录) |
| 轮转 | **完全没有** | TBD | wasteland 设计应主动补齐, 至少给文件 sink 加 size cap / age TTL |
| Multi-agent | 所有 agent 共享 slog; 区分靠 attribute | TBD | wasteland 若有 agent 维度, 应在 logger 自动注入 `agent=` field, 而不是分文件 |
| Sub-session | `parent_session_id` 在 DB; 目录扁平化 | TBD | wasteland 应考虑"父子 session 目录嵌套"还是"扁平 + 索引" |
| 内存 broker 容量 | 1000 events hint, 实际未用 | rxjs 默认无限, 需要手动 backpressure | opencode 这块是**反例**: 不要让 capacity hint 成为摆设 |

契合点:

- TUI 与日志通过"统一事件总线 + 类型分发"解耦——这套模式 rxjs 完全覆盖。
- "slog/logger 适配到 broker"的桥接思路可以直接套到 wasteland 的 `logger → Subject`。
- "provider/agent 写 transcript 文件, 不走 UI" 是可借鉴的**职责分离**——UI 不应承担"全量记录"职责。

差异 / 待补:

- opencode **没有 size/age 轮转**, wasteland 应主动引入(retention.ts / rotating-file)。
- opencode panic 写在 cwd, 比较随意;wasteland 设计日志系统时, panic / fatal 应有显式独立 sink(写到固定位置, 不依赖 cwd)。
- opencode slog 全局共享, 缺少 `agent=`/`sessionId=` 自动注入; wasteland 可以利用 rxjs 的 `pipe(map)` 在适配层注入。

---

## 10. 可借鉴的 2-3 个具体模式

1. **`io.Writer → pubsub.Broker` Adapter Pattern** — slog 通过 `logging.NewWriter`(实现 `io.Writer` 接口)把 logfmt 解码成结构化 `LogMessage`, 再走 broker 给 TUI 消费。**一句话**: 用窄接口(`io.Writer`)作为日志门面与事件总线之间的解耦点, 替换底层 sink 不影响调用方。
2. **`if cfg.Debug` Transcript Side-Channel** — Session transcript 的写文件函数(`WriteRequestMessageJson` 等)**不走 slog**, 而是在 provider/agent 调用点用 `if cfg.Debug` 显式触发。**一句话**: 把"系统调试日志"和"可重放 / 审计 transcript"分成两条独立通道, 前者走 slog, 后者直接落盘, 各自优化(结构 / 压缩 / 保留策略不同)。
3. **Single Channel Fan-In to TUI** — `setupSubscriptions` 把 logging/sessions/messages/permissions/coderAgent 五个 broker **统一汇聚到一个 `chan tea.Msg`**, TUI 用类型 switch 分发。**一句话**: 用一条物理 channel 把所有领域事件合并进入 TUI 的 update loop, 避免多源订阅顺序与并发复杂度。
4. **(`Persist` + `PersistTime` Sibling Field)** — log message 上有 `$_persist` / `$_persist_time` 两个非标准字段, 标记"这条日志要在状态栏停留显示多久"。**一句话**: 在结构化日志里预留"展示意图"字段, 让 logger 既能写文件也能被状态栏消费, 不需要再开一条状态事件流。

---

## Caveats / Not Found

- 官方文档站 https://opencode.ai/docs 未深查(仓库已 archive, 文档可能未完全迁移到 sst/opencode 分支)。本次以源码为准。
- `cfg.Data.Directory` 的**默认 `.opencode` 没有自动 `$HOME` 前缀**——它是相对 cwd 的路径。README 的"~/.opencode/"只在 custom_commands 路径出现。需要在 wasteland 设计时明确是否要自动加 `$HOME` 或 `./`。
- `internal/pubsub/broker.go` 的 `maxEvents` 字段看似预留容量但 `Publish` 未使用, **不是真正的 ring buffer**。引用时需注意其"声明与实现不符"。
- 文件轮转 / TTL / size cap 在 opencode 中**完全没有实现**, 不要把它当成"开源最佳实践"——它是反面教材(wasteland 需要自己补)。
- `--debug` 与 `OPENCODE_DEV_DEBUG=true` 的分离(只升 level vs 真正写盘)在 README 中**没有显式说明**, 容易踩坑(用户在生产加 `-d` 期望能看到文件, 实际不会)。
