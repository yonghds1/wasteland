# Runtime-TUI Integration Research

> 研究目标：分析 rx-cli 项目中 runtime 层和 TUI 层的对接点，为实现 TUI 与 Runtime 的对接提供完整信息。

## 1. 文件清单

### 1.1 Runtime 层文件

| 文件路径 | 用途 |
|---------|------|
| `src/runtime/event-types.ts` | 运行时事件类型定义（RuntimeEvent, SessionRecord 等） |
| `src/runtime/agent-loop.ts` | Agent 主循环，输出 events$ 和 debug$ 流 |
| `src/runtime/session-manager.ts` | Session 管理器，处理会话持久化 |
| `src/runtime/debug-events.ts` | 调试追踪事件定义 |
| `src/runtime/turn-context.ts` | Turn 上下文类型定义 |
| `src/runtime/turn-state.ts` | Turn 状态管理 |
| `src/runtime/permission-gate.ts` | 权限决策系统 |
| `src/runtime/tool-dispatch.ts` | 工具调用分发 |

### 1.2 TUI 层文件

| 文件路径 | 用途 |
|---------|------|
| `src/tui/index.tsx` | TUI 入口，启动 ink 应用 |
| `src/tui/App.tsx` | 根组件，页面路由和全局状态 |
| `src/tui/context/AppContext.tsx` | 全局状态类型定义和 Context |
| `src/tui/components/session/SessionPage.tsx` | 会话页面 |
| `src/tui/components/session/AgentTree.tsx` | Agent 树组件 |
| `src/tui/components/session/MessageList.tsx` | 消息列表组件 |
| `src/tui/components/debug/DebugPage.tsx` | 调试页面 |
| `src/tui/components/debug/TraceLog.tsx` | Trace 日志组件 |
| `src/tui/components/config/ConfigPage.tsx` | 配置页面 |

### 1.3 命令入口文件

| 文件路径 | 用途 |
|---------|------|
| `src/commands/tui.ts` | TUI 命令入口 |
| `src/commands/chat.ts` | Chat 命令入口（参考实现） |

---

## 2. Runtime 层接口分析

### 2.1 runAgentLoop 主入口

**位置**：`src/runtime/agent-loop.ts`

**签名**：
```typescript
function runAgentLoop(params: {
  input$: Observable<ChatInputTurn>;
  provider: AgentProvider;
  sessionManager: SessionManager;
  toolRegistry?: ToolRegistry;
  permissionGate?: PermissionGate;
  cwd: string;
  mode: RuntimeMode;
  maxStepsPerTurn?: number;
  existingSession?: SessionMetadata;
}): AgentRun
```

**返回值**：
```typescript
type AgentRun = {
  events$: Observable<RuntimeEvent>;    // 运行时事件流
  debug$: Observable<DebugTraceEvent>;  // 调试追踪流
};
```

**关键特点**：
- 使用 RxJS Observable 实现流式输出
- 返回两个独立的事件流：`events$`（业务事件）和 `debug$`（调试追踪）
- 支持单次执行模式（"single"）和交互模式（"interactive"）

### 2.2 RuntimeEvent 事件类型

**位置**：`src/runtime/event-types.ts`

**事件类型列表**：

| 事件类型 | 用途 | 关键字段 |
|---------|------|---------|
| `session_started` | 会话开始 | sessionId, sessionPath, mode |
| `user_turn` | 用户输入 | sessionId, turn, content, source |
| `assistant_chunk` | AI 响应片段（流式） | sessionId, turn, chunk |
| `assistant_message` | AI 响应完成 | sessionId, turn, content |
| `tool_call_requested` | 工具调用请求 | sessionId, turn, callId, toolName, input |
| `permission_decision` | 权限决策 | sessionId, turn, callId, toolName, decision, mode, reason |
| `tool_started` | 工具开始执行 | sessionId, turn, callId, toolName |
| `tool_result` | 工具执行成功 | sessionId, turn, callId, toolName, status, output |
| `tool_failed` | 工具执行失败 | sessionId, turn, callId, toolName, status, error |
| `session_ended` | 会话结束 | sessionId |
| `agent_spawned` | 子 Agent 创建 | parentId, childId, childSessionPath, name, task |
| `agent_completed` | 子 Agent 完成 | childId, status, result?, error?, sessionPath |

### 2.3 DebugTraceEvent 类型

**位置**：`src/runtime/debug-events.ts`

```typescript
type DebugTraceEvent = {
  timestamp: string;
  sessionId: string;
  turn?: number;
  step?: number;
  scope: DebugTraceScope;  // "session" | "turn" | "provider" | "tool" | "ui"
  phase: string;
  message: string;
  data?: Record<string, unknown>;
};
```

**典型 phase 值**：
- `session.start`, `session.end`, `session.error`
- `turn.input`, `turn.advance`, `turn.complete`, `turn.max_steps`
- `provider.start`, `provider.event`, `provider.empty`
- `tool.start`, `tool.permission`, `tool.result`

### 2.4 SessionManager 接口

**位置**：`src/runtime/session-manager.ts`

```typescript
class SessionManager {
  // 创建新会话
  async startSession(params: {
    cwd: string;
    mode: RuntimeMode;
    providerId: string;
  }): Promise<SessionMetadata>;

  // 创建子 Agent 会话
  async createChildSession(
    parent: SessionMetadata,
    name: string,
  ): Promise<SessionMetadata>;

  // 追加记录
  async appendRecord(session: SessionMetadata, record: SessionRecord): Promise<void>;

  // 刷新缓冲区
  async flush(sessionId: string): Promise<void>;

  // 关闭会话
  async closeSession(sessionId: string): Promise<void>;

  // 关闭所有会话
  async closeAll(): Promise<void>;
}
```

**SessionMetadata 结构**：
```typescript
type SessionMetadata = {
  id: string;           // 格式: 2026-05-23T14-30-00_abc123
  path: string;         // 会话文件路径
  cwd: string;          // 工作目录
  mode: RuntimeMode;    // "single" | "interactive"
  providerId: string;   // Provider 标识
  parentId?: string;    // 父会话 ID（子 Agent）
  childName?: string;   // 子 Agent 名称
};
```

### 2.5 SessionRecord 持久化类型

**位置**：`src/runtime/event-types.ts`

```typescript
type SessionRecord =
  | { type: "session"; sessionId: string; mode: RuntimeMode; cwd: string; provider: string; timestamp: string; parentId?: string; childName?: string; }
  | SessionMessageRecord
  | SessionToolCallRecord
  | SessionPermissionRecord
  | SessionToolResultRecord
  | { type: "session_end"; sessionId: string; timestamp: string; };

type SessionMessageRecord = {
  type: "message";
  role: "user" | "assistant";
  turn: number;
  content: string;
  timestamp: string;
  source?: InputSource;
};
```

---

## 3. TUI 数据结构分析

### 3.1 AppState 全局状态

**位置**：`src/tui/context/AppContext.tsx`

```typescript
interface AppState {
  currentPage: PageName;  // "session" | "debug" | "config"

  // 模式状态
  inputMode: boolean;           // 是否在输入模式
  exitConfirmPending: boolean;  // 是否等待退出确认
  showHelp: boolean;            // 是否显示帮助

  // 会话状态
  session: {
    agents: AgentNode[];
    messages: Message[];
    tools: ToolCall[];
    isStreaming: boolean;
  };

  // 调试状态
  debug: {
    traces: TraceEvent[];
    filter: TraceFilter;
  };

  // 配置状态
  config: {
    provider: string;
    model: string;
    permissionMode: string;
    maxTurns: number;
    maxSteps: number;
  };
}
```

### 3.2 TUI 子类型定义

**AgentNode**：
```typescript
interface AgentNode {
  id: string;
  name: string;
  depth: number;
  status: "running" | "idle" | "completed" | "failed" | "timeout";
  startTime: number;
  endTime?: number;
}
```

**Message**：
```typescript
interface Message {
  id: string;
  timestamp: string;
  agentId: string;
  type: "user" | "assistant" | "tool" | "system";
  content: string;
  collapsed?: boolean;
}
```

**ToolCall（TUI）**：
```typescript
interface ToolCall {
  id: string;
  name: string;
  status: "pending" | "running" | "success" | "error";
  duration?: number;
}
```

**TraceEvent（TUI）**：
```typescript
interface TraceEvent {
  timestamp: string;
  sessionId: string;
  turn?: number;
  step?: number;
  scope: string;
  phase: string;
  message: string;
  data?: Record<string, unknown>;
}
```

---

## 4. 数据格式差异分析

### 4.1 RuntimeEvent → TUI Message 映射

| RuntimeEvent | TUI Message 字段映射 |
|-------------|---------------------|
| `user_turn` | `{ id: callId?, timestamp, agentId: sessionId, type: "user", content }` |
| `assistant_chunk` | 需要累积，不直接映射为 Message |
| `assistant_message` | `{ id: turn-based, timestamp, agentId: sessionId, type: "assistant", content }` |
| `tool_result` / `tool_failed` | `{ id: callId, timestamp, agentId: sessionId, type: "tool", content: output/error }` |

**关键差异**：
1. TUI Message 需要 `id` 字段，RuntimeEvent 中 tool 相关有 callId，message 相关需要生成
2. TUI Message 需要 `agentId` 字段，对应 RuntimeEvent 的 `sessionId`
3. `assistant_chunk` 需要累积后合并，不应作为独立 Message

### 4.2 RuntimeEvent → TUI ToolCall 映射

| RuntimeEvent | TUI ToolCall 状态 |
|-------------|------------------|
| `tool_call_requested` | `{ status: "pending" }` |
| `tool_started` | `{ status: "running" }` |
| `tool_result` | `{ status: "success" }` |
| `tool_failed` | `{ status: "error" }` |

**关键差异**：
1. Runtime 中 tool 状态分散在多个事件中，TUI 需要聚合
2. TUI 需要计算 `duration`（从 `tool_started` 到 `tool_result`/`tool_failed`）

### 4.3 agent_spawned/agent_completed → TUI AgentNode 映射

| RuntimeEvent | AgentNode 字段 |
|-------------|---------------|
| `agent_spawned` | `{ id: childId, name, depth: inferFromId, status: "running", startTime: now }` |
| `agent_completed` | 更新 `{ status, endTime: now }` |

**关键差异**：
1. Runtime 中 `depth` 需要从 `sessionId` 推断（统计 `-child-` 出现次数）
2. TUI 主 Agent（depth=0）需要手动创建，不在 RuntimeEvent 中

### 4.4 DebugTraceEvent → TUI TraceEvent 映射

**完全兼容**，类型定义一致，可直接传递。

---

## 5. 命令入口分析

### 5.1 TUI 命令当前实现

**位置**：`src/commands/tui.ts`

```typescript
export function createTuiCommand(): Command {
  return new Command("tui")
    .description("启动交互式 TUI Dashboard")
    .option("--attach <session>", "附加到已有 session")
    .action(async (options) => {
      // TTY 检测
      const tty = detectTTY();
      if (!tty.isInteractive) {
        // 错误提示...
        process.exit(1);
      }

      try {
        await runTUI();  // 当前只是渲染静态 UI
      } catch (error) {
        console.error("TUI 启动失败:", error);
        process.exit(1);
      }
    });
}
```

**当前问题**：
- `runTUI()` 不接收任何 runtime 相关参数
- 没有创建 SessionManager、Provider、PermissionGate 等
- 没有订阅任何事件流

### 5.2 Chat 命令参考实现

**位置**：`src/commands/chat.ts`

```typescript
async function runChatSession(params: {
  input$: Observable<ChatInputTurn>;
  provider: AgentProvider;
  sessionManager: SessionManager;
  cwd: string;
  mode: RuntimeMode;
  debug: boolean;
  debugFormat: DebugFormat;
  projectConfigDir: string | null;
  permissionMode: ReturnType<typeof resolvePermissionMode>;
  maxStepsPerTurn: number;
  render?: {
    onTurnComplete?: () => void;
    style?: "classic" | "interactive";
  };
}): Promise<void> {
  const run = runAgentLoop({
    input$: params.input$,
    provider: params.provider,
    sessionManager: params.sessionManager,
    toolRegistry: createDefaultToolRegistry(),
    permissionGate: createPermissionGate({ mode: params.permissionMode }),
    cwd: params.cwd,
    mode: params.mode,
    maxStepsPerTurn: params.maxStepsPerTurn,
  });

  const work: Promise<void>[] = [
    renderRuntimeEvents(run.events$, params.render),
  ];

  if (params.debug) {
    work.unshift(
      renderDebugTrace(run.debug$, {
        output: process.stderr,
        format: params.debugFormat,
        traceDir,
      }),
    );
  }

  await Promise.all(work);
}
```

**关键模式**：
1. 创建 `runAgentLoop()` 获取事件流
2. 订阅 `events$` 渲染到终端
3. 订阅 `debug$` 输出调试信息（可选）
4. 使用 `Promise.all()` 等待所有订阅完成

---

## 6. 事件流向分析

### 6.1 当前 Chat 命令事件流

```
用户输入
    ↓
createInteractiveTurnStream()
    ↓
Observable<ChatInputTurn>
    ↓
runAgentLoop()
    ↓
┌───────────────────────────────────┐
│ events$: Observable<RuntimeEvent> │
│ debug$: Observable<DebugTraceEvent>│
└───────────────────────────────────┘
    ↓                    ↓
renderRuntimeEvents()  renderDebugTrace()
    ↓                    ↓
  stdout              stderr
```

### 6.2 TUI 需要的事件流

```
用户输入
    ↓
Observable<ChatInputTurn>
    ↓
runAgentLoop()
    ↓
┌───────────────────────────────────┐
│ events$: Observable<RuntimeEvent> │
│ debug$: Observable<DebugTraceEvent>│
└───────────────────────────────────┘
    ↓                    ↓
eventsToAppState()    traces直接追加
    ↓
setState({ session, debug })
    ↓
React 组件重新渲染
```

---

## 7. 需要创建的适配层

### 7.1 事件 → 状态转换器

**建议位置**：`src/tui/hooks/useRuntimeEvents.ts`

**功能**：
1. 订阅 `events$` 和 `debug$` 流
2. 将 RuntimeEvent 转换为 AppState 更新
3. 处理 chunk 累积逻辑
4. 管理 Agent 树状态

**核心逻辑**：
```typescript
function useRuntimeEvents(
  events$: Observable<RuntimeEvent>,
  debug$: Observable<DebugTraceEvent>
): {
  agents: AgentNode[];
  messages: Message[];
  tools: ToolCall[];
  traces: TraceEvent[];
  isStreaming: boolean;
} {
  // 状态累积逻辑...
}
```

### 7.2 用户输入处理

**建议位置**：`src/tui/hooks/useUserInput.ts`

**功能**：
1. 创建 Subject<ChatInputTurn>
2. 处理 InputBar 提交
3. 管理输入模式状态

### 7.3 Runtime 初始化器

**建议位置**：`src/tui/hooks/useRuntime.ts`

**功能**：
1. 加载配置（复用 `loadRxcSettings`）
2. 创建 Provider
3. 创建 SessionManager
4. 创建 PermissionGate
5. 调用 `runAgentLoop`

---

## 8. 实现建议

### 8.1 最小改动方案

1. **修改 `src/commands/tui.ts`**：
   - 添加配置加载逻辑
   - 创建 runtime 组件
   - 将 runtime 传递给 `runTUI()`

2. **修改 `src/tui/index.tsx`**：
   - 接收 runtime 参数
   - 创建 RxJS 订阅
   - 将事件转换为 React 状态

3. **创建适配 Hook**：
   - `useRuntimeEvents`：事件 → 状态转换
   - `useAgentTree`：Agent 树状态管理
   - `useMessageList`：消息列表状态管理

### 8.2 关键技术点

1. **RxJS 订阅在 React 中的处理**：
   ```typescript
   useEffect(() => {
     const subscription = events$.subscribe({
       next: (event) => setState(transform(event)),
       error: (err) => console.error(err),
       complete: () => console.log("completed"),
     });
     return () => subscription.unsubscribe();
   }, [events$]);
   ```

2. **Chunk 累积**：
   - 使用 `useRef` 存储累积的 chunks
   - 在 `assistant_message` 事件时创建最终 Message

3. **Agent 深度推断**：
   ```typescript
   function inferDepth(sessionId: string): number {
     return (sessionId.match(/-child-/g) || []).length;
   }
   ```

4. **ToolCall 状态聚合**：
   - 使用 `Map<string, ToolCall>` 按 callId 存储中间状态
   - 根据事件类型更新状态

### 8.3 需要新增的类型定义

**建议位置**：`src/tui/types.ts`（新建）

```typescript
// 从 runtime 导入并重命名，避免冲突
export type { RuntimeEvent, DebugTraceEvent } from "../runtime/event-types.js";

// TUI 特有的运行时上下文
export interface TuiRuntimeContext {
  events$: Observable<RuntimeEvent>;
  debug$: Observable<DebugTraceEvent>;
  sendInput: (content: string, source: InputSource) => void;
  session: SessionMetadata;
}
```

---

## 9. 依赖关系图

```
                    ┌─────────────────────────────────────┐
                    │           commands/tui.ts           │
                    │  (入口：创建 runtime、传递给 TUI)    │
                    └─────────────────┬───────────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          │                           │                           │
          ▼                           ▼                           ▼
┌─────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│ config/         │     │ runtime/            │     │ tui/                │
│ load-settings   │     │ agent-loop          │     │ index.tsx           │
│ resolve-runtime │     │ session-manager     │     │ (接收 runtime)      │
└─────────────────┘     └─────────────────────┘     └──────────┬──────────┘
                                                              │
                                                              ▼
                                              ┌───────────────────────────────┐
                                              │ tui/hooks/                    │
                                              │ useRuntimeEvents              │
                                              │ (订阅 events$、debug$)        │
                                              └───────────────┬───────────────┘
                                                              │
                                                              ▼
                                              ┌───────────────────────────────┐
                                              │ tui/context/AppContext.tsx    │
                                              │ (全局状态：agents, messages,  │
                                              │  tools, traces)               │
                                              └───────────────┬───────────────┘
                                                              │
                                      ┌───────────────────────┼───────────────────────┐
                                      │                       │                       │
                                      ▼                       ▼                       ▼
                              ┌───────────────┐     ┌───────────────┐     ┌───────────────┐
                              │ SessionPage   │     │ DebugPage     │     │ ConfigPage    │
                              │ (AgentTree,   │     │ (TraceLog,    │     │ (配置显示)    │
                              │  MessageList) │     │  SessionInfo) │     │               │
                              └───────────────┘     └───────────────┘     └───────────────┘
```

---

## 10. 总结

### 10.1 TUI 需要的 Runtime 数据

| 数据 | 来源 | 用途 |
|------|------|------|
| 会话消息 | `events$` → user_turn, assistant_message, tool_* | MessageList 显示 |
| Agent 树 | `events$` → agent_spawned, agent_completed | AgentTree 显示 |
| 工具状态 | `events$` → tool_* 事件聚合 | 工具执行状态显示 |
| 调试追踪 | `debug$` | TraceLog 显示 |
| 配置信息 | `loadRxcSettings()` | ConfigPage 显示 |

### 10.2 Runtime 提供的接口

| 接口 | 功能 |
|------|------|
| `runAgentLoop()` | 创建 Agent 运行循环，返回事件流 |
| `SessionManager` | 会话创建和持久化 |
| `loadRxcSettings()` | 配置加载 |
| `resolveChatRuntime()` | Provider 解析 |

### 10.3 主要对接工作

1. **修改 TUI 入口**：接收 runtime 参数，创建事件订阅
2. **创建适配 Hook**：将 RuntimeEvent 转换为 AppState 更新
3. **处理状态累积**：chunk 合并、Agent 树构建、Tool 状态聚合
4. **用户输入集成**：将 InputBar 输入转换为 ChatInputTurn
