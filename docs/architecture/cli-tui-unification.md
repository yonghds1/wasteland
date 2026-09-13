# UI 分层架构:TUI 主导与 CLI fallback

## 目的

本文档描述 wasteland 的 UI 分层架构:**TUI 是唯一主界面,CLI 是非交互 fallback,两者经 adapter 接入共享的 core runtime**。

边界说明:
- 本文档是项目级分层设计说明,面向人理解整体结构,聚焦"TUI/CLI 实现差异 + 共享 core 边界"。
- 精确的 TypeScript 接口签名与实现细节,见 [input-output-adapters.md](./input-output-adapters.md) 及代码实现。
- 它回答三个问题:
  - 为什么 TUI 是主界面、CLI 退为 fallback
  - 哪些逻辑共享、哪些必须分开
  - TUI 与 CLI 当前的真实实现差异有哪些

---

## 分层架构

```text
┌──────────────────────────────────────────────────────────────┐
│                      UI 层(可替换)                          │
│  ┌─────────────────────────────┐  ┌────────────────────────┐ │
│  │  TUI(唯一主界面)            │  │  CLI(非交互 fallback)  │ │
│  │  src/tui/  Ink / React      │  │  src/ui/  readline     │ │
│  │  (Subject 直连,无专用类)     │  │  CliInputAdapter       │ │
│  │                             │  │  CliOutputAdapter      │ │
│  └──────────────┬──────────────┘  └────────────┬───────────┘ │
└─────────────────┼──────────────────────────────┼────────────┘
                  ↓                              ↓
┌──────────────────────────────────────────────────────────────┐
│            Adapter 层(src/core/input-adapter.ts + output-adapter.ts)│
│  InputAdapter / OutputAdapter 抽象 + DefaultOutputAdapter    │
└──────────────────────────────┬───────────────────────────────┘
                               ↓
┌──────────────────────────────────────────────────────────────┐
│            Core 层(src/core/,不变,不依赖具体 UI)            │
│  runtime/: runAgentLoop / session-manager /                  │
│            tool-dispatch / permission-gate                   │
│  shared/:  initialize-runtime / local-commands               │
└──────────────────────────────────────────────────────────────┘
```

### 各层职责

| 层 | 位置 | 职责 | 依赖方向 |
|----|------|------|----------|
| **UI 层** | `src/tui/`、`src/ui/` | 用户交互、渲染;实现 InputAdapter/OutputAdapter | 依赖 Adapter 层与 Core 层 |
| **Adapter 层** | `src/core/input-adapter.ts` + `output-adapter.ts` | 输入/输出抽象接口;`DefaultOutputAdapter` 提供共用转换 | 仅依赖 Core 类型 |
| **Core 层** | `src/core/runtime/`、`src/core/shared/` | Agent 循环、会话、工具分发、权限、运行时初始化 | **不依赖任何具体 UI** |

关键约束:**core 不依赖具体 UI**。UI 层经 adapter 接入 core,因此 TUI 与 CLI 可独立替换,而 core 运行时保持不变。

---

## TUI 主导与 CLI fallback

### TUI 是主界面

- `npm run dev` 默认启动 TUI(`package.json` 中 `dev: tsx src/cli.ts`,无参数时进入 TUI)。
- `src/cli.ts` 无参数时默认启动 TUI;TUI 为唯一主入口。
- TUI 在 `src/commands/tui.ts` 中做 TTY 检测,非交互环境(无 TTY)会拒绝启动并提示改用 CLI。

### CLI 是非交互 fallback

- `chat` 命令保留功能但从 `--help` 隐藏(`src/cli.ts` 中 `program.command('chat', { hidden: true })`),仅作非交互场景的 fallback。
- 典型用法:`wasteland chat --message 'your message'`,适合管道、脚本、无 TTY 环境。
- CLI 实现位于 `src/ui/`(`CliInputAdapter` / `CliOutputAdapter`)。

### 共享 core runtime

TUI 与 CLI 不是两套独立运行时,而是同一 core 的两个 UI 前端:

- 共用 `initializeRuntime()` 完成会话、技能、工具、MCP、ACP、Provider、权限的初始化。
- 共用 `runAgentLoop()` 驱动 Agent 循环。
- 共用 `executeLocalCommand()` 处理本地命令。

---

## 共享的核心层

### initializeRuntime

统一 CLI 和 TUI 的运行时初始化,返回 `RuntimeEnvironment`:

```typescript
// 模块:src/core/shared/initialize-runtime.ts
export async function initializeRuntime(
  params: InitializeRuntimeParams
): Promise<RuntimeEnvironment> {
  // 加载配置 -> 解析运行时(provider/model/role)
  // -> 创建 Provider -> SessionManager -> PermissionGate
  // -> ToolRegistry(含 MCP/ACP) -> SkillExecutor
  return { sessionManager, skillExecutor, provider, toolRegistry,
           permissionGate, resolvedRuntime, mcpManager,
           loadedSettings, ... };
}
```

`RuntimeEnvironment` 是 TUI 和 CLI 的共同入口:TUI 的 `createTuiRuntime()` 与 CLI 的 `chat` 命令都调用它,确保两端初始化逻辑一致。`SkillExecutor` 在此统一创建,因此 TUI 与 CLI 的 Skills 能力对齐。

### runAgentLoop 与 runtime 核心

`src/core/runtime/` 提供 Agent 循环与会话/工具/权限基础设施:

- `agent-loop.ts` — Agent 循环核心,输入 `Observable<ChatInputTurn>`,输出 `Observable<RuntimeEvent>`。
- `session-manager.ts` — 会话创建、恢复、查询。
- `tool-dispatch.ts` — 工具调用分发。
- `permission-gate.ts` — 权限闸门。

这些模块与 UI 无关,TUI 和 CLI 共用。

### executeLocalCommand

统一本地命令处理(`/help`、`/tools`、`/skills`、`/clear`、`/exit`):

```typescript
// 模块:src/core/shared/local-commands.ts
export function executeLocalCommand(params: {
  command: string;
  skillExecutor?: SkillExecutor;
}): LocalCommandResult;
```

`useRuntime` 装配的 TUI 输入流与 `CliInputAdapter` 均调用此函数,保证两端命令行为一致(包括依赖 `skillExecutor` 的 `/skills`)。

---

## Adapter 层

Adapter 层定义 UI 与 core 之间的契约,使 UI 可替换:

- `InputAdapter` — 抽象输入来源,统一为 `Observable<ChatInputTurn>`。
- `OutputAdapter` — 将 `RuntimeEvent` 转换为 `DisplayEvent`(1:1 映射)。
- `DefaultOutputAdapter` — 默认实现,CLI 与 TUI 共用,纯函数转换、无副作用。

具体实现位于 UI 层（TUI 无专用 adapter 类，用 Subject + `useRuntimeEvents` 直连）：

| 实现 | 文件 | 用途 |
|------|------|------|
| `CliInputAdapter` | `src/ui/cli-input-adapter.ts` | CLI 输入(readline) |
| `CliOutputAdapter` | `src/ui/cli-output-adapter.ts` | CLI 输出(terminal) |

接口契约的精确定义与扩展新 UI 的方式见 [input-output-adapters.md](./input-output-adapters.md)。本文不重复。

---

## TUI 与 CLI 实现差异

差异点已按代码现状核实。下表仅列**当前仍存在**的真实差异;原文档中"TUI 缺 Skills""Role 硬编码 undefined"等差异**已修复**(见后文"已统一项")。

### 仍存在的差异

| 维度 | TUI(主界面) | CLI(fallback) | 差异原因 |
|------|-------------|---------------|----------|
| **输入框架** | React/Ink(声明式) | readline(命令式) | 框架选择不同 |
| **输出渲染** | React 组件 | ANSI streaming | 渲染机制不同 |
| **状态管理** | React `useState` | Observable subscriptions | 框架选择不同 |
| **会话启动** | `createTuiRuntime` 显式 `startSession`(interactive),作为 `existingSession` 传入 `runAgentLoop` | 不显式 `startSession`,会话由 `runAgentLoop` 内部基于 `sessionManager` 创建 | 生命周期处理不同:TUI 需在启动循环前持有会话句柄 |

上述差异均属"触发机制/框架"层面,通过 adapter 隔离,不影响 core。

### 已统一项(原差异已修复)

| 原差异 | 现状 | 依据 |
|--------|------|------|
| Skills:TUI 缺失 `SkillExecutor` | 已统一。TUI 经 `initializeRuntime()` 初始化 `SkillExecutor`,并传入 `runAgentLoop` | `useRuntime.ts` 调用 `initializeRuntime()`;`initialize-runtime.ts` 创建 `SkillExecutor`;`runAgentLoop` 接收 `skillExecutor: runtime.skillExecutor` |
| Role:TUI 硬编码 `undefined` | 已统一。TUI 支持 `--role`,`createTuiRuntime(cwd, roleName, providerName)` 经 `initializeRuntime` -> `resolveChatRuntime` 解析 | `src/commands/tui.ts` 提供 `-r, --role <name>` 选项 |
| 本地命令 `/skills` `/tools` `/clear` | 已统一。两端共用命令执行器 | TUI 装配（`useRuntime.ts`）与 `CliInputAdapter` 均经 `src/core/shared/command-executor.ts` / `command-executor-sync.ts` |

---

## 共享 vs Adapter 对照表

| 层级 | 共享逻辑 | Adapter 对接 | 原因 |
|------|----------|--------------|------|
| **输入** | 本地命令处理(`executeLocalCommand`) | `InputAdapter` | 触发机制不同(readline vs React Subject) |
| **核心** | `RuntimeEnvironment`、`runAgentLoop`、session/tool/permission | 无需 Adapter | 完全统一,UI 无关 |
| **输出** | 事件格式转换(`DefaultOutputAdapter`) | `OutputAdapter` | 渲染机制不同(ANSI vs React 组件) |

---

## 范围说明

- **皮肤系统(Skin)**:TUI 已在 `createTuiRuntime` 中经 `loadSkin()` 加载皮肤(默认 `warlord-stern`),皮肤属于 TUI 渲染增强,不作为 CLI/TUI 分层差异的核心议题,本文不展开。
- **精确接口签名**:见 [input-output-adapters.md](./input-output-adapters.md)。
- **运行时分层契约**:见 [runtime-boundaries.md](./runtime-boundaries.md)。

---

## 相关文档

- [Input/Output 适配器架构](./input-output-adapters.md) — 接口契约与扩展新 UI
- [运行时分层与契约](./runtime-boundaries.md)
- [技能系统架构](./skills.md)
- [项目结构规划](../project-structure.md)
