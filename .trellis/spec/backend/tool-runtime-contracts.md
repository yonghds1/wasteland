# Tool Runtime Contracts

> Current baseline / 当前基线：Phase 2 已经建立最小工具合同、权限闸门和工具生命周期分发骨架；Phase 3 又让 `local` provider 能在工具结果返回后继续走下一步 provider 推理并给出最终 assistant 回复；Phase 4 新增 edit-file 和 write-file 工具，实现文件编辑和写入能力；Phase 5 实现 Qwen provider 真实 tool calling，抽离 openai-compatible 模块供复用。

## Scenario: Phase 5 OpenAI-compatible provider tool calling

### 1. Scope / Trigger

- Trigger: 新增 `src/providers/openai-compatible/` 模块，支持 Qwen、DeepSeek、智谱 GLM 等 OpenAI 兼容 provider 的 tool calling。
- Trigger: `TurnContext` 新增 `toolRegistry` 字段，Provider 可构建工具定义。
- Trigger: `TurnToolResult` 新增 `input` 字段，用于构建包含工具调用的消息历史。
- Trigger: read-file 工具新增行号显示、智能截断和 offset/limit 参数。
- Trigger: 这属于跨层 contract 变更，后续添加新 provider 或新工具必须遵循此模式。

### 2. Signatures

- OpenAI-compatible module exports:

```ts
// types.ts - OpenAI API 类型定义
type OpenAIFunctionTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}

type OpenAIToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON 字符串
  };
}

type OpenAIToolMessage = {
  role: "tool";
  tool_call_id: string;
  content: string;
}

// tool-adapter.ts - 工具转换
function buildOpenAITools(registry: ToolRegistry): OpenAIFunctionTool[]
function parseToolCalls(toolCalls: OpenAIToolCall[]): ToolCall[]
function hasParseError(call: ToolCall): boolean
function getParseErrorMessage(call: ToolCall): string

// message-builder.ts - 消息构建
function buildMessages(params: {
  history: readonly SessionMessageRecord[];
  input: string;
  toolResults: readonly TurnToolResult[];
}): OpenAIMessage[]

function buildToolResultMessages(results: readonly TurnToolResult[]): OpenAIToolMessage[]
function needsToolLoop(messages: OpenAIMessage[]): boolean
```

- Extended TurnContext:

```ts
type TurnContext = {
  sessionId: string;
  turn: number;
  input: ChatInputTurn;
  cwd: string;
  history: readonly SessionMessageRecord[];
  toolRegistry?: ToolRegistry; // NEW: 供 Provider 构建工具定义
}
```

- Extended TurnToolResult:

```ts
type TurnToolResult = {
  callId: string;
  toolName: string;
  input: ToolInput; // NEW: 用于构建 assistant message 中的 tool_calls
  status: ToolRunStatus;
  output?: string;
  error?: string;
}
```

- Extended ToolRegistry:

```ts
class ToolRegistry {
  register(tool: AgentTool): void
  get(toolName: string): AgentTool | undefined
  list(): string[] // NEW: 列出所有工具名称
}
```

- read-file extended parameters:

```ts
// read-file input schema
{
  path: string;      // 必需：文件路径
  offset?: number;   // 可选：起始行号（从 1 开始）
  limit?: number;    // 可选：读取行数
}
```

### 3. Contracts

- OpenAI-compatible provider behavior:
  - 使用 `buildMessages()` 构建请求消息（包含工具历史）
  - 使用 `buildOpenAITools()` 构建工具定义
  - 非流式模式发送请求（tool calling 主流做法）
  - 根据 `finish_reason` 区分响应类型：
    - `"stop"` → 文本响应，发出 `assistant_chunk` + `assistant_message`
    - `"tool_calls"` → 工具调用，发出多个 `tool_call` 事件

- Tool calling flow:
  1. Provider 从 `context.toolRegistry` 构建工具定义
  2. Provider 发送请求（带 `tools` 数组）
  3. API 返回 `finish_reason: "tool_calls"`
  4. Provider 解析 `tool_calls`，发出 `tool_call` 事件
  5. Runtime 执行工具，累积结果到 `state.toolResults`
  6. Provider 下一步收到 `state.toolResults`，继续推理

- read-file output format:
  - 元数据头：`📄 <path> (<N> lines, <size>KB)`
  - 分隔线：48 个 `─` 字符
  - 行号格式：右对齐行号 + `│` + 内容
  - 截断提示：`... N lines hidden ...`
  - 大文件（>200 行）自动显示首尾各 50 行

- Tool parameter schema (OpenAI format):
  - read-file: path, offset?, limit?
  - edit-file: path, old_string, new_string, replace_all?
  - write-file: path, content
  - bash: command

### 4. Validation & Error Matrix

| Condition | Expected behavior |
|-----------|-------------------|
| OpenAI-compatible provider receives tool_calls response | Parse and emit `tool_call` events for each call |
| Tool arguments JSON parse fails | Return error as `input._errorMessage` for model retry |
| read-file offset > total lines | Return `status: "error"` with message |
| read-file without offset/limit on large file | Auto-truncate with head/tail split |
| Provider toolRegistry is undefined | Tools not sent in request |
| Multiple tool_calls in response | Emit all `tool_call` events in sequence |

### 5. Good / Base / Bad Cases

- Good:
  - Qwen provider with tool registry sends tools, receives tool_calls, emits events
  - read-file on large file shows metadata + head + tail + truncation hint
- Base:
  - Provider without tool registry operates in text-only mode
- Bad:
  - 硬编码工具 schema 在 provider 中（应使用 buildOpenAITools）
  - 直接返回原始文件内容（应格式化带行号）
  - 在 provider 中处理工具执行（应由 runtime dispatch 处理）

### 6. Tests Required

- OpenAI-compatible module tests:
  - assert `buildOpenAITools()` 生成正确的 tools 数组
  - assert `parseToolCalls()` 正确解析 tool_calls
  - assert `parseToolCalls()` 处理 JSON 解析错误
  - assert `buildMessages()` 正确构建包含工具历史的消息

- read-file tests:
  - assert 小文件显示完整内容 + 行号
  - assert 大文件显示首尾截断
  - assert offset/limit 参数正确工作
  - assert 元数据头格式正确

### 7. Wrong vs Correct

#### Wrong: 在 Provider 中硬编码工具 schema

```ts
const tools = [{
  type: "function",
  function: {
    name: "read-file",
    parameters: { ... }
  }
}];
```

Why wrong:
- 无法复用
- 与 ToolRegistry 不同步
- 新增工具需要修改多处

#### Correct: 使用 openai-compatible 模块

```ts
const tools = context.toolRegistry
  ? buildOpenAITools(context.toolRegistry)
  : undefined;
```

Why correct:
- 从单一数据源生成
- 自动同步工具定义
- 可复用于多个 provider

---

## Scenario: Phase 2 tool runtime skeleton

### 1. Scope / Trigger

- Trigger: 仓库已经新增 `src/tools/` 契约、`src/runtime/permission-gate.ts`、`src/runtime/tool-dispatch.ts`、`src/runtime/file-audit.ts`。
- Trigger: `RuntimeEvent` 和 `SessionRecord` 已扩展工具与权限事件。
- Trigger: 内建工具集已扩展：read-file、bash、edit-file、write-file。
- Trigger: 这属于跨层 contract 变更，后续接真实 provider / MCP / resume 时必须在此基础上演进。

### 2. Signatures

- Tool contract:

```ts
type ToolCall = {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
}

interface AgentTool {
  readonly name: string;
  readonly riskLevel: "read" | "write" | "execute";
  execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolExecutionResult>;
}
```

- Tool registry:

```ts
class ToolRegistry {
  register(tool: AgentTool): void
  get(toolName: string): AgentTool | undefined
}
```

- Default registry:

```ts
createDefaultToolRegistry(): ToolRegistry
```

- Tool runner:

```ts
executeToolCall(params: {
  registry: ToolRegistry;
  call: ToolCall;
  context: ToolExecutionContext;
}): Promise<ToolExecutionResult>
```

- Permission gate:

```ts
createPermissionGate(params?: {
  mode?: PermissionMode;
  rules?: PermissionRule[];
}): PermissionGate
```

- Chat CLI surface:

```ts
chat --permission-mode <default|accept_edits|bypass_permissions>
```

- Tool lifecycle dispatch:

```ts
dispatchToolCall(params: {
  session: SessionMetadata;
  sessionManager: SessionManager;
  turn: number;
  call: ToolCall;
  registry: ToolRegistry;
  permissionGate: PermissionGate;
  cwd: string;
  turnState: TurnState;
}): Observable<RuntimeEvent>
```

- File access audit:

```ts
checkReadBeforeEdit(params: {
  toolName: string;
  filePath: string;
  turnState: TurnState;
}): { ok: boolean; error?: string }
```

### 3. Contracts

- `ToolRiskLevel`
  - `read`
  - `write`
  - `execute`

- `ToolRunStatus`
  - `success`
  - `error`
  - `blocked`

- `PermissionMode`
  - `default`
  - `accept_edits`
  - `bypass_permissions`

- `PermissionDecisionKind`
  - `allow`
  - `ask`
  - `deny`

- New runtime events
  - `tool_call_requested`
  - `permission_decision`
  - `tool_started`
  - `tool_result`
    - carries `status: "success"`
  - `tool_failed`
    - carries `status: "error" | "blocked"`

- New session records
  - `tool_call`
  - `permission`
  - `tool_result`

- Terminal-event uniqueness (09-14 hardening, `09-14-duplicate-tool-call-id`)
  - 同一个 `callId` 在父侧**只允许一条终结事件**（`tool_result` 或 `tool_failed`）。
  - `turn-executor` 把二者都记进 `state.toolResults`；同一 `callId` 记两次会让
    `buildMessages` 产出重复 `tool_call_id`，上游以 `invalid_request_error`
    (`Duplicate value for 'tool_call_id'`) 拒收**整个 turn**。
  - spawn_agent 是唯一带 PreDispatchHook 的工具，也是唯一有「两个终结产出点」
    风险的工具：`invokeFinish` 失败分支**只** `subscriber.error(...)`（不发事件、不写记录），
    终结事件**与父 session 记录**都由 `spawnChildAgentForwarding$` 的 `catchError`
    唯一产出；成功分支仍由 `invokeFinish` 直接发 `tool_result` 并写记录。
  - 失败时**记录也必须收归一处**：若 `invokeFinish` 每次 attempt 各写一条，
    `maxRetries > 0` 时会写入多条同 `callId` 记录，`/resume` 经 history 分支重建
    消息时同样会出现重复 `tool_call_id`（与重复事件同一种上游拒收）。
  - 新增工具/hook 时的检查项：一个 tool_call 无论经历几次重试、几个错误来源，
    父侧最多一条终结事件、最多一条结果记录（「多」才是 bug；数量不足不触发上游拒收，
    但仍是有损历史，故正常路径应恰好各一条）。
  - 例外（既有行为，非缺陷）：`spawnChildAgentForwarding$` 的两处**早退**校验失败
    （输入解析失败 / 超出嵌套深度）在 retry+catchError 管线**之外**直接 `of(tool_failed)`，
    不发记录。它们不经 `invokeFinish`，不受本契约的「唯一产出点」约束。
  - 已知缺口①（本次改动引入的窗口，`maxRetries > 0` 才可达）：失败记录从
    「首次失败即写」（invokeFinish）移到「重试耗尽后写」（catchError），因此退避等待
    期间若订阅被 teardown（用户 Ctrl+C / 进程被杀），既无终结事件也无父 session 记录。
    默认 `maxRetries=0` 时该窗口约等于 0。旧行为在该窗口下有记录但**无**事件
    （history 里出现孤立 tool_result），并非更优；要彻底消除需把「记录只由最终
    attempt 写」做成显式终态收尾（catchError + finalize 二选一，且不得重复写）。
  - 已知缺口②（既有，非本次引入）：`assembleForwardObservable` 的超时定时器
    **不检查 `isSummarizing`**。子 agent 在超时前刚产出 `assistant_message`、
    摘要 LLM 往返超出剩余预算时，超时回调会把这次**成功**改判为失败（并触发整轮重试），
    随后摘要 resolve 时 `finish('success')` 因 `state.called` 早退 → 已完成的子 agent
    工作被静默丢弃。修法是超时回调先看 `isSummarizing`（放行摘要）或把超时预算与
    摘要预算分开。
  - 回归防线：`event-forwarder.test.ts` 的 `maxRetries=2` 用例同时断言
    「终结事件恰好 1 条」与「父 session 记录恰好 1 条」。

- Local provider demo contract
  - input starts with `/read `
  - provider emits a `tool_call` for `read-file`
  - path is passed as `input.path`
  - input starts with `/bash `
  - provider emits a `tool_call` for `bash`
  - command is passed as `input.command`
  - after runtime appends a `tool_result` or blocked/error outcome to the turn state
  - provider runs one more step and emits a final `assistant_message` summarizing the tool outcome

### Current chat input syntax

This is the current executable input surface for the `local` provider demo path:

| Input form | Example | Expected path |
|------------|---------|---------------|
| Plain text | `你好` | provider emits assistant text events |
| `/read <relative-path>` | `/read package.json` | provider emits `tool_call` for `read-file` |
| `/bash <command>` | `/bash pwd` | provider emits `tool_call` for `bash` |

### Built-in tools

| Tool | Risk Level | Description |
|------|------------|-------------|
| `read-file` | `read` | 读取文件内容（支持行号、截断、分页） |
| `bash` | `execute` | 执行 shell 命令 |
| `edit-file` | `write` | 精确字符串替换编辑文件 |
| `write-file` | `write` | 创建或完整覆写文件 |

### read-file contract (Phase 5 extended)

- Parameters:
  - `path`: 文件路径（相对于 cwd，必需）
  - `offset`: 起始行号（可选，从 1 开始）
  - `limit`: 读取行数（可选）

- Output format:
  ```
  📄 <relative-path> (<N> lines, <size>KB)
  ────────────────────────────────────────────────────────
    1│<content line 1>
    2│<content line 2>
  ...
  ```

- Behavior:
  - 小文件（≤200 行）：显示完整内容 + 行号
  - 大文件（>200 行）：显示首尾各 50 行，中间省略
  - 有 offset/limit 时：返回指定范围
  - 行号右对齐，宽度根据总行数计算
  - 文件元数据包含路径、行数、大小

- Error conditions:
  - 路径为空或不存在
  - 路径在 cwd 之外
  - offset 超出文件范围

### edit-file contract

- Parameters:
  - `path`: 文件路径（相对于 cwd）
  - `old_string`: 要替换的原始字符串
  - `new_string`: 替换后的新字符串
  - `replace_all`: 是否替换所有匹配项（可选，默认 false）

- Behavior:
  - `old_string` 必须精确匹配（不支持正则或模糊匹配）
  - 默认 `old_string` 必须唯一匹配，否则报错
  - `replace_all: true` 时替换所有匹配项
  - read-before-edit 检查：必须在当前 turn 内已调用过 `read-file` 读取目标文件

### write-file contract

- Parameters:
  - `path`: 文件路径（相对于 cwd）
  - `content`: 文件完整内容

- Behavior:
  - 自动创建文件及必要的父目录
  - 覆写已有文件时需要 read-before-edit 检查
  - read-before-edit 检查：必须在当前 turn 内已调用过 `read-file` 读取目标文件

Notes:

- This syntax belongs to the current `local` provider demo path, not a frozen long-term DSL.
- Future real providers may keep, extend, or replace these trigger forms, but any change must be documented here and in `docs/`.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
|-----------|-------------------|
| `default` mode + `read` tool | permission decision is `allow` |
| `default` mode + `write` / `execute` tool | permission decision is `ask` |
| `accept_edits` mode + `write` tool | permission decision is `allow` |
| `accept_edits` mode + `execute` tool | permission decision is `ask` |
| `bypass_permissions` mode | permission decision is `allow` |
| `--permission-mode` is unsupported | command must fail before entering runtime |
| input starts with `/read ` and path is non-empty | local provider emits `tool_call` instead of assistant text |
| input starts with `/bash ` and command is non-empty | local provider emits `tool_call` instead of assistant text |
| local provider receives a `success` tool result for `/read` or `/bash` | emits a final assistant message after the tool lifecycle |
| local provider receives a `blocked` or `error` tool outcome | emits a final assistant message describing the failure |
| `read-file` target path is missing / empty / outside cwd | tool returns `status: "error"` |
| `bash` command is missing / empty | tool returns `status: "error"` |
| `edit-file` path is outside cwd | tool returns `status: "error"` |
| `edit-file` old_string is empty | tool returns `status: "error"` |
| `edit-file` old_string not found in file | tool returns `status: "error"` with match hint |
| `edit-file` old_string matches multiple times and replace_all is false | tool returns `status: "error"` with match count |
| `write-file` path is outside cwd | tool returns `status: "error"` |
| `edit-file` or `write-file` target file has not been read in current turn | dispatch emits `tool_failed` with read-before-edit error |
| tool name not found in registry | emit `tool_call_requested` then `tool_failed`; transcript stores error result |
| permission decision is not `allow` | do not emit `tool_started`; emit `tool_failed` with `status: "blocked"` or `"error"`; transcript stores blocked/error result |
| tool execution throws | tool runner returns `status: "error"` and dispatch emits `tool_failed` with `status: "error"` |

### 5. Good / Base / Bad Cases

- Good:
  - `/read note.txt` under `default` mode emits full lifecycle: request -> permission -> start -> result
- Good:
  - `/bash pwd` with `--permission-mode bypass_permissions` emits request -> permission -> start -> result
- Base:
  - `execute`-risk tool under `default` mode emits request -> permission -> failed(blocked) -> final assistant message
- Bad:
  - 把权限判断写进单个工具实现
  - 在 command handler 中直接执行工具
  - provider 直接越过 tool registry / permission gate 调用本地副作用

### 6. Tests Required

- Permission mode matrix test
  - assert `default` / `bypass_permissions` 对不同 risk level 的决策
- Allowed lifecycle test
  - assert event order
  - assert transcript contains `tool_call` / `permission` / `tool_result`
- Process-level CLI test for `/read <path>`
  - assert main `chat` runtime path renders tool lifecycle
  - assert final assistant output is rendered after tool result
  - assert transcript contains `read-file` records
- Process-level CLI test for `/bash <command>`
  - assert `default` mode blocks execute-risk tool
  - assert `bypass_permissions` mode allows execute-risk tool
  - assert both paths end with a final assistant message
- Blocked lifecycle test
  - assert no `tool_started`
  - assert `tool_failed.status === "blocked"`
  - assert transcript contains blocked `tool_result`

### 7. Wrong vs Correct

#### Wrong

```ts
if (call.toolName === "bash") {
  return execa("bash", ["-lc", input.command]);
}
```

Why wrong:

- no registry boundary
- no permission gate
- no transcript
- runtime cannot observe or replay the tool lifecycle

#### Correct

```ts
dispatchToolCall({
  session,
  sessionManager,
  turn,
  call,
  registry,
  permissionGate,
  cwd,
});
```

Why correct:

- tool execution enters through a shared contract
- permission is explicit
- transcript is preserved
- later provider / MCP integration can reuse the same path

---

## Scenario: subAgents 配置生效 + 主 agent 工具集最小化

### 1. Scope / Trigger

- Trigger: minimax (MiniMax-M3) 是小模型，工具越多决策越乱，且之前的 `spawn-agent.ts` 完全忽略 `settings.subAgents[name]` 配置（minimax 在子 agent 里只能"角色扮演"）。
- Trigger: `subAgents[name].promptVariables`（role / goal / backstory / tools / constraints）、`promptTemplate` 与可选 `skin` 字段应真正注入到子 agent 的 system prompt 和工具集。
- Trigger: 主 agent minimax 工具集应最小化为 `[spawn_agent, read-file, bash]`，其他工具下放给子 agent。
- Trigger: 任何 `subAgentConfig` 字段缺失需有降级路径。

### 2. Signatures

```ts
// src/core/runtime/agent-loop.ts 新增导出
export const MAIN_AGENT_TOOL_NAMES = ['spawn_agent', 'read-file', 'bash'] as const;

export function filterToolRegistry(
  registry: ToolRegistry,
  allowedNames: readonly string[]
): ToolRegistry;

// src/tools/spawn-agent.ts 新增 helpers
function parseSubAgentTools(raw: unknown): string[];
// raw 可为 string（逗号分隔）/ string[] / undefined；返回 trim 后的 string[]

function assembleSubAgentPrompt(params: {
  subAgentConfig: SubAgentSettings | undefined;
  cwd: string;
  roleName: string;
  tools: string[];
}): string | undefined;
// 通过 PromptAssembler.assemble(...) 渲染功能 prompt，再在前面注入 skin 的英文 persona
// subAgentConfig undefined 或组装失败时 fallback: 返回 undefined
```

### 3. Contracts

#### 主 agent 工具集最小化

- `MAIN_AGENT_TOOL_NAMES` = `['spawn_agent', 'read-file', 'bash']`（**唯一白名单**）
- **过滤位置**：在 chat/resume/tui 三个**入口**调用 `filterToolRegistry(runtime.toolRegistry, MAIN_AGENT_TOOL_NAMES)` 传给 `runAgentLoop`
- **不在 `runAgentLoop` 内部过滤**（避免子 agent 二次过滤——子 agent 的 toolRegistry 已被 subAgents.tools 限定过）
- `runAgentLoop` 接 `toolRegistry?: ToolRegistry`（已存在），传过滤后的即生效

#### subAgents 配置生效（spawn-agent.ts）

- **读配置**：`subAgentConfig = context.loadedSettings?.settings?.subAgents?.[childName]`
- **降级**：`subAgentConfig` undefined → 保持 minimax 传入值（不注入 prompt，不限定 tools）
- **工具优先级**：`subAgentConfig.promptVariables.tools` > minimax 传入 `tools` > 全部工具
  - 若 `subAgentConfig.promptVariables.tools` 存在 → 解析为 `string[]`（`parseSubAgentTools`），用它限定子 agent
  - 否则用 minimax 传入的 `tools`
  - 否则用全部工具
- **模型优先级**：`subAgentConfig.model` > minimax 传入 `model`
  - **关键修复**：`subAgentConfig.model` 可能是 alias（如 `"minimax_model"`），需要从 `settings.models[alias].model` 解析为真实 model name（如 `"MiniMax-M3"`）
  - 解析失败（alias 不在 models 表）→ 保留原 alias（兼容 alias 即 model name 的场景）
- **prompt 注入**：先用 `PromptAssembler.assemble(...)` 渲染功能 prompt，再用 `composeAgentPrompt(getRoleSkin(subAgentConfig.skin), functionalPrompt)` 把固定英文 persona 放在前面，传给 `runAgentLoop({ ..., prompt })`
- **skin 默认值**：`subAgentConfig.skin` 缺失或未注册时回退 `defaultRoleSkin = "warlord-stern"`；没有 `subAgentConfig` 时仍不注入任何 prompt
- **链路**：`runAgentLoop.prompt` → `createTurnContext.prompt` → `buildMessages` → OpenAI system message → minimax 收到

#### debug log 字段（`spawn-agent.ts` `debugLog({ kind: "spawn_agent", ... })`）

- `childName`, `childId`, `taskPreview`, `taskLength`
- `providerId`, `resolvedModel`（已解析），`modelParam`（minimax 传入原值）
- `subAgentConfigName`（如有配置），`subAgentTools`（数组），`subAgentPromptPreview`（200 字符），`subAgentPromptLength`

### 4. Validation & Error Matrix

| 场景 | 行为 |
|---|---|
| `subAgentConfig` undefined | 降级：minimax 传入值生效，无 prompt 注入 |
| `promptVariables.tools` 是 `"a, b, c"` | `parseSubAgentTools` 解析为 `['a', 'b', 'c']` |
| `promptVariables.tools` 是 `string[]` | 直接 trim |
| `subAgentConfig.model = "minimax_model"` (alias) | 从 `settings.models["minimax_model"].model` 解析为 `"MiniMax-M3"` |
| alias 在 settings.models 找不到 | 保留原 alias |
| PromptAssembler 抛错 | `assembleSubAgentPrompt` catch → 返回 undefined + `debugLog(kind: "sub_agent_prompt_error")` |
| `subAgentConfig.skin = "scout"` | system prompt 以固定英文 scout persona 开始，后接功能 prompt |
| `subAgentConfig.skin` 缺失或未知 | 回退 `defaultRoleSkin` 的英文 persona |
| minimax 传入 `tools = ["web-search"]` 但 subAgentConfig.tools 存在 | 忽略 minimax 的 tools，用 subAgentConfig.tools |

### 5. Good / Base / Bad Cases

#### Good
- `subAgentConfig = { promptTemplate: "role-worker", promptVariables: { role: "Researcher", tools: "web-fetch, read-file", ... } }` → 子 agent 收到 system prompt 含 "You are a Researcher." + "Available tools: web-fetch, read-file" + 工具集限定为 2 个
- `subAgentConfig.model = "minimax_model"` → 实际 API 请求 `model: "MiniMax-M3"`（不是 `"minimax_model"`）

#### Bad
- `subAgentConfig` undefined 时仍注入 prompt → 禁止
- minimax 传入的 tools 覆盖 subAgentConfig.tools → 禁止
- model alias 未解析就传给 provider → 禁止（API 失败）
- `runAgentLoop` 内部过滤 MAIN_AGENT_TOOL_NAMES → 禁止（会二次过滤子 agent）

### 6. Tests Required

- `MAIN_AGENT_TOOL_NAMES` 包含 `[spawn_agent, read-file, bash]`
- `createDefaultToolRegistry` 注册全部 13 个工具（sanity check）
- `runAgentLoop` 只把白名单工具传给 provider（mock provider 验证）
- `subAgentConfig` 含 `promptTemplate + promptVariables + skin` → 子 agent 收到英文 persona、正确功能 prompt 与限定工具集
- 主 agent chat / resume / TUI 入口 → persona 位于 orchestrator 功能 prompt 之前
- `subAgentConfig.tools` 覆盖 minimax 传入 `tools`
- 无 `subAgentConfig` → 无 prompt，minimax 传入 `tools` 生效
- `subAgentConfig.model` alias 解析（`minimax_model` → `MiniMax-M3`）
- alias 在 settings.models 找不到 → 保留原 alias

### 7. Wrong vs Correct

#### Wrong

```ts
// spawn-agent.ts: 用 minimax 传入的 model 直接作为 newSettings.model
newSettings = { ...context.providerSettings, model: model };
// 问题：model 是 alias "minimax_model"，provider 用 "minimax_model" 调 API（失败）
```

#### Correct

```ts
// 解析 alias
let resolvedModel = effectiveModel;
if (subAgentConfigModel && context.loadedSettings?.settings?.models) {
  const aliasConfig = context.loadedSettings.settings.models[subAgentConfigModel];
  if (aliasConfig?.model) resolvedModel = aliasConfig.model;
}
newSettings = { ...context.providerSettings, model: resolvedModel };
```

Why correct:

- `settings.models[alias].model` 是 model 别名解析的唯一权威位置
- 未找到 alias 时保留原值（兼容 alias 即 model name 的场景，如直接写 `"gpt-4o"`）
- 避免 minimax API 收到未解析的 alias 导致 404/400 错误

---

## Scenario: once/always 会话级记住 + 弹窗 bypass 入口拆除

### 1. Scope / Trigger

- Trigger: 权限弹窗选项 2（`2`/`a`）曾发送 `/perm bypass` 把**全局**切到免确认，用户不敢点；且 `spawn_agent` 等无模式工具点了也没用。
- Trigger: OpenCode/Claude Code 常规做法是 once（本次）/ always（记住同类，session 级内存），落盘是二期且只落本地忽略文件。

### 2. Signatures

```ts
// permission-gate.ts
type PermissionRule = { toolName?: string; riskLevel?: ToolRiskLevel; decision; reason?; inputPrefix?: { key: string; prefix: string } };
gate.addSessionRule(rule: PermissionRule): void;   // 内存，进程结束即焚
gate.clearSessionRules(): void;                    // 预留（单进程多 session 时调用）
describeAllowPattern(toolName: string, input?: ToolInput): AllowPattern | null;
// bash→command 首两 token（如 "git status"），edit/write/read→path 全值，git→subcommand；
// 无映射/空值返回 null（UI 只给 once）。

// 回答协议（dispatch-utils requestPermissionConfirmation）：
// 'yes' → 本次放行；'always' → 本次放行（规则由 UI 侧先注册）；其他 → 拒绝。

// dispatch-utils.ts —— 把「用户是否放行」落成最终权限决策（两条 dispatch 路径共用）
resolveConfirmedDecision(rawDecision: PermissionDecision, allowed: boolean): PermissionDecision;
// ask + allowed  ⇒ { ...raw, decision: 'allow', reason: '用户已确认允许本次工具调用。' }
// ask + !allowed ⇒ { ...raw, decision: 'deny',  reason: raw.reason + '（用户拒绝）' }
// 非 ask         ⇒ rawDecision 原样返回（保留 permissionRuleHit 等「为何直接放行」的 reason）
```

### 3. Contracts

- 优先级：静态 deny > session 放行 > 静态 ask/allow > 模式默认。session always 永远盖不过显式 deny。
- 弹窗选项 2 = always（内存 session 规则），**禁止再发 `/perm bypass`**；`Shift+Tab` 与手输 `/perm` 保留（显式自愿行为）。
- 无可记模式的工具：选项 2 置灰并跳过，不静默降级。
- `user_input_requested` 携带 `toolName` + `input`（可选字段，ask-user 工具可不填）；UI 由此推导模式，不正则反解析 question。
- CLI：`always`/`once`/`yes`/`no` 关键字，复用同一 helper；无 gate/无 pattern 时降级本次允许并提示。
- 子 agent 与父共享 gate 实例，同 session 自动跟进（落盘前无跨 session 继承问题）。
- **用户同意必须落成 `decision: 'allow'`**：`ask` + 用户答 yes/always 时，授权门原始决策仍是 `ask`，
  必须经 `resolveConfirmedDecision` 转成 `allow` 再往下走。两条 dispatch 路径
  （`engine/tool-dispatch.ts`、`spawn-agent/dispatch-handler.ts`）下游统一用
  `decision.decision !== 'allow'` 判定是否执行，原样透传 `ask` 会把「用户已同意」当未授权拦掉，
  记成 `tool_result status='blocked'`。判定旁证：被拒时 reason 追加「（用户拒绝）」，被误拦时**不带**该后缀。
- 该映射只有一份实现（`resolveConfirmedDecision`）。历史上同一段 6 行分支在两个文件里各写了一遍，
  两份都漏了 ask→allow，所以修 bug 请改 helper，不要在调用点重新内联。

### 4. Tests Required

- gate：前缀命中/未命中、静态 deny 优先、clear 生效（`permission-gate.test.ts`）。
- 回答语义：`always` 放行本次（`permission-confirm.test.ts`）。
- 决策映射：`ask`+同意 ⇒ `allow`；`ask`+拒绝 ⇒ `deny` 且 reason 带「（用户拒绝）」；非 ask 原样透传
  （`permission-confirm.test.ts` 的 `resolveConfirmedDecision` 组）。
- **集成（回归防线）**：`yes`/`always` 回答后必须跑到 `tool_started` + `tool_result status='success'`，
  且不出现 `tool_failed`。只断言 helper 的 `allowed` 布尔值**不足以**覆盖此 bug
  ——`tool-dispatch-permission.test.ts` 曾把这个 bug 当预期行为写进注释并断言 `decision='ask'` +
  `status='blocked'`，正是它让 bug 长期隐身。
- TUI：选项 2 注册规则且不发 bypass、无模式时忽略（`ChatInputBar.test.tsx`）。
- CLI：`always` 关键字注册+放行、降级提示（`cli-input-adapter.test.ts`）。
- 已知 UX 缺口（未修）：链式命令的 always 规则永不命中（`isSafeCommandRemainder` fail-closed），
  但 TUI 仍显示 `[已允许·本会话]`，用户会误以为下次免问。
