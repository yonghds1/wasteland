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
