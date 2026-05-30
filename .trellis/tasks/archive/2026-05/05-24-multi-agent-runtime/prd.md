# 多 Agent 运行时架构

## Goal

将当前的单 Agent CLI 架构演进为**兼容单 Agent 和多 Agent** 的运行时：
- **单 Agent 模式**：保持现有行为，一个 agent 独立运行（默认）
- **多 Agent 模式**：用户可选择编排方式，由智能体推荐最佳方案

## What I already know

**现有架构**：

1. **单 Agent Loop** - `runAgentLoop()` 处理单个 agent 的对话循环
2. **Provider 抽象** - `AgentProvider` 接口定义 `runStep()` 契约，返回 `Observable<ProviderStreamEvent>`
3. **Tool 系统** - 完整的工具注册、权限闸门、工具执行链路
4. **Session 管理** - transcript 持久化到 JSONL
5. **RxJS 事件流** - `RuntimeEvent` 类型覆盖会话生命周期、消息、工具调用
6. **Turn 模型** - 用户输入 → provider 响应 → 工具调用 → 递归循环

**当前限制**：

- 一次只能运行一个 agent
- 没有 agent 间通信机制
- 没有任务分解和委派能力
- 没有并行执行能力

**用户初始描述**：
- 使用 RxJS 构建多 agent 运行的智能体

## Assumptions (temporary)

- 多 agent 可能涉及：并行执行、层级编排、协作模式
- 需要与现有 `runAgentLoop` 架构兼容或在其上扩展
- RxJS 的事件流模型天然适合多 agent 编排

## Research References

* [`research/multi-agent-patterns.md`](research/multi-agent-patterns.md) — Agents-as-Tools 模式最适合本项目
* [`research/claude-code-codex-patterns.md`](research/claude-code-codex-patterns.md) — Claude Code 自然语言编排模式

## Research Notes

### Claude Code 的关键模式

**1. 自然语言编排**
```markdown
Launch 4 agents in parallel to independently review:
- Agent 1: CLAUDE.md compliance sonnet agent
- Agent 2: Opus bug agent
```

**2. Agent 定义（Markdown + YAML frontmatter）**
```markdown
---
name: code-reviewer
description: Reviews code for bugs
tools: Glob, Grep, Read
model: sonnet
---
```

**3. 模型选择策略**
| 模型 | 用途 |
|------|------|
| haiku | 快速检查、过滤 |
| sonnet | 标准分析 |
| opus | 复杂推理 |

**4. 置信度过滤**
- Agent 返回 0-100 置信度
- 只报告 ≥80 的问题

### 推荐方案：Agents-as-Tools + 自然语言编排

**核心设计**：
- **单 Agent 模式（默认）**：保持现有 `runAgentLoop` 行为
- **多 Agent 模式**：通过 `spawn_agent` 工具触发，主 Agent 决定是否需要子 Agent
- **CLI 切换**：可选参数提示系统，但实际编排由 Agent 决定

### 与现有架构的整合点

| 现有模块 | 整合方式 |
|---------|---------|
| `ToolRegistry` | 添加 `spawn_agent` 工具 |
| `PermissionGate` | 控制 spawn 权限 |
| `ToolRunner` | 执行子 agent 并返回结果 |
| `RuntimeEvent` | 添加 `agent_spawned`、`agent_completed` 事件 |

### RxJS 并行模式

```typescript
// 并行执行多个子 Agent
const parallelAgents$ = forkJoin({
  researcher: runChildAgent({ type: "researcher", task: "..." }),
  coder: runChildAgent({ type: "coder", task: "..." }),
  reviewer: runChildAgent({ type: "reviewer", task: "..." })
});
// 返回: { researcher: result, coder: result, reviewer: result }
```

## Open Questions

### Blocking
1. ~~"多 Agent" 的具体场景是什么？~~
   - ✅ **主从编排模式**：主 Agent 规划任务 → 委派子 Agent 并行执行 → 汇总反馈 → 主 Agent 判断完成 → 循环

### Preference
2. ~~spawn_agent 工具的参数设计？~~
   - ✅ **最小参数**：`{ name, task }`

3. ~~子 Agent 的 Session 管理？~~
   - ✅ **独立 session 文件**：`{parentSessionId}-child-{name}.jsonl`

4. ~~并行执行的超时和错误处理？~~
   - ✅ **容错模式**：部分失败不影响其他，主 Agent 决定后续处理

## Requirements (evolving)

### 核心需求

- ✅ **单 Agent 模式（默认）**
  - 保持现有 `runAgentLoop` 行为
  - 不调用 `spawn_agent` 就是单 Agent

- ✅ **多 Agent 模式（可选）**
  - 通过 `spawn_agent` 工具触发
  - 主 Agent 决定是否需要子 Agent、需要几个
  - 子 Agent 并行或串行执行

- ✅ **CLI 模式切换**
  ```bash
  # 默认单 Agent
  rxc chat --message "分析代码"

  # 提示系统使用多 Agent（可选）
  rxc chat --multi --message "重构 UserService"
  # Agent 自行决定是否 spawn 子 Agent

  # 指定编排策略（可选）
  rxc chat --workflow parallel --message "..."
  ```

### spawn_agent 工具

- ✅ **spawn_agent 作为工具**
  - 符合现有 tool contract
  - 子 Agent 执行完成后返回 `tool_result`

- ✅ **spawn_agent 参数设计（参考 Claude Code）**
  ```typescript
  spawn_agent({
    name: string;      // 子 Agent 标识
    task: string;      // 任务描述
    model?: string;    // 可选：模型选择（haiku/sonnet/opus）
    tools?: string[];  // 可选：限定工具集
  })
  ```

### 执行和错误处理

- ✅ **并行/串行执行**
  - 主 Agent 可一次发出多个 spawn_agent（并行）
  - 主 Agent 也可每个 turn 只发一个（串行）
  - 使用 RxJS `forkJoin` 实现并行

- ✅ **子 Agent Session 管理**
  - 每个子 Agent 有独立的 session 文件
  - 命名规则：`{parentSessionId}-child-{name}.jsonl`

- ✅ **并行错误处理（容错模式）**
  - 一个失败不影响其他
  - 全部完成后汇总成功/失败结果

## Acceptance Criteria (evolving)

### 单 Agent 模式（默认）
- [x] 不调用 spawn_agent 时，行为与现有 `runAgentLoop` 一致
- [x] 单 Agent 能正常执行所有现有工具

### 多 Agent 模式
- [x] `spawn_agent` 工具可被注册和调用
- [x] 子 Agent 能独立执行并返回结果
- [x] 多个子 Agent 能并行执行（handleParallelSpawns 已实现，待后续集成）
- [x] 部分失败时其他继续执行
- [x] 每个 Agent 有独立的 session 文件

### CLI 切换
- [x] 默认行为是单 Agent
- [x] ~~`--multi` 参数~~ 已移除（agent 自主决策是否 spawn）
- [x] Agent 能根据任务复杂度自主决定是否 spawn（由真实 provider 驱动）

### 事件流
- [x] RuntimeEvent 包含 agent 生命周期事件
- [x] UI 能正确显示多 Agent 执行状态（深度标识、颜色区分、时间戳）
- [x] Session JSONL 记录包含时间戳和层级信息（parentId、childName）
- [x] Session 时间戳格式优化（本地时间，精确到秒）
- [x] Session 缓冲写入机制（10 条/5 秒阈值）

## Definition of Done (team quality bar)

- Tests added/updated (unit/integration where appropriate)
- Lint / typecheck / CI green
- Docs/notes updated if behavior changes
- Rollout/rollback considered if risky

## Technical Approach

### 架构整合

```
现有架构（单 Agent）:
  runAgentLoop → runTurnLoop → Provider.runStep → tool_call → dispatchToolCall

多 Agent 扩展（兼容单 Agent）:
  runAgentLoop → runTurnLoop → Provider.runStep
    ↓ (tool_call: spawn_agent)  ← 只有调用 spawn_agent 才触发多 Agent
    → dispatchToolCall
      → spawn_agent tool
        → runAgentLoop (子 Agent, mode="single")
          → 返回 tool_result
```

### 关键实现

**1. CLI 模式切换（可选）**

```typescript
// src/commands/chat.ts
program
  .option("--multi", "提示系统使用多 Agent 模式")
  .option("--workflow <type>", "指定编排策略", "auto");

// --multi 只是提示，实际由 Agent 决定是否 spawn
```

**2. spawn_agent 工具定义**

```typescript
// src/tools/spawn-agent.ts
export const spawnAgentTool: AgentTool = {
  name: "spawn_agent",
  riskLevel: "execute",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "子 Agent 标识" },
      task: { type: "string", description: "任务描述" },
      model: { type: "string", enum: ["haiku", "sonnet", "opus"], description: "模型选择" },
      tools: { type: "array", items: { type: "string" }, description: "限定工具集" }
    },
    required: ["name", "task"]
  },
  async execute(input, context) {
    // 1. 创建子 Agent session
    // 2. 运行子 Agent (forkJoin 实现并行)
    // 3. 返回 tool_result
  }
};
```

**3. 并行执行（使用 forkJoin）**

```typescript
// 在 tool-dispatch.ts 中处理多个 spawn_agent
function handleParallelSpawns(calls: ToolCall[]): Observable<RuntimeEvent> {
  const childRuns = calls.map(call =>
    runChildAgent(call.input).pipe(
      timeout(60000),
      catchError(err => of({ status: "error", error: err.message }))
    )
  );

  return forkJoin(childRuns).pipe(
    map(results => results.map((r, i) => ({
      callId: calls[i].id,
      ...r
    })))
  );
}
```

**4. 事件类型扩展**

```typescript
// 添加到 RuntimeEvent
type MultiAgentEvent =
  | { type: "agent_spawned"; parentId: string; childId: string; name: string; task: string }
  | { type: "agent_completed"; childId: string; status: "success" | "error"; result?: string; sessionPath: string };
```

**5. Session 命名规则**

```typescript
// SessionManager 扩展
function createChildSession(parent: SessionMetadata, name: string): SessionMetadata {
  return {
    id: `${parent.id}-child-${name}`,
    path: parent.path.replace(".jsonl", `-child-${name}.jsonl`),
    parentId: parent.id,
    // ...
  };
}
```

## Decision (ADR-lite)

**Context**: 需要支持多 Agent 协作，现有架构是单 Agent 循环

**Decision**: 采用 Agents-as-Tools 模式
- spawn_agent 作为工具加入 ToolRegistry
- 子 Agent 通过 runAgentLoop 运行（mode="single"）
- 使用 RxJS forkJoin 实现并行

**Consequences**:
- ✅ 最小化架构改动
- ✅ 与现有 tool 系统无缝整合
- ✅ 权限控制复用 PermissionGate
- ⚠️ 需要扩展 RuntimeEvent 类型
- ⚠️ 需要实现子 Agent session 管理

## Out of Scope (explicit)

> **注意**: 以下部分项目已在后续迭代中实现（MCP 集成、resume/sessions 命令）。本文档保留为历史记录。
> 核心架构规范请参阅 [wasteland-spec.md](../../docs/architecture/wasteland-spec.md)。

- ~~MCP 集成~~ ✅ 已实现（`src/tools/mcp-client.ts`, `src/tools/mcp-registry.ts`）
- ~~resume / sessions 命令~~ ✅ 已实现（`src/commands/resume.ts`, `src/commands/sessions.ts`）
- 子 Agent 的嵌套深度限制（后续优化）
- 子 Agent 的资源配额管理（后续优化）
- Markdown 流式渲染 + 语法高亮（需引入 marked/highlight.js 依赖，建议独立 task）
- 折叠式块交互（需要 TUI 框架如 ink/blessed，建议独立 task）

## Technical Notes

**关键文件**：
- `src/runtime/agent-loop.ts` - 核心循环逻辑
- `src/runtime/event-types.ts` - 事件类型定义
- `src/providers/provider-types.ts` - Provider 接口
- `src/tools/tool-types.ts` - 工具类型

**RxJS 模式**：
- `defer + concat + 递归` 循环模式
- `concatMap` 顺序处理
- `Subject` 作为事件发射器
