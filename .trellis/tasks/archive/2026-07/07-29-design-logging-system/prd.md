# 设计 wasteland 日志系统

> 任务 slug: `design-logging-system` · 创建于 2026-07-29
> 目标: 借鉴 opencode / Claude Code 的日志结构,为 wasteland 设计一套统一的、可扩展的、与 UI 解耦的 logging 子系统,MVP 在不破坏现有 session transcript 与 debug trace 的前提下落地。

## Goal

wasteland 当前只有两条松散耦合的日志路径——`events$` (UI 消费)、`debug$`/`.wasteland/debug.log`(开发调试用)——以及写 session transcript 的 `.wasteland/sessions/*.jsonl`。它们之间没有统一的层级抽象、没有轮转/保留策略、没有 redaction、也没有明确的字段约定。本任务目标是设计并落地一套 logging 子系统:

1. **统一抽象**: 把 core 内所有"可观察"的事件(trace / session / 错误 / 决策)拢到同一套 schema + sink 模型。
2. **多 sink 输出**: 同一份事件可同时输出到 debug.log(jsonl)、TUI debug 页(styled)、未来可平滑接 OTLP/文件分割/重定向。
3. **与 UI 解耦**: core 不再因"调试需要"耦合 stdout/stderr,日志经 RxJS Subject 注入到 UI/文件/测试夹具。
4. **可演进**: 默认关闭、运行时按 level 开关、按 scope 过滤、按 session 隔离、按 size/time 轮转。

### 用户关键约束(2026-07-29 二次明确)

**A. 目的:方便查找问题**——决定下面这些产物形态:
- 文件命名/分片:每条事件可被 `grep`/`jq` 单独定位,且能按时段/session/level 切窗。
- 字段顺序与 key 命名固定,snake_case 与主流 agent 一致。
- error 事件独立流(永远可查、不被 gzip 吞掉)。
- 时间戳毫秒精度 UTC ISO8601,跨 session 可对齐。
- 提供 `wasteland logs` 子命令(最小 MVP:`wasteland logs errors` / `wasteland logs show <sid>`)。

**B. 交互上需要和主流 agent 对齐**——决定 CLI flag、字段、目录结构:
- 路径:`.wasteland/logs/` 主目录,贴近 `~/.claude/projects/<encoded-cwd>/<sid>.jsonl` 范式。
- 环境变量:`WASTELAND_LOG_LEVEL/DIR/REDACT` 与 `WASTELAND_DEBUG` 共存,不分裂 level 与落盘开关(与 opencode 区分)。
- Schema:字段名与顺序固定 + `version: 1` 字段(承诺 semver 演进,避免 Claude Code issue #53516 那种不稳定痛苦)。
- Subagent:`subagents/agent-<id>.{jsonl,meta.json}` 配对,meta 含 `toolUseId / spawnDepth / agentType`(借自 Claude Code)。
- tool 事件 5 段时间分解 `preHookMs / permissionMs / toolMs / postHookMs / totalMs`(借自 Claude Code `tengu_tool_use_success`)。
- assistant 记录 `usage { input_tokens, output_tokens, cache_*_tokens }`,字段名与 Claude Code transcript 一致。
- session 文件末尾 `last-prompt` leaf cursor(类似 Claude Code type=last-prompt)。

## What I already know

### wasteland 现有 logging 资产(已摸清)

- **单文件 debug.log**:`.wasteland/debug.log`,JSONL,同步 `appendFileSync`,无轮转。当前 104KB / 388 行,会无限增长。
  - 路径硬编码 `process.cwd() + '/.wasteland/debug.log'`,无 `WASTELAND_LOG_DIR` env。
  - 启动时追加一行 `# wasteland debug session started at <iso>` 头(非 JSON),后续每行一 JSON。
  - `enableDebugLog()` 后才生效,默认 no-op。
- **事件流两条**:
  - `events$: Observable<RuntimeEvent>` —— 全量会话事件,目前仅供 UI 订阅(未落盘)。
  - `debug$: Observable<DebugTraceEvent>` —— debug 追踪流(scope: `session/turn/provider/tool/ui/skill/permission`),被 TUI `useRuntimeEvents` 订阅并落入 debug.log。
- **Schema 已就绪**:
  - `RuntimeEvent` 是 17 种 discriminated union(`session_started/user_turn/assistant_chunk/tool_call_requested/permission_decision/tool_started/tool_result/tool_failed/agent_spawned/agent_completed/skill_*/user_input_*/agent_progress/agent_thinking/agent_tool_use/session_ended`)。
  - `SessionRecord` 6 种(`session/message/tool_call/permission/tool_result/session_end`),已被 `SessionManager` 写入 `sessions/<id>.jsonl`,带 10条/5s flush 缓冲。
- **session 命名约定**:`YYYY-MM-DD_HHMMSS_xxxxxx`(本地时区)。
- **环境变量**:`WASTELAND_DEBUG` 启用 debug 落盘;兼容旧 `JOE_DEBUG`;`WASTELAND_SESSION_DIR` 覆盖 session 路径(独立于 debug.log)。
- **debugLog 调用点**(已确认 4 处):`agent-loop.ts`、`spawn-agent/index.ts`、`spawn-agent/context-builder.ts`、`skin-occupancy.ts`。当前只有 trace 类,无 error/warn/info 等级。
- **TUI 集成**:`src/tui/hooks/useRuntime.ts` 在 136 行设 `debug$: run.debug$`;`useRuntimeEvents` 480 行起订阅并降噪。
- **CLI fallback**:`commands/chat.ts:128` 与 `commands/resume.ts:176/240` 通过 `renderDebugTrace(run.debug$, …)` 在 chat 回放时把 debug 流喷到屏幕(同样走 `debugLog` 持久化)。

### 约束(已确认)

- 架构分层:`UI(CLI/TUI) → Adapter → Core(runtime)`,core 不能依赖具体 UI。
- core 跑在 `runAgentLoop({ input$ }) -> { events$, debug$ }` 的 RxJS 模型里,新 logging 必须能挂上现有 Subject 或共享同一总线。
- 现有 session transcript(`SessionRecord` + 缓冲写)不能破坏——是用户 `wasteland resume <id>` 的事实来源。
- Node 20+,import ESM,无第三方 logger 依赖(当前依赖只有 cheerio/commander/ink/react/rxjs/turndown/zod)。
- i18n 校验/locale parity/contrast 都是 CI 闸门,日志若新增字段要进 schema 同步校验。
- 测试体系 vitest,任何 logger 抽象必须有可注入的 `MemorySink` 便于测试断言。

### wasteland 缺乏的能力(观察清单)

| 现状 | 缺口 | 落地诉求 |
|---|---|---|
| 单一 `debug.log` | 无 size/time 轮转、无保留策略 | 默认按 size 切(>=10MB 切 + 最多保留 N 份) |
| 无日志 level 概念 | 无法 info/warn/error 分级 | 引入 `LogLevel = debug/info/warn/error`,JSONL 里加 `level` |
| debug 写文件,error 仅出现在 console | error 级别永不落盘 | 独立 `error.log`(或 .jsonl),出问题优先看 |
| `WASTELAND_DEBUG` 二值开关 | 无法按 scope 过滤(verbose 但只看 tool) | level + scope(per-scope enable) |
| raw 字符串入 debugLog | 无 redaction(API key、user prompt 裸跑) | sink 层 redaction(denylist + mask) |
| events$ 不落盘,只给 UI | 重放/导出/取证困难 | core 暴露 `LogBus`,UI/文件/测试任意订阅 |
| 路径硬编码 cwd | 多 cwd/多项目会冲突 | 引入 `WASTELAND_LOG_DIR`,默认仍进 `.wasteland/logs/` |
| `WASTELAND_DEBUG` 与 UI debug 页耦合 | 同一开关同时控制 UI + 文件 | 分开:UI debug 页单独一个 env;文件落盘独立 |
| 无 correlation id | 子 agent / tool 的事件难以串联 | 全事件携带 `sessionId / turn / step / parentChildId?` |
| 无性能指标(token / latency) | 排障只能看时长 | 选 P2:trace 流携带 `durationMs / cost? / tokens?` |

## Assumptions (temporary)

- [A1] 用户要的是"框架 + MVP 落地",不是单纯的方案稿子——所以本任务最终会带 1 个能跑的最小实现。
- [A2] "日志"指 runtime/工具/权限事件,不包括 library 内部日志(cheerio/rxjs 自身)——后者按各 lib 默认。
- [A3] 不动现有 `SessionRecord` 协议——它对 resume 而言是契约级。logging 系统新增的是 trace/error 层,**不取代** session transcript。
- [A4] 倾向 RxJS 风格,复用 core 已有的 Subject 模型,不引入 winston/pino 这种重依赖。
- [A5] TUI 的 debug 页面改造进 MVP(只动渲染开关),完整重做 UI 留 P2。
- [A6] CLI fallback 的 `--debug` 行为保持不变,但内部走新 Logger。

## Open Questions (收敛完成,转 Requirements)

- Q1: ~~debug log vs transcript 合流 vs 分流?~~ → 决议:**分流**(transcript 保持 SessionManager 现状;runtime log 走新 FileSink)。
- Q2: ~~redaction 默认行为?~~ → 决议:**强制 on**,可用 env 关闭但要求 warn。
- Q3: ~~logger 实现?~~ → 决议:**自写**(Approach A),零依赖,贴合 rxjs。
- Q4: ~~轮转策略?~~ → 决议:**size + age 双轴**,默认 10MB × 5 + 7 天 gzip。
- Q5: ~~自带的 CLI 调试命令?~~ → 决议:保留 `WASTELAND_DEBUG` env + 新增 `wasteland logs` 子命令(MVP 至少 `wasteland logs errors` / `wasteland logs show <sid>`,更多命令留 P2)。

## Requirements (locked)

### 核心 schema 与抽象(R1-R10)

- R1: 新增 `src/core/logger/` 子系统,导出 `Logger`(LogLevel + scope 过滤)与 `LogBus`(RxJS Subject 聚合 events + trace)。
- R2: `LogEntry` schema:`{ timestamp, level, scope, sessionId, turn?, step?, message, data?, error? }`,level ∈ {debug,info,warn,error},scope ∈ {session, turn, provider, tool, ui, skill, permission, mcp, a2a, file}。
- R3: 提供两个内置 sink:`FileSink`(JSONL,按 size/age 切)与 `MemorySink`(测试用)。
- R4: `FileSink` 支持 redaction(denylist 正则:Authorization/Bearer/`sk-…`/env `*_API_KEY` 等)。
- R5: 把现有 `debugLog()` + `debug$` 合并到新 `Logger.debug(...)`。
- R6: 新增 `.wasteland/logs/error.jsonl`,level>=warn 必落盘,即使 `WASTELAND_DEBUG=false`。
- R7: 暴露 `runtime.log$: Observable<LogEntry>`,与 events$、debug$ 并列,UI 可单独订阅。
- R8: env:`WASTELAND_LOG_LEVEL`(默认 `info`)、`WASTELAND_LOG_DIR`(默认 `.wasteland/logs`)、`WASTELAND_LOG_REDACT`(默认 `true`)、`WASTELAND_LOG_TAIL_LINES`(默认 `50`)。
- R9: `ChatInputTurn.user_turn` 等含 prompt 内容的字段,经 sink 写入前自动按 denylist mask。
- R10: logger 单实例,`enableDebugLog()` 改为 `Logger.setLevel('debug')` 语义;`WASTELAND_DEBUG` 仍兼容但内部转 level。

### "方便查找问题"产物形态(R11-R14)

- R11: **文件路径与命名固定**:
  - `.wasteland/logs/runtime-<YYYY-MM-DD>.jsonl`(按天切,自然时序,grep 时段窗口)
  - `.wasteland/logs/error.jsonl`(独立流,永远不被 gzip)
  - `.wasteland/logs/runtime-<YYYY-MM-DD>.jsonl.<1..5>`(轮转保留档)
  - `.wasteland/logs/index.json`(轻量索引:每个文件含 sessionId 范围 + size + mtime,快速定位)
  - `.wasteland/sessions/<sid>.jsonl`(契约不动,与 logs/ 平级)
  - `.wasteland/logs/transcript/<sid>.jsonl`(可选:SessionManager 复制一份到 logs/,便于与 runtime 同 jq)
- R12: **顶层字段顺序固定**:`timestamp, level, scope, sessionId, turn?, step?, message, data?, error?`。snake_case 与 Claude Code transcript 对齐。`message` 强制单行(`\n` 转义)。
- R13: **时间戳** ISO8601 UTC,毫秒精度 `YYYY-MM-DDTHH:mm:ss.sssZ`,跨 session 可对齐。
- R14: **新增 CLI `wasteland logs`**:`wasteland logs errors`(列 error.jsonl 最近 N 条)、`wasteland logs show <sid>`(根据 sessionId 反查 runtime + transcript 合并视图)、`wasteland logs tail [--level error|warn|info|debug] [--scope <s>]`(类 journalctl 风格,实时跟踪)。

### "对齐主流 agent 交互"产物形态(R15-R20)

- R15: **路径对齐**:`.wasteland/logs/` 主目录贴近 `~/.claude/` 范式;`WASTELAND_LOG_DIR` 可全局覆盖,类似 `OPENCODE_DATA_DIRECTORY`。
- R16: **Schema 字段对齐 Claude Code transcript**:
  - `LogEntry.version: 1` 字段(承诺 semver 演进,避免 Claude Code #53516).
  - assistant 事件携带 `usage { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }`,字段名与 Claude Code 完全一致。
  - 错误事件携带 `top_frame / stack`(类似 Claude Code `tengu_tool_use_error.error_top_frame`),便于快速定位代码行。
  - session 事件携带 `parent_session_id + agent_id + tool_use_id` 三元组,反查父 spawn 调用。
- R17: **Subagent metadata sidecar**(借自 Claude Code `subagents/agent-<id>.meta.json`):
  - 路径 `.wasteland/logs/transcript/<sid>/subagents/agent-<agentId>.{jsonl,meta.json}`。
  - `meta.json` 字段:`agentType`, `description`, `toolUseId`, `spawnDepth`, `createdAt`。
  - jsonl 中含 `isSidechain: true` 标识。
- R18: **工具事件 5 段时间分解**(借自 Claude Code `tengu_tool_use_success`):
  - `preHookMs`, `permissionMs`, `toolMs`, `postHookMs`, `totalMs`。
  - 资源 delta(`rssDeltaBytes`, `heapUsedDeltaBytes`)可作 P2。
- R19: **`last-prompt` leaf cursor**(借自 Claude Code `type=last-prompt`):
  - session transcript 末尾追加一行 `last-prompt` 记录,持续更新指向最后 user 事件 UUID。
  - 用于 "上次的 prompt" / "继续上回输入" 场景。
- R20: **CLI flag 对齐**:`--debug` / `-d` 启用 debug 落盘(对标 Claude Code 直觉);保留 `--verbose` 不启用以避免语义重叠。`WASTELAND_DEBUG` env 仍兼容(老用户脚本不受影响)。

### TUI Dedicated Logs Page(R21-R27,ADR-6 锁定 L2)

- R21: 新增 `src/tui/components/LogsPage.tsx`,作为顶层 page,值域 `chat | sessions | logs`,通过 `T` 键切换 page(参考 opencode TUI 的 pages 切换风格)。
- R22: Logs page 表格列固定:`time | level | scope | sessionId | turn | step | message`;每列宽可配但默认布局。
- R23: Logs page 双栏布局——左 table(`getmaxy` 适配),右 detail pane,选中行按 Enter 展开 `data` 全字段 JSON tree(类似 lazygit 的 commit detail)。
- R24: 实时跟踪由 `log$ Subject` 驱动,新事件追加到 table 顶部,默认 tail 模式;按 `P` 键暂停/恢复(可选:`follow` toggle)。
- R25: 顶部过滤栏:`level`(默认 `info`,可选值 `debug/info/warn/error`)、`scope`(多选)、`sessionId`(子串匹配)。按键 `L` 切换 level 下拉、`S` 切换 scope 多选、`/` 进入 sessionId 输入。
- R26: `/logs <subcmd>` TUI 本地命令集合(在 `ChatInputBar` 中分发,与 `/clear` 平级,不进 skill registry):
  - `/logs`(无参数)— 切到 Logs page,保留当前过滤
  - `/logs close` — 切回 Chat page
  - `/logs errors` — 切到 Logs page,level 预置 `error`
  - `/logs show <sid>` — 切到 Logs page,sessionId 预置 `<sid>`
  - `/logs level <l>` — 设置当前过滤 level 并保持 Logs page 选中
  - `/logs scope <s>` — 设置当前过滤 scope(逗号分隔多值)
  - `/logs help` — 在 chat 区打印子命令列表
  - 别名:`/log`、`/debug`(语义对齐 `--debug`)
- R27: Logs page 状态(filter / column width / 选中行)在退出 page 时保留(写 `.wasteland/logs-view.json`),下次进入恢复——可选,**默认不持久化**避免污染 git 仓库。

MVP 不要(留 P2 / Out of Scope):

- OTLP/HTTP 导出、JSON-over-TCP、metrics/trace 协议。
- TUI debug 页 UI 重构(只接 log$ 流,渲染逻辑可后续优化)。
- `wasteland logs` 高级子命令(如 `compare`/`diff`/`export`)。
- 跨平台 file-watch / 实时 tail UX,只提供基础 CLI 即可。
- 任何 form of metrics aggregation / dashboard。
- 日志内容本地化(结构化字段中英一致即可)。

## Acceptance Criteria (locked)

- [ ] AC1: 新增 `src/core/logger/` 目录(>=5 个 ts 文件 + 对应 vitest 用例),`npm run check` 全绿。
- [ ] AC2: `WASTELAND_DEBUG=1` 或 `WASTELAND_LOG_LEVEL=debug` 启用 debug 落盘;默认 `WASTELAND_LOG_LEVEL=info` 时 debug 静默不写。
- [ ] AC3: 模拟一次 `sk-abc123XYZ...` 出现在 prompt 工具 input,落盘 JSONL 中该字段被 mask(不是原文)。
- [ ] AC4: `.wasteland/logs/runtime-*.jsonl` size 触发时自动切到 `.1`/`.2`/等保留档,`index.json` 同步更新。
- [ ] AC5: warn/error 即使 `WASTELAND_DEBUG=false` 仍写入 `error.jsonl`。
- [ ] AC6: TUI 启动后 `useRuntimeEvents` 接 `log$`,渲染最近 N 条 debug(数量可配,默认 50)。
- [ ] AC7: docs/architecture/logging.md 落地,README 的 `WASTELAND_*` env 表新增 `WASTELAND_LOG_LEVEL/DIR/REDACT/TAIL_LINES`,并演示 `grep`/`jq`/`wasteland logs` 实际使用命令。
- [ ] AC8: 现有 `wasteland resume <id>` 功能不受影响(`SessionRecord` 协议不动)。
- [ ] AC9: 至少 1 个 MCP / A2A / file-audit scope 各 1 个真实调用点走新 logger(测试中可见输出)。
- [ ] AC10: 旧的 `WASTELAND_DEBUG=1` 仍能写出 trace 事件(向后兼容)。
- [ ] AC11: **Schema 对齐验证**:`LogEntry` jsonl 输出与 Claude Code 同字段名(`timestamp / level / scope / sessionId / usage`)可被 `claude-dev.tools` 一类工具间接消费(只测字段兼容即可,不要求完整 replay)。
- [ ] AC12: **`wasteland logs errors` 与 `wasteland logs show <sid>` 两个子命令**至少在一台手工 runtime 上能复现错误列表 + session 视图。
- [ ] AC13: **`grep '"sessionId":"<sid>"'`** 能从 `.wasteland/logs/runtime-*.jsonl` 与 `.wasteland/logs/error.jsonl` 中拉出该 session 全链路事件(方便查找)。
- [ ] AC14: **`jq 'select(.level=="error")'`** 命令演示出现在 README/docs/logging.md 的"如何排查问题"小节。
- [ ] AC15: Subagent 透传验证:`wasteland logs show <parent-sid>` 能同时列出 `agent-<id>.jsonl` 与父 transcript 的关联(`toolUseId` 反查)。
- [ ] AC16: 工具事件携带 5 段时间字段,且在 `error.jsonl` 中保留可用以定位慢工具。
- [ ] AC17: TUI 顶层 App 支持 `T` 键在 `chat | sessions | logs` 三个 page 间循环切换(`T` 在 chat 中触发,在 logs/sessions 中按其它键返回 chat)。
- [ ] AC18: Logs page 表格列固定为 `time | level | scope | sessionId | turn | step | message`,与 R22 一致。
- [ ] AC19: Logs page 双栏布局——左 table、右 detail pane;选中行按 Enter 展开 `data` 全字段 JSON tree。
- [ ] AC20: 实时跟踪由 `log$ Subject` 驱动;按 `P` 键暂停/恢复;暂停时新事件入缓冲,恢复后批量刷出。
- [ ] AC21: 7 个 `/logs` 子命令(`/logs`, `/logs close`, `/logs errors`, `/logs show <sid>`, `/logs level <l>`, `/logs scope <s>`, `/logs help`)全部在 chat 输入时正确分发,不做 skill 注册,直接由 `ChatInputBar` 处理。
- [ ] AC22: top-level filter(level/scope/sessionId)切换即时影响 Logs page 渲染(无 reload),filter 状态由 Logs page 内部 reducer 管理。

## Definition of Done (team quality bar)

- 测试新增/更新:Unit 覆盖 FileSink / MemorySink / Redactor / LogBus / Logger;集成覆盖一次完整 run 输出。
- Lint/typecheck/CI 全绿。
- i18n、locale-parity、contrast 三个脚本(项目固定闸门)仍通过。
- 文档更新:`logging.md` + README 的 `WASTELAND_*` env 表新增 `WASTELAND_LOG_LEVEL/DIR/REDACT`。
- 兼容性:旧 `WASTELAND_DEBUG` 与 `JOE_DEBUG` 仍生效,但内部切换到新 Logger。
- Rollout:`logger` 默认开启 info 级 + error 必落盘;高敏感字段默认 mask,可用 `WASTELAND_LOG_REDACT=false` 关闭(并在 README 注 warn)。

## Out of Scope (explicit)

- 不改 SessionRecord schema(resume 协议级契约)。
- 不引入重型 logger 依赖(winston/pino/otel-sdk)——MVP 自带轻量实现,后续按需换。
- 不为 free-form metadata 增加 schema 校验——`data` 字段允许任意 JSON,但顶层字段必须固定。
- 不重做 TUI debug 页 UI——只增加 log$ 订阅,UI 改造留 P2。
- 不为日志做跨进程 IPC(只覆盖单进程 wasteland 启动场景)。

## Technical Notes

### 仓库巡检结论

- core 入口:`src/core/runtime/agent-loop.ts`(1260 行返回 `debug$`)、`session-manager.ts`(6 record JSONL)。
- 现有 debug 主线:`debug-logger.ts:debugLog()` ← `agent-loop.ts:1025` / `spawn-agent/index.ts:202,269` / `context-builder.ts:87` / `skin-occupancy.ts:47`。
- Event 总入口:`event-types.ts` 17 种 RuntimeEvent;`debug-events.ts` 7 种 DebugTraceEvent。
- Path 解析:`src/config/paths.ts` 提供 `resolveDefaultSessionDir`,需复用/平行设计 `resolveDefaultLogDir`。
- CI 闸门:`npm run check`(typecheck + lint + i18n 校验 + locale-parity + contrast + vitest)。

### 主流 agent 对齐矩阵(2026-07-29 用户要求)

| 维度 | Claude Code | opencode | wasteland 目标 |
|---|---|---|---|
| 主目录 | `~/.claude/projects/<enc-cwd>/` | `.opencode/` | `.wasteland/logs/` |
| 主日志文件 | `<sid>.jsonl`(append-only) | `debug.log`(单文件) | `runtime-YYYY-MM-DD.jsonl`(按天切) |
| Session transcript | 同主日志 jsonl | `messages/<sid[:8]>/` | 保留 `sessions/<sid>.jsonl`,**同时**写一份 `logs/transcript/<sid>.jsonl` |
| Subagent | `subagents/agent-<id>.{jsonl,meta.json}` | 共享 slog | `logs/transcript/<sid>/subagents/agent-<id>.{jsonl,meta.json}`(借自 Claude Code) |
| 时间分解 | 5 段时间(preHook/permission/tool/postHook/total) | slog 简单 level | 5 段时间(preHookMs / permissionMs / toolMs / postHookMs / totalMs) |
| CLI flag 调试 | `--verbose`(同源 stdout 同步) | `-d` + `OPENCODE_DEV_DEBUG` 分离 | `--debug` 启用 debug 落盘;env `WASTELAND_LOG_LEVEL/DIR/REDACT` 控制行为 |
| Schema 演进 | 不稳定(schema breaking) | 稳定 | `version: 1` 字段 + semver 承诺 |
| 轮转/TTL | 无(wasteland 重点改进) | 无 | size + age 双轴 + 7 天 gzip |
| Redaction | 完全明文 | 无 | denylist 强制 on(env 可关但 warn) |
| Disk bug 教训 | 4 writer 域无锁 0.21% 损坏 | 单 slog 共享 | 单写入域 + mutex(吸取教训) |
| 字段命名 | snake_case(`sessionId, parentUuid`) | 内部 attrs | snake_case,字段名尽量与 Claude Code 对齐 |

> 该矩阵写入 `docs/architecture/logging.md` 的开篇。

### Research References

- [`research/opencode-logging.md`](research/opencode-logging.md) — **一句话**:opencode 三层:slog→io.Writer→pubsub.Broker(默认无文件)+ `OPENCODE_DEV_DEBUG=true` 时切到 `debug.log` + `messages/<sid[:8]>/<seq>_{request,response_stream,response,tool_results}`,session 父子关系走 SQLite 而非文件层级,**完全无轮转/TTL**(反面教材)。
- [`research/claude-code-logging.md`](research/claude-code-logging.md) — **一句话**:Claude Code 主日志 = `~/.claude/projects/<encoded-cwd>/<sid>.jsonl`(append-only JSONL,type 至少 12 种,字段 uuid+parentUuid+cwd+sessionId+usage),`--verbose` 与 transcript 同源仅多 stdout sink,subagent 配 `subagents/agent-<id>.{jsonl,meta.json}` 配对并以 `isSidechain:true` 标记,telemetry 旁路 `1p_failed_events.<sid>.<rand>.json` 含 27 类 `tengu_*` 事件附 base64 additional_metadata,4 个 writer 域无锁导致 0.21% 损坏率(issue #81843),13MB/天无轮转(issue #81065)。

### Research Notes

#### What similar tools do

**opencode**

- 三层 sink:运行时 slog(默认 broker)+ session transcript(默认不写)+ SQLite(主事实)。
- `--debug` 与 `OPENCODE_DEV_DEBUG=true` **分离**:前者只升 level,后者才落盘;这种"level 升降 ≠ 持久化"的设计是有意为之。
- `io.Writer → pubsub.Broker` adapter 把 logger 解耦到单一 RxJS-like 总线,TUI logs page 是订阅者。
- panic/critical 写在 cwd(`opencode-panic-<name>-<ts>.log`),与 data dir 无关——**反面教材**:磁盘权限/临时目录易踩坑。
- 完全没有轮转/TTL/TLG——README 也没说——全权交运维。

**Claude Code**

- 四路独立 sink:transcript(主)+ telemetry(tengu_* 1P 旁路)+ daemon.log(系统进程)+ in-process ephemeral state(jobs/teams/roster)。
- session transcript 是 append-only JSONL,**schema 官方不承诺稳定**(issue #53516 long-open)。
- subagent 文件与父 session 同目录,通过 `isSidechain:true` + `promptId` 反查父 tool_use 链路。
- `tengu_tool_use_success` 携带 5 段时间(preHookMs / permissionMs / toolMs / postHookMs / totalMs)+ 资源 delta(rss/heap bytes),是端到端 latency 分解的标准件。
- file-history `<8-char-hash>@v<n>` 提供任意时刻 rollback 能力。
- **反例**:4 个 writer 域无锁,实测 0.21% jsonl 损坏(issue #81843);13MB/天无压缩无 TTL(issue #81065);resume 跨 sid 旋转可能冻 jsonl(issue #78159 / #80654)。

#### Constraints from our repo/project

- ESM + Node 20+,import 必须带 `.js`。
- 现有 RxJS 风格(`runAgentLoop({ input$ }) -> { events$, debug$ }`)——新 logging 必须能挂上同一总线。
- 现有 `SessionRecord` 6 种 discriminated union 是 `wasteland resume <id>` 的契约级事实源,不能修改。
- core 不依赖具体 UI,新 logger 必须能同时给 TUI / CLI / 测试夹具订阅。
- CI 闸门:`npm run check`(typecheck + lint + i18n + locale-parity + contrast + vitest)全绿。
- 当前依赖最小化(7 项),MVP 应避免引入 winston/pino 这类重型 logger。
- 敏感字段:`ChatInputTurn.content`、`tool_result.output`、`tool_call.input` 等都可能裸跑 API key,需 sink 层 redaction。

#### Feasible approaches here

**Approach A: 自写轻量 Logger + RxJS Subject + FileSink/MemorySink(推荐)**

- 不引入第三方 logger。
- 新增 `src/core/logger/` 子系统:
  - `LogEntry = { timestamp, level, scope, sessionId, turn?, step?, message, data?, error? }`,level ∈ debug/info/warn/error,scope ∈ session/turn/provider/tool/ui/skill/permission/mcp/a2a/file。
  - `Logger.debug/info/warn/error({ ... })`,内部过 scope/level 过滤后发到 Subject。
  - `LogBus: Subject<LogEntry>`,UI/File/测试任意订阅。
  - `FileSink`:JSONL append,size-based 轮转(默认 10MB × 5 份)+ age(默认 7 天压缩 gzip)+ redaction denylist。
  - `MemorySink`:测试断言用。
  - `TuiSink`(P2):订阅 → TUI debug 面板渲染。
- 现有 `debugLog()` 改造:内部转 `Logger.debug(...)` 一行包装,保留 `enableDebugLog()` 语义。
- `.wasteland/logs/` 目录:`runtime-YYYY-MM-DD.jsonl`(info+)+ `error.jsonl`(warn/error 必落盘)+ `transcript/<sid>.jsonl`(来自 SessionManager,不动)。
- MCP/A2A/file-audit:在 `mcp-transport` / `a2a-*` / `file-audit` 调用点插 `Logger.info({ scope: ... })`。
- env:`WASTELAND_LOG_LEVEL`(默认 info)、`WASTELAND_LOG_DIR`(默认 `.wasteland/logs`)、`WASTELAND_LOG_REDACT`(默认 true)。
- 优:零依赖、贴合 rxjs 风格、改动局部、测试好写(MemorySink)。
- 缺:高级能力(OTLP/远程)要自己加,但 P2 不阻塞 MVP。

**Approach B: 多 sink 矩阵 + Transcript Side-Channel(借鉴 opencode)**

- 在 Approach A 的基础上,把 transcript 写成独立 sink,与 runtime log 文件物理隔离(像 opencode 的 `messages/` 与 `debug.log`)。
- transcript sink:与 SessionManager 平级,直接写 `<YAML/logs/transcript/<sid>.jsonl>`,结构与 SessionRecord 一致。
- runtime log sink:写 `runtime-YYYY-MM-DD.jsonl`。
- 优:职责更清,UI 调试用 runtime.log,session 复盘用 transcript.jsonl——两个文件独立轮转、独立保留、独立 redaction 策略。
- 缺:实现稍复杂,需修 SessionManager 输出(或不修——保留现状,只新增 runtime 层)。

**Approach C: 引入 pino/wiston 等成熟 logger**

- 用 pino(轻量、JSON 原生、子 logger、routing 插件齐全)。
- 替换所有 `console.* / debugLog` 为 `pino().child({ component: 'agent-loop' })`。
- `pino/pino-rotate-file` 接轮转。
- 优:生态完整、bug 少、性能已知。
- 缺:引入约 200kb 依赖、破坏 rxjs 风格统一、第三方库变更难控、未来订阅 UI 测试夹具要绕一层。

## Decision Log (ADR-lite)

### ADR-1 — MVP 覆盖范围

- **Date**: 2026-07-29
- **Context**: wasteland 当前 logging 覆盖盲区大(MCP/A2A/file-audit 完全不在日志系统内),是否纳入 MVP 需要在工期/复杂度/价值间平衡。
- **Decision**: 全量纳入(MCP + A2A + file-audit + 现有 internal runtime)。对应 Step 5 选项 D。
- **Consequences**:
  - (+) 一次解决"日志盲区",避免分批交付时反复迁移调用点。
  - (+) 子 agent + 外部协议 + 文件审计三块共用同一 `Logger.info({ scope })`,UI/调试/取证统一入口。
  - (-) 改动面比只覆盖 internal runtime 大,但每个 scope 都是单点插入,review 可控。

### ADR-2 — 实施路径:自写轻量 Logger

- **Date**: 2026-07-29
- **Context**: 在 3 个候选方案(A 自写 / B transcript 物理隔离 / C pino)中做选择。wasteland 依赖最小化、rxjs 风格统一。
- **Decision**: 选 A 自写轻量 `Logger + RxJS Subject + FileSink/MemorySink`,以最少的依赖和最贴合现有 rxjs 总线的方式落地。transcript 文件保持 SessionManager 现状不动,新 logger 只覆盖 runtime 日志层。
- **Consequences**:
  - (+) 零依赖,贴合 RxJS 风格,UI/测试夹具直接订阅 `LogBus`,复用现有 debug$ 路径。
  - (+) 改动局部:`src/core/logger/` 新增目录,`debugLog()` 改薄包装,MCP/A2A/file-audit 各加 1-3 个 `Logger.info({ scope })`。
  - (-) Transcript 文件与 runtime log 文件在同一 `.wasteland/` 下但路径不冲突——跨文件联合分析(resume + debug)要 join `sessionId`。
  - (-) 未来 OTLP/远程 sink 需要自己扩,但不阻塞 MVP。

### ADR-3 — 轮转策略

- **Date**: 2026-07-29
- **Context**: opencode 与 Claude Code 都缺轮转,导致磁盘增长无界(wasteland 已经 104KB debug.log 累计)。
- **Decision**: FileSink 默认按 size 轮转(10MB × 5 份)+ 7 天 gzip 归档。可被 `WASTELAND_LOG_ROTATE` env 关闭以保持向后兼容。
- **Consequences**:
  - (+) 避免 Claude Code 式 13MB/天增长失控。
  - (-) 但要在 FileSink 内追加压缩/老化逻辑,测试覆盖更密。

### ADR-4 — Redaction 强制开启

- **Date**: 2026-07-29
- **Context**: Claude Code transcript 完全明文,`pastedContents`、hook 输出都裸跑;wasteland 也存在 `ChatInputTurn.content`、`tool_result.output` 暴露 API key 的风险。
- **Decision**: `WASTELAND_LOG_REDACT=true` 默认值,denylist 正则覆盖 `Authorization`、`Bearer`、`*_API_KEY`、`sk-...`、`xoxb-...` 等高敏感模式。redaction 在 sink 层强制执行,**不可被 DEBUG 关掉**——只有显式 `WASTELAND_LOG_REDACT=false` 才能关闭,且 README + 日志必写一条 warn。
- **Consequences**:
  - (+) 避免无意泄漏 API key。
  - (-) 罕见场景下误伤(用户故意测试 denylist 模式)——可用 env 关闭但有 audit 警告。

### ADR-5 — 对齐主流 agent(2026-07-29 用户要求)

- **Context**:用户在二次明确阶段补了"交互上需要和主流 agent 对齐"的诉求。
- **Decision**:字段命名、路径、subagent 配对、5 段时间分解、`last-prompt` cursor、version:1 schema 都对齐 Claude Code transcript,以最小化"用户从 Claude Code 切换到 wasteland 的认知负担"。`.wasteland/logs/` 路径约定贴近 `~/.claude/` 范式。
- **Consequences**:
  - (+) wasteland 日志文件可被 `claude-dev.tools` 类工具间接消费;`wasteland logs` 与 `claude-code-log` 等工具语义对齐。
  - (+) `wasteland logs errors` 体验贴近 `journalctl -p err`,Linux 用户零迁移成本。
  - (-) 锁字段名后,Claude Code 后续若改 transcript schema,wasteland 要保持兼容(`version: 1` 字段可演进)。

### ADR-6 — TUI 日志查看:L2 Dedicated Logs Page(2026-07-29)

- **Context**:用户问"主流 agent 在 TUI 上怎么看日志"后三个候选:
  - L0 REPL-style echo 到对话区(简单但刷屏)
  - L1 Drawer/Sidebar(中,IDE 风)
  - L2 Dedicated Logs page(opencode / lazygit / k9s 风,table + detail)
- **Decision**:L2 Dedicated Logs page,顶层 tab 导航(`T` 键切换 page,值域 `chat | sessions | logs`),与 opencode `internal/tui/components/logs/` 一致。`/logs` 系列本地命令作为 page 切换/过滤的快捷入口,不与 skill 协议耦合。
- **Consequences**:
  - (+) 与 wasteland 现有多 page 架构兼容(`SessionIndexPage.tsx` 已存在),增加 Logs page 是同模式增量。
  - (+) 实时跟踪 + level/scope 过滤 + 选中行 detail 展开,排查问题最直接。
  - (+) `/logs` 命令只是 page 切换的快捷入口,不与 skill 协议耦合。
  - (-) 需要扩顶层 `App.tsx` 状态机加 page 路由,改动面比 L1 大。
  - (-) PR4 工期从半天 → 1-2 天;MVP 总工期从 3 天 → 4-5 天。
