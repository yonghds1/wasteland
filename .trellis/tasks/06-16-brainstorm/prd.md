# brainstorm: spawn_agent 并行执行

## Goal

实现 spawn_agent 的并行执行能力，让多个子 Agent 可以同时工作，而不是串行等待。这是提升多 Agent 系统效率的关键特性。

## What I already know

### 项目当前状态（0.1.0）

**已完成的核心功能：**
- Agent Runtime（RxJS 响应式循环）✅
- Provider 层（OpenAI 兼容 / Claude / Local）✅
- 工具系统（13 个内置工具 + MCP）✅
- 多 Agent 架构（spawn_agent）✅
- 会话管理（持久化 / Resume / 索引）✅
- 技能系统（发现 / 注册 / 执行）✅
- TUI 界面（Ink/React）✅
- 配置系统（层级合并）✅
- 国际化（中英文）✅
- 工具参数 Schema 统一（Zod）✅ 刚完成

**测试状态：** 305 个测试全部通过

### 架构约束

- Node.js 20+，ESM 模块
- TypeScript 6.x
- RxJS 7.x（核心运行时）
- 已有 Zod + zod-to-json-schema 依赖

## Research References

* [`research/spawn-agent-parallel-execution.md`](research/spawn-agent-parallel-execution.md) — 完整的并行化阻塞点分析和 RxJS 模式建议
* [`research/industry-parallel-tool-execution.md`](research/industry-parallel-tool-execution.md) — 5 大 Agent 框架的并行执行模式分析

## Research Notes

### 核心阻塞点

1. **concatMap 串行处理**（主阻塞点）：agent-loop.ts 第 449 行，所有 tool_call 串行处理
2. **废弃的 handleParallelSpawns**：spawn-agent.ts 中有 forkJoin 实现但未连接
3. **TurnState 顺序假设**：toolCalls/toolResults 数组按顺序累积
4. **UI 事件顺序依赖**：事件序列被 TUI 组件依赖

### 简化因素

- 子 Agent 运行在 `mode: 'single'`（一个 turn 后退出）
- 没有交互式循环需要管理

### 业界标准做法（5 大框架对比）

| 框架 | 并行方式 | 关键模式 |
|------|---------|---------|
| OpenAI Agents SDK | `asyncio.create_task()` + `_FunctionToolBatchExecutor` | 按 task ID 排序结果，支持最大并发配置 |
| LangGraph | `waiting_edges` + `PregelRunner` | State reducers 合并并行状态 |
| CrewAI | `async_execution=True` + `asyncio.create_task()` | 流式输出支持 |
| AutoGen | 默认并行，`parallel_tool_calls=False` 可禁用 | 简单直接 |
| Claude Code | `Promise.all()` + Provider 层批量 | 按 tool_call ID 排序 |

**业界共识**：Buffer + Batch 模式（先收集所有 tool_call，再批量并行执行）

## Decision (ADR-lite)

### Context

当前 spawn_agent 是串行执行的：主 Agent 发出多个 spawn_agent 调用时，第一个完成后才开始第二个。这严重限制了多 Agent 系统的效率。

### Decision

采用 **agent-loop 层缓冲（Buffer + Batch）** 模式实现 spawn_agent 并行执行：

1. **并行范围**：仅 spawn_agent 并行，其他工具保持串行
2. **实现层面**：agent-loop 层缓冲，对 Provider 无感知
3. **失败处理**：Fail-fast（一个失败，取消其他 Agent）
4. **并发上限**：可配置，默认 -1（无限制）
5. **状态管理**：按 tool_call.id 排序存入 TurnState
6. **UI 展示**：Footer 并行状态栏

### Consequences

- 符合业界标准（OpenAI Agents SDK、Claude Code 等）
- 改动集中在 agent-loop.ts，对 Provider 无侵入
- 未来可扩展到其他工具的并行执行
- 需要处理状态更新的顺序保证

## Requirements

### 功能需求

1. **并行 dispatch**：当 provider 一步发出多个 tool_call 时，识别 spawn_agent 调用并用 `merge` 并行执行
2. **Fail-fast**：任一 spawn_agent 失败，取消其他正在运行的 Agent，返回已收集的部分结果
3. **并发控制**：支持通过 settings.json 配置最大并发数（默认 -1 无限制）
4. **状态排序**：并行结果按 tool_call.id 排序后存入 TurnState
5. **UI 反馈**：Footer 区域显示 "Running N agents..." + 每个 Agent 的名称和状态

### 非功能需求

1. **性能**：3 个 spawn_agent 并行执行时，总耗时应接近最慢的那个（而非三者之和）
2. **兼容性**：单个 spawn_agent 调用时行为不变
3. **可观测性**：并行执行的 trace 信息清晰可读

## Acceptance Criteria

- [ ] 3 个 spawn_agent 并行执行时，总耗时 ≤ 最慢单个 + 20% 开销
- [ ] 1 个 spawn_agent 执行时，行为与当前完全一致（回归测试）
- [ ] 并行执行中一个失败，其他 Agent 被正确取消
- [ ] 并行结果按 tool_call.id 正确排序存入 TurnState
- [ ] Footer 并行状态栏正确显示 Agent 数量和状态
- [ ] 所有现有 305 个测试通过
- [ ] 新增并行执行相关的单元测试和集成测试
- [ ] TypeScript 编译无错误，ESLint 无警告

## Definition of Done

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* 其他工具的并行执行（如 bash、read-file 等）
* Agent Team 的并行协调（SendMessage、TaskUpdate 等）
* 分布式并行（跨机器的 Agent 并行）
* 并行执行的流式输出优化（每个 Agent 的 chunk 仍然按顺序显示）

## Technical Approach

### 核心修改：agent-loop.ts 的 runTurnLoop

**当前流程**：
```
Provider stream → concatMap (逐个处理) → tool_call → dispatchToolCall → 等待完成 → 下一个
```

**目标流程**：
```
Provider stream → buffer tool_calls → 分组(并行/串行) → merge(并行组) + concat(串行组) → forkJoin → 按 ID 排序 → state
```

### 实现步骤

1. **添加缓冲机制**：在 runTurnLoop 中，用 `toArray()` 或手动缓冲收集 provider 发出的所有事件
2. **事件分类**：provider 流完成后，将事件分为：
   - `tool_call` 事件：检查是否为 spawn_agent
   - 其他事件（assistant_chunk、assistant_message）：直接处理
3. **并行 dispatch**：spawn_agent 的 tool_calls 用 `merge` 并行 dispatch，每个调用 `forkJoin` 等待结果
4. **串行 dispatch**：其他工具的 tool_calls 保持 `concatMap` 串行处理
5. **结果合并**：并行结果按 tool_call.id 排序，与串行结果合并
6. **状态更新**：按排序后的顺序更新 TurnState

### 关键 RxJS 操作符

- `toArray()`：缓冲 provider 事件
- `merge()`：并行执行多个 spawn_agent
- `forkJoin()`：等待所有并行结果
- `concatMap()`：串行执行非 spawn_agent 工具

### 配置扩展

在 `settings-types.ts` 中添加：
```typescript
parallel?: {
  maxConcurrency?: number; // 默认 -1（无限制）
}
```

### UI 扩展

在 Footer 组件中添加并行状态显示：
```typescript
// 当有并行 Agent 运行时显示
{parallelAgents.length > 0 && (
  <Text color="cyan">
    ⚡ Running {parallelAgents.length} agents: {parallelAgents.map(a => a.name).join(', ')}
  </Text>
)}
```

## Implementation Plan (small PRs)

### PR1: 基础设施 + 配置
- 修改 `settings-types.ts` 添加 parallel 配置
- 修改 `load-settings.ts` 支持并行配置加载
- 添加配置相关的单元测试
- 更新 i18n 文件（en.json, zh.json）

### PR2: agent-loop 核心并行逻辑
- 修改 `agent-loop.ts` 的 `runTurnLoop`：添加事件缓冲和分类
- 实现并行 dispatch（merge + forkJoin）
- 实现 fail-fast 取消机制
- 添加并行执行的 trace 事件
- 添加核心逻辑的单元测试

### PR3: 状态管理 + UI
- 修改 `turn-state.ts`：支持按 ID 排序的结果合并
- 修改 Footer 组件：添加并行状态栏
- 添加 UI 相关的单元测试

### PR4: 集成测试 + 文档
- 添加端到端集成测试（3 个 spawn_agent 并行）
- 更新 README 和用户指南
- 更新 CHANGELOG

## Technical Notes

* 关键文件：`src/core/runtime/agent-loop.ts`（第 449-680 行）
* 废弃代码：`src/tools/spawn-agent.ts` 第 310-351 行的 `handleParallelSpawns` 可参考
* 配置路径：`src/config/settings-types.ts`
* UI 组件：`src/tui/components/common/Footer.tsx`
* 测试目录：`test/runtime/` 和 `test/tools/`
* 代码库路径：/home/ubuntu/workspace/rx-cli
* Trellis 管理：.trellis/ 目录
