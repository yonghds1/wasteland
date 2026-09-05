# 统一 CLI 和 TUI 核心链路

## Goal

将 CLI 和 TUI 的用户输入到输出核心链路统一为一套逻辑，通过 Adapter 模式处理 I/O 边界差异，消除重复代码，确保功能一致性。

## Architecture Decision (ADR-lite)

### Context

CLI 和 TUI 共享相同的核心运行时（agent-loop, providers, tools, skills），但在 I/O 层和生命周期管理上存在差异：
- CLI 用 readline（命令式），TUI 用 React/Ink（声明式）
- 会话创建时机不同
- TUI 缺失 Skills/Role 支持

### Design Principle

**能共用的逻辑在不影响复杂度的前提下抽离出来，转换部分用 adapter 对接。**

- **业务逻辑** — 抽离到共享模块，CLI 和 TUI 调用同一函数
- **I/O 转换** — 用 Adapter 模式适配，各 UI 实现自己的 Adapter

### Decision

采用 **共享业务逻辑 + Adapter 模式** 架构：

1. **共享业务逻辑层** — 本地命令处理、运行时初始化、Role 解析
2. **InputAdapter** — 抽象输入来源，统一为 `ChatInputTurn`
3. **OutputAdapter** — 事件级转换（1:1 映射），统一为 `DisplayEvent`
4. **RuntimeEnvironment** — 统一运行时环境（会话、Skills、Tools、MCP）

### Consequences

- 核心链路完全统一，只有 I/O 适配层不同
- 本地命令处理逻辑共享，CLI 和 TUI 调用同一函数
- 新增 UI 只需实现 InputAdapter 和 OutputAdapter
- 皮肤系统（Skin）暂不纳入本次统一范围

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Unified Pipeline                          │
└─────────────────────────────────────────────────────────────────┘

用户输入
    ↓
┌─────────────────────────────┐
│      InputAdapter           │  readline (CLI) / React Subject (TUI)
│  → ChatInputTurn            │  统一输入格式: {turn, content, source}
└─────────────┬───────────────┘
              ↓
┌─────────────────────────────────────────────────────────────────┐
│                  Shared Business Logic Layer                    │
│  ┌───────────────────┐  ┌───────────────────┐  ┌─────────────┐ │
│  │ RuntimeEnvironment    │  │ LocalCommands     │  │ RoleResolver│ │
│  │ - Session         │  │ - /help           │  │ - resolve() │ │
│  │ - Skills          │  │ - /skills         │  │             │ │
│  │ - MCP             │  │ - /tools          │  │             │ │
│  │ - Provider        │  │ - /clear          │  │             │ │
│  └───────────────────┘  └───────────────────┘  └─────────────┘ │
└─────────────┬───────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────┐
│     agent-loop.ts           │  ← 核心完全统一
│  → Observable<RuntimeEvent> │
└─────────────┬───────────────┘
              ↓
┌─────────────────────────────┐
│     OutputAdapter           │  ← 事件级转换 (1:1 映射)
│  → DisplayEvent             │
└─────────────┬───────────────┘
              ↓
┌─────────────────────────────┐
│      UI Renderer            │  stdout.write (CLI) / React 组件 (TUI)
└─────────────────────────────┘
```

### 共享业务逻辑 vs Adapter 对接

| 层级 | 共享逻辑 | Adapter 对接 |
|------|----------|--------------|
| **输入** | 本地命令处理逻辑 | InputAdapter（触发机制不同） |
| **核心** | RuntimeEnvironment、agent-loop | 无需 Adapter |
| **输出** | 事件格式转换 | OutputAdapter（渲染机制不同） |

## What I already know

### 已统一的核心层（无需修改）

- Runtime: agent-loop.ts, event-types.ts, permission-gate.ts, session-manager.ts, tool-dispatch.ts
- Providers: 所有 provider 实现（claude, openai, local, openai-compatible）
- Tools: 所有工具实现
- Skills: skill-discovery.ts, skill-executor.ts, skill-registry.ts
- Config: load-settings.ts, resolve-chat-runtime.ts

### 需要统一的部分

| 层级 | CLI 现状 | TUI 现状 | 统一方案 |
|------|----------|----------|----------|
| **输入** | readline (`createInteractiveTurnStream`) | React/Ink (`InputBar.tsx` + `useUserInput`) | InputAdapter 接口 |
| **输出** | ANSI streaming (`terminal-renderer.ts`) | React 组件 (`MessageList.tsx`) | OutputAdapter + DisplayEvent |
| **状态管理** | Observable subscriptions | React useState/useReducer | 各自保持，消费同一事件流 |
| **会话启动** | 在 `runAgentLoop()` 内部 | 在 `createTuiRuntime()` 中提前创建 | 统一到 RuntimeEnvironment |
| **Skills** | 完整支持 | 缺失 (`SkillExecutor` 未创建) | 统一到 RuntimeEnvironment |
| **Role** | `--role` 参数支持 | 硬编码 `roleName: undefined` | 统一到 RuntimeEnvironment |
| **MCP** | 完整生命周期管理 | 重复实现 | 统一到 RuntimeEnvironment |

### TUI 缺失功能（MVP 需补齐）

- `--role` 参数支持
- `/skills` 命令
- `/tools` 命令
- `/clear` 命令
- `SkillExecutor` 初始化

### 关键发现

1. **TUI 也是流式的** — 只是渲染机制不同（setState vs stdout.write）
2. **事件格式已统一** — CLI 和 TUI 都消费相同的 `RuntimeEvent`
3. **皮肤系统不在公共链路** — 半成品，暂不纳入

---

## Requirements

### Phase 1: 共享业务逻辑层 ✅

* [x] 提取 `initializeRuntime()` 函数，统一会话、Skills、Tools、MCP 初始化
* [x] 提取 `executeLocalCommand()` 函数，统一本地命令处理（`/help`, `/skills`, `/tools`, `/clear`）
* [x] CLI 和 TUI 都调用这些共享函数

### Phase 2: 统一 RuntimeEnvironment ✅

* [x] CLI 和 TUI 都使用 `RuntimeEnvironment` 启动 agent-loop
* [x] 统一会话创建时机（在 RuntimeEnvironment 中）
* [x] TUI 补齐 SkillExecutor 初始化

### Phase 3: InputAdapter ✅

* [x] 定义 `InputAdapter` 接口
* [x] 实现 `CliInputAdapter`（封装 readline）
* [x] 实现 `TuiInputAdapter`（封装 React Subject）
* [x] 调用共享的 `executeLocalCommand()` 处理本地命令

### Phase 4: OutputAdapter ✅

* [x] 定义 `DisplayEvent` 类型（RuntimeEvent 的 1:1 映射）
* [x] 实现 `OutputAdapter` 接口
* [x] 实现 `DefaultOutputAdapter`（CLI 和 TUI 共用）
* [x] 事件级转换，聚合逻辑留给 UI 层

### Phase 5: 补齐 TUI 功能 ✅

* [x] 支持 `--role` 参数（通过 RuntimeEnvironment）
* [x] 实现 `/skills`, `/tools`, `/clear` 命令（调用共享命令处理器）
* [x] 确保 Skills 在 TUI 中可用

---

## Acceptance Criteria

* [x] CLI 和 TUI 走同一套 `RuntimeEnvironment` 初始化逻辑
* [x] Skills 在 TUI 中可用
* [x] Role 支持在 TUI 中可用
* [x] 无功能回归
* [ ] 新增 UI 只需实现 InputAdapter 和 OutputAdapter

## Definition of Done

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes

## Out of Scope

* 皮肤系统（Skin）集成 — 单独任务
* 改变 React/Ink 和 readline 的底层框架选择
* 完全统一渲染系统（CLI 和 TUI 保持各自的渲染机制）

## Technical Notes

* 核心分析详见 research/architecture-analysis.md
* 输出链路分析详见 research/output-flow-analysis.md
* 输入链路分析详见 research/input-flow-analysis.md
* 皮肤架构分析详见 research/skin-architecture.md

## Research References

* `research/architecture-analysis.md` — CLI vs TUI 架构差异全景
* `research/output-flow-analysis.md` — 输出渲染链路深度分析
* `research/input-flow-analysis.md` — 输入处理链路深度分析
* `research/skin-architecture.md` — 皮肤系统现状（不在公共链路）
