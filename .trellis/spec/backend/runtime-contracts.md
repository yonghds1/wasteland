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
// src/core/runtime/agent-loop.ts runAgentLoop params 新增
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
