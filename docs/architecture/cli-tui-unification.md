# CLI 与 TUI 链路统一架构

## 目的

本文档描述 CLI 和 TUI 链路统一的架构设计，解释为什么采用 Adapter 模式，以及共享业务逻辑的边界划分。

边界说明：
- 本文档是项目级设计说明，面向人理解整体结构。
- 精确的 TypeScript 签名、接口定义，以代码实现为准。

它回答三个问题：
- CLI 和 TUI 为什么有差异
- 哪些逻辑可以共用，哪些必须分开
- 统一后的架构是什么样子

---

## 现状分析

### 已统一的核心层

CLI 和 TUI 共享相同的核心运行时：

- **Runtime**: `agent-loop.ts`, `event-types.ts`, `permission-gate.ts`, `session-manager.ts`
- **Providers**: 所有 AI 提供商实现
- **Tools**: 所有工具实现
- **Skills**: `skill-discovery.ts`, `skill-executor.ts`
- **Config**: `load-settings.ts`, `resolve-chat-runtime.ts`

### 差异点

| 层级 | CLI | TUI | 差异原因 |
|------|-----|-----|----------|
| **输入** | readline（命令式） | React/Ink（声明式） | 框架选择不同 |
| **输出** | ANSI streaming | React 组件 | 渲染机制不同 |
| **状态管理** | Observable subscriptions | React useState | 框架选择不同 |
| **会话启动** | 在 `runAgentLoop()` 内 | 在 `createTuiRuntime()` 外 | 生命周期处理不同 |
| **Skills** | 完整支持 | 缺失 | TUI 未初始化 SkillExecutor |
| **Role** | `--role` 参数支持 | 硬编码 `undefined` | TUI 未实现 |

### TUI 缺失的功能

- `--role` 参数支持
- `/skills`, `/tools`, `/clear` 命令
- `SkillExecutor` 初始化

---

## 设计原则

**能共用的逻辑在不影响复杂度的前提下抽离出来，转换部分用 adapter 对接。**

### 业务逻辑 vs 触发机制

| 类型 | 特征 | 示例 | 处理方式 |
|------|------|------|----------|
| **业务逻辑** | 与 I/O 无关的处理 | 命令解析、状态转换、数据处理 | 抽离到共享模块 |
| **触发机制** | 与框架相关的输入/输出 | readline、React 组件、stdout.write | 用 Adapter 适配 |

### 判断标准

一个逻辑是否应该抽离，问自己：
1. CLI 和 TUI 需要做同样的事吗？→ 是 → 抽离
2. 抽离后会增加复杂度吗？→ 不会 → 抽离
3. 触发方式不同但结果相同吗？→ 是 → 用 Adapter

---

## 统一架构

### 架构图

```text
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

### 核心层

所有核心逻辑集中在 `src/core/` 目录下：

```text
src/core/
├── index.ts                  # 导出所有核心模块
├── runtime/                  # 运行时核心
│   ├── agent-loop.ts         # Agent 循环核心
│   ├── event-types.ts        # 事件类型定义
│   ├── session-manager.ts    # 会话管理
│   ├── permission-gate.ts    # 权限闸门
│   ├── tool-dispatch.ts      # 工具调用分发
│   └── ...
├── shared/                   # 共享业务逻辑
│   ├── initialize-runtime.ts # 运行时初始化
│   └── local-commands.ts     # 本地命令处理
└── adapters/                 # 适配器接口
    ├── input-adapter.ts      # 输入适配器接口
    └── output-adapter.ts     # 输出适配器接口
```

#### 1. initializeRuntime

统一会话、Skills、Tools、MCP 生命周期管理：

```typescript
// 模块：src/core/shared/initialize-runtime.ts
export async function initializeRuntime(config: RuntimeConfig): Promise<RuntimeEnvironment> {
  const loadedSettings = await loadWastelandSettings({ cwd, env })
  const resolvedRuntime = resolveChatRuntime({ settings, roleName, providerName, cwd })
  const providerRegistry = createDefaultProviderRegistry()
  const provider = providerRegistry.resolve(...)
  const sessionManager = new SessionManager(...)
  const permissionGate = createPermissionGate(...)
  const { toolRegistry, startMCP, stopMCP } = createDefaultToolRegistry(...)
  const skillExecutor = new SkillExecutor(...)
  return { sessionManager, skillExecutor, provider, toolRegistry, ... }
}
```

**为什么抽离**：
- CLI 和 TUI 都需要相同的初始化逻辑
- TUI 当前缺失 SkillExecutor，抽离后自动补齐

#### 2. executeLocalCommand

统一本地命令处理（`/help`, `/skills`, `/tools`, `/clear`）：

```typescript
// 模块：src/core/runtime/local-commands.ts
export function executeLocalCommand(params: {
  command: string;
  skillExecutor?: SkillExecutor;
}): LocalCommandResult {
  switch (command) {
    case '/skills': return { handled: true, output: createSkillsText(...) }
    case '/tools':  return { handled: true, output: createToolsText() }
    case '/clear':  return { handled: true, action: 'clear' }
    case '/help':   return { handled: true, output: createHelpText(), action: 'help' }
    case '/exit':   return { handled: true, action: 'exit' }
    default:       return { handled: false }
  }
}
```

**为什么抽离**：
- CLI 和 TUI 需要执行相同的命令
- 当前 CLI 在 `readline-input.ts` 处理，TUI 未实现
- 抽离后两者调用同一函数，保证行为一致

#### 3. InputAdapter 接口

抽象用户输入来源，统一为 ChatInputTurn Observable：

```typescript
// 模块：src/core/adapters/input-adapter.ts
export interface InputAdapter {
  readonly input$: Observable<ChatInputTurn>;
  destroy(): void;
}
```

CLI 和 TUI 各自实现此接口：
- `src/ui/cli-input-adapter.ts` - 封装 readline
- `src/tui/tui-input-adapter.ts` - 封装 React Subject

#### 4. OutputAdapter 接口

将 RuntimeEvent 转换为 DisplayEvent（1:1 映射）：

```typescript
// 模块：src/core/adapters/output-adapter.ts
export interface OutputAdapter {
  processEvent(event: RuntimeEvent): DisplayEvent;
}
```

CLI 和 TUI 使用相同的 DefaultOutputAdapter，各自负责渲染 DisplayEvent。

#### 3. RoleResolver

统一 Role 解析：

```typescript
// 新模块：src/config/role-resolver.ts
export function resolveRole(roleName: string | undefined): RoleConfig {
  // 解析逻辑
}
```

**为什么抽离**：
- CLI 通过 `--role` 参数传入
- TUI 硬编码为 `undefined`
- 抽离后 TUI 可以从配置读取 role

### Adapter 层

#### InputAdapter

抽象输入来源，统一为 `ChatInputTurn`：

```typescript
// 模块：src/core/adapters/input-adapter.ts
export interface InputAdapter {
  readonly input$: Observable<ChatInputTurn>;
  destroy(): void;
}

// CLI 实现：src/ui/cli-input-adapter.ts
export class CliInputAdapter implements InputAdapter {
  // 封装 readline
}

// TUI 实现：src/tui/tui-input-adapter.ts
export class TuiInputAdapter implements InputAdapter {
  // 封装 React Subject
}
```

#### OutputAdapter

事件级转换（1:1 映射），统一为 `DisplayEvent`：

```typescript
// 模块：src/core/adapters/output-adapter.ts
export interface OutputAdapter {
  processEvent(event: RuntimeEvent): DisplayEvent;
}

// 默认实现（CLI 和 TUI 共用）
export class DefaultOutputAdapter implements OutputAdapter {
  // 纯函数转换，无副作用
}
```

**为什么是 1:1 映射**：
- 简单直接，每个事件有明确的转换规则
- 聚合逻辑（如多个 chunk 合成 message）留给 UI 层
- 易于测试和扩展

---

## 共享 vs Adapter 对照表

| 层级 | 共享逻辑 | Adapter 对接 | 原因 |
|------|----------|--------------|------|
| **输入** | 本地命令处理逻辑 | InputAdapter | 触发机制不同 |
| **核心** | RuntimeEnvironment、agent-loop | 无需 Adapter | 完全统一 |
| **输出** | 事件格式转换 | OutputAdapter | 渲染机制不同 |

---

## 实施阶段

### Phase 1: 共享业务逻辑层

- 提取 `initializeRuntime()` 函数
- 提取 `executeLocalCommand()` 函数
- CLI 和 TUI 都调用这些共享函数

### Phase 2: 统一 RuntimeEnvironment

- CLI 和 TUI 都使用 `RuntimeEnvironment` 启动 agent-loop
- 统一会话创建时机
- TUI 补齐 SkillExecutor 初始化

### Phase 3: InputAdapter

- 定义 `InputAdapter` 接口
- 实现 `CliInputAdapter` 和 `TuiInputAdapter`
- 调用共享的 `executeLocalCommand()` 处理本地命令

### Phase 4: OutputAdapter

- 定义 `DisplayEvent` 类型
- 实现 `CliOutputAdapter` 和 `TuiOutputAdapter`
- 事件级转换，聚合逻辑留给 UI 层

### Phase 5: 补齐 TUI 功能

- 支持 `--role` 参数（通过 RuntimeEnvironment）
- 实现 `/skills`, `/tools`, `/clear` 命令
- 确保 Skills 在 TUI 中可用

---

## 皮肤系统（Skin）

**本次统一不包含皮肤系统。**

原因：
- 皮肤系统当前是半成品（数据结构存在，但未接入任何消费者）
- 皮肤加载位置不在公共链路中
- 皮肤集成需要单独任务处理

---

## 相关文档

- [运行时分层与契约](./runtime-boundaries.md)
- [技能系统架构](./skills.md)
- [项目结构规划](../project-structure.md)
