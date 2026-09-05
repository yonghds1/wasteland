# CLI/TUI 统一链路 Contracts

> 当前基线：CLI 和 TUI 共享核心运行时（agent-loop, providers, tools），但在 I/O 层和生命周期管理上存在差异。本次统一通过 Adapter 模式和共享业务逻辑层，将两条链路合并为一条。

`docs/architecture/cli-tui-unification.md` 是人读的架构说明；本文件才是精确签名、字段合同和校验行为的规范真源。

## Scenario: Shared Business Logic Layer

### 1. Scope / Trigger

- Trigger: CLI 和 TUI 的本地命令处理逻辑重复
- Trigger: TUI 缺失 SkillExecutor、Role 支持
- Trigger: 会话创建时机不一致
- 这属于跨层 contract 变更，后续改 I/O 层时必须按合同演进

### 2. Signatures

- RuntimeEnvironment:

```typescript
type RuntimeEnvironment = {
  session: SessionManager;
  skillExecutor: SkillExecutor;
  mcpManager: McpManager;
  providerRegistry: ProviderRegistry;
  roleConfig: RoleConfig | null;
}

async function initializeRuntime(params: {
  settings: ResolvedRxcSettings;
  roleName?: string;
  providerName?: string;
  cwd: string;
}): Promise<RuntimeEnvironment>
```

- LocalCommandResult:

```typescript
type LocalCommandResult = {
  handled: boolean;
  output?: string;
  action?: 'clear' | 'exit' | 'help';
}

function executeLocalCommand(params: {
  command: string;
  context: RuntimeEnvironment;
}): LocalCommandResult
```

- RoleResolver:

```typescript
type RoleConfig = {
  id: string;
  name: string;
  model: string;
  provider: string;
  permissionMode?: string;
}

function resolveRole(params: {
  roleName: string | undefined;
  settings: ResolvedRxcSettings;
}): RoleConfig | null
```

### 3. Field Contracts

#### RuntimeEnvironment

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `session` | `SessionManager` | Yes | 会话管理器 |
| `skillExecutor` | `SkillExecutor` | Yes | 技能执行器 |
| `mcpManager` | `McpManager` | Yes | MCP 生命周期管理 |
| `providerRegistry` | `ProviderRegistry` | Yes | Provider 注册表 |
| `roleConfig` | `RoleConfig \| null` | Yes | 当前角色配置（null 为默认） |

#### LocalCommandResult

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `handled` | `boolean` | Yes | 是否处理了该命令 |
| `output` | `string` | No | 命令输出内容（仅当 CLI 直接渲染时使用） |
| `action` | `'clear' \| 'exit' \| 'help'` | No | 特殊动作标识 |

> **CHANGED (07-30-help-dialog-mode)**: `action: 'help'` no longer implies `output` is populated. The TUI uses `state.showHelp = 'commands'` to render a dialog instead. **The CLI must render the help text to stdout itself** when it sees `action === 'help'`, using the `createHelpCommandsSection` / `createHelpToolsSection` / `createHelpSkillsSection` / `createHelpLocalCommandsSection` helpers from `@core/shared/command-handlers.js`.

### 4. Validation Rules

- `initializeRuntime()` 必须初始化所有字段，不能返回 partial context
- `executeLocalCommand()` 必须处理以下命令：`/help`, `/skills`, `/tools`, `/clear`, `/exit`
- 未知命令应返回 `{ handled: false }`
- `resolveRole()` 在 roleName 为 undefined 时返回 null（使用默认配置）
- **NEW (07-30)**: `action: 'help'` handler returns only `{ handled: true, action: 'help' }` (no `output`). Adapter layer (TUI dialog OR CLI stdout) is responsible for rendering.

---

## Scenario: InputAdapter Interface

### 1. Scope / Trigger

- Trigger: CLI 使用 readline，TUI 使用 React/Ink
- Trigger: 需要统一输入格式为 `ChatInputTurn`
- 这属于 I/O 层 contract 变更

### 2. Signatures

```typescript
interface InputAdapter {
  readonly input$: Observable<ChatInputTurn>;
  destroy(): void;
}

// CLI 实现
class CliInputAdapter implements InputAdapter {
  constructor(params: {
    readline: readline.Interface;
    commandHandler: (command: string) => LocalCommandResult;
  });
  readonly input$: Observable<ChatInputTurn>;
  destroy(): void;
}

// TUI 实现
class TuiInputAdapter implements InputAdapter {
  constructor(params: {
    subject: Subject<ChatInputTurn>;
    commandHandler: (command: string) => LocalCommandResult;
  });
  readonly input$: Observable<ChatInputTurn>;
  destroy(): void;
}
```

### 3. Field Contracts

#### ChatInputTurn (已有，保持不变)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `turn` | `number` | Yes | 轮次编号 |
| `content` | `string` | Yes | 用户输入内容 |
| `source` | `'cli' \| 'tui' \| 'api'` | Yes | 输入来源 |

### 4. Validation Rules

- `input$` 必须是 hot Observable（订阅前已经开始产出）
- `destroy()` 必须清理所有订阅和资源
- 本地命令（`/` 开头）必须先经过 `commandHandler` 处理
- 本地命令处理后不能进入 `input$`

---

## Scenario: OutputAdapter Interface

### 1. Scope / Trigger

- Trigger: CLI 使用 stdout.write，TUI 使用 React setState
- Trigger: 需要统一事件格式为 `DisplayEvent`
- 这属于 I/O 层 contract 变更

### 2. Signatures

```typescript
type DisplayEvent =
  | { type: 'session_started'; sessionId: string }
  | { type: 'user_turn'; turn: number; content: string }
  | { type: 'assistant_chunk'; turn: number; chunk: string }
  | { type: 'assistant_message'; turn: number; content: string }
  | { type: 'tool_call_requested'; turn: number; toolName: string; callId: string }
  | { type: 'tool_started'; turn: number; toolName: string; callId: string }
  | { type: 'tool_result'; turn: number; toolName: string; callId: string; output: string }
  | { type: 'tool_failed'; turn: number; toolName: string; callId: string; error: string }
  | { type: 'permission_decision'; turn: number; toolName: string; decision: string; mode: string }
  | { type: 'agent_spawned'; childId: string; task: string }
  | { type: 'agent_completed'; childId: string; status: string; result?: string; error?: string }
  | { type: 'session_ended' };

interface OutputAdapter {
  processEvent(event: RuntimeEvent): DisplayEvent;
}
```

### 3. Field Contracts

#### DisplayEvent (1:1 映射 RuntimeEvent)

| DisplayEvent Type | 对应 RuntimeEvent | 说明 |
|-------------------|-------------------|------|
| `session_started` | `session_started` | 会话开始 |
| `user_turn` | `user_turn` | 用户输入 |
| `assistant_chunk` | `assistant_chunk` | 流式输出 chunk |
| `assistant_message` | `assistant_message` | 完整消息 |
| `tool_call_requested` | `tool_call_requested` | 工具请求 |
| `tool_started` | `tool_started` | 工具开始 |
| `tool_result` | `tool_result` | 工具结果 |
| `tool_failed` | `tool_failed` | 工具失败 |
| `permission_decision` | `permission_decision` | 权限决策 |
| `agent_spawned` | `agent_spawned` | 子 Agent 创建 |
| `agent_completed` | `agent_completed` | 子 Agent 完成 |
| `session_ended` | `session_ended` | 会话结束 |

### 4. Validation Rules

- `processEvent()` 必须是纯函数（无副作用）
- 必须处理所有 `RuntimeEvent` 类型
- 未知事件类型应抛出错误（不静默忽略）
- `DisplayEvent` 字段名应与 `RuntimeEvent` 保持一致（便于调试）

---

## Scenario: UI Renderer Interface

### 1. Scope / Trigger

- Trigger: CLI 使用 stdout.write，TUI 使用 React 组件
- Trigger: 需要定义渲染器接口
- 这属于 I/O 层 contract 变更

### 2. Signatures

```typescript
interface UIRenderer {
  renderEvent(event: DisplayEvent): void;
  flush(): void;
  destroy(): void;
}

// CLI 实现
class CliRenderer implements UIRenderer {
  constructor(params: {
    stdout: Writable;
    style?: 'classic' | 'interactive';
  });
  renderEvent(event: DisplayEvent): void;
  flush(): void;
  destroy(): void;
}

// TUI 实现（在 React Hook 中调用）
function createTuiRenderer(params: {
  setState: React.Dispatch<React.SetStateAction<AppState>>;
}): UIRenderer
```

### 3. Validation Rules

- `renderEvent()` 可以有副作用（写入 stdout 或更新 React state）
- `flush()` 必须确保所有待输出内容都已渲染
- `destroy()` 必须清理资源
- 聚合逻辑（如多个 chunk 合成 message）由 UIRenderer 内部处理

---

## 与现有 Contracts 的关系

本文件扩展 `runtime-contracts.md`，新增以下接口：

核心逻辑集中在 `src/core/` 目录下，使用 `@core/*` 路径别名导入：

| 新增接口 | 位置 | 说明 |
|----------|------|------|
| `RuntimeEnvironment` | `@core/shared/initialize-runtime.ts` | 统一生命周期管理 |
| `InputAdapter` | `@core/adapters/input-adapter.ts` | 输入适配接口 |
| `OutputAdapter` | `@core/adapters/output-adapter.ts` | 输出转换接口 |
| `DefaultOutputAdapter` | `@core/adapters/output-adapter.ts` | 默认输出适配器实现 |
| `executeLocalCommand` | `@core/shared/local-commands.ts` | 本地命令处理 |
| `createHelpCommandsSection` 等 4 段 helper | `@core/shared/command-handlers.ts` | `/help` dialog 内容生成（07-30） |

运行时核心（已迁移到 `src/core/runtime/`）：
- `@core/runtime/agent-loop.ts` - Agent 循环核心
- `@core/runtime/event-types.ts` - 事件类型定义
- `@core/runtime/session-manager.ts` - 会话管理
- `@core/runtime/permission-gate.ts` - 权限闸门
- `@core/runtime/tool-dispatch.ts` - 工具调用分发

CLI 特定实现：
- `@ui/cli-input-adapter.ts` - CLI 输入适配器（必须为 `action: 'help'` 自行渲染到 stdout，07-30）

TUI 特定实现：
- `@tui/tui-input-adapter.ts` - TUI 输入适配器
- `@tui/hooks/use-runtime-unified.ts` - TUI 运行时 Hook
- `@tui/hooks/use-local-commands.ts` - TUI 本地命令 Hook
- `@tui/components/HelpCommandsView.tsx` - `/help` dialog（07-30）
- `@tui/components/HelpShortcutsView.tsx` - `?` key dialog（07-30）

所有的 `runAgentLoop()`、`AgentProvider`、`SessionManager` 等接口现在都在 `src/core/runtime/` 下。
