# wasteland 核心架构规范

> 本文档是 wasteland 项目的**唯一事实来源**（Single Source of Truth）。
> 其他文档与本文档冲突时，以本文档为准。

## 1. 概述

**wasteland** 是一个废土主题的多 Agent CLI 系统。灵感来自 Mad Max 世界观，主 Agent "Immortan Joe" 作为指挥官，管理多个子 Agent "War Boys" 协同完成任务。

### 技术栈

| 组件 | 技术 |
|------|------|
| 语言 | TypeScript (ES2022, NodeNext) |
| CLI 框架 | Commander |
| 响应式流 | RxJS |
| TUI 框架 | Ink (React) |
| 运行时 | Node.js >= 20 |

### CLI 命令

- **主命令**: `wasteland`（`package.json` bin 字段注册，npm 安装时自动可用）
- **角色别名**: 由 `scripts/create-aliases.sh` 根据皮肤配置**动态创建**的 symlink
  - 默认创建 `joe`（Immortan Joe 的简写）
  - 切换皮肤时，别名随皮肤角色配置变化
  - 别名指向同一个 `bin/wasteland.js` 入口

```
wasteland chat [--message "..."] [--provider <type>] [--model <name>]
wasteland tui
wasteland config current
wasteland sessions [list|show|delete]
wasteland resume <session-id>
wasteland skin [list|show|load|info]
joe chat --message "..."   # 动态别名，等同于 wasteland chat
```

## 2. Agent 架构模型

### 2.1 主 Agent（Immortan Joe）

- **数量**: 唯一 1 个，**不可增加**
- **默认皮肤**: Immortan Joe
- **职责**: 接收用户输入，分析任务，决定是否 spawn 子 agent，汇总结果
- **可覆盖**: 皮肤配置、角色配置均可通过 settings 覆盖
- **不可覆盖**: 不能添加第二个主 agent

### 2.2 子 Agent（War Boys）

- **数量**: 默认 4 个，可增加自定义子 agent
- **默认角色**:

| 子 Agent | 职责 | 典型 tools |
|----------|------|-----------|
| `coder` | 编写和修改代码 | read-file, write-file, edit-file, bash |
| `planner` | 分析任务、制定计划 | read-file, glob, grep, list-directory |
| `reviewer` | 审查代码质量 | read-file, glob, grep |
| `researcher` | 调研技术方案 | read-file, glob, grep, web-fetch |

- **可覆盖**: 现有子 agent 的配置可被覆盖
- **可新增**: 通过 `settings.json` 的 `subAgents` 字段添加自定义子 agent

### 2.3 协作模式：严格层级

```
用户 ──→ Main Agent (Immortan Joe)
              │
              ├── spawn ──→ Coder Agent ──→ 结果返回
              ├── spawn ──→ Planner Agent ──→ 结果返回
              ├── spawn ──→ Reviewer Agent ──→ 结果返回
              └── spawn ──→ Researcher Agent ──→ 结果返回
              │
              ▼
         Main Agent 汇总 ──→ 用户
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
| `name` | 角色显示名 | "Immortan Joe" |
| `title` | 头衔 | "The Warlord" |
| `greeting` | 问候语 | "Witness me, mortal!" |
| `catchphrases` | 口癖列表 | ["Shiny and chrome!", "Mediocre!"] |
| `personality` | 性格描述 | "Ruthless leader, speaks in commands" |
| `ui.banner` | 启动横幅 | { title, subtitle, style } |
| `ui.colors` | 主题颜色 | { primary, secondary, accent, muted } |
| `ui.labels` | 界面标签 | { user, assistant, system } |
| `ui.messages` | 提示消息 | { welcome, thinking, success, error } |

**皮肤文件位置**:
- 项目级: `.wasteland/skins/<skin-id>.json`
- 用户级: `~/.wasteland/skins/<skin-id>.json`

### 3.2 Role 层（能力）

角色定义 agent 的实际行为能力，决定会话链路。

| 字段 | 说明 | 来源 |
|------|------|------|
| `systemPrompt` | 系统提示词 | settings.json → subAgents → promptTemplate |
| `tools` | 可用工具列表 | settings.json → subAgents → tools |
| `permissions` | 权限模式 | settings.json → runtime → permissionMode |
| `model` | 使用的模型 | settings.json → subAgents → model |

**角色配置位置**: `settings.json`（或 `.wasteland/settings.json`）

### 3.3 关联方式

皮肤和角色通过 **agent name** 关联：

```json
// settings.json
{
  "subAgents": {
    "coder": {
      "model": "sonnet",
      "promptTemplate": "coder-prompt",
      "tools": ["read-file", "write-file", "edit-file", "bash"]
    }
  }
}

// .wasteland/skins/wasteland.json
{
  "roles": {
    "workers": {
      "coder": {
        "name": "Scabrous Scrotus",
        "greeting": "Code or die!",
        "catchphrases": ["Witness my commits!"]
      }
    }
  }
}
```

两个文件通过 `"coder"` 这个 name 关联。皮肤切换不影响角色配置。

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
  "subAgents": {
    "coder": {
      "model": "smart",
      "tools": ["read-file", "write-file", "edit-file", "bash"]
    },
    "planner": {
      "model": "smart",
      "tools": ["read-file", "glob", "grep", "list-directory"]
    },
    "reviewer": {
      "model": "smart",
      "tools": ["read-file", "glob", "grep"]
    },
    "researcher": {
      "model": "fast",
      "tools": ["read-file", "glob", "grep", "web-fetch"]
    },
    "my-custom-agent": {
      "description": "自定义 agent",
      "model": "fast",
      "tools": ["read-file", "bash"]
    }
  },
  "runtime": {
    "defaultRole": "immortan-joe",
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
命令行参数 (--provider, --model, etc.)
```

### 4.3 皮肤加载优先级

```
.wasteland/skins/<skin-id>.json (项目级)
  ↓ 回退
~/.wasteland/skins/<skin-id>.json (用户级)
  ↓ 回退
内置默认皮肤 (Immortan Joe)
```

## 5. 运行时架构

### 5.1 Agent Loop

```
用户输入
  ↓
TurnContext 构建（system prompt + history + tools）
  ↓
Provider.runStep(TurnContext, TurnState)
  ↓ 返回 Observable<ProviderStreamEvent>
  ├── assistant_chunk → 流式输出文本
  ├── tool_call → ToolRegistry.dispatch()
  │     ├── 普通工具 → 执行并返回结果
  │     └── spawn_agent → 创建子 agent session
  │           ├── 子 agent 独立运行 agent loop
  │           └── 结果返回主 agent
  └── assistant_message → turn 结束
  ↓
检查 maxStepsPerTurn / maxTurns
  ↓
TurnState 更新，进入下一轮
```

### 5.2 Provider 抽象

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

### 5.3 工具系统

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

### 5.4 Session 管理

- 每个 agent 运行产生一个 session
- Session 以 JSONL 格式持久化
- 主 agent session 和子 agent session 独立存储
- 支持 session 恢复（`resume` 命令）

## 6. 事件系统

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

## 7. 技能系统

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

## 8. 国际化（i18n）

- 支持语言: `en`（英语）、`zh`（中文）
- 默认语言: `en`
- 可通过 `settings.json` → `runtime.language` 切换
- 所有用户可见文本必须通过 `t()` 函数获取
- 禁止在源码中硬编码用户可见的文本

## 9. 文档引用

本文档引用的现有文档（保留为实现记录，以本文档为准）:

| 文档 | 状态 | 说明 |
|------|------|------|
| `docs/architecture/agent-cli.md` | 过时 | 基线描述需更新 |
| `docs/architecture/multi-agent-architecture.md` | 部分过时 | 角色系统描述需更新 |
| `docs/architecture/skills.md` | 部分过时 | 产品名需修正 |
| `docs/implementation/phase-3-multi-step-agent-loop.md` | 过时 | 需标注状态 |
| `README.md` | 部分过时 | 项目结构和命令需更新 |
