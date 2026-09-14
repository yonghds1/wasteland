# Runtime Contracts

> Current baseline / 当前基线：Phase 1 已经建立 `chat` 命令跨 `commands`、`config`、`runtime`、`providers`、`ui`、`session` 的最小可运行合同；Phase 2 补上了独立的工具生命周期合同；Phase 3 又把单步 reply loop 升级成多步 step loop，并新增独立的 debug trace 输出。

`docs/architecture/runtime-boundaries.md` 是人读的架构说明；本文件才是精确签名、字段合同和校验行为的规范真源。

## Scenario: Phase 1 chat runtime skeleton

### 1. Scope / Trigger

- Trigger: `chat` 已不再是单文件 demo，而是跨层运行时链路。
- Trigger: 当前实现已经引入共享事件类型、provider contract、统一配置加载、session transcript 和 session-dir 环境变量覆盖。
- Trigger: 这属于跨层 contract 变更，后续继续改 `chat` / runtime / provider 时必须按合同演进。

### 2. Signatures

- Runtime entry:

```ts
runAgentLoop(params: {
  input$: Observable<ChatInputTurn>;
  provider: AgentProvider;
  sessionManager: SessionManager;
  toolRegistry?: ToolRegistry;
  permissionGate?: PermissionGate;
  cwd: string;
  mode: RuntimeMode;
  maxStepsPerTurn?: number;
}): {
  events$: Observable<RuntimeEvent>;
  debug$: Observable<DebugTraceEvent>;
}
```

- Config entry:

```ts
loadRxcSettings(params?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<LoadedRxcSettings>

resolveChatRuntime(params: {
  settings: ResolvedRxcSettings;
  roleName?: string;
  providerName?: string;
}): ResolvedChatRuntime
```

- Provider contract:

```ts
type ProviderStepInput = {
  context: TurnContext;
  state: TurnState;
}

interface AgentProvider {
  readonly id: string;
  runStep(input: ProviderStepInput): Observable<ProviderStreamEvent>;
}
```

- Provider registry:

```ts
class ProviderRegistry {
  register(id: string, factory: ProviderFactory): void
  resolve(id: string, config?: ProviderSettings): AgentProvider
  list(): string[]
}

createDefaultProviderRegistry(): ProviderRegistry
```

- Session manager:

```ts
startSession(params: {
  cwd: string;
  mode: RuntimeMode;
  providerId: string;
}): Promise<SessionMetadata>

// Session ID format: <timestamp>_<shortId>
// Example: 2026-05-23T14-30-00_abc123
// timestamp: ISO format with : and . replaced by -
// shortId: first 6 chars of UUID

appendRecord(session: SessionMetadata, record: SessionRecord): Promise<void>
```

- Debug renderer:

```ts
type DebugFormat = "pretty" | "jsonl";

renderDebugTrace(
  events$: Observable<DebugTraceEvent>,
  params?: {
    output?: Writable;
    format?: DebugFormat;
    traceDir?: string;  // for JSONL file persistence
  },
): Promise<void>
```

- UI input helpers:

```ts
createSingleTurnInput(message: string, source: "message" | "stdin"): Observable<ChatInputTurn>
readPipedInput(stdin?: Readable): Promise<string | null>
createInteractiveTurnStream(...): InteractiveTurnStream
```

### 3. Contracts

- `ChatInputTurn`
  - `turn: number`
  - `content: string`
  - `source: "message" | "stdin" | "interactive"`

- `ProviderStreamEvent`
  - `assistant_chunk`
  - `tool_call`
  - `assistant_message`

- `RuntimeEvent`
  - chat 主链当前至少使用：
    - `session_started`
    - `user_turn`
    - `assistant_chunk`
    - `assistant_message`
    - `session_ended`
  - 工具相关事件已在代码中存在，另见 `tool-runtime-contracts.md`

- `DebugTraceEvent`
  - `timestamp`
  - `sessionId`
  - optional `turn`
  - optional `step`
  - `scope`
  - `phase`
  - optional `data`
  - emitted through `runAgentLoop(...).debug$`

- `SessionRecord`
  - `type: "session"`: session open metadata
  - `type: "message"`: user/assistant persisted message
  - `type: "session_end"`: session close marker
  - tool / permission 相关记录已在代码中存在，另见 `tool-runtime-contracts.md`

- Interactive local commands
  - `/help`
  - `/tools`
  - `/clear`
  - `/exit`
  - `/quit`
  - these are handled inside `createInteractiveTurnStream(...)`
  - they do not emit `ChatInputTurn`

- Configuration sources
  - project: `.rxc/settings.json`
  - project auth: `.rxc/auth.json`
  - user global: `~/.rxc/settings.json`
  - user global auth: `~/.rxc/auth.json`
  - env override root: `RXC_HOME`
  - settings precedence inside config loader:
    - CLI params
    - `RXC_*` process env
    - project `.rxc/settings.json`
    - user global `~/.rxc/settings.json`
    - built-in defaults
  - auth ref precedence:
    - process env with the same key
    - project `.rxc/auth.json`
    - user global `~/.rxc/auth.json`

- Generic auth refs
  - provider / model / role free-form fields may contain `{"$auth":"KEY_NAME"}`
  - loader resolves `$auth` refs before provider construction
  - resolved values must be non-empty strings

- Role/model config
  - `models.<modelId>` maps model aliases to `provider + model`
  - `roles.<roleId>` maps role aliases to `model` and optional `permissionMode`
  - `runtime.defaultRole` is used when `chat --role` is absent
  - `chat --role <name>` overrides `runtime.defaultRole`
  - role resolution may change:
    - provider id
    - provider config
    - default permission mode

- Session directory override
  - `RXC_SESSION_DIR`
  - optional
  - `RX_CLI_SESSION_DIR` remains as a legacy fallback alias
  - if both are absent, default to `.rxc/sessions/` under current working directory

- Chat debug surface
  - `chat --debug`
  - when enabled, pretty debug trace goes to `stderr`
  - normal assistant / tool output remains on `stdout`
  - `chat --debug --debug-format jsonl`
  - JSONL format outputs to both `stderr` and file `.rxc/traces/<sessionId>.jsonl`
  - each JSONL line is a serialized `DebugTraceEvent`
  - `--debug-format` supports `pretty` (default) and `jsonl`

- Session ID format
  - `<timestamp>_<shortId>` (e.g., `2026-05-23T14-30-00_abc123`)
  - timestamp: `new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)`
  - shortId: first 6 chars of UUID
  - enables chronological sorting and human identification

- Trace directory
  - `.rxc/traces/` (parallel to `.rxc/sessions/`)
  - created automatically when `--debug-format jsonl` is used
  - trace file name matches session ID: `<sessionId>.jsonl`

- Provider resolution surface
  - `chat --provider <name>`
  - `chat --role <name>`
  - command resolves provider through `ProviderRegistry`, not inline `if/else`
  - current built-in providers:
    - `local`
    - `qwen`

- Config inspection surface
  - `config current`
  - prints the resolved provider/model/role/runtime view
  - secrets in provider settings must be redacted

### 4. Validation & Error Matrix

| Condition | Expected behavior |
|-----------|-------------------|
| `--provider` is unsupported | Throw `当前不支持 provider: <name>` before entering runtime |
| `--role` is unsupported | Throw `当前未定义 role: <name>` before entering runtime |
| role references a missing model | Throw `role <name> 引用了未定义的 model: <model>` before entering runtime |
| settings contains `{"$auth":"OPENAI_API_KEY"}` and project `auth.json` defines it | loader resolves the field before provider creation |
| process env and `auth.json` both define the same auth key | process env wins |
| project `auth.json` and user `auth.json` both define the same auth key | project `auth.json` wins |
| a `$auth` key is referenced but missing everywhere | Throw `未找到 auth key: <key>` before entering runtime |
| `providers.qwen.baseUrl` does not end with `/v1` | qwen provider normalizes it to a compatible root before requesting chat completions |
| `--debug` is enabled | runtime still writes normal reply output to `stdout`; debug trace writes to `stderr` |
| `--debug --debug-format jsonl` is enabled | runtime writes JSONL to `stderr` AND persists to `.rxc/traces/<sessionId>.jsonl` |
| `--debug` is used without `--debug-format` | defaults to `pretty` format, `stderr` only, no trace file |
| trace directory does not exist | `renderDebugTrace` creates it recursively before subscribing |
| `--message` contains only whitespace | Treat as absent; continue stdin / interactive detection |
| stdin is non-TTY and trimmed content is empty | Throw `stdin 输入为空，无法启动会话。` |
| interactive line is `/exit` or `/quit` | Close readline; do not emit a user turn |
| interactive line is `/help` | Print local help text; do not emit a user turn |
| interactive line is `/tools` | Print local tool syntax text; do not emit a user turn |
| interactive line is `/clear` | Clear terminal + redraw intro; do not emit a user turn |
| provider emits chunk events | Renderer may stream chunks to `stdout`; debug trace must not emit one pretty log per chunk |
| provider emits `tool_call` | runtime dispatches tool lifecycle and may re-enter provider for a later step |
| provider emits final `assistant_message` | runtime persists assistant message record and completes the turn |
| a turn exceeds `maxStepsPerTurn` | runtime persists a fallback assistant message and completes the turn |
| session directory does not exist | `SessionManager` creates it recursively |

### 5. Good / Base / Bad Cases

- Good:
  - `chat --message "你好"` emits one turn, writes session start + user + assistant + session end records
- Good:
  - `chat --message "/read note.txt"` emits tool lifecycle, then re-enters provider and emits a final assistant message
- Base:
  - `printf 'hello' | chat` goes through the same runtime path with `source: "stdin"`
- Bad:
  - Empty piped stdin must fail before starting a session
  - Provider code must not write directly to stdout/stderr
  - Debug output must not be mixed into normal `stdout`
  - Command handlers must not inline their own reply loop after this refactor

### 6. Tests Required

- Process-level smoke test for `chat --message`
  - assert rendered assistant output
- Process-level smoke test for stdin path
  - assert same runtime path behavior
- Session transcript persistence test
  - assert transcript file exists
  - assert `session` / `user` / `assistant` / `session_end` records are present
- Process-level CLI test for `/read <path>`
  - assert tool lifecycle renders before final assistant output
- Process-level CLI test for `--debug`
  - assert normal output stays in `stdout`
  - assert trace output appears in `stderr`
- Process-level CLI test for `--debug --debug-format jsonl`
  - assert JSONL output goes to `stderr`
  - assert trace file is created at `.rxc/traces/<sessionId>.jsonl`
  - assert each JSONL line is valid JSON
  - assert session ID uses timestamp prefix format
- If provider contract changes later
  - add/adjust tests for new runtime event types, debug trace behavior, and transcript behavior
- Process-level CLI test for unsupported provider
  - assert command fails before entering runtime
- Process-level CLI test for `.rxc/auth.json`
  - assert secrets can live outside `.rxc/settings.json`
  - assert `$auth` values reach provider resolution
- Process-level CLI test for auth ref env override
  - assert process env can override the same key from `auth.json`
- Process-level CLI test for `chat --role`
  - assert role can resolve model/provider/permission defaults
- Process-level CLI test for `runtime.defaultRole`
  - assert role is applied when CLI does not pass `--role`
- Process-level CLI test for `config current`
  - assert resolved provider/model/role output is correct
  - assert secrets are redacted

### 7. Wrong vs Correct

#### Wrong

```ts
new Command("chat").action(async () => {
  const reply = await callProviderInline(process.argv.slice(2));
  process.stdout.write(reply);
});
```

Why wrong:

- command owns provider orchestration
- no shared runtime event stream
- no session transcript
- impossible to reuse the same flow for stdin and interactive input

#### Correct

```ts
new Command("chat").action(async (options) => {
  const run = runAgentLoop({
    input$: createSingleTurnInput(options.message, "message"),
    provider,
    sessionManager,
    cwd: process.cwd(),
    mode: "single",
  });

  await renderRuntimeEvents(run.events$);
});
```

Why correct:

- command stays thin
- runtime owns turn orchestration
- provider is swappable through a contract
- UI renderer, debug trace, and transcript persistence stay reusable

---

## Scenario: subAgent system prompt 透传

### 1. Scope / Trigger

- Trigger: `spawn-agent.ts` 组装 subAgent 角色 prompt 后需要传给子 agent
- Trigger: 链路：`spawn-agent.ts` → `runAgentLoop({ prompt })` → `runTurnLoop` → `createTurnContext({ prompt })` → `buildMessages({ prompt })` → OpenAI `system` message
- Trigger: 任何 subAgent 实现都应通过此链路注入 prompt，不应绕过 `buildMessages`

### 2. Signatures

```ts
// src/core/shared/run-agent-helpers.ts runAgentLoop params 新增
export function runAgentLoop(params: {
  // ... 既有
  prompt?: string;  // 最终 system prompt（入口先拼英文 persona + resolvedRuntime.prompt；子 agent 同样先拼 persona）
  loadedSettings?: LoadedWastelandSettings;  // 透传到 dispatchToolCall → spawn-agent 用于读 subAgents 配置
}): AgentRun;

// src/providers/openai-compatible/message-builder.ts buildMessages 新增
function buildMessages(params: {
  history: readonly SessionMessageRecord[];
  input: string;
  toolResults: readonly TurnToolResult[];
  prompt?: string;  // 转 system message
}): OpenAIMessage[];
```

### 3. Contracts

- `runAgentLoop` 接受 `prompt?: string` 参数
- chat / resume / TUI 入口用 `composeAgentPrompt(runtime.skin, resolvedRuntime.prompt)` 组装主 Agent prompt，persona 必须位于功能 prompt 之前
- `spawn-agent.ts` 用 `subAgentConfig.skin` 选择英文 persona，再追加 worker 功能 prompt
- `runTurnLoop` 透传 `prompt` 到 `createTurnContext`
- `createTurnContext` 把 `prompt` 存到 `TurnContext.prompt`
- `buildMessages` 检测 `params.prompt` 非空时插入 `{ role: 'system', content: prompt }` 作为第一条消息
- minimax (OpenAI-compatible) 收到 system message 作为子 agent 的角色约束

### 4. Validation & Error Matrix

| 场景 | 行为 |
|---|---|
| `prompt` undefined | `buildMessages` 不插入 system message |
| `prompt` 空字符串 | 同上（不插入） |
| `prompt` 含中文/英文/多行 | 原样作为 system content |
| `prompt` 特别长 | 不截断（minimax API 接受长 system message） |

### 5. Good / Base / Bad Cases

#### Good
- 子 agent 收到 system message: `"You are an Information Research Specialist. Your goal is: Search, discover, retrieve information... Available tools: web-fetch, read-file. Constraints: - Read only..."`

#### Bad
- `runAgentLoop` 内部硬编码 system message（绕过 prompt 参数）
- spawn-agent.ts 直接拼接 system message 后用别的 API 路径发送（绕过 `buildMessages`）

### 6. Tests Required

- `buildMessages({ prompt: '...' })` 在 messages[0] 插入 `{ role: 'system', content: '...' }`
- `buildMessages({ prompt: undefined })` 不插入 system message
- 主 Agent chat / resume / TUI 入口注入英文 persona，并保持 persona 在 orchestrator prompt 之前
- 子 Agent 配置 skin 后收到对应英文 persona + worker 功能 prompt
- `runAgentLoop` 透传 `prompt` 到 `buildMessages`（mock provider 验证 messages 数组）

### 7. Wrong vs Correct

#### Wrong

```ts
// spawn-agent.ts: 直接用 OpenAI 私有 API 路径发 system message
// 绕过 buildMessages，导致 system 消息可能不参与 token 计数 / 截断
await provider.client.post('/chat/completions', { messages: [{ role: 'system', ... }] });
```

#### Correct

```ts
// runAgentLoop 透传 prompt 到 createTurnContext
context.prompt = params.prompt;
// buildMessages 把 prompt 转 system message
messages = buildMessages({ history, input, toolResults, prompt });
```

Why correct:

- 统一通过 `buildMessages` 路径，所有 provider（openai / claude / local）一致
- token 计数、截断、cache 等通用逻辑复用
- 未来加 system prompt 限制（如最长 N 字符）只需改 `buildMessages` 一处

---

## Scenario: runAgentLoop 调用收敛（startAgentLoop 共享装配）

### 1. Scope / Trigger

- Trigger: `chat.ts` / `resume.ts` / `tui/hooks/useRuntime.ts` 三处曾逐字重复 13 个 `runAgentLoop` 实参，且 `resume` 单消息与交互分支漏传 `loadedSettings` / `debug`（spawn 重试配置与 debug 追踪在 resume 里不生效）。
- Trigger: 任何新增的 Agent 入口（第 4 个调用点）都必须走同一装配，不许手写第三遍。

### 2. Signatures

```ts
// src/core/shared/run-agent-helpers.ts
startAgentLoop(args: BaseLoopArgs & { input$: Observable<ChatInputTurn> }): AgentRunResult;
// 13 个公共实参一次装配：provider / sessionManager / 全量 toolRegistry /
// permissionGate / prompt 合成 / providerRegistry+Settings / skillExecutor /
// childAgentTimeout / userInputBridge / debug / loadedSettings 透传。
// 调用方只传差异项：input$ / existingSession / initialHistory / abort$ / resolvePrompt。

// src/ui/debug-trace-helper.ts（注意：core 不依赖 UI，追踪输出只能住 UI 层）
attachDebugTrace(
  work: Promise<void>[],
  debug$: AgentRunResult['debug$'],
  opts: { debug: boolean; debugFormat: DebugFormat; cwd: string; projectConfigDir: string | null }
): void;
// debug 关闭时 no-op；jsonl 才落盘 traceDir。

stopRuntimeAgents(runtime: Pick<RuntimeEnvironment, 'mcpManager'>): Promise<void>;
// 停止 MCP 服务器（避免进程泄漏）。ACP agent 子进程随工具调用起停，无需运行时级清理。
```

### 3. Contracts

- chat / resume / TUI 启动 loop 只许调 `startAgentLoop`，不许直调 `runAgentLoop` 手写 13 参数。
- debug 追踪块只许调 `attachDebugTrace`，不许复制 `if (debug) { traceDir ... renderDebugTrace }`。
- 退出清理只许调 `stopRuntimeAgents`。
- `resume` 交互模式必须带 `UserInputBridge`（与 chat 交互模式一致，支持 ask-user）。

### 4. Tests Required

- `src/commands/chat.test.ts`、`src/commands/__tests__/resume.test.ts`、`src/tui/hooks/useRuntime.test.ts`：三种入口装配回归（本轮重构后 15 用例全绿）。
- 新增入口时：补对应装配测试，断言 `loadedSettings` / `debug` / `userInputBridge` 透传。

### 5. Wrong vs Correct

#### Wrong

```ts
// resume.ts（历史 bug）：漏传 loadedSettings/debug/userInputBridge
const run = runAgentLoop({ input$, provider, sessionManager, toolRegistry, permissionGate, cwd, mode, maxStepsPerTurn, existingSession, initialHistory, prompt, providerRegistry, providerSettings, skillExecutor, childAgentTimeout });
```

Why wrong:

- spawn-agent 读不到 multiAgent 重试配置；`--debug` 在 resume 里静默失效；ask-user 不可用。
- 第三个调用点复制粘贴时必然继续漏。

#### Correct

```ts
const run = startAgentLoop({ input$, runtime, cwd, mode, maxStepsPerTurn, prompt, debug, userInputBridge, existingSession, initialHistory });
attachDebugTrace(work, run.debug$, { debug, debugFormat, cwd, projectConfigDir });
// finally { await stopRuntimeAgents(runtime); }
```

Why correct:

- 公共实参与透传语义 single source of truth；调用方只表达差异。

---

## Scenario: context compaction token 预算契约

### 1. Scope / Trigger

- Trigger: `context-manager.ts` 的 `planCompaction` 从"按 `windowSize` 条数保留"重写为"按 token 预算切割"（完全替换，无双模式兼容）
- Trigger: `compactionBudgetRatio` 已接入配置（`settings-types.ts` 默认 0.6，`load-settings.ts` 校验，`agent-loop.ts` 构造 `ContextManager` 时读配置，无硬编码）
- 链路：`agent-loop.ts` pre-send 压缩与 `maybeSummaryCompact` 异步摘要 → `ContextManager.planCompaction` → `applyCompaction`

### 2. Signatures

```ts
// src/core/runtime/context-manager.ts
export type ContextManagerConfig = {
  /** context window 大小（token 数） */
  contextWindow: number;
  /** 触发同步压缩的低水位（0-1，默认 0.8） */
  compactionThreshold: number;
  /** 触发异步摘要压缩的高水位（0-1，默认 0.95），必须 >= compactionThreshold */
  summarizationThreshold: number;
  /** 压缩预算占比（0-1，默认 0.6）：contextWindow × compactionBudgetRatio = 保留窗口的 token 预算 */
  compactionBudgetRatio: number;
};

// planCompaction 只算计划不改 history；applyCompaction 才落地修改
planCompaction(history: readonly HistoryRecord[]): CompactionPlan | null;

export type CompactionPlan = {
  /** 切割点：history[0..cutIndex) 将被移除 */
  cutIndex: number;
  /** 将被移除的记录（可先做摘要） */
  removedRecords: HistoryRecord[];
};
```

### 3. Contracts

- **预算公式**：`budgetTokens = round(contextWindow × compactionBudgetRatio)`。默认 `contextWindow=128000`、`ratio=0.6` → 76800；测试常取 `contextWindow=1000` → 600。
- **切割规则（token 预算语义，不再按条数）**：
  - 从尾部向前遍历，对每条记录累加 `estimateMessageTokens(record)`；当 `acc + t > budgetTokens` 时停，保留窗口起点 `start` 落在"超预算前最后一条可纳入的记录"处，保留 `history[start..length)`。
  - 短记录（条数多但 token 少）保留更多条；长记录（条数少但 token 多）保留更少条——与旧的 `windowSize` 固定条数语义相反。
  - 单条记录就超预算：至少保留最后一条（不删光）。
  - 全部记录纳入也不超预算（`start === 0`）：返回 `null`，无需压缩。
  - 空 history：返回 `null`。
- **安全切割边界**：初始 `cutIndex = start` 后向后推进，跳过 `tool_call` / `tool_result`，直到遇到非工具记录（`message` / `summary`）作为保留窗口起点，避免切出孤儿工具消息（OpenAI API 会拒绝）；推进到末尾仍全是工具记录 → 返回 `null`。
- **token 估算**：`estimateTokens` ≈ CJK 每字 1 token（2 字符/token）、非 CJK 4 字符/token；`tool_result` 额外 +10 元数据开销。估算值仅用于预算决策，真实值由 `reportUsage` 的 API total 修正。
- **触发水位**：`needsCompaction` 低水位（默认 0.8）触发同步切割安全网；`needsSummarization` 高水位（默认 0.95）才触发异步摘要；usage 后 totalTokens 已含 system prompt，不再双计 `setPromptTokens`。
- **`windowSize` 已完全移除**：`ContextManagerConfig` 无 `windowSize` 字段，代码与测试均无 `windowSize` 残留。

### 4. Validation & Error Matrix

| 场景 | 行为 |
|---|---|
| `history` 为空 | `planCompaction` 返回 `null` |
| 全部记录累计 ≤ `budgetTokens` | 返回 `null`（无需压缩） |
| 尾部累积首次超预算 | `cutIndex` 落在超预算边界记录处，保留更少记录 |
| 单条记录就超预算 | 保留最后一条，不删光 |
| 切割点落在 `tool_call`/`tool_result` 上 | `cutIndex` 向后推进到非工具记录 |
| 向后推进到末尾仍全是工具记录 | 返回 `null`（放弃压缩） |

### 5. Good / Base / Bad Cases

#### Good
- 7 × 100 tokens（`budgetTokens`=600）：尾部累积到 6 条，第 7 条超限 → `cutIndex=1`，仅移除 1 条
- 7 × 200 tokens（`budgetTokens`=600）：尾部累积到 3 条 → `cutIndex=4`，移除 4 条（长记录保留更少）

#### Bad
- 固定"保留最近 N 条"的条数语义：与 token 预算目标冲突（相同 token 成本下短记录应比长记录保留更多条）
- 切割点落在 `tool_call`/`tool_result` 序列中间：产生孤儿工具消息，provider 请求被拒

### 6. Tests Required

- `src/core/runtime/__tests__/context-manager.test.ts`：
  - 全部记录 ≤ 预算 → `null`
  - 短记录保留更多条 / 长记录保留更少条（`cutIndex` 与 `removedRecords` 断言）
  - 单条超预算至少保留最后一条
  - 切割点跳过 `tool_call`/`tool_result`，工具配对不拆散
  - 保留窗口起点之后全是工具记录 → 放弃压缩
  - `applyCompaction` 含摘要时头部插入 summary、`tokensSaved` 扣除摘要占用
  - `needsCompaction` / `needsSummarization` 双水位与 usage 双计修复

### 7. Wrong vs Correct

#### Wrong

```ts
// 旧语义：按 windowSize 条数固定保留最近 N 条，与 token 预算无关
const cutIndex = Math.max(0, history.length - config.windowSize);
```

Why wrong:

- 长记录场景下 N 条可能远超 context window，压缩失效；短记录场景又过度删除
- 与 `budgetTokens`（token 目标）无关，无法保证压缩后不超预算

#### Correct

```ts
// 当前语义：从尾部累积 estimateMessageTokens 至 budgetTokens 即停
const budgetTokens = Math.round(contextWindow * compactionBudgetRatio);
let acc = 0, start = history.length;
for (let i = history.length - 1; i >= 0; i--) {
  const t = estimateMessageTokens(history[i]);
  if (acc + t > budgetTokens) break;
  acc += t;
  start = i;
}
```

Why correct:

- 保留窗口以 token 成本为目标，压缩后稳定不超预算
- 短记录保留更多条、长记录保留更少条，token 效率一致
- `tool_call`/`tool_result` 安全边界保证 provider 请求合法

---

## Scenario: OpenAI-compatible reasoning 字面回传（round-trip）

> 来源：`.trellis/tasks/09-13-reasoning-roundtrip`（opencode-go + deepseek 思考模型多步工具循环被上游拒证实测）。

### 1. Scope / Trigger

- Trigger: 任何 OpenAI 兼容线（`openai.ts` / `openai-compatible/`）触碰 assistant 消息的历史重建、流解析或错误处理。
- Trigger: 接入新的思考模型厂商/网关前，想确认"要不要为它写适配代码"——答案是不写，本契约就是适配层。
- 范围外：Anthropic 原生 thinking block + signature（`claude.ts`，二期）；`<think>` 显示层；transcript 存储格式。

### 2. Signatures

```ts
// src/core/runtime/event-types.ts —— 载荷定义在 core（provider → core 分层方向）
export type ReasoningPayload = { field: string; content: string };

// 三个携带点，全部可选、缺失时序列化与旧格式逐字节一致：
SessionMessageRecord.reasoning?: ReasoningPayload;   // 历史最终消息路径
SessionToolCallRecord.reasoning?: ReasoningPayload;  // 历史 tool_call 路径
TurnToolResult.reasoning?: ReasoningPayload;         // intra-turn toolResults 路径

// ProviderStreamEvent（provider-types.ts）：tool_call 与 assistant_message 各带 reasoning?

// src/providers/shared/reasoning-roundtrip.ts —— 纯函数，可独立单测
export function detectReasoningField(delta): 'reasoning_content' | 'reasoning' | 'thought' | undefined;
export function isReasoningRoundTripError(message: string): boolean;
export function hasReasoningFields(messages: readonly OpenAIMessage[]): boolean;
export function stripReasoningFields(messages): readonly OpenAIMessage[];
```

### 3. Contracts

- **字面回传铁律**：上游在这条 assistant 消息上发过什么 reasoning 字段，续传历史时就用**同名原字段、原值**带回；**没发的绝不凭空造**（含空串——空 `content` 一律视为无）。
- 接收侧（R-1）：`detectReasoningField` 按 `reasoning_content` > `reasoning` > `thought` 严格序探测**实际命中的字段名**；首个非空增量锁定字段名，后续跨字段增量丢弃；`<think>` 显示链与 emitChunk 行为不变。
- 回传侧（R-3）：**三条 assistant 路径都要带回传**——历史 message、历史 tool_call（同 step 多 tool_call 合并进一条 assistant 消息时按字段名判重只挂一次）、intra-turn toolResults section-3。只修 message 路径不够：strict 网关对工具循环中间步同样校验。
- 类型表达：动态 key 无法写进 `OpenAIMessage` 联合类型，统一经 `withAssistantExtras` / `attachAssistantExtras` 附加，断言范围收窄到"动态额外字段"，role/content/tool_calls 仍由类型系统校验。
- 自愈（R-4）：`isReasoningRoundTripError` 判"字段被**拒收**"（unrecognized/not supported/invalid_request 等），且**显式排除** "must be passed back / required / missing / needs to be passed back / please provide" 这类"**要求多带**"措辞——后者归 R-3 解决，去字段只会更糟。
- 记忆粒度：provider 实例闭包（`roundTripSuppressed`）；重试严格一次（`roundTripRetried` + `!isSuppressed()` 双闸）；**记忆只在去字段重试真的拿到 ok 响应后才落下**（判错代价不对称：文案误判不能永久关掉回传能力）。

### 4. Validation & Error Matrix

| 场景 | 行为 |
|---|---|
| 上游发 `reasoning_content`，续传请求 | 同 key 原值带回 |
| 旧 session 记录无 `reasoning` 字段 | 序列化逐字节同改前；不造字段 |
| 上游报"必须回传"而本地数据已丢（旧会话续聊） | 不假重试，错误文案原样透传 |
| 上游 400 "unrecognized field reasoning_content" | 去字段重试一次；成功则实例内记住停回传 |
| 上游 400 "reasoning_content must be passed back" | **不**触发自愈（属"要求多带"，交 R-3） |
| 重试仍失败 | 不再自愈，`subscriber.error` 抛错 |
| provider 实例已 suppressed | 起手即 `stripReasoningFields`，后续请求不带 |
| `reasoning.content` 为空串 | 视同无，不回传（防造非法空字段） |

### 5. Good / Base / Bad Cases

#### Good
- deepseek/qwen 思考模型经任意 OpenAI 兼容网关跑多步工具循环（turn≥3 step），全程零厂商定制适配。

#### Base
- 非思考模型：流里无 reasoning delta → 记录无字段 → 请求体与改前逐字节一致。

#### Bad
- 把三个源字段归一化成固定 key 再回传（上游按原字段校验，直接拒）。
- 用"去字段"自愈"must be passed back"错误（越自愈越糟）。
- 见到 reasoning 类 `invalid_request` 文案就永久关闭回传（判错代价不对称）。

### 6. Tests Required

- `src/providers/__tests__/openai-reasoning-stream.test.ts`：三字段变体各自 `{field,content}` 正确；首非空锁字段、跨字段丢弃；无 reasoning 流事件不含 key；UI chunk 序列与改前逐字一致。
- `src/providers/openai-compatible/__tests__/message-builder-reasoning.test.ts`：三条 assistant 路径挂载；旧记录逐字节零回归；user 不造字段；空串不回传；同 step 多 tool_call 只挂一次；混合 field 并存。
- `src/providers/__tests__/openai-self-heal.test.ts`：拒收→去字段重试一次且第二次 body 无三字段；成功后才记忆；must-pass-back / 非 reasoning 错误不 retry；已 suppressed 不再自愈；措辞变体（requires/needs to be passed back/please provide）不误判。

### 7. Wrong vs Correct

#### Wrong

```ts
// 归一化固定 key —— DashScope 系按原字段校验，拒收
messages.push({ role: 'assistant', content, reasoning: reasoningText });

// 见 reasoning 字样就 strip 重试 —— "must be passed back" 会被越修越没
if (lower.includes('reasoning')) { stripAndRetry(); }
```

#### Correct

```ts
// 原字段名动态放回；断言收窄到 extras
withAssistantExtras({ role, content }, { [reasoning.field]: reasoning.content });

// 排除"要求多带"措辞 + 成功才记忆
if (isReasoningRoundTripError(msg) && !roundTripRetried && hasReasoningFields(msgs)) {
  roundTripRetried = true;
  effectiveMessages = stripReasoningFields(effectiveMessages);
  return execute(); // ok 后：roundTrip.setSuppressed()
}
```

### 已知限制

- **`/resume` 缺口（待后续任务）**：session JSONL 落盘的 `tool_call` 记录来自 `tool-dispatch.ts` 的 `createToolCallRecord`（不感知 reasoning）；带 reasoning 的 record 在 `turn-executor.ts` appendRecord 之后被 push 进 history，`session-manager.appendRecord` 的 map 又剥掉该字段。**同一会话的后续 turn 正常**，但跨进程 `/resume` 重建的 tool_call 历史缺中间步 reasoning，strict 网关会再次报错。修法：appendRecord 持久化 + history 加载（`agent-loop.ts:274`）两处透传 `reasoning`。
- transcript 存双份思考文本（`content` 内 `<think>` + `reasoning.content`）：PRD 已接受；若二期瘦身，合并处理。
- `estimateMessageTokens` 不计 `reasoning.content`：token 估算偏乐观，压缩阈值稍松（PRD 接受"回传全文"风险的一部分）。

---

## Scenario: UserInputBridge 的等待者永不悬空（FIFO 认领语义）

### 1. Scope / Trigger

- Trigger: 实测会话 `2026-09-13_100427_1416ba` 中 3 个并行子 agent 的 bash 权限提问无人应答，子会话无 `permission` 记录、无 `tool_result`，静默等到 `childAgentTimeout`(600000ms)。
- Trigger: 子 agent 与父 agent 共用**同一个** `UserInputBridge`（`spawn-agent/index.ts` 传 `context.userInputBridge`），并行问询会同时占位同一队列。
- Trigger: 2026-09-14 复现出「同一 tick 内多次 `provideInput` 丢失答案」——等待者因此**永不 resolve**（`09-14-subagent-permission-hang`）。

### 2. Signatures

```ts
// core/engine/user-input-bridge.ts
class UserInputBridge {
  requestInput(context?: PendingInputContext): Promise<string>; // 排队，返回的 Promise 被回答时 resolve
  provideInput(answer: string): void;   // 认领「第一个未被认领」的等待者，异步出队
  isPending(): boolean;                 // 物理队列非空（含已认领未出队）
  pendingCount(): number;               // 物理队列长度（含已认领未出队）
  getPendingContext(): PendingInputContext | null; // 第一个**未认领**者的 context
  destroy(): void;                      // 排空；等待者收到空串（按拒绝处理）
}
type Waiter = { context: PendingInputContext | null; resolve: (a: string) => void; claimed?: boolean };
```

### 3. Contracts

- **等待者永不悬空**：任何进入队列的 `requestInput()` 最终必须被 resolve —— 由 `provideInput` 或 `destroy` 二选一。**禁止**出现"按键被处理了、但等待者没被 resolve"的路径。
- **`provideInput` 认领「第一个未认领者」**，不是 `waiters[0]`：同 tick 多次调用时 `waiters[0]` 可能已认领（其微任务尚未执行），重复认领会因 `indexOf(head) < 0` 让**第二个答案被静默丢弃**、对应等待者永久挂起。
  已实测可达：`cli-input-adapter` 的 `fromEvent(rl, 'line')` 对一次多行写入会在同一 tick 同步连发多个 `line` 事件（`terminal` true/false 都成立）。
- **出队保持异步（微任务）**：`provideInput` 返回后、微任务执行前 `isPending()` 仍为 true。CLI 的 `tap → filter` 链依赖这个语义吞掉输入行，避免它泄漏成聊天消息。故 `claimed` 只标记、不移除。
- **三个只读视图的语义分工**（新增消费方时必须区分）：
  - `isPending()` / `pendingCount()` = 物理队列，**含已认领未出队**（吞行依赖）；
  - `getPendingContext()` = 第一个**未认领**者（UI/CLI 要据它注册 `always` 规则，答过的那条不能再用）。
- **UI 侧热键分支不得静默吞键**：无 pattern、无 gate 等无法"记住"的情况必须**可见地降级**（落到 `once`）或明确提示；直接 `return` 会让等待者不 resolve。TUI 与 CLI 行为必须一致。
- **热键必须按「归一化 token」匹配，不能只做单键相等比较**：ink 对同一 stdin chunk 只回调一次，快速连击/粘贴会把多个字符作为一个 `inputChar` 传入（实测 `createInputParser.push('aa' | 'always')` **从不拆分可打印串**）。只比较单字符时这类输入块会不匹配任何分支、被末尾 `return` 整块吞掉——既不回答权限也不进输入框，等待者挂到超时。故 TUI 侧 `inputChar.trim().toLowerCase()` 后同时接受单键与精确单词（`yes`/`always`/`no`/`是`），与 CLI 的 `provideInput(line.trim())` 语义对齐。回归：`ChatInputBar.test.tsx` 的整串输入用例。
- **有等待就必须可见**：只要 `bridge.isPending()` 为真，界面必须给出可操作提示——含「详情缺失」（卡片为空）时也要渲染兜底。禁止"输入被当权限回答吞掉、界面却空白"的静默死锁。TUI 由 `isPendingPermission ? <PermissionPrompt card={…}/> : 正常输入区` 保证，`card` 为 null 时渲染 `permissionUnknownTitle`。
- **队列深度必须可见**：卡片 FIFO 逐个上位，用户需知道还排着几个（并行子 agent 同批提问时尤其重要）。TUI 渲染 `state.permission.queue.length`；**不要**用 `bridge.pendingCount()` 反推——它以物理队列为准、含已认领未出队者，刚回答完会多算 1。
- **reducer 必须按 `callId` 摘卡，而非只认队头**：被回答的若不是队头（卡片 FIFO 与 bridge FIFO 背离时可能发生），仍要从 `queue` 摘除并记入 `history`；否则留下幽灵卡片，之后错误上位、让用户的回答被 `provideInput` 认领给**另一个**等待者。
- `user_input_requested` 事件应携带 `toolName` + `input`；UI 由此推导模式，不靠 question 正则反推。

### 4. Validation & Error Matrix

| Condition | Expected behavior |
|---|---|
| 同一 tick 连续 N 次 `provideInput`，队列有 N 个等待者 | N 个各被认领一次，全部 resolve |
| `provideInput` 时队列为空 | 静默丢弃（不抛错），不影响后续请求 |
| `provideInput` 次数 > 等待者数 | 多余调用 no-op |
| `destroy()` 时存在已认领但未出队的等待者 | 其微任务因 `indexOf < 0` 提前返回，不二次 resolve |
| 队头已是已认领者，此时读取 `getPendingContext()` | 返回**下一个未认领**者（不是 `waiters[0]`） |

### 5. Tests Required

- `src/core/engine/__tests__/user-input-bridge.test.ts`：认领后 `getPendingContext()` 推进到下一个未认领者（红→绿已实证）。
- `src/core/engine/__tests__/tool-dispatch-concurrency.test.ts`：共享 bridge 上 3 个并发 ask 各占位、逐个回答全部推进到 `tool_started`+`tool_result`；FIFO 与 `getPendingContext()` 一致；空队列静默丢弃；**同一 tick 两次 `provideInput` 各解一个**。
- `src/tui/components/ChatInputBar.test.tsx`：无可记模式时按 `2` 不注册规则但**降级为 `provideInput('yes')`**（不再静默吞键）；队列非空渲染 `permissionQueued`、为空不渲染；`isPending()` 为真而卡片缺失时渲染 `permissionUnknownTitle` 兜底。
- `src/tui/hooks/runtime-reducers/tool-reducer.test.ts`：回答队头 → 排队者上位；回答**非队头** → 从 `queue` 摘除并记入 `history`（不留幽灵卡片）。

### 6. Wrong vs Correct

#### Wrong

```ts
// 1) 认领队头：同 tick 第二次调用拿到同一个对象，其微任务 indexOf<0 → 答案被丢
const head = this.waiters[0];

// 2) 无 pattern 时静默 return：按键被吞 + 等待者不 resolve（子 agent 挂到超时）
if (!pattern || !gate?.addSessionRule) return;
```

#### Correct

```ts
const head = this.waiters.find((w) => !w.claimed);   // 认领第一个未认领者
if (!head) return;
head.claimed = true;
queueMicrotask(() => { /* indexOf → splice → resolve */ });

// 无法记住 → 可见降级，绝不吞键
if (!pattern || !gate?.addSessionRule) { confirmOnce(); return; }
```

### 已知缺口

- **H-3 未做**：等待用户回答本身没有独立上限/取消路径，`childAgentTimeout`(600s) 是唯一兜底；用户没看见卡片时症状与实测完全一致（无 `permission` 记录、无结果、600s 超时）。建议补「子 agent 正在等待权限」的可观测信号。
- `tool-dispatch.ts` 的 ask-user 分支调 `requestInput()` **不带 context**，故队头是 ask-user 时 `getPendingContext()` 恒为 null（既有行为，非本次引入）。
- 缺陷 1 对 **CLI 会话已实证可达**；对 **TUI 会话未证实**（`ChatInputBar` 用 `inputChar === '2'` 相等比较，多字符 chunk 不匹配热键）。
