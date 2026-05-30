# CLI 和 TUI 输出渲染链路分析

## 概述

rx-cli 的 CLI 和 TUI 两个 UI 路径都从同一个核心运行时（`agent-loop.ts`）获取事件流，但事件的消费方式完全不同。

## 1. agent-loop.ts 的输出接口

`runAgentLoop()` 返回 `AgentRun` 对象：

```typescript
type AgentRun = {
  events$: Observable<RuntimeEvent>;  // 运行时事件流
  debug$: Observable<DebugTraceEvent>; // 调试追踪流
};
```

**数据流向**：
```
input$ (用户输入) → runAgentLoop → events$ (RuntimeEvent 流)
                                 → debug$ (DebugTraceEvent 流)
```

## 2. event-types.ts 事件格式

`RuntimeEvent` 是可辨识联合类型，所有事件共享 `type` 字段：

| 事件类型 | 关键字段 | 用途 |
|---------|---------|------|
| `session_started` | sessionId, sessionPath, mode | 会话开始 |
| `user_turn` | sessionId, turn, content, source | 用户输入 |
| `assistant_chunk` | sessionId, turn, chunk | 流式响应片段 |
| `assistant_message` | sessionId, turn, content | 响应完成 |
| `tool_call_requested` | sessionId, turn, callId, toolName, input | 工具调用请求 |
| `permission_decision` | sessionId, turn, callId, decision, mode | 权限决策 |
| `tool_started` | sessionId, turn, callId, toolName | 工具开始执行 |
| `tool_result` | sessionId, turn, callId, toolName, status, output | 工具执行成功 |
| `tool_failed` | sessionId, turn, callId, toolName, status, error | 工具执行失败 |
| `session_ended` | sessionId | 会话结束 |
| `agent_spawned` | parentId, childId, name, task | 子 Agent 创建 |
| `agent_completed` | childId, status, result, error | 子 Agent 完成 |
| `skill_started` | sessionId, turn, skillName, args | 技能调用开始 |
| `skill_result` | sessionId, turn, skillName, result | 技能执行结果 |

## 3. CLI 输出链路

**文件**: `src/ui/terminal-renderer.ts`

**输入**: `Observable<RuntimeEvent>`

**处理方式**: 直接订阅事件流，使用 `switch` 语句处理每种事件类型，直接写入 `stdout`。

```typescript
export async function renderRuntimeEvents(
  events$: Observable<RuntimeEvent>,
  params?: {
    stdout?: Writable;
    stderr?: Writable;
    onTurnComplete?: () => void;
    style?: 'classic' | 'interactive';
  }
): Promise<void>
```

**渲染逻辑**:
- `assistant_chunk`: 直接写入 `stdout.write(event.chunk)`
- `assistant_message`: 写入完整内容
- `tool_*`: 格式化输出工具状态
- `session_*`: 输出会话生命周期信息

**调用点**: `src/commands/chat.ts` 中 `runChatSession()` 函数

```typescript
const run = runAgentLoop({ ... });
await renderRuntimeEvents(run.events$, params.render);
```

## 4. TUI 输出链路

**文件**: `src/tui/hooks/useRuntimeEvents.ts`

**输入**: `Observable<RuntimeEvent>` (通过 `TuiRuntimeContext.events$`)

**处理方式**: React Hook 订阅事件流，将事件转换为 React 状态更新。

```typescript
export function useRuntimeEvents(
  events$: TuiRuntimeEvents | null,
  debug$: TuiRuntimeDebug | null,
  setState: React.Dispatch<React.SetStateAction<AppState>>
): void
```

**状态转换** (`processRuntimeEvent` 函数):
- `session_started`: 创建主 Agent 节点，设置 `isThinking = true`
- `user_turn`: 添加用户消息到 `messages[]`
- `assistant_chunk`: 累积到 `streamingContent`，触发打字机效果
- `assistant_message`: 创建 assistant 消息，重置流式状态
- `tool_*`: 更新 `tools[]` 状态，添加工具消息到 `messages[]`
- `agent_spawned/completed`: 更新 Agent 树

**渲染组件**: `src/tui/components/session/MessageList.tsx`

**调用点**: `src/tui/index.tsx` → `App.tsx` → `SessionPage.tsx`

## 5. 事件格式统一性

**是的，事件格式完全统一**。CLI 和 TUI 都消费相同的 `RuntimeEvent` 类型：

```typescript
// 两者都从同一个源头获取
const run = runAgentLoop({ input$, ... });

// CLI: 直接订阅
renderRuntimeEvents(run.events$);

// TUI: 通过 React Hook 订阅
useRuntimeEvents(runtime.events$, runtime.debug$, setState);
```

## 6. agent-loop 返回值/回调对比

| 维度 | CLI | TUI |
|------|-----|-----|
| **事件源** | `run.events$` | `runtime.events$` (同源) |
| **调试流** | `run.debug$` | `runtime.debug$` (同源) |
| **输入方式** | `createInteractiveTurnStream()` | `Subject<ChatInputTurn>` |
| **渲染方式** | 直接写 stdout | React 状态更新 |
| **输出格式** | ANSI 终端格式 | Ink (React) 组件 |

**关键差异**:
- CLI 使用 `readline` 库创建交互式输入流
- TUI 使用 RxJS `Subject` 作为输入
- 两者都调用同一个 `runAgentLoop()` 函数

## 7. 输出内容数据结构对比

### CLI 数据结构
```typescript
// 直接输出原始事件内容
stdout.write(event.chunk);  // assistant_chunk
stdout.write(`assistant[${event.turn}]> ${event.content}\n`);  // assistant_message
```

### TUI 数据结构
```typescript
// 转换为 React 组件状态
interface Message {
  id: string;
  timestamp: string;
  agentId: string;
  type: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  collapsed?: boolean;
}

interface ToolCall {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'success' | 'error';
  duration?: number;
}

interface AgentNode {
  id: string;
  name: string;
  depth: number;
  status: 'running' | 'idle' | 'completed' | 'failed' | 'timeout';
  startTime: number;
  endTime?: number;
}
```

## 8. 未处理的事件类型

以下事件在 `RuntimeEvent` 中定义，但 **CLI 和 TUI 都未显式处理**:

- `skill_started` - 技能调用开始事件
- `skill_result` - 技能执行结果事件

这些事件会被发送到 `default` 分支（CLI）或忽略（TUI）。

## 9. 文件路径汇总

| 文件路径 | 描述 |
|---------|------|
| `src/runtime/agent-loop.ts` | 核心运行时，产生 events$ 和 debug$ |
| `src/runtime/event-types.ts` | RuntimeEvent 类型定义 |
| `src/runtime/debug-events.ts` | DebugTraceEvent 类型定义 |
| `src/ui/terminal-renderer.ts` | CLI 事件消费和渲染 |
| `src/commands/chat.ts` | CLI 入口，调用 renderRuntimeEvents |
| `src/tui/hooks/useRuntime.ts` | TUI 运行时初始化 |
| `src/tui/hooks/useRuntimeEvents.ts` | TUI 事件订阅和状态转换 |
| `src/tui/context/AppContext.tsx` | TUI 全局状态定义 |
| `src/tui/components/session/MessageList.tsx` | TUI 消息列表渲染组件 |
| `src/tui/types.ts` | TUI 类型定义 |

## 10. 架构总结

```
┌─────────────────────────────────────────────────────────────┐
│                    agent-loop.ts                            │
│  input$ → runAgentLoop → events$ (Observable<RuntimeEvent>) │
│                          → debug$  (Observable<DebugTraceEvent>) │
└───────────────────────────┬─────────────────────────────────┘
                            │
          ┌─────────────────┴─────────────────┐
          │                                   │
          ▼                                   ▼
┌─────────────────────┐             ┌─────────────────────┐
│  CLI Path           │             │  TUI Path           │
│  terminal-renderer.ts│             │  useRuntimeEvents.ts│
│  直接订阅 events$    │             │  React Hook 订阅    │
│  stdout.write()     │             │  setState()         │
└─────────────────────┘             └─────────────────────┘
```

## 关键发现

1. **事件源统一**: CLI 和 TUI 都从同一个 `runAgentLoop()` 获取事件流
2. **事件格式统一**: 都消费相同的 `RuntimeEvent` 类型
3. **消费方式不同**: CLI 直接写 stdout，TUI 转换为 React 状态
4. **skill 事件未处理**: `skill_started` 和 `skill_result` 事件在两个 UI 路径中都被忽略
5. **数据结构差异**: CLI 保持原始事件格式，TUI 转换为组件状态（Message, ToolCall, AgentNode）
