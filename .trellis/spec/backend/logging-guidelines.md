# Logging Conventions / 日志规约

> **Status**: established (PR1-4 + fix 已 commit, 2026-07-30)
> **Module**: `src/core/logger/` + TUI LogsPage + `wasteland logs` CLI
> **Owner**: backend logger subsystem

---

## §1 Module Structure / 模块结构

`src/core/logger/` 8 个文件,单职责:

| 文件 | 职责 | 关键 export |
|---|---|---|
| `types.ts` | 字面量联合 + 类型 + Zod 兜底 | `LogLevel`, `LogScope`, `LogEntry`, `LogUsage`, `LogTimings`, `LogError`, `logEntrySchema` |
| `log-bus.ts` | RxJS Subject 多 sink 广播 + 独立过滤 | `LogBus` |
| `memory-sink.ts` | 测试用数组缓冲(实现 `LogSink` interface) | `MemorySink`, `LogSink` |
| `file-sink.ts` | JSONL append + size/age 轮转 + redaction | `FileSink`, `FileSinkOptions` |
| `logger.ts` | 静态 façade,自动注入 version+timestamp | `Logger`(static) |
| `redactor.ts` | 8 类 denylist 正则(不可关闭) | `RedactionRule`, `defaultRedactionRules`, `redactString`, `redactObject` |
| `rotation.ts` | size rotate + gzip 归档 | `RotatePolicy`, `rotateIfNeeded`, `gzipIfStale` |
| `index.ts` | barrel 导出 | (无) |

**依赖方向**: `types ← log-bus/memory-sink/file-sink/logger/redactor/rotation`;`logger → log-bus`(注入 bus);`file-sink → redactor/rotation`。

---

## §2 LogEntry Contract / LogEntry 契约

### Signatures

```ts
// src/core/logger/types.ts:146
export type LogEntry = {
  version: 1;
  timestamp: string;        // ISO8601 UTC ms 'YYYY-MM-DDTHH:mm:ss.sssZ'
  level: LogLevel;
  scope: LogScope;
  sessionId: string;
  turn?: number;
  step?: number;
  message: string;          // 单行,\n → \\n
  data?: Record<string, unknown>;
  error?: { name: string; message: string; top_frame?: string; stack?: string };
};

// 借自 Claude Code transcript;放 data.usage
export type LogUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

// 借自 Claude Code tengu_tool_use_success;放 data.timings
export type LogTimings = {
  preHookMs: number;
  permissionMs: number;
  toolMs: number;
  postHookMs: number;
  totalMs: number;
};
```

### Contracts

- **顶层字段顺序固定**: `version, timestamp, level, scope, sessionId, turn?, step?, message, data?, error?`
- **字段命名**: snake_case(`sessionId` 例外,沿用 codebase camelCase 约定);`top_frame`, `input_tokens` 等
- **version 字段承诺 semver 演进**, 避免 Claude Code #53516 那种 schema breaking 痛苦
- **自由扩展字段走 `data.*`**: `usage` → `data.usage`,`timings` → `data.timings`, `command` → `data.command`, etc.
- **message 单行强制**: `\n` 已在 `Logger.finalizeEntry` 转义为 `\\n`

### Validation

所有 entry 落盘前**必须**经 `logEntrySchema.safeParse()` 校验(types.ts:178-207)。校验失败 FileSink 静默丢弃,不阻塞主流程。

---

## §3 Scope Usage / Scope 使用约定

10 种 scope(`types.ts:57`)与典型调用方:

| Scope | 典型调用方 |
|---|---|
| `session` | session-manager, agent-loop |
| `turn` | agent-loop(turn.input/output) |
| `provider` | agent-loop(provider.chunk) |
| `tool` | tool-dispatch(完成事件), spawn-agent/index |
| `ui` | TUI 渲染相关 |
| `skill` | skill-executor, skin-occupancy |
| `permission` | permission-gate |
| `mcp` | mcp-transport(收发), mcp-registry |
| `a2a` | a2a-client(进出), a2a-webhook, a2a-claude-code-adapter |
| `file` | file-audit(读/编辑决策) |

### 新增 scope **必须三处同步**

1. `LogScope` union(`types.ts:57`)
2. Zod enum(`types.ts:182`)
3. 调用点的 emission 代码

---

## §4 FileSink Contract / FileSink 契约

### Signatures

```ts
// src/core/logger/file-sink.ts
export type FileSinkOptions = {
  dir: string;
  dailyPrefix?: string;     // 默认 'runtime'
  errorFilename?: string;   // 默认 'error.jsonl'
  policy?: RotatePolicy;
  redactionRules?: readonly RedactionRule[];
};

export class FileSink implements LogSink {
  constructor(opts: FileSinkOptions);
  write(entry: LogEntry): void;
  flush(): Promise<void>;
  close(): Promise<void>;
  listFiles(): Promise<string[]>;
}
```

### Contracts

- **主路径**: `<dir>/runtime-YYYY-MM-DD.jsonl`(UTC 日切)
- **错误独立流**: `<dir>/error.jsonl`(warn/error 必落盘,即使 `WASTELAND_DEBUG=false`)
- **写入规则**:
  - `level ∈ {warn, error}` → **双写** runtime + error
  - `level ∈ {debug, info}` → 只写 runtime
- **字段顺序固定**: `orderKeys()`(file-sink.ts:79) 保顶层字段顺序,grep/jq 切窗稳定
- **串行化**: `queueChain`(file-sink.ts `runPipeline`)避免 `currentSize` 竞态

### Rotation 默认

| 参数 | 默认 | 来源 |
|---|---|---|
| `maxSizeBytes` | 10485760 (10MB) | `src/core/runtime/debug-logger.ts` |
| `maxFiles` | 5 (含当前) | 同上 |
| `maxAgeDays` | 7 | 同上 |

- **size 触发**: `rotateIfNeeded(file, upcomingBytes, policy)`(rotation.ts)
- **gzip 归档**: **`maybeGzip()` 在 file-sink 内 today-flag 控制**, 只在跨天首次 write 时触发一次,避免每 write stat syscall。这是 fix PR 修的关键 bug(早期 fire-and-forget stat 在高频 write 把 CPU 吃满)

---

## §5 Redaction Contract / 脱敏契约

### 8 条 denylist(`src/core/logger/redactor.ts:58`)

1. `auth-header` — `Authorization: ...`
2. `bearer-token` — `Bearer <token>`
3. `env-api-key` — `<ENV>_API_KEY=...`
4. `openai-sk` — `sk-...`
5. `slack-xoxb` — `xoxb-...`
6. `github-pat` — `ghp_...`
7. `jwt-like` — 3-segment JWT
8. `pem-private-key` — `-----BEGIN ... PRIVATE KEY-----` blocks

### Contracts

- **不可关闭**: `redactObject`/`redactString` 没有 `enabled: false` 参数(ADR-4)
- FileSink 在 write 前对 `entry.data` 字段深拷贝 + redact(orig 对象不变)
- 替换格式: `[redacted:<rule-name>]<masked>`,便于审计哪条规则命中
- env `WASTELAND_LOG_REDACT`: 实际无效(模块级不可关);保留以对齐 PRD 语义
- **禁止**直接调 `appendFileSync` 绕过 FileSink — 失去 redact/rotation/orderKeys 保障

---

## §6 LogBus Contract / 日志总线契约

### Signatures

```ts
// src/core/logger/log-bus.ts
export class LogBus {
  subscribe(sink: LogSink, opts?: SubscribeOptions): () => void;
  publish(entry: LogEntry): void;
  asObservable(): Observable<LogEntry>;
  subscriberCount(): number;
  shutdown(): void;
}

export type SubscribeOptions = {
  minLevel?: LogLevel;
  scopes?: ReadonlySet<LogScope>;
};
```

### Contracts

- 内部用 RxJS `Subject<LogEntry>`
- 同步消费: `subscribe()` 时 `subject.subscribe((entry) => { if filter → sink.write(entry) })`
- **level 过滤**: `LOG_LEVEL_RANK[entry.level] >= sub.minLevelRank` 才投递
- **scope 过滤**: `scopes` 非空时 `entry.scope ∈ scopes` 才投递
- **异常隔离**: 单个 sink 抛错不影响其它(log-bus.ts:97 静默 try/catch)
- **backpressure**: MVP 不做,Subject 默认缓冲 + 异步;P2 候选用 ReplaySubject + bounded buffer

---

## §7 Logger Facade Contract / Logger 静态外壳契约

### Signatures

```ts
// src/core/logger/logger.ts
export class Logger {
  static setBus(bus: LogBus): void;
  static setLevel(level: LogLevel): void;
  static setEnv(env: {
    level?: LogLevel;
    redact?: boolean;
    dir?: string;
    tailLines?: number;
  }): void;

  static debug(entry: Omit<LogEntry, 'version' | 'timestamp' | 'level'> & { sessionId: string }): void;
  static info(...): void;
  static warn(...): void;
  static error(...): void;
}
```

### Contracts

- **自动注入**: `version: 1`, `timestamp: new Date().toISOString()`(logger.ts `finalizeEntry`)
- **message 转义**: `\n` → `\\n`, 保证 JSONL 单行
- **Error 实例规范化**: `{ name, message, top_frame, stack }`, `top_frame` 取 stack 首行(借自 Claude Code tengu_tool_use_error.error_top_frame)
- **默认 no-op**: 未 `setBus` 时 publish 走默认 Subject 但没人订阅
- **level gate**: `setLevel('info')` 后 debug 调用 no-op;`setLevel('error')` 后 info/warn 静默

---

## §8 Env Contract / 环境变量契约

| env | 默认 | 来源 / 行为 |
|---|---|---|
| `WASTELAND_LOG_LEVEL` | `info` | `src/config/load-settings.ts:833` |
| `WASTELAND_LOG_DIR` | `.wasteland/logs` | `src/config/load-settings.ts` |
| `WASTELAND_LOG_REDACT` | `true`(无效) | `src/config/load-settings.ts` |
| `WASTELAND_LOG_TAIL_LINES` | `50` | `src/config/load-settings.ts` |
| `WASTELAND_DEBUG=1` | alias 到 `WASTELAND_LOG_LEVEL=debug` | `src/config/load-settings.ts:775` |
| `JOE_DEBUG=1` | 旧 compat alias → `WASTELAND_DEBUG` | `src/config/load-settings.ts:775` |

### Validation 规则

- `WASTELAND_LOG_LEVEL` ∈ `{debug, info, warn, error}`, 否则 default `info`
- `WASTELAND_LOG_DIR` 绝对/相对都行,不创建直到 file sink 第一次 write
- 整数 env 用 `parseInt` + fallback 默认

---

## §9 Mandatory Wire-Up / 强制 wire-up

**任何 CLI 子命令入口启动后必须**(在解析 message 之前):

```ts
import { initializeFileSinkFromEnv, enableDebugLog } from '../core/runtime/debug-logger.js';

initializeFileSinkFromEnv({ cwd: process.cwd(), env: process.env });
if (settings.runtime.debug || env.WASTELAND_DEBUG === '1') {
  enableDebugLog();
}
```

### 已 wire-up 的入口

- `src/commands/chat.ts`(fix 期间加)
- `src/commands/resume.ts`(fix 期间加)
- `src/tui/hooks/useRuntime.ts`(PR3 加)

### 反模式

**禁止**在没调 `initializeFileSinkFromEnv` 的路径直接 `Logger.debug()` 然后期望写入落盘。

---

## §10 Tool Timing Contract / 工具耗时契约

### 5 段字段固定

```
preHookMs      — preDispatchHook 阶段
permissionMs   — permission-gate 判定
toolMs         — 工具主体执行
postHookMs     — postDispatchHook 阶段
totalMs        — 端到端总耗时(>= toolMs)
```

### Contracts

- 调用点: `src/core/runtime/tool-dispatch.ts` 在 dispatch 完成时 `Logger.debug({ scope: 'tool', data: { timings: ... } })`
- **全部 numeric 且 `totalMs >= toolMs`**
- **失败 dispatch 也 emit timings**,便于排查慢工具(测试覆盖 `tool-dispatch.test.ts:失败 timing emit`)
- 5 段时间来自四个边界的闭包变量追踪(`preHookStartMs` / `permissionStartMs` / `toolStartMs`)

---

## §11 Subagent Sidecar Contract / 子 agent 旁路契约

### 路径

```
<dir>/transcript/<parentSid>/subagents/agent-<childId>.jsonl
<dir>/transcript/<parentSid>/subagents/agent-<childId>.meta.json
```

### `meta.json` 字段

```jsonc
{
  "agentType": "researcher|developer|analyst|tester|custom",
  "description": "<task description>",
  "toolUseId": "<父 transcript 的 tool_use.id>",
  "spawnDepth": 1,
  "createdAt": "<ISO8601 ms>",
  "childSessionId": "<sid>"
}
```

### JSONL 标识

`isSidechain: true` 标识子树(借自 Claude Code transcript 字段名)。

### 调用点

`src/tools/spawn-agent/index.ts:writeSubagentSidecar()` 在 spawn 完成时调。失败容错(spawn 主流程不因 sidecar 失败而中断)。

### 限制

- **完整 transcript 复制到 sidecar 留 P2**(scope 限定)
- 当前仅写 meta + skeleton jsonl,实际 transcript 仍走 SessionManager

---

## §12 TUI LogsPage Contract / TUI Logs 页契约

### Top-level page routing

- `PageName` ∈ `'chat' | 'sessions' | 'logs'`(`src/tui/context/AppContext.tsx`)
- **T 键循环切换**(`src/tui/App.tsx:298-302`)
- LogsPage 渲染条件: `currentPage === 'logs'`(`src/tui/App.tsx:359`)

### 表格列固定(7 列)

```
time | level | scope | sessionId | turn | step | message
```

(LogsPage.tsx:316-336)

### 3 filters

- `level`(debug/info/warn/error, **L 键循环**)
- `scope`(`*` / `tool` / `permission` / ..., **S 键循环**)
- `sessionId`(**`/` 键**进入 text input,**Enter 应用,Esc 取消**)

### 8 键位

| 键 | 行为 |
|---|---|
| `↑↓` | 选中行 |
| `Enter` | 展开 detail |
| `P` | 暂停/恢复 follow |
| `L` | level filter 循环 |
| `S` | scope filter 循环 |
| `/` | sessionId 输入 |
| `Esc` | close panel |
| (follow) | 自动追加最新 entry |

### `/logs` 本地命令(7 子命令 + 3 alias)

实装: `src/tui/route-logs-command.ts`, 21 unit tests 覆盖。

- `/logs`、`/log`、`/debug`(3 alias)— 切到 logs page
- `/logs close` — 切回 chat
- `/logs errors` — level=error 切到 logs
- `/logs show <sid>` — sessionId 过滤
- `/logs level <l>` — 仅改 filter level
- `/logs scope <s>` — 仅改 filter scope(逗号分隔多值)
- `/logs help` — echo 子命令列表(i18n `skills.logsHelp.title` / `helpText`)

### 反模式

- **禁止**把这些加到 skill registry(`/logs` 是本地命令,不走 skill system)
- **禁止**用 console.* 替代 LogsPage 渲染(Ink 风格保持)

---

## §13 CLI `wasteland logs` Contract / CLI 日志子命令契约

### 3 子命令

| 子命令 | flags | 行为 |
|---|---|---|
| `logs errors` | `--tail N`(默认 20), `--dir` | tail `error.jsonl` N 行 |
| `logs show <sid>` | `--tail N`, `--dir` | 全 dir sessionId 过滤 + timestamp 升序合并 |
| `logs tail` | `--level`, `--scope`, `--tail N`(默认 50), `--follow`, `--dir` | follow 今天 `runtime-YYYY-MM-DD.jsonl` |

### 5 列固定输出

```
TIME | LEVEL | SCOPE | SESSIONID | MESSAGE
```

### 字段校验

`parseLogLine()`(`src/commands/logs.ts:101`)严格校验 4 关键字段:
- `sessionId`(string, 非空)
- `level`(枚举)
- `scope`(枚举)
- `timestamp`(ISO8601)

缺任一字段 → skip 该行。

### `--follow` 实现

- `fs.watch(file)` + 自维护 `lastSize` 游标
- file 不存在时降级 `Waiting for ...` 输出
- truncate 后写自动重置 0
- AbortSignal 支持(测试可手动终止)

### 反模式

- **禁止**重复实现 `FileSink.listFiles()`(logs.ts 内部 `listLogFiles` 是 `readdir`+regex 直实现,因需要绝对路径;若要复用,extract shared helper,见 §17)

---

## §14 Cross-File Join Contract / 跨工件 join 契约

### SessionRecord vs LogEntry

| 维度 | SessionRecord | LogEntry |
|---|---|---|
| 文件路径 | `.wasteland/sessions/<sid>.jsonl` | `.wasteland/logs/runtime-YYYY-MM-DD.jsonl` |
| 用途 | resume / sessions 命令的事实契约 | 运行时日志(排查 / 审计) |
| 字段 | session / message / tool_call / permission / tool_result / session_end | version / timestamp / level / scope / sessionId / ... |
| 可改 | **不可改**(resume 协议级契约) | 可改(semver 版本化) |

### Join 方式(通过 sessionId)

```bash
# 某 session 在 runtime log 中的全链路事件
sessionId='xxx'
grep "\"sessionId\":\"$sessionId\"" .wasteland/logs/*.jsonl

# 仅 error
jq --arg sid "$sessionId" 'select(.sessionId == $sid and .level == "error")' \
  .wasteland/logs/runtime-*.jsonl error.jsonl
```

也可用 `wasteland logs show <sid>` 直接获得。

---

## §15 Anti-Patterns / 反模式

### Don't: 新增 scope 不更新 types.ts

```ts
// BAD: 直接传字符串, 不在 LogScope union 内
Logger.info({ sessionId, scope: 'myNewScope', ... });  // TS error, runtime 校验失败
```

```ts
// GOOD: 三处同步
// 1) types.ts:57 LogScope union 加 'myNewScope'
// 2) types.ts:182 zod enum 加 'myNewScope'
// 3) caller 增加 Logger 调用
```

### Don't: 关闭 redact

```ts
// BAD: 不存在 enabled: false
const rules = enabled ? defaultRedactionRules() : [];

// GOOD: redaction 永远 on
const rules = defaultRedactionRules();
```

### Don't: 直接写文件绕过 FileSink

```ts
// BAD
appendFileSync(`${dir}/foo.jsonl`, JSON.stringify(entry));

// GOOD
fileSink.write(entry);  // 自动获得 redact/rotation/orderKeys 保障
```

### Don't: 每 write 都触发 gzip

```ts
// BAD
async write(entry) {
  await gzipIfStale(file);  // 高频 write 浪费 CPU
  await this.appendLine(file, entry);
}

// GOOD: maybeGzip 用 lastGzipCheckDay flag 一次性触发
async write(entry) {
  await this.maybeGzip();  // 跨天首次才触发
  await this.appendLine(file, entry);
}
```

### Don't: 把 /logs 加到 skill registry

```ts
// BAD: 把 /logs 当 skill,在 default-skills.ts 注册
// GOOD: /logs 是 TUI 本地命令,在 ChatInputBar.tsx onSubmit 里分发
```

---

## §16 Common Mistakes / 常见错误

### 错: CLI 漏调 initializeFileSinkFromEnv

**Symptom**: `wasteland chat --debug` 时, debug 日志只 echo 到 stderr, 看不到 `.wasteland/logs/runtime-*.jsonl`。

**Cause**: CLI 入口没调 `initializeFileSinkFromEnv`。

**Fix**: §9 强制 wire-up。

**Prevention**: 新增 CLI 子命令时, 复制 chat.ts / resume.ts 的 wire-up 模板。

### 错: redact 仍含 API key

**Symptom**: `data.command` 含 `sk-...`, 但落盘文件中可看到原文。

**Cause**: 调用方没在 data 写入前调 `redactObject`,或 binary 数据进了 data 字段。

**Fix**: 写入前用 `redactObject(data)` 深拷贝处理(string 才递归);避免 binary 进入 data。

### 错: gzip 跑得太频繁

**Symptom**: 高频 write 时, `stat` syscall 把 CPU 吃满。

**Cause**: 早期实现每次 write 都 fire-and-forget `gzipIfStale`。

**Fix**: 用 `lastGzipCheckDay` flag 一次性触发(§4)。

### 错: LogTimings 字段全 0

**Symptom**: `data.timings` 出现但全是 0。

**Cause**: tool-dispatch.ts 没在每个边界(capture preHook/permission/tool/postHook)记录时间戳。

**Fix**: 严格按 §10 的 4 个边界闭包变量追踪,不要事后估算。

---

## §17 Tests Required / 测试覆盖要求

### 已存在的关键测试

| 文件 | 用例数 | 覆盖 |
|---|---|---|
| `src/core/logger/__tests__/logger.test.ts` | 24 | LogBus / Logger / MemorySink |
| `src/core/logger/__tests__/file-sink.test.ts` | 17 | redactor / FileSink 基础 / 轮转 / gzip |
| `src/core/runtime/__tests__/debug-logger.test.ts` | 14 | debug-logger 兼容 / env 注入 |
| `src/core/runtime/__tests__/file-audit.test.ts` | 4 | file scope logging |
| `src/tui/route-logs-command.test.ts` | 21 | 7 子命令 + 3 alias + 错误路径 |
| `src/commands/__tests__/logs.test.ts` | 33 | CLI 子命令 + JSONL 解析 + filter |
| `src/core/runtime/__tests__/tool-dispatch.test.ts` | 3 | 5 段时间 timings |
| `src/tools/spawn-agent/sidecar.test.ts` | 2 | meta.json + skeleton jsonl |

总计 **118 logger-related tests**, `npm test` 593 tests / 59 files pass。

### 新增 / 修改 coverage 要求

- 新增 scope → 至少 1 个 caller test 覆盖 emission
- 修改 FileSink 行为 → 同步 file-sink.test.ts
- 修改 redaction denylist → 同步 redactor 测试覆盖新增 pattern
- 修改 /logs 子命令 → 同步 route-logs-command.test.ts

---

## §18 References / 参考

- **PRD**: `.trellis/tasks/07-29-design-logging-system/prd.md`(完整需求 + ADR-1~6)
- **架构文档**: `docs/architecture/logging.md`(10 节用户级文档)
- **研究**: `.trellis/tasks/07-29-design-logging-system/research/opencode-logging.md` + `claude-code-logging.md`
- **Module**: `src/core/logger/`
- **Tests**: `src/core/logger/__tests__/`

---

## §19 ADR-lite / 关键决策

| ADR | 决策 | 落地 |
|---|---|---|
| **ADR-1** | MVP 覆盖范围 = 全量(MCP + A2A + file-audit + internal) | scope 联合 10 个 |
| **ADR-2** | 自写轻量 Logger(RxJS Subject + FileSink/MemorySink),不引入 winston/pino | `src/core/logger/` |
| **ADR-3** | Rotation: 10MB × 5 + 7 天 gzip | `FileSinkOptions.policy` 默认 |
| **ADR-4** | Redaction 强制 on,不可关闭 | redactor.ts 没有 `enabled` 参数 |
| **ADR-5** | 字段命名对齐 Claude Code transcript | `LogEntry`, `LogUsage`, `LogTimings` |
| **ADR-6** | TUI L2 Dedicated Logs Page | `src/tui/components/LogsPage.tsx` |

---

## §20 TUI 查问题体验约定（2026-09 batch）

### Signatures

```ts
// logs-page-utils.ts
cardKeyFor(entry: LogEntry, ordinal: number): string;
// seq 优先（全局唯一），无 seq 用 timestamp + 同毫秒序号兜底。
getErrorContextWindowAt(entries: LogEntry[], idx: number, radius?: number): ErrorContextWindow | null;
// 按下标取上下文（同毫秒多条精确定位）；getErrorContextWindow 保留为 timestamp 兼容包装。
transcriptToLogEntries(records: SessionRecord[], sessionId: string): LogEntry[];
// transcript message → LogEntry（level info / scope turn / data.kind 'transcript'，仅 message 记录）。

// file-log-loader.ts
MAX_ROTATED_ARCHIVES = 4;
// loadSessionEntries 合并 active + .1..N（数字越大越旧，与 rotation.ts 一致），
// 指纹为各文件 mtime:size 联合；单档损坏 allSettled 跳过该档（有失败不缓存）。
```

### Contracts

- **卡片键**：展开/上下文窗口/React key 一律用 `cardKeyFor`，禁止直接用 `timestamp`（同毫秒串台）。
- **session 列表 5s 轮询**（`SESSION_LIST_POLL_MS`）：指纹未变返回同一引用，setState 自动 bail out；长度变化时按 sessionId 找回选中（`selRef` + `pollKeepRef`），抑制回顶，不跟用户滚动打架。
- **对话合并视图**（T 键，默认关）：transcript 行无 seq，按时间与日志合并排序；走同一过滤/导出管线；`data.kind='transcript'` 供时间线聚合忽略。
- **跳转自动聚焦**：`sid` 过滤落地且该 session `hasError` 时自动开 errorFocus；Omnibox 提交即视为手动，后续不再自动开（`errorFocusTouchedRef`）。
- **Omnibox**：`sid:` 收窄后精确匹配直接选中跳转；未写 `level:` 不碰当前档位。
- **全局时间线渐进式**：逐 session 追加渲染 + `x/N` 进度，不再等 50 个全量读完。
