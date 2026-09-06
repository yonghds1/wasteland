# wasteland 核心架构规范

> 本文档是 wasteland 项目的**唯一事实来源**（Single Source of Truth）。
> 其他文档与本文档冲突时，以本文档为准。

## 1. 概述

**wasteland** 是一个废土主题的多 Agent 系统，以 **TUI（Ink/React）为唯一主界面**，CLI 作为非交互 fallback。采用废土（post-apocalyptic）主题，主 Agent 作为指挥官，管理多个子 Agent 协同完成任务。

项目强调**分层架构与 UI 分离**：Core 层不依赖任何具体 UI，UI 层（TUI / CLI）经 Adapter 接入 Core，可替换、可移除（见 [第 5 节 UI 分层与 Adapter 架构](#5-ui-分层与-adapter-架构)）。

### 技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| 语言 | TypeScript (ES2022, NodeNext) | |
| TUI 框架 | Ink (React) | **唯一主界面** |
| CLI 框架 | Commander | 非交互 fallback 与子命令路由 |
| 响应式流 | RxJS | Core 与 UI 之间的数据流边界 |
| 运行时 | Node.js >= 20 | |

### 界面与命令

**TUI 主入口**（默认）：

- `wasteland` —— 无参数等价于 `wasteland tui`（`src/cli.ts` 在无参时自动追加 `tui`）
- `wasteland tui` —— 显式启动 TUI Dashboard
- `npm run dev` —— 开发模式（`tsx src/cli.ts`），默认启动 TUI

**CLI fallback 与管理命令**：

| 命令 | 说明 |
|------|------|
| `wasteland tui` | TUI 主入口（`-r/--role`、`-p/--provider`、`--permission-mode`、`--debug`、`--attach <session>`） |
| `wasteland chat` | **hidden**，非交互 fallback：单轮（`-m`）、stdin 管道、或交互式 readline |
| `wasteland current` | 查看当前生效配置 |
| `wasteland config` | 配置管理 |
| `wasteland init` | 初始化项目（首次运行空配置 + 交互式终端时自动进入引导） |
| `wasteland sessions` | 会话管理（`list` / `show` / `delete`） |
| `wasteland resume <session-id>` | 恢复会话 |
| `wasteland skin` | 皮肤管理（`list` / `show` / `load` / `info`） |

> 命令清单与 `src/cli.ts` 一致：`chat`（hidden）、`config`、`current`、`init`、`tui`、`sessions`、`resume`、`skin`。`chat` 已从 `--help` 隐藏，保留作非交互 fallback，体现 UI 可分离。

**`chat` 选项**（无 `--multi`）：

- `-m, --message <text>`：单轮消息
- `-p, --provider <name>`：指定 Provider
- `-r, --role <name>`：指定角色
- `--debug`：输出调试 trace
- `--debug-format <format>`：`pretty`（默认）/ `jsonl`
- `--permission-mode <mode>`：`default` / `accept_edits` / `bypass_permissions`

**角色别名**：由 `scripts/create-aliases.sh`（经 `src/utils/symlink-manager.ts` 的 `ensureRoleAliases`）根据皮肤配置**动态创建**的 symlink，指向同一个 `bin/wasteland.js` 入口。默认皮肤无额外别名，切换皮肤时别名随角色配置变化。`postinstall` 与 `npm run aliases` / `aliases:switch` 均调用该脚本。

```
wasteland                          # 默认启动 TUI
wasteland tui                      # 显式启动 TUI
wasteland chat --message "..."     # hidden，非交互 fallback
wasteland current
wasteland sessions list
wasteland resume <session-id>
wasteland skin list
<alias> chat --message "..."     # 皮肤配置的动态别名（默认皮肤无别名）
```

## 2. Agent 架构模型

### 2.1 主 Agent（orchestrator）

- **数量**: 唯一 1 个，**不可增加**
- **默认皮肤**: warlord-stern（热沙总督）
- **职责**: 接收用户输入，分析任务，决定是否 spawn 子 agent，汇总结果
- **可覆盖**: 皮肤配置、角色配置均可通过 settings 覆盖
- **不可覆盖**: 不能添加第二个主 agent

### 2.2 子 Agent

- **数量**: 默认 4 个，可增加自定义子 agent
- **默认角色**:

| 子 Agent | 职责 | 典型 tools |
|----------|------|-----------|
| `coder` | 编写和修改代码 | read-file, write-file, edit-file, bash |
| `planner` | 分析任务、制定计划 | read-file, glob, grep, list-directory |
| `reviewer` | 审查代码质量 | read-file, glob, grep |
| `researcher` | 调研技术方案 | read-file, glob, grep, web-fetch |

- **可覆盖**: 现有子 agent 的角色配置可被覆盖
- **可新增**: 通过 `.wasteland/roles.json` 定义自定义角色，`settings.json` 的 `multiAgent` 引用

### 2.3 协作模式：严格层级

```
用户 ──-> Main Agent (orchestrator)
              │
              ├── spawn ──-> Coder Agent ──-> 结果返回
              ├── spawn ──-> Planner Agent ──-> 结果返回
              ├── spawn ──-> Reviewer Agent ──-> 结果返回
              └── spawn ──-> Researcher Agent ──-> 结果返回
              │
              ▼
         Main Agent 汇总 ──-> 用户
```

**关键约束**:
- 子 agent 之间**不直接通信**
- 所有协调由主 agent 负责
- 子 agent 结果通过 `spawn_agent` 工具返回主 agent
- 子 agent 可并行执行（通过 RxJS `forkJoin`）

## 3. 皮肤与角色：严格分离

### 设计原则

> **皮肤（Skin）= 纯表面表现，不影响会话链路**
> **角色（Role）= 实际能力配置，决定对话行为**

### 3.1 Skin 层（表面）

皮肤定义 agent 的外在表现，可随时切换而不影响功能。

| 字段 | 说明 | 示例 |
|------|------|------|
| `name` | 角色显示名 | "热沙总督" |
| `title` | 头衔 | "废土指挥官" |
| `greeting` | 问候语 | "说出目标，热沙总督在听。" |
| `catchphrases` | 口癖列表 | ["资源有限，判断必须锋利。", "先定路线，再谈荣耀。"] |
| `personality` | 性格描述 | "威严、命令式、说话充满信念" |
| `ui.banner` | 启动横幅 | { title, subtitle, style } |
| `ui.colors` | 主题颜色 | { primary, secondary, accent, muted } |
| `ui.labels` | 界面标签 | { user, assistant, system } |
| `ui.messages` | 提示消息 | { welcome, thinking, success, error } |

**皮肤文件位置**:
- 项目级: `.wasteland/skins/<skin-id>.json`
- 用户级: `~/.wasteland/skins/<skin-id>.json`

### 3.2 Role 层（能力）

角色定义 agent 的实际行为能力，决定会话链路。角色定义在 `.wasteland/roles.json`
（与 `skins.json` 对称），每个角色是可复用的完整定义。

| 字段 | 说明 | 来源 |
|------|------|------|
| `promptTemplate` | 系统提示词 | roles.json -> roles[name] -> promptTemplate |
| `tools` | 可用工具列表 | roles.json -> roles[name] -> tools |
| `permissionMode` | 权限模式 | roles.json -> roles[name] -> permissionMode |
| `model` | 使用的模型 | roles.json -> roles[name] -> model |
| `skins` | 皮肤候选列表 | roles.json -> roles[name] -> skins |

**角色配置位置**: `.wasteland/roles.json`（内置默认在 `src/config/roles/default-roles.ts`）

### 3.3 关联方式

角色和皮肤通过 `multiAgent` 引用组合关联：

```jsonc
// .wasteland/roles.json — 角色定义（可复用）
{
  "roles": {
    "developer": {
      "promptTemplate": "role-worker",
      "model": "sonnet",
      "tools": ["read-file", "write-file", "edit-file", "bash"],
      "skins": ["coder"]
    }
  }
}

// .wasteland/settings.json — 引用组合
{
  "multiAgent": {
    "developer": { "role": "developer", "skin": "coder" }
  }
}
```

加载时把 `role` 引用展开合并进 `multiAgent` 条目，下游消费方拿到完整配置。
角色（能力）与皮肤（表面）保持解耦，皮肤切换不影响角色配置。

### 3.4 禁止事项

- ❌ 皮肤文件中不得包含 `systemPrompt`、`tools`、`permissions` 等能力配置
- ❌ 角色配置中不得包含 `greeting`、`catchphrases`、`ui.colors` 等表面配置
- ❌ 不得通过皮肤切换来改变 agent 的行为能力

## 4. 配置体系

### 4.1 settings.json 结构

```json
{
  "defaultProvider": "openai-compatible",
  "providers": {
    "openai-compatible": {
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "...",
      "model": "gpt-4"
    },
    "anthropic": {
      "baseUrl": "https://api.anthropic.com",
      "apiKey": "...",
      "model": "claude-sonnet-4-20250514"
    }
  },
  "models": {
    "fast": { "provider": "local", "model": "qwen-turbo" },
    "smart": { "provider": "anthropic", "model": "claude-sonnet-4-20250514" }
  },
  "multiAgent": {
    "coder": { "role": "developer", "skin": "coder" },
    "planner": { "role": "planner", "skin": "warlord-casual" },
    "reviewer": { "role": "reviewer", "skin": "sentinel" },
    "researcher": { "role": "researcher", "skin": "scout" },
    "my-custom-agent": { "role": "my-custom-agent", "skin": "warlord-stern" }
  },
  "runtime": {
    "defaultRole": "orchestrator",
    "permissionMode": "default",
    "maxStepsPerTurn": 8,
    "maxTurns": 20,
    "childAgentTimeout": 120000,
    "debug": false,
    "language": "en"
  },
  "mcpServers": {}
}
```

### 4.2 配置加载优先级

```
~/.wasteland/settings.json (用户级)
  ↓ 被覆盖
.wasteland/settings.json (项目级)
  ↓ 被覆盖
命令行参数 (--provider, --role, etc.)
```

### 4.3 皮肤加载优先级

```
.wasteland/skins/<skin-id>.json (项目级)
  ↓ 回退
~/.wasteland/skins/<skin-id>.json (用户级)
  ↓ 回退
内置默认皮肤 (warlord-stern)
```

## 5. UI 分层与 Adapter 架构

wasteland 采用三层分层架构，**Core 层不依赖任何具体 UI**。UI 层（TUI / CLI）可替换、可移除，经 Adapter 接入 Core。接口细则见 [`input-output-adapters.md`](./input-output-adapters.md)。

### 5.1 分层结构

```
┌───────────────────────────────────────────────────────────┐
│  UI 层（可替换；Core 不依赖具体 UI）                       │
│  ┌─────────────────────────┐  ┌─────────────────────────┐ │
│  │ TUI（唯一主界面）        │  │ CLI（非交互 fallback）   │ │
│  │ src/tui/                │  │ src/ui/                 │ │
│  │  (Subject 直连,无专用类) │  │  CliInputAdapter        │ │
│  │                         │  │  CliOutputAdapter       │ │
│  │  Ink / React            │  │  readline / terminal    │ │
│  └─────────────────────────┘  └─────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
        │ input$: Observable<ChatInputTurn>      ▲
        ▼                                         │ events$: Observable<RuntimeEvent>
┌───────────────────────────────────────────────────────────┐
│  Adapter 层  src/core/input-adapter.ts + output-adapter.ts    │
│  InputAdapter / OutputAdapter 抽象                        │
│  DefaultOutputAdapter（1:1 默认实现）                     │
└───────────────────────────────────────────────────────────┘
        │                                         ▲
        ▼                                         │
┌───────────────────────────────────────────────────────────┐
│  Core 层（不变）  src/core/runtime/                       │
│  runAgentLoop / session-manager / tool-dispatch /         │
│  permission-gate / event-types / user-input-bridge        │
└───────────────────────────────────────────────────────────┘
```

### 5.2 边界契约

- **输入边界**：UI 层通过 `InputAdapter` 产出 `input$: Observable<ChatInputTurn>`，交由 `runAgentLoop` 消费。Core 只认该 Observable，不感知输入来自 TUI 还是 CLI。
- **输出边界**：`runAgentLoop` 返回 `{ events$: Observable<RuntimeEvent>, debug$ }`，UI 层通过 `OutputAdapter`（`handleEvents(events$)`）消费并渲染。Core 不感知渲染方式。
- **依赖方向**：UI 依赖 Adapter 抽象与 Core 运行时；Core 不反向依赖任何 UI 实现。新增 UI（如 Web/Desktop）除实现 `InputAdapter` / `OutputAdapter` 外，还需复制装配逻辑（见 input-output-adapters.md 相关说明）。

### 5.3 Adapter 实现一览

| 抽象 | 实现 | 文件 |
|------|------|------|
| `InputAdapter` | `CliInputAdapter` | `src/ui/cli-input-adapter.ts` |
| `InputAdapter` | （无专用类，Subject + `useRuntimeEvents` 直连） | `src/tui/hooks/useRuntime.ts` |
| `OutputAdapter` | `CliOutputAdapter` | `src/ui/cli-output-adapter.ts` |
| `OutputAdapter` | （无专用类，事件直译为 AppState） | `src/tui/hooks/useRuntimeEvents.ts` |
| `OutputAdapter` | `DefaultOutputAdapter`（1:1 映射） | `src/core/output-adapter.ts` |

## 6. 运行时架构

Core 与 UI 的解耦点即 `runAgentLoop` 的 `input$` / `events$` 边界（见 [第 5 节](#5-ui-分层与-adapter-架构)）：UI 经 Adapter 产生 `input$`、消费 `events$`，Core 内部不感知 UI 类型。

### 6.1 Agent Loop

```
InputAdapter.input$ → 用户输入
  ↓
TurnContext 构建（system prompt + history + tools）
  ↓
Provider.runStep(TurnContext, TurnState)
  ↓ 返回 Observable<ProviderStreamEvent>
  ├── assistant_chunk -> 流式输出文本
  ├── tool_call -> ToolRegistry.dispatch()
  │     ├── 普通工具 -> 执行并返回结果
  │     └── spawn_agent -> 创建子 agent session
  │           ├── 子 agent 独立运行 agent loop
  │           └── 结果返回主 agent
  └── assistant_message -> turn 结束
  ↓
检查 maxStepsPerTurn / maxTurns
  ↓
TurnState 更新，进入下一轮
  ↓
events$: Observable<RuntimeEvent> → OutputAdapter 渲染
```

### 6.2 Provider 抽象

```typescript
interface AgentProvider {
  readonly id: string;
  runStep(input: ProviderStepInput): Observable<ProviderStreamEvent>;
}
```

**已注册的 Provider**:

| 协议类型 | 工厂函数 | 说明 |
|----------|---------|------|
| `local` | `createLocalProvider` | 本地测试用，命令解析 |
| `openai-compatible` | `createOpenAIProvider` | OpenAI / Ollama / Qwen 等兼容 API |
| `anthropic` | `createClaudeProvider` | Anthropic Claude API |

### 6.3 工具系统

**内置工具** (12 个):

| 工具 | 用途 | 风险级别 |
|------|------|---------|
| `read-file` | 读取文件 | read |
| `write-file` | 写入文件 | write |
| `edit-file` | 编辑文件 | write |
| `glob` | 文件匹配 | read |
| `grep` | 内容搜索 | read |
| `list-directory` | 列出目录 | read |
| `bash` | 执行命令 | execute |
| `web-fetch` | 获取网页 | read |
| `http-request` | HTTP 请求 | read |
| `ask-user` | 询问用户 | read |
| `spawn_agent` | 创建子 agent | execute |
| `mcp-*` | MCP 服务器工具 | 动态 |

### 6.4 Session 管理

- 每个 agent 运行产生一个 session
- Session 以 JSONL 格式持久化
- 主 agent session 和子 agent session 独立存储
- 支持 session 恢复（`resume` 命令；TUI 亦可通过 `--attach <session>` 接入）

## 7. 事件系统

### RuntimeEvent 类型

| 事件 | 说明 |
|------|------|
| `session_started` | 会话开始 |
| `user_turn` | 用户输入 |
| `assistant_chunk` | 助手流式输出片段 |
| `assistant_message` | 助手完整消息 |
| `tool_call_requested` | 工具调用请求 |
| `permission_decision` | 权限决策 |
| `tool_started` | 工具开始执行 |
| `tool_result` | 工具执行成功 |
| `tool_failed` | 工具执行失败 |
| `session_ended` | 会话结束 |
| `agent_spawned` | 子 agent 被创建 |
| `agent_completed` | 子 agent 完成 |
| `skill_started` | 技能开始执行 |
| `skill_result` | 技能执行结果 |

### SessionRecord 类型

| 记录类型 | 说明 |
|----------|------|
| `message` | 消息记录 |
| `tool_call` | 工具调用记录 |
| `permission` | 权限决策记录 |
| `tool_result` | 工具结果记录 |
| `session` | 会话开始记录 |
| `session_end` | 会话结束记录 |

## 8. 技能系统

技能是更高层次的抽象，封装常见工作流。

### 内置技能

| 技能 | 别名 | 说明 |
|------|------|------|
| `/help` | | 显示帮助 |
| `/status` | `/stat` | 显示状态 |
| `/tools` | | 列出工具 |
| `/init` | | 初始化项目 |
| `/context` | `/ctx` | 显示上下文 |

### 技能来源

1. **内置** (`src/skills/skills/`): 随 wasteland 发布
2. **项目级** (`.wasteland/skills/`): 项目特定技能
3. **用户级** (`~/.wasteland/skills/`): 用户自定义技能

## 9. 国际化（i18n）

- 支持语言: `en`（英语）、`zh`（中文）
- 默认语言: `en`
- 可通过 `settings.json` -> `runtime.language` 切换
- 所有用户可见文本必须通过 `t()` 函数获取
- 禁止在源码中硬编码用户可见的文本

## 10. 文档引用

本文档与以下文档互补（接口细则，有效）：

| 文档 | 说明 |
|------|------|
| `docs/architecture/input-output-adapters.md` | Adapter 接口细则、实现类清单与扩展新 UI 的步骤 |

以下文档保留为实现记录，与本文档冲突时以本文档为准：

| 文档 | 状态 | 说明 |
|------|------|------|
| `docs/architecture/agent-cli.md` | 过时 | 基线描述需更新 |
| `docs/architecture/multi-agent-architecture.md` | 部分过时 | 角色系统描述需更新 |
| `docs/architecture/skills.md` | 部分过时 | 产品名需修正 |
| `docs/implementation/phase-3-multi-step-agent-loop.md` | 过时 | 需标注状态 |
| `README.md` | 部分过时 | 项目结构和命令需更新 |
